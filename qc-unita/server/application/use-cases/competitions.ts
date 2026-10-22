/**
 * Casos de uso do Quadro de Concorrência.
 * Orquestram domínio puro (shared/domain) + repositórios. Sem acoplamento a HTTP ou UI.
 */
import type {
  AddQcItemInput,
  BudgetLineDTO,
  CompetitionDetailDTO,
  CreateCompetitionInput,
  DecideApprovalInput,
  AddLinesInput,
  SetReferenceLinesInput,
  UpdateItemInput,
  UpdateRevisionInput,
  UpdateSupplierTermsInput,
  UpsertPricesInput,
} from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import { budgetReadiness, missingSummary } from '../../../shared/domain/budget/readiness'
import { buildApprovalPlan, decide, type ApprovalInstance } from '../../../shared/domain/approval/approval-flow'
import { lineTotal } from '../../../shared/domain/competition/best-condition'
import { buildQcMap, type QcMap } from '../../../shared/domain/competition/qc-map'
import {
  approvalAmount,
  assertEditable,
  baseRevisionFor,
  canCreateRevision,
  DomainError,
  isEditable,
} from '../../../shared/domain/competition/revision'
import { buildSnapshot } from '../../../shared/domain/competition/snapshot'
import { groupBudgetLines, lineBalances, linkFromQuantity, linkFromShare, type GroupedItem } from '../../../shared/domain/planning/links'
import { AppError, can, notFound, requirePermission, roleIdsFor, type RequestContext } from '../context'
import type { AggregatedInput, CompetitionData, ComputedPersistence, NewQcItem, Repositories } from '../ports'
import { namedBudgetStructure } from './works'

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

  const [lines, structure] = await Promise.all([repos.catalog.listBudgetLines(work.currentBudgetId), namedBudgetStructure(repos, work.currentBudgetId)])
  // Só com o orçamento 100% completo: toda linha com IP e todo Item com nome
  const readiness = budgetReadiness(structure.groups, lines)
  if (!readiness.ready) {
    throw new AppError(
      'BUDGET_INCOMPLETE',
      `Para criar uma concorrência, o orçamento precisa estar 100% com vínculos de planejamento e nomes dos Itens. Falta(m): ${missingSummary(readiness)}. Complete no orçamento da obra ou no De-para e use "Atualizar dados".`,
      409,
      readiness,
    )
  }
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
  const references = toAggregated(groupBudgetLines(selected, { available, shares }))
  if (!references.length) {
    throw new AppError('NO_ITEMS', 'Nenhuma linha do orçamento com saldo disponível para os IPs/linhas selecionados.', 422)
  }
  const principal =
    input.packageCodes?.[0] ??
    [...references.flatMap((i) => i.links)].sort((a, b) => Decimal.from(b.budgetValue).compare(a.budgetValue))[0]?.packageCode ??
    null

  const budgetAmount = Decimal.sum(references.map((i) => i.total)).round(4)
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
      references,
    },
    ctx.actor.id,
  )
  // O mapa já nasce preenchido com as referências (um insumo do mapa por referência)
  await repos.competitions.addItems(ids.revisionId, references.map((r, k) => itemFromReference(r, ids.referenceIds[k]!)))
  await recompute(repos, ids.competitionId, ids.revisionId)
  return { competitionId: ids.competitionId, revisionId: ids.revisionId }
}

/** Insumo do mapa igual à referência (mesmo insumo e quantidade), ligado a ela */
function itemFromReference(r: Pick<AggregatedInput, 'materialId' | 'code' | 'description' | 'unit' | 'quantity'>, referenceId: string): NewQcItem {
  return {
    materialId: r.materialId, code: r.code, description: r.description, unit: r.unit, quantity: r.quantity,
    origin: 'reference', planningCode: null, planningDescription: null, referenceIds: [referenceId],
  }
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

/**
 * Recalcula melhores condições/totais com o domínio e persiste o resultado. O total orçado da
 * revisão acompanha a verba dos insumos referência (Σ linhas puxadas do orçamento).
 */
export async function recompute(repos: Repositories, competitionId: string, revisionId: string): Promise<QcMap> {
  const data = await repos.competitions.getData(competitionId, revisionId)
  if (!data) throw notFound('Concorrência')
  const budgetAmount = Decimal.sum(data.links.map((l) => l.budgetValue)).round(4)
  if (!budgetAmount.eq(data.revision.budgetAmount)) {
    await repos.competitions.updateRevision(revisionId, { budgetAmount: budgetAmount.toDb() })
    data.revision.budgetAmount = budgetAmount.toDb()
  }
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
    // Só as linhas cujo valor contratado mudou
    linkValues: map.links
      .map((l, k) => ({ linkId: l.id!, awardedUnitPrice: l.awardedUnitPrice?.toDb() ?? null, awardedTotal: l.awardedTotal?.toDb() ?? null, before: data.links[k]! }))
      .filter((v) => v.awardedTotal !== v.before.awardedTotal || v.awardedUnitPrice !== v.before.awardedUnitPrice)
      .map(({ before: _b, ...v }) => v),
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
  const { ref, data } = await loadDraft(repos, ctx, revisionId)
  if (input.pctMaterial !== undefined && input.pctEquipment !== undefined) {
    if (Decimal.from(input.pctMaterial).plus(input.pctEquipment).gt(1)) {
      throw new DomainError('PCT_INVALID', '% material + % equipamento não pode exceder 100%.')
    }
  }
  if (input.code !== undefined || input.description !== undefined || input.unit !== undefined) {
    if (data.items.find((i) => i.id === itemId)?.origin !== 'manual') {
      throw new DomainError('ITEM_FROM_REFERENCE', 'Código, descrição e unidade só podem ser alterados em insumos criados no mapa.')
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

async function loadDraft(repos: Repositories, ctx: RequestContext, revisionId: string) {
  const ref = await loadEditable(repos, ctx, revisionId, 'competition.edit')
  const data = (await repos.competitions.getData(ref.competitionId, revisionId))!
  return { ref, data }
}

/** Linhas do orçamento de um insumo referência e o % de cada uma (verba puxada). */
export async function setReferenceLines(repos: Repositories, ctx: RequestContext, revisionId: string, referenceId: string, input: SetReferenceLinesInput) {
  const { ref, data } = await loadDraft(repos, ctx, revisionId)
  if (!data.references.some((r) => r.id === referenceId)) throw notFound('Insumo referência')
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
  assertSharesWithinBalance(lines, new Map(links.map((l) => [l.activityItemId, Decimal.from(l.share)])), lineBalances(lines, others))

  // Insumo do mapa preenchido por esta referência (1:1) acompanha a quantidade dela
  const oldQty = Decimal.sum(data.links.filter((l) => l.referenceId === referenceId).map((l) => Decimal.from(l.quantity)))
  const newQty = Decimal.sum(links.map((l) => Decimal.from(l.quantity))).round(4)
  for (const item of data.items.filter((i) => i.origin === 'reference' && i.referenceIds.length === 1 && i.referenceIds[0] === referenceId)) {
    if (oldQty.eq(item.quantity) && !newQty.eq(item.quantity)) await repos.competitions.updateItem(item.id, { quantity: newQty.toDb() })
  }
  await repos.competitions.setReferenceLinks(revisionId, referenceId, links)
  await recompute(repos, ref.competitionId, revisionId)
}

/**
 * Inclui linhas do orçamento no QC (de quaisquer IPs) como insumos referência. Linhas de um insumo
 * que já é referência viram linhas dela; as demais criam referências novas.
 * `fillMap`: cada referência nova já ganha seu insumo no mapa (1:1).
 */
export async function addLines(repos: Repositories, ctx: RequestContext, revisionId: string, input: AddLinesInput) {
  const { ref, data } = await loadDraft(repos, ctx, revisionId)
  const lines = await repos.catalog.getBudgetLines([...new Set(input.lineIds)])
  const already = new Set(data.links.map((l) => l.lineKey))
  const fresh = lines.filter((l) => !already.has(l.lineKey))
  if (!fresh.length) throw new AppError('LINES_ALREADY_LINKED', 'As linhas selecionadas já estão neste QC.', 409)

  const commitments = await repos.competitions.workCommitments(ref.workId)
  const others = commitments.links.filter((l) => l.competitionId !== ref.competitionId)
  const balances = lineBalances(fresh, others)
  const shares = parseShares(input.shares)
  assertSharesWithinBalance(fresh, shares, balances)
  const available = new Map([...balances].map(([k, v]) => [k, v.balanceShare]))
  const groups = groupBudgetLines(fresh, { available, shares })
  if (!groups.length) throw new AppError('NO_BALANCE', 'As linhas selecionadas já estão totalmente comprometidas em outras concorrências.', 422)

  const refByMaterial = new Map(data.references.map((r) => [r.materialId, r]))
  const merges = groups.filter((g) => refByMaterial.has(g.materialId))
  const newRefs = groups.filter((g) => !refByMaterial.has(g.materialId))
  await Promise.all(
    merges.map((g) => {
      const existing = refByMaterial.get(g.materialId)!
      const current = data.links.filter((l) => l.referenceId === existing.id).map(keepLink)
      return repos.competitions.setReferenceLinks(revisionId, existing.id, [...current, ...toAggregated([g])[0]!.links])
    }),
  )
  const aggregated = toAggregated(newRefs)
  const created = aggregated.length ? await repos.competitions.addReferences(revisionId, aggregated) : []
  if (input.fillMap && created.length) await repos.competitions.addItems(revisionId, aggregated.map((r, k) => itemFromReference(r, created[k]!)))
  await recompute(repos, ref.competitionId, revisionId)
  return { createdReferences: created.length, mergedReferences: merges.length }
}

/** Vínculo já gravado reaproveitado como está (mesmo % e verba). */
function keepLink(l: CompetitionData['links'][number]) {
  return {
    activityItemId: l.activityItemId!, lineKey: l.lineKey!, materialId: l.materialId, packageCode: l.packageCode,
    packageDescription: l.packageDescription, quantity: l.quantity, share: l.share, budgetValue: l.budgetValue, budgetUnitCost: l.budgetUnitCost,
  }
}

export async function removeReference(repos: Repositories, ctx: RequestContext, revisionId: string, referenceId: string) {
  const { ref, data } = await loadDraft(repos, ctx, revisionId)
  if (!data.references.some((r) => r.id === referenceId)) throw notFound('Insumo referência')
  await repos.competitions.removeReference(referenceId)
  await recompute(repos, ref.competitionId, revisionId)
}

/** Insumo novo no mapa (da lista da obra ou livre), ligado às referências escolhidas. */
export async function addQcItem(repos: Repositories, ctx: RequestContext, revisionId: string, input: AddQcItemInput) {
  const [{ ref, data }, materialId] = await Promise.all([
    loadDraft(repos, ctx, revisionId),
    input.materialCode ? repos.catalog.findMaterialIdByCode(input.materialCode) : null,
  ])
  assertReferences(data, input.referenceIds)
  const [id] = await repos.competitions.addItems(revisionId, [{
    materialId,
    code: input.code,
    description: input.description,
    unit: input.unit,
    quantity: Decimal.from(input.quantity).round(4).toDb(),
    origin: 'manual',
    planningCode: input.planningCode ?? null,
    planningDescription: input.planningDescription ?? null,
    referenceIds: input.referenceIds,
  }])
  await recompute(repos, ref.competitionId, revisionId)
  return { id: id! }
}

/** Preenche o mapa com um insumo para cada referência ainda sem uso. */
export async function fillFromReferences(repos: Repositories, ctx: RequestContext, revisionId: string) {
  const { ref, data } = await loadDraft(repos, ctx, revisionId)
  const used = new Set(data.items.flatMap((i) => i.referenceIds))
  const free = data.references.filter((r) => !used.has(r.id))
  const quantity = new Map<string, Decimal>()
  for (const l of data.links) quantity.set(l.referenceId, (quantity.get(l.referenceId) ?? Decimal.ZERO).plus(l.quantity))
  if (free.length) {
    await repos.competitions.addItems(revisionId, free.map((r) => itemFromReference({ ...r, quantity: (quantity.get(r.id) ?? Decimal.ZERO).round(4).toDb() }, r.id)))
  }
  await recompute(repos, ref.competitionId, revisionId)
  return { created: free.length }
}

export async function setItemReferences(repos: Repositories, ctx: RequestContext, revisionId: string, itemId: string, referenceIds: string[]) {
  const { ref, data } = await loadDraft(repos, ctx, revisionId)
  if (!data.items.some((i) => i.id === itemId)) throw notFound('Item')
  assertReferences(data, referenceIds)
  await repos.competitions.setItemReferences(revisionId, itemId, referenceIds)
  await recompute(repos, ref.competitionId, revisionId)
}

function assertReferences(data: CompetitionData, referenceIds: string[]) {
  const known = new Set(data.references.map((r) => r.id))
  if (referenceIds.some((r) => !known.has(r))) throw new AppError('REFERENCE_UNKNOWN', 'Insumo referência não pertence a esta revisão.', 422)
}

export async function removeItem(repos: Repositories, ctx: RequestContext, revisionId: string, itemId: string) {
  const ref = await loadEditable(repos, ctx, revisionId, 'competition.edit')
  await repos.competitions.removeItem(itemId)
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
  const base = baseRevisionFor(data.revisions)!
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
    references: data.references,
    referenceLines: data.links,
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
