/**
 * Casos de uso do Quadro de Concorrência.
 * Orquestram domínio puro (shared/domain) + repositórios. Sem acoplamento a HTTP ou UI.
 */
import type {
  BudgetLineDTO,
  CompetitionDetailDTO,
  CreateCompetitionInput,
  DecideApprovalInput,
  SetItemLinksInput,
  UpdateItemInput,
  UpdateRevisionInput,
  UpdateSupplierTermsInput,
  UpsertPricesInput,
} from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import { buildApprovalPlan, decide, type ApprovalInstance } from '../../../shared/domain/approval/approval-flow'
import { lineTotal } from '../../../shared/domain/competition/best-condition'
import { buildQcMap, type QcMap } from '../../../shared/domain/competition/qc-map'
import {
  approvalAmount,
  assertEditable,
  canCreateRevision,
  DomainError,
  isEditable,
} from '../../../shared/domain/competition/revision'
import { buildSnapshot } from '../../../shared/domain/competition/snapshot'
import { groupBudgetLines, itemBudgetFromLines, lineBalances, lineBudgetValue, linkFromQuantity, linkFromShare, type GroupedItem } from '../../../shared/domain/planning/links'
import { AppError, can, notFound, requirePermission, roleIdsFor, type RequestContext } from '../context'
import type { AggregatedInput, CompetitionData, ComputedPersistence, Repositories } from '../ports'

const today = (ctx: RequestContext) => ctx.now().toISOString().slice(0, 10)

// ----------------------------------------------------------------------------- leitura
export async function listCompetitions(repos: Repositories, ctx: RequestContext, filter: { workId?: string }) {
  const all = await repos.competitions.list(filter)
  return all.filter((c) => can(ctx.actor, 'competition.read', c.workId))
}

export async function getCompetition(
  repos: Repositories,
  ctx: RequestContext,
  competitionId: string,
  revisionId?: string,
): Promise<CompetitionDetailDTO> {
  const data = await repos.competitions.getData(competitionId, revisionId)
  if (!data) throw notFound('Concorrência')
  requirePermission(ctx, 'competition.read', data.competition.workId)
  const work = await repos.catalog.getWork(data.competition.workId)
  const budgetId = work?.currentBudgetId ?? data.competition.budgetId
  const [allLines, commitments] = await Promise.all([
    repos.catalog.listBudgetLines(budgetId),
    repos.competitions.workCommitments(data.competition.workId),
  ])
  // Linhas relevantes ao consolidador: IPs e insumos tocados pelo QC (o orçamento inteiro seria pesado)
  const pkgs = new Set(data.links.map((l) => l.packageCode).filter(Boolean))
  const mats = new Set(data.links.map((l) => l.materialId))
  const keys = new Set(data.links.map((l) => l.lineKey))
  return {
    ...withCapabilities(ctx, data),
    budgetLines: allLines.filter((l) => pkgs.has(l.packageCode) || mats.has(l.materialId) || keys.has(l.lineKey)),
    otherCommitments: commitments.links.filter((l) => l.competitionId !== competitionId),
  }
}

function withCapabilities(ctx: RequestContext, data: CompetitionData): Omit<CompetitionDetailDTO, 'budgetLines' | 'otherCommitments'> {
  const workId = data.competition.workId
  const editable = isEditable(data.revision)
  const roles = roleIdsFor(ctx.actor, workId)
  const pending = data.approvals.find((a) => a.status === 'pending')
  const isLatest = data.revisions.every((r) => r.number <= data.revision.number)
  return {
    ...data,
    can: {
      edit: editable && can(ctx.actor, 'competition.edit', workId),
      editPrices: editable && can(ctx.actor, 'proposal.edit', workId),
      submit: editable && can(ctx.actor, 'competition.submit', workId),
      decide:
        data.revision.status === 'in_approval' &&
        !!pending &&
        roles.includes(pending.roleId) &&
        can(ctx.actor, 'approval.decide', workId),
      createRevision: isLatest && canCreateRevision(data.revisions).ok && can(ctx.actor, 'competition.edit', workId),
    },
  }
}

// ----------------------------------------------------------------------------- criação
export async function createCompetition(repos: Repositories, ctx: RequestContext, input: CreateCompetitionInput) {
  requirePermission(ctx, 'competition.create', input.workId)
  const work = await repos.catalog.getWork(input.workId)
  if (!work) throw notFound('Obra')
  if (!work.currentBudgetId) {
    throw new AppError('BUDGET_MISSING', 'A obra não possui orçamento vigente. Sincronize com o ERP.', 409)
  }

  const lines = await repos.catalog.listBudgetLines(work.currentBudgetId)
  const pkgs = new Set(input.packageCodes ?? [])
  const lineIdSet = new Set(input.lineIds ?? [])
  const codes = new Set(input.materialCodes ?? [])
  const selected = lines.filter((l) =>
    lineIdSet.size ? lineIdSet.has(l.id) : (pkgs.size ? !!l.packageCode && pkgs.has(l.packageCode) : true) && (codes.size ? codes.has(l.code) : true),
  )
  // Cada linha entra com o % escolhido pelo usuário; sem escolha, com o % ainda livre na obra
  const commitments = await repos.competitions.workCommitments(input.workId)
  const balances = lineBalances(selected, commitments.links)
  const shares = parseShares(input.lineShares)
  assertSharesWithinBalance(selected, shares, balances)
  const available = new Map([...balances].map(([k, v]) => [k, v.balanceShare]))
  const items = toAggregated(groupBudgetLines(selected, { available, shares }))
  if (!items.length) {
    throw new AppError('NO_ITEMS', 'Nenhuma linha do orçamento com saldo disponível para os IPs/linhas selecionados.', 422)
  }
  const principal =
    input.packageCodes?.[0] ??
    [...items.flatMap((i) => i.links)].sort((a, b) => Decimal.from(b.budgetValue).compare(a.budgetValue))[0]?.packageCode ??
    null

  const budgetAmount = Decimal.sum(items.map((i) => i.total)).round(4)
  const code = await repos.competitions.nextCode(input.workId)

  const ids = await repos.competitions.create(
    {
      workId: input.workId,
      budgetId: work.currentBudgetId,
      code,
      title: input.title,
      description: input.description ?? null,
      packageCode: principal,
      requestedOn: input.requestedOn ?? today(ctx),
      procurementOwnerId: ctx.actor.id,
      budgetAmount: budgetAmount.toDb(),
      items,
    },
    ctx.actor.id,
  )
  await recompute(repos, ids.competitionId, ids.revisionId)
  return ids
}

// ----------------------------------------------------------------------------- edição do rascunho
async function loadEditable(repos: Repositories, ctx: RequestContext, revisionId: string, permission: string) {
  const ref = await repos.competitions.getRevisionRef(revisionId)
  if (!ref) throw notFound('Revisão')
  requirePermission(ctx, permission, ref.workId)
  assertEditable(ref)
  return ref
}

function serializeBest(map: QcMap): ComputedPersistence['best'] {
  return map.best.map((b) => ({
    itemId: b.itemId,
    competitionSupplierId: b.competitionSupplierId,
    unitPrice: b.unitPrice?.toDb() ?? null,
    totalPrice: b.totalPrice?.toDb() ?? null,
    budgetTotal: b.budgetTotal.toDb(),
    varianceAmount: b.varianceAmount?.toDb() ?? null,
    varianceRatio: b.varianceRatio?.toFixed(6) ?? null,
    isOverride: b.isOverride,
    overrideReason: b.overrideReason,
  }))
}

/** Recalcula melhores condições/totais com o domínio e persiste o resultado. */
export async function recompute(repos: Repositories, competitionId: string, revisionId: string): Promise<QcMap> {
  const data = await repos.competitions.getData(competitionId, revisionId)
  if (!data) throw notFound('Concorrência')
  const map = buildQcMap(data)

  const itemQty = new Map(map.items.map((i) => [i.id, i.quantity]))
  const computed: ComputedPersistence = {
    priceTotals: map.prices.map((p) => ({
      competitionSupplierId: p.competitionSupplierId,
      itemId: p.itemId,
      totalPrice: p.unitPrice ? lineTotal(p.unitPrice, itemQty.get(p.itemId) ?? Decimal.ZERO).toDb() : null,
    })),
    proposalTotals: map.summaries.map((s) => ({ competitionSupplierId: s.competitionSupplierId, total: s.total.toDb() })),
    best: serializeBest(map),
    awardedTotal: map.awardedTotal.toDb(),
    linkValues: map.links.map((l) => ({
      linkId: l.id!,
      awardedUnitPrice: l.awardedUnitPrice?.toDb() ?? null,
      awardedTotal: l.awardedTotal?.toDb() ?? null,
    })),
  }
  await repos.competitions.persistComputed(revisionId, computed)
  return map
}

export async function updateRevision(repos: Repositories, ctx: RequestContext, revisionId: string, input: UpdateRevisionInput) {
  const ref = await loadEditable(repos, ctx, revisionId, 'competition.edit')
  const { engineeringOwnerId, procurementOwnerId, ...revisionPatch } = input
  if (engineeringOwnerId !== undefined || procurementOwnerId !== undefined) {
    await repos.competitions.updateCompetition(ref.competitionId, { engineeringOwnerId, procurementOwnerId })
  }
  if (Object.keys(revisionPatch).length) await repos.competitions.updateRevision(revisionId, revisionPatch)
  await recompute(repos, ref.competitionId, revisionId)
}

export async function updateItem(repos: Repositories, ctx: RequestContext, revisionId: string, itemId: string, input: UpdateItemInput) {
  const ref = await loadEditable(repos, ctx, revisionId, 'competition.edit')
  if (input.pctMaterial !== undefined && input.pctEquipment !== undefined) {
    if (Decimal.from(input.pctMaterial).plus(input.pctEquipment).gt(1)) {
      throw new DomainError('PCT_INVALID', '% material + % equipamento não pode exceder 100%.')
    }
  }
  await repos.competitions.updateItem(itemId, input)
  await recompute(repos, ref.competitionId, revisionId)
}

export async function addSupplier(repos: Repositories, ctx: RequestContext, revisionId: string, supplierId: string) {
  const ref = await loadEditable(repos, ctx, revisionId, 'competition.edit')
  const supplier = await repos.catalog.getSupplier(supplierId)
  if (!supplier) throw notFound('Fornecedor')
  const data = await repos.competitions.getData(ref.competitionId, revisionId)
  if (data!.suppliers.some((s) => s.supplierId === supplierId)) {
    throw new AppError('SUPPLIER_DUPLICATED', 'Fornecedor já participa desta revisão.', 409)
  }
  const sortOrder = data!.suppliers.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1
  const id = await repos.competitions.addSupplier(revisionId, supplier, sortOrder)
  await recompute(repos, ref.competitionId, revisionId)
  return { id }
}

export async function updateSupplier(repos: Repositories, ctx: RequestContext, revisionId: string, competitionSupplierId: string, input: UpdateSupplierTermsInput) {
  const ref = await loadEditable(repos, ctx, revisionId, 'proposal.edit')
  await repos.competitions.updateSupplier(competitionSupplierId, input)
  await recompute(repos, ref.competitionId, revisionId)
}

export async function removeSupplier(repos: Repositories, ctx: RequestContext, revisionId: string, competitionSupplierId: string) {
  const ref = await loadEditable(repos, ctx, revisionId, 'competition.edit')
  await repos.competitions.removeSupplier(competitionSupplierId)
  await recompute(repos, ref.competitionId, revisionId)
}

export async function upsertPrices(repos: Repositories, ctx: RequestContext, revisionId: string, input: UpsertPricesInput) {
  const ref = await loadEditable(repos, ctx, revisionId, 'proposal.edit')
  await repos.competitions.upsertPrices(revisionId, input.prices)
  const map = await recompute(repos, ref.competitionId, revisionId)
  return { bestMixTotal: map.mixTotal.toDb() }
}

export async function setBestOverride(
  repos: Repositories,
  ctx: RequestContext,
  revisionId: string,
  input: { itemId: string; competitionSupplierId: string | null; reason?: string },
) {
  const ref = await loadEditable(repos, ctx, revisionId, 'competition.edit')
  const data = (await repos.competitions.getData(ref.competitionId, revisionId))!
  const overrides = data.overrides.filter((o) => o.itemId !== input.itemId)
  if (input.competitionSupplierId) {
    if (!input.reason?.trim()) throw new DomainError('OVERRIDE_REASON', 'Justifique a escolha manual do fornecedor.')
    overrides.push({ itemId: input.itemId, competitionSupplierId: input.competitionSupplierId, reason: input.reason.trim() })
  }
  // valida via domínio antes de persistir
  const map = buildQcMap({ ...data, overrides })
  await repos.competitions.persistComputed(revisionId, {
    priceTotals: [],
    proposalTotals: [],
    best: serializeBest(map),
  })
}

function toAggregated(groups: GroupedItem[]): AggregatedInput[] {
  return groups.map((g) => ({
    materialId: g.materialId,
    code: g.code,
    description: g.description,
    unit: g.unit,
    quantity: g.quantity.toDb(),
    unitCost: g.unitCost.toDb(),
    total: g.budget.toDb(),
    links: g.links.map((l) => ({
      activityItemId: l.activityItemId,
      lineKey: l.lineKey,
      materialId: l.materialId,
      packageCode: l.packageCode,
      packageDescription: l.packageDescription,
      quantity: l.quantity.toDb(),
      share: l.share.toFixed(6),
      budgetValue: l.budget.toDb(),
      budgetUnitCost: l.budgetUnitCost.toDb(),
    })),
  }))
}

function parseShares(raw: Record<string, string> | undefined): Map<string, Decimal> {
  return new Map(Object.entries(raw ?? {}).map(([id, v]) => [id, Decimal.from(v).round(6)]))
}

/** O % pedido para uma linha não pode exceder o % ainda livre (descontados os outros QCs da obra). */
function assertSharesWithinBalance(
  lines: BudgetLineDTO[],
  shares: Map<string, Decimal>,
  balances: ReturnType<typeof lineBalances>,
) {
  const over = lines.filter((l) => {
    const s = shares.get(l.id)
    const free = balances.get(l.lineKey)?.balanceShare
    return s && free && s.gt(Decimal.max(Decimal.ZERO, free).round(6))
  })
  if (over.length) {
    const l = over[0]!
    throw new AppError(
      'SHARE_OVER_BALANCE',
      `O percentual informado excede o saldo livre da linha ${l.code} (${l.packageCode ?? 'sem IP'})${over.length > 1 ? ` e de mais ${over.length - 1} linha(s)` : ''}.`,
      422,
    )
  }
}

/** Converte vínculos de entrada (por % ou por quantidade) em vínculos persistíveis. */
function buildLink(line: BudgetLineDTO, spec: { share?: Decimal; quantity?: Decimal }) {
  const v = spec.share ? linkFromShare(line, spec.share) : linkFromQuantity(line, spec.quantity!.round(4))
  return {
    activityItemId: line.id,
    lineKey: line.lineKey,
    materialId: line.materialId,
    packageCode: line.packageCode,
    packageDescription: line.packageDescription,
    quantity: v.quantity.toDb(),
    share: v.share.toFixed(6),
    budgetValue: v.budgetValue.toDb(),
    budgetUnitCost: v.quantity.isZero() ? Decimal.from(line.unitCost).toDb() : v.budgetValue.div(v.quantity, 4).toDb(),
  }
}

/** Orçado de cada item = linhas vinculadas; total orçado da revisão acompanha. */
async function syncBudgetFromLinks(repos: Repositories, competitionId: string, revisionId: string, itemIds?: string[]) {
  const data = (await repos.competitions.getData(competitionId, revisionId))!
  const lines = await repos.catalog.getBudgetLines([...new Set(data.links.map((l) => l.activityItemId).filter((x): x is string => !!x))])
  const byId = new Map(lines.map((l) => [l.id, l]))
  for (const item of data.items.filter((i) => !itemIds || itemIds.includes(i.id))) {
    const parts = data.links
      .filter((l) => l.itemId === item.id)
      .map((l) => {
        const q = Decimal.from(l.quantity)
        const line = l.activityItemId ? byId.get(l.activityItemId) : undefined
        const budget = l.budgetValue != null ? Decimal.from(l.budgetValue) : line ? lineBudgetValue(line, q) : q.times(l.budgetUnitCost).round(4)
        return { quantity: q, budget }
      })
    if (!parts.length) continue
    const b = itemBudgetFromLines(parts)
    if (!b.quantity.eq(item.budgetQuantity) || !b.unitCost.eq(item.budgetUnitCost)) {
      await repos.competitions.updateItem(item.id, { budgetQuantity: b.quantity.toDb(), budgetUnitCost: b.unitCost.toDb() })
    }
  }
  const after = (await repos.competitions.getData(competitionId, revisionId))!
  const budgetAmount = Decimal.sum(after.items.map((i) => Decimal.from(i.budgetQuantity).times(i.budgetUnitCost).round(4)))
  if (!budgetAmount.eq(after.revision.budgetAmount)) await repos.competitions.updateRevision(revisionId, { budgetAmount: budgetAmount.toDb() })
}

/**
 * Define os vínculos de um item: linhas do orçamento (de qualquer IP) e a quantidade de cada uma.
 */
export async function setItemLinks(repos: Repositories, ctx: RequestContext, revisionId: string, itemId: string, input: SetItemLinksInput) {
  const ref = await loadEditable(repos, ctx, revisionId, 'competition.edit')
  const data = (await repos.competitions.getData(ref.competitionId, revisionId))!
  if (!data.items.some((i) => i.id === itemId)) throw notFound('Item')
  const ids = [...new Set(input.links.map((l) => l.activityItemId))]
  if (ids.length !== input.links.length) throw new AppError('LINK_DUPLICATED', 'A mesma linha do orçamento foi informada duas vezes.', 422)
  const lines = await repos.catalog.getBudgetLines(ids)
  if (lines.length !== ids.length) throw new AppError('LINK_LINE', 'Linha do orçamento não encontrada.', 422)
  const byId = new Map(lines.map((l) => [l.id, l]))
  const links = input.links.map((l) =>
    buildLink(byId.get(l.activityItemId)!, {
      share: l.share !== undefined ? Decimal.from(l.share) : undefined,
      quantity: l.quantity !== undefined ? Decimal.from(l.quantity) : undefined,
    }),
  )
  // Teto: o % de cada linha não pode passar do que os outros QCs da obra deixaram livre
  const commitments = await repos.competitions.workCommitments(ref.workId)
  const others = commitments.links.filter((c) => c.competitionId !== ref.competitionId)
  const balances = lineBalances(lines, others)
  assertSharesWithinBalance(lines, new Map(links.map((l) => [l.activityItemId, Decimal.from(l.share)])), balances)

  // Se a quantidade do item acompanhava os vínculos, continua acompanhando
  const item = data.items.find((i) => i.id === itemId)!
  const oldLinked = Decimal.sum(data.links.filter((l) => l.itemId === itemId).map((l) => l.quantity))
  const newLinked = Decimal.sum(links.map((l) => l.quantity))
  if (oldLinked.eq(item.quantity) && !newLinked.eq(item.quantity)) {
    await repos.competitions.updateItem(itemId, { quantity: newLinked.round(4).toDb() })
  }
  await repos.competitions.setItemLinks(revisionId, itemId, links)
  await syncBudgetFromLinks(repos, ref.competitionId, revisionId, [itemId])
  await recompute(repos, ref.competitionId, revisionId)
}

/**
 * Inclui linhas do orçamento no QC (de quaisquer IPs). Linhas de um insumo já presente viram
 * vínculo do item existente (e somam na quantidade); as demais criam itens novos.
 */
export async function addLines(repos: Repositories, ctx: RequestContext, revisionId: string, lineIds: string[], rawShares?: Record<string, string>) {
  const ref = await loadEditable(repos, ctx, revisionId, 'competition.edit')
  const data = (await repos.competitions.getData(ref.competitionId, revisionId))!
  const lines = await repos.catalog.getBudgetLines([...new Set(lineIds)])
  const already = new Set(data.links.map((l) => l.lineKey))
  const fresh = lines.filter((l) => !already.has(l.lineKey))
  if (!fresh.length) throw new AppError('LINES_ALREADY_LINKED', 'As linhas selecionadas já estão neste QC.', 409)

  const commitments = await repos.competitions.workCommitments(ref.workId)
  const others = commitments.links.filter((l) => l.competitionId !== ref.competitionId)
  const balances = lineBalances(fresh, others)
  const shares = parseShares(rawShares)
  assertSharesWithinBalance(fresh, shares, balances)
  const available = new Map([...balances].map(([k, v]) => [k, v.balanceShare]))
  const groups = groupBudgetLines(fresh, { available, shares })
  if (!groups.length) throw new AppError('NO_BALANCE', 'As linhas selecionadas já estão totalmente comprometidas em outras concorrências.', 422)

  const touched: string[] = []
  const newItems: GroupedItem[] = []
  for (const g of groups) {
    const item = data.items.find((i) => i.materialId === g.materialId)
    if (!item) {
      newItems.push(g)
      continue
    }
    const current = data.links.filter((l) => l.itemId === item.id && !!l.activityItemId)
    const currentLines = await repos.catalog.getBudgetLines(current.map((c) => c.activityItemId!))
    const byId = new Map(currentLines.map((l) => [l.id, l]))
    const kept = current
      .filter((c) => byId.has(c.activityItemId!))
      .map((c) => {
        const line = byId.get(c.activityItemId!)!
        return c.share != null
          ? buildLink(line, { share: Decimal.from(c.share) })
          : buildLink(line, { quantity: Decimal.from(c.quantity) })
      })
    const extra = g.links.map((l) => ({
      activityItemId: l.activityItemId, lineKey: l.lineKey, materialId: l.materialId, packageCode: l.packageCode,
      packageDescription: l.packageDescription, quantity: l.quantity.toDb(), share: l.share.toFixed(6),
      budgetValue: l.budget.toDb(), budgetUnitCost: l.budgetUnitCost.toDb(),
    }))
    await repos.competitions.setItemLinks(revisionId, item.id, [...kept, ...extra])
    await repos.competitions.updateItem(item.id, { quantity: Decimal.from(item.quantity).plus(g.quantity).toDb() })
    touched.push(item.id)
  }
  const created = newItems.length ? await repos.competitions.addItems(revisionId, toAggregated(newItems)) : []
  await syncBudgetFromLinks(repos, ref.competitionId, revisionId, touched)
  await recompute(repos, ref.competitionId, revisionId)
  return { createdItems: created.length, mergedItems: touched.length }
}

export async function removeItem(repos: Repositories, ctx: RequestContext, revisionId: string, itemId: string) {
  const ref = await loadEditable(repos, ctx, revisionId, 'competition.edit')
  await repos.competitions.removeItem(itemId)
  await syncBudgetFromLinks(repos, ref.competitionId, revisionId, [])
  await recompute(repos, ref.competitionId, revisionId)
}

// ----------------------------------------------------------------------------- revisões e aprovações
/**
 * Status da concorrência acompanha a revisão corrente — exceto quando já está contratada:
 * novas revisões de um QC contratado não desfazem o contrato (alterações vão por aditivo).
 */
async function setCompetitionStatus(repos: Repositories, competitionId: string, status: 'open' | 'in_approval' | 'approved', patch: { currentRevisionId?: string } = {}) {
  const current = await repos.competitions.getData(competitionId)
  const keep = current?.competition.status === 'contracted'
  await repos.competitions.updateCompetition(competitionId, { ...patch, ...(keep ? { status: 'contracted' } : { status }) })
}

export async function createRevision(repos: Repositories, ctx: RequestContext, competitionId: string, reason: string) {
  const data = await repos.competitions.getData(competitionId)
  if (!data) throw notFound('Concorrência')
  requirePermission(ctx, 'competition.edit', data.competition.workId)
  const check = canCreateRevision(data.revisions)
  if (!check.ok) throw new DomainError('REVISION_NOT_ALLOWED', check.reason!)
  const base = [...data.revisions]
    .filter((r) => r.status === 'approved' || r.status === 'rejected')
    .sort((a, b) => b.number - a.number)[0]!
  const revisionId = await repos.competitions.cloneRevision(base.id, reason)
  if (data.competition.status === 'contracted') await repos.competitions.updateCompetition(competitionId, { status: 'contracted' })
  await recompute(repos, competitionId, revisionId)
  return { revisionId }
}

export async function submitRevision(repos: Repositories, ctx: RequestContext, revisionId: string) {
  const ref = await loadEditable(repos, ctx, revisionId, 'competition.submit')
  const data = (await repos.competitions.getData(ref.competitionId, revisionId))!
  const map = buildQcMap(data, { today: today(ctx) })
  if (map.issues.length) {
    throw new AppError('SUBMISSION_INVALID', 'Existem pendências para envio à aprovação.', 422, map.issues)
  }
  const amount = approvalAmount(map.winner?.summary.total ?? null, map.mixTotal)
  const plan = buildApprovalPlan(await repos.approvals.listSteps(), amount)
  await repos.approvals.createPlan(revisionId, plan)
  await repos.competitions.setRevisionStatus(revisionId, {
    status: 'in_approval',
    submittedAt: ctx.now().toISOString(),
    submittedBy: ctx.actor.id,
  })
  await setCompetitionStatus(repos, ref.competitionId, 'in_approval')
  return { steps: plan.length, amount: amount.toDb() }
}

export async function decideApproval(repos: Repositories, ctx: RequestContext, revisionId: string, input: DecideApprovalInput) {
  const ref = await repos.competitions.getRevisionRef(revisionId)
  if (!ref) throw notFound('Revisão')
  requirePermission(ctx, 'approval.decide', ref.workId)
  if (ref.status !== 'in_approval') throw new DomainError('REVISION_NOT_IN_APPROVAL', 'A revisão não está em aprovação.')

  const current: ApprovalInstance[] = (await repos.approvals.listForRevision(revisionId)).map((a) => ({
    stepOrder: a.stepOrder,
    stepName: a.stepName,
    roleId: a.roleId,
    status: a.status,
    decidedBy: a.decidedById,
    decidedAt: a.decidedAt,
    comment: a.comment,
  }))
  const nowIso = ctx.now().toISOString()
  const result = decide(current, {
    stepOrder: input.stepOrder,
    decision: input.decision,
    comment: input.comment ?? null,
    actorId: ctx.actor.id,
    actorRoleIds: roleIdsFor(ctx.actor, ref.workId),
    now: nowIso,
  })
  for (const step of result.approvals) {
    const before = current.find((c) => c.stepOrder === step.stepOrder)!
    if (before.status !== step.status) await repos.approvals.saveDecision(revisionId, step)
  }

  if (result.outcome === 'rejected') {
    await repos.competitions.setRevisionStatus(revisionId, { status: 'rejected', decidedAt: nowIso })
    await setCompetitionStatus(repos, ref.competitionId, 'open')
  } else if (result.outcome === 'approved') {
    await approveAndFreeze(repos, ctx, ref.competitionId, revisionId, nowIso)
  }
  return { outcome: result.outcome }
}

/** Congela a revisão: snapshot canônico + hash; revisão aprovada anterior → superseded. */
async function approveAndFreeze(repos: Repositories, ctx: RequestContext, competitionId: string, revisionId: string, nowIso: string) {
  // Revisão em aprovação não admite edição: o mapa é recalculado apenas para o snapshot.
  const data = (await repos.competitions.getData(competitionId, revisionId))!
  const map = buildQcMap(data)
  const { snapshot, hash } = await buildSnapshot({
    competition: data.competition,
    revision: { ...data.revision, status: 'approved', decidedAt: nowIso },
    items: data.items,
    suppliers: data.suppliers,
    prices: data.prices,
    approvals: await repos.approvals.listForRevision(revisionId),
    bestConditions: map.best,
    supplierSummaries: map.summaries,
    totals: {
      budget: map.budgetTotal,
      available: map.available,
      bestMix: map.mixTotal,
      winner: map.winner?.summary.total ?? null,
    },
    frozenBy: ctx.actor.id,
    frozenAt: nowIso,
  })

  for (const prev of data.revisions.filter((r) => r.status === 'approved' && r.id !== revisionId)) {
    await repos.competitions.setRevisionStatus(prev.id, { status: 'superseded' })
  }
  await repos.competitions.setRevisionStatus(revisionId, {
    status: 'approved',
    decidedAt: nowIso,
    snapshot,
    snapshotHash: hash,
    frozenAt: nowIso,
  })
  await setCompetitionStatus(repos, competitionId, 'approved', { currentRevisionId: revisionId })
}

export async function listAudit(repos: Repositories, ctx: RequestContext, competitionId: string) {
  const data = await repos.competitions.getData(competitionId)
  if (!data) throw notFound('Concorrência')
  requirePermission(ctx, 'audit.read', data.competition.workId)
  return repos.audit.listForCompetition(competitionId, 300)
}
