/**
 * Casos de uso da Solicitação de Contrato e dos Aditivos.
 *
 *   draft ──submit──▶ submitted ──ERP──▶ sent_to_erp ──assinatura──▶ signed
 *     │                   │
 *     └──── cancel ───────┘ (cancelled)
 *
 * Aditivo: draft ──submit──▶ submitted ──Gerente/Diretoria──▶ approved | rejected
 */
import type {
  AddendumItemInput,
  ContractListItemDTO,
  ContractRequestDTO,
  SaveAddendumInput,
  UpdateContractItemInput,
  UpdateContractRequestInput,
} from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import { buildQcMap } from '../../../shared/domain/competition/qc-map'
import { DomainError } from '../../../shared/domain/competition/revision'
import {
  buildContractDraft,
  computeAddendum,
  contractDistribution,
  currentEndOn,
  validateAddendum,
  validateContractRequest,
  type AddendumLine,
} from '../../../shared/domain/contract/contract-request'
import type { ERPProvider } from '../../infrastructure/erp/erp-provider'
import { AppError, can, notFound, requirePermission, type Actor, type RequestContext } from '../context'
import type { AddendumContent, ContractData, NewAddendumItem, Repositories } from '../ports'

const today = (ctx: RequestContext) => ctx.now().toISOString().slice(0, 10)

/** Aditivo é decidido pela Gerência/Diretoria (planilha: "Assinatura Gerente / Diretoria"). */
const ADDENDUM_DECIDERS = new Set(['manager', 'director', 'admin'])
function canDecideAddendum(actor: Actor, workId: string) {
  return can(actor, 'approval.decide', workId) && actor.roles.some((r) => ADDENDUM_DECIDERS.has(r.roleKey) && (r.workId === null || r.workId === workId))
}

async function load(repos: Repositories, ctx: RequestContext, id: string, permission = 'contract.read'): Promise<ContractData> {
  const c = await repos.contracts.get(id)
  if (!c) throw notFound('Solicitação de contrato')
  requirePermission(ctx, permission, c.work.id)
  return c
}

function assertStatus(c: ContractData, allowed: ContractData['status'][], message: string) {
  if (!allowed.includes(c.status)) throw new DomainError('CONTRACT_STATUS', message, { status: c.status })
}

function headerOf(c: ContractData) {
  return {
    contractTypeId: c.contractType.id,
    startOn: c.startOn,
    endOn: c.endOn,
    supplierId: c.supplier.id,
    secondSupplierId: c.secondSupplier?.id ?? null,
    directBilling: c.contractType.directBilling,
    directBillingMaterials: c.directBillingMaterials,
    measurementCriteria: c.measurementCriteria,
    supplierCndValidUntil: c.supplier.cndValidUntil,
  }
}

// ----------------------------------------------------------------------------- leitura
export async function listContracts(repos: Repositories, ctx: RequestContext, filter: { workId?: string; competitionId?: string }): Promise<ContractListItemDTO[]> {
  const all = await repos.contracts.list(filter)
  return all.filter((c) => can(ctx.actor, 'contract.read', c.workId))
}

export async function getContract(repos: Repositories, ctx: RequestContext, id: string): Promise<ContractRequestDTO> {
  const c = await load(repos, ctx, id)
  const workId = c.work.id
  const manage = can(ctx.actor, 'contract.manage', workId)
  const openAddendum = c.addenda.some((a) => a.status === 'draft' || a.status === 'submitted')
  const contractTypes = await repos.catalog.listContractTypes()
  const issues = c.status === 'draft' ? validateContractRequest(headerOf(c), c.items.map((i) => ({ quantity: Decimal.from(i.quantity) })), today(ctx)) : []
  return {
    ...c,
    contractTypes,
    issues,
    can: {
      manage,
      edit: manage && c.status === 'draft',
      submit: manage && c.status === 'draft',
      cancel: manage && (c.status === 'draft' || c.status === 'submitted'),
      pushToErp: manage && c.status === 'submitted',
      sign: manage && (c.status === 'submitted' || c.status === 'sent_to_erp'),
      addendum: manage && ['submitted', 'sent_to_erp', 'signed'].includes(c.status) && !openAddendum,
      decideAddendum: canDecideAddendum(ctx.actor, workId) && c.addenda.some((a) => a.status === 'submitted'),
    },
  }
}

// ----------------------------------------------------------------------------- criação
export async function createContractRequest(repos: Repositories, ctx: RequestContext, competitionId: string) {
  const current = await repos.competitions.getData(competitionId)
  if (!current) throw notFound('Concorrência')
  const workId = current.competition.workId
  requirePermission(ctx, 'contract.manage', workId)

  const approved = current.revisions.find((r) => r.status === 'approved')
  if (!approved) throw new DomainError('CONTRACT_NO_APPROVED_REVISION', 'A concorrência não possui revisão aprovada para gerar o contrato.')
  const existing = (await repos.contracts.list({ competitionId })).find((c) => c.status !== 'cancelled')
  if (existing) throw new AppError('CONTRACT_EXISTS', `Já existe a solicitação ${existing.code} para esta concorrência.`, 409, { id: existing.id })

  const data = (await repos.competitions.getData(competitionId, approved.id))!
  const r = data.revision
  if (!r.winnerSupplierId || !r.contractTypeId || !r.serviceStartOn || !r.serviceEndOn) {
    throw new DomainError('CONTRACT_REVISION_INCOMPLETE', 'A revisão aprovada não tem vencedora, tipo de contrato ou datas do serviço.')
  }
  const map = buildQcMap(data)
  const draft = buildContractDraft(data, map)
  if (!draft.items.length) throw new DomainError('CONTRACT_NO_ITEMS', 'A empresa vencedora não cotou nenhum item com quantidade.')

  const work = (await repos.catalog.getWork(workId))!
  const code = await repos.contracts.nextCode(workId, work.code)
  const id = await repos.contracts.create(
    {
      competitionId,
      revisionId: approved.id,
      supplierId: r.winnerSupplierId,
      contractTypeId: r.contractTypeId,
      code,
      startOn: r.serviceStartOn,
      endOn: r.serviceEndOn,
      totalAmount: draft.total.toDb(),
      pctMaterial: draft.distribution.pctMaterial.toFixed(6),
      pctEquipment: draft.distribution.pctEquipment.toFixed(6),
      pctService: draft.distribution.pctService.toFixed(6),
      budgetAmount: map.budgetTotal.toDb(),
      availableAmount: map.available.toDb(),
      scopeDefinitions: r.engineeringNotes,
      notes: draft.excluded.length
        ? `Itens não cotados pela vencedora (fora deste contrato): ${draft.excluded.map((e) => e.code).join(', ')}.`
        : null,
      items: draft.items.map((i) => ({
        competitionItemId: i.competitionItemId,
        materialId: i.materialId,
        code: i.code,
        description: i.description,
        specification: i.specification,
        unit: i.unit,
        quantity: i.quantity.toDb(),
        unitPrice: i.unitPrice.toDb(),
        pctRetention: i.pctRetention.toFixed(6),
        pctMaterial: i.pctMaterial.toFixed(6),
        pctEquipment: i.pctEquipment.toFixed(6),
        allocations: i.allocations.map((a) => ({ packageCode: a.packageCode, quantity: a.quantity.toDb() })),
      })),
    },
    ctx.actor.id,
  )
  return { id, code, excluded: draft.excluded.length }
}

// ----------------------------------------------------------------------------- edição do rascunho
export async function updateContractRequest(repos: Repositories, ctx: RequestContext, id: string, input: UpdateContractRequestInput) {
  const c = await load(repos, ctx, id, 'contract.manage')
  assertStatus(c, ['draft'], 'Somente solicitações em rascunho podem ser alteradas.')
  const startOn = input.startOn ?? c.startOn
  const endOn = input.endOn ?? c.endOn
  if (endOn < startOn) throw new DomainError('CONTRACT_DATES', 'O término deve ser posterior ao início.')
  if (input.secondSupplierId) {
    if (input.secondSupplierId === c.supplier.id) throw new DomainError('CONTRACT_SECOND_SUPPLIER', 'O 2º contratado deve ser diferente do contratado principal.')
    if (!(await repos.catalog.getSupplier(input.secondSupplierId))) throw notFound('Fornecedor')
  }
  if (input.contractTypeId && !(await repos.catalog.listContractTypes()).some((t) => t.id === input.contractTypeId)) throw notFound('Tipo de contrato')
  await repos.contracts.update(id, input)
}

export async function updateContractItem(repos: Repositories, ctx: RequestContext, id: string, itemId: string, input: UpdateContractItemInput) {
  const c = await load(repos, ctx, id, 'contract.manage')
  assertStatus(c, ['draft'], 'Somente solicitações em rascunho podem ser alteradas.')
  if (!c.items.some((i) => i.id === itemId)) throw notFound('Item do contrato')
  await repos.contracts.updateItem(id, itemId, input)
}

// ----------------------------------------------------------------------------- ciclo de vida
export async function submitContractRequest(repos: Repositories, ctx: RequestContext, id: string) {
  const c = await load(repos, ctx, id, 'contract.manage')
  assertStatus(c, ['draft'], 'A solicitação já foi enviada.')
  const items = c.items.map((i) => ({ quantity: Decimal.from(i.quantity), totalPrice: Decimal.from(i.totalPrice), pctMaterial: Decimal.from(i.pctMaterial), pctEquipment: Decimal.from(i.pctEquipment) }))
  const issues = validateContractRequest(headerOf(c), items, today(ctx))
  if (issues.length) throw new AppError('CONTRACT_INVALID', 'Existem pendências na solicitação de contrato.', 422, issues)
  // Distribuição recalculada no envio (o percentual dos itens é a fonte)
  const dist = contractDistribution(items)
  await repos.contracts.update(id, { status: 'submitted', submittedAt: ctx.now().toISOString(), submittedBy: ctx.actor.id })
  await repos.competitions.updateCompetition(c.competition.id, { status: 'contracted' })
  return { status: 'submitted' as const, pctService: dist.pctService.toFixed(6) }
}

export async function cancelContractRequest(repos: Repositories, ctx: RequestContext, id: string, reason: string) {
  const c = await load(repos, ctx, id, 'contract.manage')
  assertStatus(c, ['draft', 'submitted'], 'Somente solicitações em rascunho ou enviadas (antes do ERP) podem ser canceladas.')
  await repos.contracts.update(id, { status: 'cancelled', cancelReason: reason })
  if (c.status === 'submitted') {
    // Sem contrato, a concorrência volta a refletir a revisão corrente
    const comp = await repos.competitions.getData(c.competition.id)
    const rev = comp?.revision.status
    const status = rev === 'approved' ? 'approved' : rev === 'in_approval' ? 'in_approval' : 'open'
    await repos.competitions.updateCompetition(c.competition.id, { status })
  }
  return { status: 'cancelled' as const }
}

/** Envia o contrato ao ERP (UAU/Senior via ERPProvider) e registra o integration_log. */
export async function pushContractToErp(repos: Repositories, erp: ERPProvider, ctx: RequestContext, id: string) {
  const c = await load(repos, ctx, id, 'contract.manage')
  assertStatus(c, ['submitted'], 'Somente solicitações enviadas podem ir para o ERP.')
  if (!c.work.erpId || !c.supplier.erpId) {
    throw new DomainError('CONTRACT_ERP_IDS', 'Obra ou fornecedor sem código no ERP. Sincronize os cadastros antes de enviar.')
  }
  const logId = await repos.integrationLogs.start({
    correlationId: ctx.correlationId, provider: erp.name, operation: 'push_contract', direction: 'outbound', triggeredBy: ctx.actor.id, integrationId: c.code,
  })
  try {
    const { erpContractId } = await erp.pushContract({
      contractRequestId: c.id,
      workErpId: c.work.erpId,
      supplierErpId: c.supplier.erpId,
      contractTypeCode: c.contractType.code,
      startOn: c.startOn,
      endOn: c.endOn,
      items: c.items.map((i) => ({ materialCode: i.code, quantity: i.quantity, unitPrice: i.unitPrice })),
    })
    await repos.contracts.update(id, { status: 'sent_to_erp', sentToErpAt: ctx.now().toISOString(), erpContractId })
    await repos.integrationLogs.finish(logId, { status: 'success', recordsProcessed: c.items.length, recordsFailed: 0, message: `Contrato ${erpContractId} criado no ERP` })
    return { erpContractId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await repos.integrationLogs.finish(logId, { status: 'error', recordsProcessed: 0, recordsFailed: c.items.length, message, errorDetail: { message } })
    throw new AppError('ERP_PUSH_FAILED', `Falha ao enviar ao ERP: ${message}`, 502)
  }
}

export async function signContract(repos: Repositories, ctx: RequestContext, id: string, input: { signedOn: string; erpContractId?: string }) {
  const c = await load(repos, ctx, id, 'contract.manage')
  assertStatus(c, ['submitted', 'sent_to_erp'], 'A solicitação precisa estar enviada para registrar a assinatura.')
  if (input.signedOn > today(ctx)) throw new DomainError('CONTRACT_SIGN_DATE', 'A data de assinatura não pode ser futura.')
  const erpContractId = input.erpContractId?.trim() || c.erpContractId
  await repos.contracts.update(id, { status: 'signed', signedOn: input.signedOn, ...(erpContractId !== c.erpContractId ? { erpContractId } : {}) })
  return { status: 'signed' as const }
}

// ----------------------------------------------------------------------------- aditivos
/** Resolve as linhas de entrada (item do contrato ou item novo) em linhas persistíveis. */
function resolveAddendumItems(c: ContractData, items: AddendumItemInput[]): NewAddendumItem[] {
  const byId = new Map(c.items.map((i) => [i.id, i]))
  const seen = new Set<string>()
  return items.map((it) => {
    if (it.contractItemId) {
      const ci = byId.get(it.contractItemId)
      if (!ci) throw new AppError('ADDENDUM_ITEM', 'Item não pertence a este contrato.', 422)
      if (seen.has(ci.id)) throw new AppError('ADDENDUM_ITEM_DUPLICATED', `O item ${ci.code} foi informado duas vezes.`, 422)
      seen.add(ci.id)
      return {
        contractItemId: ci.id, materialId: ci.materialId, code: ci.code, description: ci.description, unit: ci.unit,
        quantityDelta: Decimal.from(it.quantityDelta).round(4).toDb(),
        unitPrice: Decimal.from(it.unitPrice ?? ci.unitPrice).round(4).toDb(),
      }
    }
    const n = it as Extract<AddendumItemInput, { code: string }>
    return {
      contractItemId: null, materialId: null, code: n.code, description: n.description, unit: n.unit,
      quantityDelta: Decimal.from(n.quantityDelta).round(4).toDb(), unitPrice: Decimal.from(n.unitPrice).round(4).toDb(),
    }
  })
}

const toLine = (i: { contractItemId: string | null; code: string; quantityDelta: string; unitPrice: string }): AddendumLine => ({
  contractItemId: i.contractItemId, code: i.code, quantityDelta: Decimal.from(i.quantityDelta), unitPrice: Decimal.from(i.unitPrice),
})

function summarize(c: ContractData, items: NewAddendumItem[], excludeAddendumId?: string) {
  const approved = c.addenda.filter((a) => a.status === 'approved' && a.id !== excludeAddendumId)
  return computeAddendum(
    c.items.map((i) => ({ id: i.id, quantity: Decimal.from(i.quantity), totalPrice: Decimal.from(i.totalPrice) })),
    approved.flatMap((a) => a.items.map(toLine)),
    items.map(toLine),
  )
}

function contentOf(c: ContractData, input: SaveAddendumInput, ctx: RequestContext, addendumId?: string): AddendumContent {
  const items = resolveAddendumItems(c, input.items)
  const summary = summarize(c, items, addendumId)
  return {
    reason: input.reason.trim(),
    requestedOn: input.requestedOn ?? today(ctx),
    newEndOn: input.newEndOn ?? null,
    totalDelta: summary.totalDelta.toDb(),
    items,
  }
}

export async function createAddendum(repos: Repositories, ctx: RequestContext, contractId: string, input: SaveAddendumInput) {
  const c = await load(repos, ctx, contractId, 'contract.manage')
  assertStatus(c, ['submitted', 'sent_to_erp', 'signed'], 'Aditivos só podem ser solicitados para contratos já enviados.')
  if (c.addenda.some((a) => a.status === 'draft' || a.status === 'submitted')) {
    throw new DomainError('ADDENDUM_OPEN', 'Já existe um aditivo em aberto (rascunho ou aguardando aprovação).')
  }
  const number = c.addenda.reduce((m, a) => Math.max(m, a.number), 0) + 1
  const id = await repos.contracts.createAddendum(contractId, number, contentOf(c, input, ctx), ctx.actor.id)
  return { id, number }
}

async function loadAddendum(repos: Repositories, ctx: RequestContext, addendumId: string, permission: string) {
  const ref = await repos.contracts.getAddendumRef(addendumId)
  if (!ref) throw notFound('Aditivo')
  const c = await load(repos, ctx, ref.contractId, permission)
  const a = c.addenda.find((x) => x.id === addendumId)!
  return { c, a }
}

export async function saveAddendum(repos: Repositories, ctx: RequestContext, addendumId: string, input: SaveAddendumInput) {
  const { c, a } = await loadAddendum(repos, ctx, addendumId, 'contract.manage')
  if (a.status !== 'draft') throw new DomainError('ADDENDUM_LOCKED', 'Somente aditivos em rascunho podem ser alterados.')
  await repos.contracts.saveAddendum(addendumId, contentOf(c, input, ctx, addendumId))
}

export async function deleteAddendum(repos: Repositories, ctx: RequestContext, addendumId: string) {
  const { a } = await loadAddendum(repos, ctx, addendumId, 'contract.manage')
  if (a.status !== 'draft') throw new DomainError('ADDENDUM_LOCKED', 'Somente aditivos em rascunho podem ser excluídos.')
  await repos.contracts.deleteAddendum(addendumId)
}

export async function submitAddendum(repos: Repositories, ctx: RequestContext, addendumId: string) {
  const { c, a } = await loadAddendum(repos, ctx, addendumId, 'contract.manage')
  if (a.status !== 'draft') throw new DomainError('ADDENDUM_LOCKED', 'O aditivo já foi enviado.')
  const approved = c.addenda.filter((x) => x.status === 'approved')
  const summary = summarize(c, a.items.map((i) => ({ ...i, materialId: null })), a.id)
  const issues = validateAddendum(
    { reason: a.reason, newEndOn: a.newEndOn, contractStartOn: c.startOn, currentEndOn: currentEndOn(c.endOn, approved) },
    summary,
  )
  if (issues.length) throw new AppError('ADDENDUM_INVALID', 'Existem pendências no aditivo.', 422, issues)
  await repos.contracts.updateAddendum(addendumId, { status: 'submitted', submittedAt: ctx.now().toISOString(), submittedBy: ctx.actor.id })
  return { status: 'submitted' as const }
}

export async function decideAddendum(repos: Repositories, ctx: RequestContext, addendumId: string, input: { decision: 'approved' | 'rejected'; comment?: string | null }) {
  const { c, a } = await loadAddendum(repos, ctx, addendumId, 'contract.read')
  if (!canDecideAddendum(ctx.actor, c.work.id)) {
    throw new AppError('FORBIDDEN', 'Aditivos são aprovados pela Gerência ou Diretoria.', 403)
  }
  if (a.status !== 'submitted') throw new DomainError('ADDENDUM_NOT_SUBMITTED', 'O aditivo não está aguardando aprovação.')
  const comment = input.comment?.trim() || null
  if (input.decision === 'rejected' && !comment) throw new DomainError('ADDENDUM_REJECT_COMMENT', 'Informe o motivo da reprovação.')
  await repos.contracts.updateAddendum(addendumId, { status: input.decision, decidedAt: ctx.now().toISOString(), decidedBy: ctx.actor.id, decisionComment: comment })
  return { status: input.decision }
}
