/**
 * Casos de uso da Solicitação de Contrato (aditivos e distratos em ./addenda.ts).
 *
 *   draft ──enviar──▶ submitted (Concluído)
 *     │                   │
 *     └──── cancel ───────┘ (cancelled)
 *
 * A solicitação fica na aba "Solicitação de contrato" do QC e nasce ANTES da aprovação do quadro:
 * pode ser gerada a partir da revisão corrente (com vencedora ou cotação escolhida, tipo de contrato e
 * datas) e é gerada automaticamente ao enviar o QC para aprovação. Enquanto está em rascunho, os
 * itens acompanham o mapa: ao enviar o QC eles são refeitos pela revisão enviada (os vínculos de
 * planejamento editados à mão ficam, se o item não mudou de quantidade). Enviar e concluir só depois
 * do QC aprovado. Os vínculos de planejamento (IP · Qtd) podem ser editados pelo Planejamento
 * (contract.planning) também depois do envio do QC e com o contrato concluído.
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
import type { CompetitionData, ContractData, NewContractRequest, Repositories } from '../ports'
import { canDecideCurrent, directorUsers } from './approval-flows'

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
  // Etapas de aprovação de cada aditivo; sem etapas (enviado antes dos fluxos), decisão única antiga
  const byAddendum = await repos.approvalFlows.listForAddenda(c.addenda.map((a) => a.id))
  const addenda = c.addenda.map((a) => ({ ...a, approvals: byAddendum.get(a.id) ?? [] }))
  const submitted = addenda.find((a) => a.status === 'submitted')
  const users = submitted?.approvals.length ? await directorUsers(repos) : new Map<string, string | null>()
  const decideAddendum = !!submitted && (submitted.approvals.length
    ? can(ctx.actor, 'approval.decide', workId) && canDecideCurrent(ctx.actor, workId, submitted.approvals, users)
    : canDecideAddendum(ctx.actor, workId))
  const qcApproved = (await repos.competitions.getRevisionRef(c.revision.id))?.status === 'approved'
  const planning = can(ctx.actor, 'contract.planning', workId) || manage
  return {
    ...c,
    addenda,
    contractTypes,
    issues: c.status === 'draft' && !qcApproved ? [...issues, { field: 'competition', message: 'O QC ainda não foi aprovado: o contrato só é concluído depois da aprovação.' }] : issues,
    qcApproved,
    can: {
      manage,
      edit: manage && c.status === 'draft',
      submit: manage && c.status === 'draft' && qcApproved,
      sync: manage && c.status === 'draft',
      planning: planning && c.status !== 'cancelled',
      cancel: manage && (c.status === 'draft' || c.status === 'submitted'),
      addendum: manage && isConcluded(c.status) && !openAddendum,
      decideAddendum,
    },
  }
}

// ----------------------------------------------------------------------------- criação
/**
 * Revisão de onde a solicitação sai: a aprovada, se houver; senão a corrente (rascunho ou em
 * aprovação). A solicitação nasce antes da aprovação do quadro.
 */
export async function contractSourceRevision(repos: Repositories, competitionId: string): Promise<CompetitionData | null> {
  const current = await repos.competitions.getData(competitionId)
  if (!current) return null
  const approved = current.revisions.find((r) => r.status === 'approved')
  if (approved) return approved.id === current.revision.id ? current : await repos.competitions.getData(competitionId, approved.id)
  return current.revision.status === 'draft' || current.revision.status === 'in_approval' ? current : null
}

/** Solicitações que a revisão gera: uma (vencedora) ou uma por empresa da cotação escolhida. */
function draftsOf(data: CompetitionData) {
  const map = buildQcMap(data)
  const chosen = hasChosenQuotation(data)
  const drafts = chosen
    ? buildChosenContractDrafts(data, map).filter((d) => d.items.length)
    : data.revision.winnerSupplierId && data.suppliers.some((s) => s.supplierId === data.revision.winnerSupplierId)
      ? [buildContractDraft(data, map)]
      : []
  const missing = chosen ? unchosenItems(data, map) : []
  return { map, chosen, drafts, unchosen: missing.length ? ` Itens sem empresa escolhida (fora das solicitações): ${missing.map((m) => m.code).join(', ')}.` : '' }
}

function notesOf(draft: ContractDraft, chosen: boolean, unchosen: string) {
  return (
    (draft.excluded.length
      ? `Itens não cotados pela ${chosen ? 'empresa escolhida' : 'vencedora'} (fora deste contrato): ${draft.excluded.map((e) => e.code).join(', ')}.`
      : '') + unchosen
  ).trim()
}

const itemsOf = (draft: ContractDraft) =>
  draft.items.map((i) => ({
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
  }))

/** Valores do cabeçalho que vêm do QC (total, distribuição e verba) */
function totalsOf(draft: ContractDraft, map: ReturnType<typeof buildQcMap>, chosen: boolean) {
  // Cotação escolhida: cada solicitação leva a verba dos seus insumos; vencedora única: a do QC inteiro
  const budget = chosen ? contractBudgetShare(draft, map) : { budgetAmount: map.budgetTotal, availableAmount: map.available }
  return {
    totalAmount: draft.total.toDb(),
    pctMaterial: draft.distribution.pctMaterial.toFixed(6),
    pctEquipment: draft.distribution.pctEquipment.toFixed(6),
    pctService: draft.distribution.pctService.toFixed(6),
    budgetAmount: budget.budgetAmount.toDb(),
    availableAmount: budget.availableAmount.toDb(),
  }
}

/**
 * Gera a solicitação a partir da revisão aprovada ou, antes da aprovação, da revisão corrente.
 *  - Sem cotação escolhida: uma solicitação com a empresa vencedora indicada.
 *  - Com cotação escolhida: uma por empresa escolhida, com os insumos escolhidos para ela. As empresas
 *    que já têm solicitação ativa nesta concorrência ficam de fora (gera só as que faltam).
 */
export async function createContractRequest(repos: Repositories, ctx: RequestContext, competitionId: string) {
  const current = await repos.competitions.getData(competitionId)
  if (!current) throw notFound('Concorrência')
  const workId = current.competition.workId
  requirePermission(ctx, 'contract.manage', workId)

  const data = await contractSourceRevision(repos, competitionId)
  if (!data) throw new DomainError('CONTRACT_NO_REVISION', 'A concorrência não tem revisão em rascunho, em aprovação ou aprovada para gerar a solicitação.')
  const active = (await repos.contracts.list({ competitionId })).filter((c) => c.status !== 'cancelled')
  const r = data.revision
  const chosen = hasChosenQuotation(data)
  if (!chosen && active[0]) throw new AppError('CONTRACT_EXISTS', `Já existe a solicitação ${active[0].code} para esta concorrência.`, 409, { id: active[0].id })
  if ((!chosen && !r.winnerSupplierId) || !r.contractTypeId || !r.serviceStartOn || !r.serviceEndOn) {
    throw new DomainError(
      'CONTRACT_REVISION_INCOMPLETE',
      'Para gerar a solicitação, preencha no QC a empresa vencedora (ou a cotação escolhida no mapa), o tipo de contrato e as datas do serviço.',
    )
  }
  const { map, drafts: all, unchosen } = draftsOf(data)

  let drafts: ContractDraft[]
  if (chosen) {
    const contracted = new Set(active.map((c) => c.supplierId))
    drafts = all.filter((d) => !contracted.has(d.supplierId))
    if (!drafts.length) {
      const existing = active.find((c) => all.some((d) => d.supplierId === c.supplierId))
      if (existing) throw new AppError('CONTRACT_EXISTS', 'Todas as empresas da cotação escolhida já têm solicitação de contrato.', 409, { id: existing.id })
      throw new DomainError('CONTRACT_NO_ITEMS', 'Nenhuma empresa escolhida cotou os insumos escolhidos para ela.')
    }
  } else {
    drafts = all
    if (!drafts[0]?.items.length) throw new DomainError('CONTRACT_NO_ITEMS', 'A empresa vencedora não cotou nenhum item com quantidade.')
  }

  const work = (await repos.catalog.getWork(workId))!
  const created: { id: string; code: string; excluded: number }[] = []
  for (const draft of drafts) {
    const notes = notesOf(draft, chosen, unchosen)
    const { id, code } = await createWithFreshCode(repos, workId, work.code, ctx.actor.id, {
      competitionId,
      revisionId: r.id,
      supplierId: draft.supplierId,
      contractTypeId: r.contractTypeId,
      startOn: r.serviceStartOn,
      endOn: r.serviceEndOn,
      ...totalsOf(draft, map, chosen),
      scopeDefinitions: r.engineeringNotes,
      notes: notes || null,
      items: itemsOf(draft),
    })
    created.push({ id, code, excluded: draft.excluded.length })
  }
  // id/code/excluded: a primeira (compatível com a solicitação única); created: todas as geradas
  return { ...created[0]!, created }
}

const formatRev = (n: number) => `R${String(n).padStart(2, '0')}`

/**
 * Acompanha o mapa: refaz os itens das solicitações em RASCUNHO pela revisão informada (a enviada
 * à aprovação ou a corrente). Concluídas não mudam.
 *  - Especificação, % retenção e vínculos de planejamento editados ficam (os vínculos, quando o item
 *    continua com a mesma quantidade).
 *  - Empresa que saiu da cotação: o rascunho dela é cancelado.
 *  - `create`: gera as que faltam (ao enviar o QC para aprovação a solicitação passa a existir).
 */
export async function syncContractRequests(repos: Repositories, ctx: RequestContext, competitionId: string, revisionId: string, opts: { create: boolean }) {
  const data = await repos.competitions.getData(competitionId, revisionId)
  if (!data) throw notFound('Concorrência')
  const r = data.revision
  const { map, chosen, drafts, unchosen } = draftsOf(data)
  const active = (await repos.contracts.list({ competitionId })).filter((c) => c.status !== 'cancelled')
  const result = { updated: 0, created: 0, cancelled: 0 }
  for (const ac of active.filter((c) => c.status === 'draft')) {
    const draft = drafts.find((d) => d.supplierId === ac.supplierId)
    if (!draft) {
      await repos.contracts.update(ac.id, { status: 'cancelled', cancelReason: `Empresa fora da cotação da ${formatRev(r.number)} do QC (cancelada ao atualizar pelo mapa).` })
      result.cancelled++
      continue
    }
    const old = await repos.contracts.get(ac.id)
    const kept = new Map((old?.items ?? []).map((i) => [i.competitionItemId, i]))
    const items = itemsOf(draft).map((i) => {
      const before = kept.get(i.competitionItemId)
      if (!before) return i
      const sameQty = Decimal.from(before.quantity).eq(i.quantity) && before.allocations.length > 0
      return {
        ...i,
        specification: before.specification ?? i.specification,
        pctRetention: before.pctRetention,
        allocations: sameQty ? before.allocations.map((a) => ({ packageCode: a.packageCode, quantity: a.quantity })) : i.allocations,
      }
    })
    await repos.contracts.replaceItems(ac.id, items)
    const notes = notesOf(draft, chosen, unchosen)
    await repos.contracts.update(ac.id, { revisionId: r.id, ...totalsOf(draft, map, chosen), notes: notes || null })
    result.updated++
  }
  if (opts.create && r.contractTypeId && r.serviceStartOn && r.serviceEndOn) {
    const covered = new Set(active.map((c) => c.supplierId))
    const missing = drafts.filter((d) => d.items.length && !covered.has(d.supplierId) && (chosen || !active.length))
    if (missing.length) {
      const work = (await repos.catalog.getWork(data.competition.workId))!
      for (const draft of missing) {
        const notes = notesOf(draft, chosen, unchosen)
        await createWithFreshCode(repos, data.competition.workId, work.code, ctx.actor.id, {
          competitionId,
          revisionId: r.id,
          supplierId: draft.supplierId,
          contractTypeId: r.contractTypeId,
          startOn: r.serviceStartOn,
          endOn: r.serviceEndOn,
          ...totalsOf(draft, map, chosen),
          scopeDefinitions: r.engineeringNotes,
          notes: notes || null,
          items: itemsOf(draft),
        })
        result.created++
      }
    }
  }
  return result
}

/** Botão "Atualizar pelo mapa" da solicitação em rascunho */
export async function syncContractFromMap(repos: Repositories, ctx: RequestContext, id: string) {
  const c = await loadContract(repos, ctx, id, 'contract.manage')
  assertStatus(c, ['draft'], 'Somente solicitações em rascunho acompanham o mapa.')
  const data = await contractSourceRevision(repos, c.competition.id)
  if (!data) throw new DomainError('CONTRACT_NO_REVISION', 'A concorrência não tem revisão para atualizar a solicitação.')
  return syncContractRequests(repos, ctx, c.competition.id, data.revision.id, { create: false })
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

/** Ainda há solicitação a gerar? (QC sem solicitação ativa, ou empresa escolhida ainda sem a dela) */
export async function contractPending(repos: Repositories, competitionId: string) {
  const data = await contractSourceRevision(repos, competitionId)
  if (!data) return false
  const r = data.revision
  if (!r.contractTypeId || !r.serviceStartOn || !r.serviceEndOn) return false
  const active = (await repos.contracts.list({ competitionId })).filter((c) => c.status !== 'cancelled')
  if (!hasChosenQuotation(data)) return !!r.winnerSupplierId && active.length === 0
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
  if ((await repos.competitions.getRevisionRef(c.revision.id))?.status !== 'approved') {
    throw new DomainError('CONTRACT_QC_NOT_APPROVED', 'O QC ainda não foi aprovado: o contrato só é concluído depois da aprovação do quadro.')
  }
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

// ----------------------------------------------------------------------------- vínculos de planejamento
/**
 * Vínculos (IP · Qtd) de um item, editados pelo Planejamento depois do envio do QC (também com o
 * contrato concluído). A soma fecha com a quantidade do item; IP repetido é somado. As referências
 * do item não mudam.
 */
export async function setContractItemAllocations(
  repos: Repositories,
  ctx: RequestContext,
  id: string,
  itemId: string,
  allocations: { packageCode: string; quantity: string }[],
) {
  const c = await loadContract(repos, ctx, id)
  if (!can(ctx.actor, 'contract.planning', c.work.id) && !can(ctx.actor, 'contract.manage', c.work.id)) {
    throw new AppError('FORBIDDEN', 'Sem permissão para editar os vínculos de planejamento.', 403)
  }
  assertStatus(c, ['draft', 'submitted', 'sent_to_erp', 'signed'], 'Solicitação cancelada não pode ser alterada.')
  const item = c.items.find((i) => i.id === itemId)
  if (!item) throw notFound('Item do contrato')
  const merged = new Map<string, Decimal>()
  for (const a of allocations) {
    const q = Decimal.from(a.quantity)
    if (q.isNegative()) throw new DomainError('ALLOCATION_NEGATIVE', 'A quantidade do vínculo não pode ser negativa.')
    if (q.isZero()) continue
    const code = a.packageCode.trim()
    merged.set(code, (merged.get(code) ?? Decimal.ZERO).plus(q))
  }
  if (!merged.size) throw new DomainError('ALLOCATION_EMPTY', 'Informe ao menos um vínculo de planejamento.')
  const sum = Decimal.sum([...merged.values()])
  if (!sum.eq(item.quantity)) {
    throw new DomainError('ALLOCATION_SUM', `A soma dos vínculos (${sum.toFixed()}) precisa fechar com a quantidade do item (${Decimal.from(item.quantity).toFixed()}).`)
  }
  await repos.contracts.setAllocations(id, itemId, [...merged].map(([packageCode, q]) => ({ packageCode, quantity: q.toDb() })))
}
