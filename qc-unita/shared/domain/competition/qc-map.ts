/**
 * Monta o "mapa" calculado do QC a partir do DTO bruto.
 * Função pura usada pela API (persistência/validação) e pela UI (recalcular ao digitar).
 */
import type { CompetitionDetailDTO } from '../../contracts'
import { Decimal } from '../decimal'
import { bestMixTotal, computeBestConditions, computeSupplierSummaries, lineTotal } from './best-condition'
import { availableBudget, compareWithBudget, type BudgetComparison } from './budget-comparison'
import { validateForSubmission, type ValidationIssue } from './revision'
import type { BestCondition, BudgetEnvelope, QcItem, QcPrice, QcSupplier, SupplierSummary } from './types'
import { awardedTotal, awardedUnitPrices, type PlanningLink } from '../planning/links'
import {
  allocateGroupBudgets,
  comparisonGroups,
  itemPlanningAllocations,
  linkAwardedAmounts,
  referenceBudgets,
  validateReferences,
  type ComparisonGroup,
  type MapItemRef,
  type PlanningAllocation,
} from '../planning/references'

export interface QcMap {
  items: QcItem[]
  suppliers: QcSupplier[]
  prices: QcPrice[]
  best: BestCondition[]
  bestByItem: Map<string, BestCondition>
  summaries: SupplierSummary[]
  summaryBySupplier: Map<string, SupplierSummary>
  envelope: BudgetEnvelope
  available: Decimal
  budgetTotal: Decimal
  mixTotal: Decimal
  mixComparison: BudgetComparison
  winner: { summary: SupplierSummary; comparison: BudgetComparison } | null
  lowestComplete: SupplierSummary | null
  issues: ValidationIssue[]
  /** Preço contratado por item (vencedora indicada ou melhor condição) */
  awardedByItem: Map<string, Decimal | null>
  /** Valor contratado/estimado da revisão */
  awardedTotal: Decimal
  links: (PlanningLink & { awardedUnitPrice: Decimal | null; awardedTotal: Decimal | null })[]
  /** Verba de cada insumo referência */
  referenceBudget: Map<string, Decimal>
  /** Insumos do mapa que usam cada referência */
  referenceUsage: Map<string, string[]>
  /** Grupos de comparação (insumos do mapa ↔ referências ligados entre si) */
  groups: ComparisonGroup[]
  groupOfItem: Map<string, ComparisonGroup>
  /** Valor contratado/estimado de cada insumo do mapa (vencedora ou melhor condição) */
  contractedByItem: Map<string, Decimal | null>
  /** IPs de cada insumo do mapa (manual ou herdado das referências) */
  allocationsByItem: Map<string, PlanningAllocation[]>
}

export type QcMapSource = Omit<CompetitionDetailDTO, 'can' | 'budgetLines' | 'otherCommitments'>

export function toDomainItems(d: QcMapSource): QcItem[] {
  return d.items.map((i) => ({
    id: i.id,
    sortOrder: i.sortOrder,
    code: i.code,
    description: i.description,
    unit: i.unit,
    budgetQuantity: Decimal.from(i.budgetQuantity),
    budgetUnitCost: Decimal.from(i.budgetUnitCost),
    quantity: Decimal.from(i.quantity),
    pctMaterial: Decimal.from(i.pctMaterial),
    pctEquipment: Decimal.from(i.pctEquipment),
    pctRetention: Decimal.from(i.pctRetention),
    referenceIds: i.referenceIds ?? [],
  }))
}

export function buildQcMap(d: QcMapSource, opts: { today?: string } = {}): QcMap {
  const items = toDomainItems(d)
  const suppliers: QcSupplier[] = d.suppliers.map((s) => ({
    id: s.id,
    supplierId: s.supplierId,
    sortOrder: s.sortOrder,
    status: s.status,
    legalName: s.legalName,
    cndValidUntil: s.cndValidUntil,
  }))
  const prices: QcPrice[] = d.prices.map((p) => ({
    competitionSupplierId: p.competitionSupplierId,
    itemId: p.itemId,
    unitPrice: Decimal.fromNullable(p.unitPrice),
  }))
  const envelope: BudgetEnvelope = {
    budgetAmount: Decimal.from(d.revision.budgetAmount),
    usedAmount: Decimal.from(d.revision.budgetUsedAmount),
    adjustmentAmount: Decimal.from(d.revision.budgetAdjustmentAmount),
  }

  // Insumos referência: verba de cada uma (linhas puxadas do orçamento)
  const planning: PlanningLink[] = (d.links ?? []).map((l) => ({
    id: l.id,
    referenceId: l.referenceId,
    materialId: l.materialId,
    packageCode: l.packageCode,
    lineKey: l.lineKey,
    activityItemId: l.activityItemId,
    quantity: Decimal.from(l.quantity),
    budgetUnitCost: Decimal.from(l.budgetUnitCost),
    share: l.share != null ? Decimal.from(l.share) : undefined,
    budgetValue: l.budgetValue != null ? Decimal.from(l.budgetValue) : undefined,
  }))
  const refLinks = planning.map((l, k) => ({
    id: l.id,
    referenceId: l.referenceId,
    packageCode: l.packageCode,
    packageDescription: d.links?.[k]?.packageDescription ?? null,
    budgetValue: l.budgetValue ?? lineTotal(l.budgetUnitCost, l.quantity),
  }))
  const referenceIds = (d.references ?? []).map((r) => r.id)
  const refBudget = referenceBudgets(referenceIds, refLinks)
  const mapItems: MapItemRef[] = d.items.map((i) => ({
    id: i.id,
    quantity: Decimal.from(i.quantity),
    referenceIds: (i.referenceIds ?? []).filter((r) => refBudget.has(r)),
    planningCode: i.planningCode ?? null,
    planningDescription: i.planningDescription ?? null,
  }))
  const { groups, groupOfItem, groupOfReference } = comparisonGroups(mapItems, refBudget)
  const winnerCsIdEarly = suppliers.find((s) => s.supplierId === d.revision.winnerSupplierId)?.id ?? null

  // 1ª passada: preços → valor de cada insumo; 2ª: orçado rateado pelo grupo → variações
  const contractedOf = (bestList: BestCondition[], its: QcItem[]) => {
    const unit = awardedUnitPrices(its, bestList, prices, winnerCsIdEarly)
    return new Map(its.map((i) => {
      const u = unit.get(i.id)
      return [i.id, u ? lineTotal(u, i.quantity) : null] as const
    }))
  }
  const firstPass = computeBestConditions(items, suppliers, prices, d.overrides)
  const allocated = allocateGroupBudgets(groups, contractedOf(firstPass, items))
  // QCs sem referências (dados antigos) mantêm o orçado gravado no item
  const withBudget = d.references ? items.map((i) => ({ ...i, referenceBudget: allocated.get(i.id) ?? Decimal.ZERO })) : items
  items.splice(0, items.length, ...withBudget)

  const best = computeBestConditions(items, suppliers, prices, d.overrides)
  const summaries = computeSupplierSummaries(items, suppliers, prices, envelope, best)
  const mixTotal = bestMixTotal(best)
  const budgetTotal = Decimal.sum(best.map((b) => b.budgetTotal))

  const winnerSupplier = suppliers.find((s) => s.supplierId === d.revision.winnerSupplierId)
  const winnerSummary = winnerSupplier ? summaries.find((s) => s.competitionSupplierId === winnerSupplier.id) : undefined

  const issues = validateForSubmission({
    revision: {
      id: d.revision.id,
      number: d.revision.number,
      status: d.revision.status,
      frozenAt: d.revision.frozenAt,
      requestedOn: d.competition.requestedOn,
      serviceStartOn: d.revision.serviceStartOn,
      serviceEndOn: d.revision.serviceEndOn,
      engineeringOwnerId: d.competition.engineeringOwner?.id ?? null,
      procurementOwnerId: d.competition.procurementOwner?.id ?? null,
      contractTypeId: d.revision.contractTypeId,
      winnerSupplierId: d.revision.winnerSupplierId,
      winnerJustification: d.revision.winnerJustification,
    },
    items,
    suppliers,
    best,
    today: opts.today,
  })

  const winnerCsId = winnerSupplier?.id ?? null
  const awardedByItem = awardedUnitPrices(items, best, prices, winnerCsId)
  const contractedByItem = contractedOf(best, items)
  const linkAmounts = linkAwardedAmounts(refLinks, groupOfReference, contractedByItem)
  const links = planning.map((l) => {
    const total = l.id ? linkAmounts.get(l.id) ?? null : null
    return { ...l, awardedTotal: total, awardedUnitPrice: total && l.quantity.isPositive() ? total.div(l.quantity, 4) : null }
  })
  if (d.references) issues.push(...validateReferences(mapItems, referenceIds))
  const referenceUsage = new Map(referenceIds.map((r) => [r, mapItems.filter((i) => i.referenceIds.includes(r)).map((i) => i.id)]))
  const allocationsByItem = new Map(mapItems.map((i) => [i.id, itemPlanningAllocations(i, refLinks)]))

  return {
    awardedByItem,
    awardedTotal: awardedTotal(items, awardedByItem),
    links,
    referenceBudget: refBudget,
    referenceUsage,
    groups,
    groupOfItem,
    contractedByItem,
    allocationsByItem,
    items,
    suppliers,
    prices,
    best,
    bestByItem: new Map(best.map((b) => [b.itemId, b])),
    summaries,
    summaryBySupplier: new Map(summaries.map((s) => [s.competitionSupplierId, s])),
    envelope,
    available: availableBudget(envelope),
    budgetTotal,
    mixTotal,
    mixComparison: compareWithBudget(envelope, mixTotal),
    winner: winnerSummary ? { summary: winnerSummary, comparison: compareWithBudget(envelope, winnerSummary.total) } : null,
    lowestComplete: summaries.find((s) => s.rank === 1) ?? null,
    issues,
  }
}
