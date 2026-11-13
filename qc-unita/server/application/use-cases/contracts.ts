/**
 * Casos de uso da Solicitação de Contrato (aditivos e distratos em ./addenda.ts).
 *
 *   draft ──enviar──▶ submitted (Concluído)
 *     │                   │
 *     └──── cancel ───────┘ (cancelled)
 *
 * A aprovação acontece no QC (a solicitação só nasce de revisão aprovada); enviar conclui.
 * Não há assinatura nem envio ao ERP (sem API de contrato). sent_to_erp e signed são de
 * contratos antigos e também valem como concluídos.
 */
import type {
  ContractListItemDTO,
  ContractRequestDTO,
  UpdateContractItemInput,
  UpdateContractRequestInput,
} from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import { buildQcMap } from '../../../shared/domain/competition/qc-map'
import { DomainError } from '../../../shared/domain/competition/revision'
import {
  buildChosenContractDrafts,
  buildContractDraft,
  isConcluded,
  contractBudgetShare,
  contractDistribution,
  hasChosenQuotation,
  unchosenItems,
  validateContractRequest,
  type ContractDraft,
} from '../../../shared/domain/contract/contract-request'
import { AppError, can, notFound, requirePermission, type Actor, type RequestContext } from '../context'
import type { ContractData, NewContractRequest, Repositories } from '../ports'

const today = (ctx: RequestContext) => ctx.now().toISOString().slice(0, 10)

/** Aditivo é decidido pela Gerência/Diretoria (planilha: "Assinatura Gerente / Diretoria"). */
const ADDENDUM_DECIDERS = new Set(['manager', 'director', 'admin'])
export function canDecideAddendum(actor: Actor, workId: string) {
  return can(actor, 'approval.decide', workId) && actor.roles.some((r) => ADDENDUM_DECIDERS.has(r.roleKey) && (r.workId === null || r.workId === workId))
}

export async function loadContract(repos: Repositories, ctx: RequestContext, id: string, permission = 'contract.read'): Promise<ContractData> {
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
  const c = await loadContract(repos, ctx, id)
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
      addendum: manage && isConcluded(c.status) && !openAddendum,
      decideAddendum: canDecideAddendum(ctx.actor, workId) && c.addenda.some((a) => a.status === 'submitted'),
    },
  }
}

// ----------------------------------------------------------------------------- criação
/**
 * Gera a solicitação a partir da revisão aprovada.
 *  - Sem cotação escolhida: uma solicitação com a empresa vencedora indicada.
 *  - Com cotação escolhida: uma por empresa escolhida, com os insumos escolhidos para ela. As empresas
 *    que já têm solicitação ativa nesta concorrência ficam de fora (gera só as que faltam).
 */
export async function createContractRequest(repos: Repositories, ctx: RequestContext, competitionId: string) {
  const current = await repos.competitions.getData(competitionId)
  if (!current) throw notFound('Concorrência')
  const workId = current.competition.workId
  requirePermission(ctx, 'contract.manage', workId)

  const approved = current.revisions.find((r) => r.status === 'approved')
  if (!approved) throw new DomainError('CONTRACT_NO_APPROVED_REVISION', 'A concorrência não possui revisão aprovada para gerar o contrato.')
  const active = (await repos.contracts.list({ competitionId })).filter((c) => c.status !== 'cancelled')

  const data = (await repos.competitions.getData(competitionId, approved.id))!
  const r = data.revision
  const chosen = hasChosenQuotation(data)
  if (!chosen && active[0]) throw new AppError('CONTRACT_EXISTS', `Já existe a solicitação ${active[0].code} para esta concorrência.`, 409, { id: active[0].id })
  if ((!chosen && !r.winnerSupplierId) || !r.contractTypeId || !r.serviceStartOn || !r.serviceEndOn) {
    throw new DomainError('CONTRACT_REVISION_INCOMPLETE', 'A revisão aprovada não tem vencedora, tipo de contrato ou datas do serviço.')
  }
  const map = buildQcMap(data)

  let drafts: ContractDraft[]
  let unchosen = ''
  if (chosen) {
    const contracted = new Set(active.map((c) => c.supplierId))
    const all = buildChosenContractDrafts(data, map)
    drafts = all.filter((d) => !contracted.has(d.supplierId) && d.items.length)
    if (!drafts.length) {
      const existing = active.find((c) => all.some((d) => d.supplierId === c.supplierId))
      if (existing) throw new AppError('CONTRACT_EXISTS', 'Todas as empresas da cotação escolhida já têm solicitação de contrato.', 409, { id: existing.id })
      throw new DomainError('CONTRACT_NO_ITEMS', 'Nenhuma empresa escolhida cotou os insumos escolhidos para ela.')
    }
    const missing = unchosenItems(data, map)
    if (missing.length) unchosen = ` Itens sem empresa escolhida (fora das solicitações): ${missing.map((m) => m.code).join(', ')}.`
  } else {
    drafts = [buildContractDraft(data, map)]
    if (!drafts[0]!.items.length) throw new DomainError('CONTRACT_NO_ITEMS', 'A empresa vencedora não cotou nenhum item com quantidade.')
  }

  const work = (await repos.catalog.getWork(workId))!
  const created: { id: string; code: string; excluded: number }[] = []
  for (const draft of drafts) {
    const notes = (
      (draft.excluded.length
        ? `Itens não cotados pela ${chosen ? 'empresa escolhida' : 'vencedora'} (fora deste contrato): ${draft.excluded.map((e) => e.code).join(', ')}.`
        : '') + unchosen
    ).trim()
    // Cotação escolhida: cada solicitação leva a verba dos seus insumos; vencedora única: a do QC inteiro
    const budget = chosen ? contractBudgetShare(draft, map) : { budgetAmount: map.budgetTotal, availableAmount: map.available }
    const { id, code } = await createWithFreshCode(repos, workId, work.code, ctx.actor.id, {
      competitionId,
      revisionId: approved.id,
      supplierId: draft.supplierId,
      contractTypeId: r.contractTypeId,
      startOn: r.serviceStartOn,
      endOn: r.serviceEndOn,
      totalAmount: draft.total.toDb(),
      pctMaterial: draft.distribution.pctMaterial.toFixed(6),
      pctEquipment: draft.distribution.pctEquipment.toFixed(6),
      pctService: draft.distribution.pctService.toFixed(6),
      budgetAmount: budget.budgetAmount.toDb(),
      availableAmount: budget.availableAmount.toDb(),
      scopeDefinitions: r.engineeringNotes,
      notes: notes || null,
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
        references: i.references.map((r) => ({ ...r, budget: r.budget.toDb() })),
      })),
    })
    created.push({ id, code, excluded: draft.excluded.length })
  }
  // id/code/excluded: a primeira (compatível com a solicitação única); created: todas as geradas
  return { ...created[0]!, created }
}

/**
 * Grava a solicitação com o próximo número da obra. Dois pedidos ao mesmo tempo podiam calcular o
 * mesmo número: o banco recusa o repetido (código único) e aqui tenta de novo com o seguinte.
 */
export async function createWithFreshCode(repos: Repositories, workId: string, workCode: string, actorId: string, data: Omit<NewContractRequest, 'code'>) {
  for (let attempt = 1; ; attempt++) {
    const code = await repos.contracts.nextCode(workId, workCode)
    try {
      return { id: await repos.contracts.create({ ...data, code }, actorId), code }
    } catch (err) {
      if (attempt < 3 && /contract_requests_code_key/.test(err instanceof Error ? err.message : String(err))) continue
      throw err
    }
  }
}

/** Ainda há solicitação a gerar? (QC aprovado sem solicitação ativa, ou empresa escolhida ainda sem a dela) */
export async function contractPending(repos: Repositories, competitionId: string, revisions: { id: string; status: string }[]) {
  const approved = revisions.find((r) => r.status === 'approved')
  if (!approved) return false
  const active = (await repos.contracts.list({ competitionId })).filter((c) => c.status !== 'cancelled')
  const data = await repos.competitions.getData(competitionId, approved.id)
  if (!data || !hasChosenQuotation(data)) return active.length === 0
  const contracted = new Set(active.map((c) => c.supplierId))
  return buildChosenContractDrafts(data, buildQcMap(data)).some((d) => d.items.length && !contracted.has(d.supplierId))
}

// ----------------------------------------------------------------------------- edição do rascunho
export async function updateContractRequest(repos: Repositories, ctx: RequestContext, id: string, input: UpdateContractRequestInput) {
  const c = await loadContract(repos, ctx, id, 'contract.manage')
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
  const c = await loadContract(repos, ctx, id, 'contract.manage')
  assertStatus(c, ['draft'], 'Somente solicitações em rascunho podem ser alteradas.')
  if (!c.items.some((i) => i.id === itemId)) throw notFound('Item do contrato')
  await repos.contracts.updateItem(id, itemId, input)
}

// ----------------------------------------------------------------------------- ciclo de vida
export async function submitContractRequest(repos: Repositories, ctx: RequestContext, id: string) {
  const c = await loadContract(repos, ctx, id, 'contract.manage')
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
  const c = await loadContract(repos, ctx, id, 'contract.manage')
  assertStatus(c, ['draft', 'submitted'], 'Somente solicitações em rascunho ou concluídas podem ser canceladas.')
  await repos.contracts.update(id, { status: 'cancelled', cancelReason: reason })
  const others = (await repos.contracts.list({ competitionId: c.competition.id })).filter((x) => x.id !== id && x.status !== 'cancelled' && x.status !== 'draft')
  if (c.status === 'submitted' && !others.length) {
    // Sem contrato, a concorrência volta a refletir a revisão corrente
    const comp = await repos.competitions.getData(c.competition.id)
    const rev = comp?.revision.status
    const status = rev === 'approved' ? 'approved' : rev === 'in_approval' ? 'in_approval' : 'open'
    await repos.competitions.updateCompetition(c.competition.id, { status })
  }
  return { status: 'cancelled' as const }
}
