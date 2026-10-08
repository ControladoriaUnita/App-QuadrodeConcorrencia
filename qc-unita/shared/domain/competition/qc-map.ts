/**
 * Monta o "mapa" calculado do QC a partir do DTO bruto.
 * Função pura usada pela API (persistência/validação) e pela UI (recalcular ao digitar).
 */
import type { CompetitionDetailDTO } from '../../contracts'
import { Decimal } from '../decimal'
import { bestMixTotal, computeBestConditions, computeSupplierSummaries } from './best-condition'
import { availableBudget, compareWithBudget, type BudgetComparison } from './budget-comparison'
import { validateForSubmission, type ValidationIssue } from './revision'
import type { BestCondition, BudgetEnvelope, QcItem, QcPrice, QcSupplier, SupplierSummary } from './types'
import {
  awardedTotal,
  awardedUnitPrices,
  linkAwardedValue,
  linkBalanceByItem,
  validateLinks,
  type ItemLinkBalance,
  type PlanningLink,
} from '../planning/links'

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
  linkBalance: Map<string, ItemLinkBalance>
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
  }))
}

export function buildQcMap(d: QcMapSource, opts: { today?: string; minSuppliers?: number } = {}): QcMap {
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
    minSuppliers: opts.minSuppliers,
  })

  const winnerCsId = winnerSupplier?.id ?? null
  const awardedByItem = awardedUnitPrices(items, best, prices, winnerCsId)
  const planning: PlanningLink[] = (d.links ?? []).map((l) => ({
    id: l.id,
    itemId: l.itemId,
    materialId: l.materialId,
    packageCode: l.packageCode,
    lineKey: l.lineKey,
    activityItemId: l.activityItemId,
    quantity: Decimal.from(l.quantity),
    budgetUnitCost: Decimal.from(l.budgetUnitCost),
    share: l.share != null ? Decimal.from(l.share) : undefined,
    budgetValue: l.budgetValue != null ? Decimal.from(l.budgetValue) : undefined,
  }))
  const links = planning.map((l) => {
    const v = linkAwardedValue(l, awardedByItem)
    return { ...l, awardedUnitPrice: v.unit, awardedTotal: v.total }
  })
  if (d.links) issues.push(...validateLinks(items, planning))

  return {
    awardedByItem,
    awardedTotal: awardedTotal(items, awardedByItem),
    links,
    linkBalance: linkBalanceByItem(items, planning),
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
