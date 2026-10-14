/**
 * Monta o "mapa" calculado do QC a partir do DTO bruto.
 * Função pura usada pela API (persistência/validação) e pela UI (recalcular ao digitar).
 * O orçado de cada insumo do mapa vem das referências ligadas (ver ../planning/references.ts).
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
  linksByReference,
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
  /** Referências que nenhum insumo do mapa usa (ficam fora da comparação) */
  unusedReferenceIds: string[]
  /** Grupos de comparação (insumos do mapa ↔ referências ligados entre si) */
  groups: ComparisonGroup[]
  groupOfItem: Map<string, ComparisonGroup>
  /** Valor contratado/estimado de cada insumo do mapa (vencedora ou melhor condição) */
  contractedByItem: Map<string, Decimal | null>
  /** IPs de cada insumo do mapa (manual ou herdado das referências) */
  allocationsByItem: Map<string, PlanningAllocation[]>
}

export type QcMapSource = Omit<CompetitionDetailDTO, 'can' | 'budgetLines' | 'otherCommitments'>

/** Itens do domínio com o orçado informado (padrão: zero, antes do rateio pelas referências) */
export function toDomainItems(d: QcMapSource, budgetOf: (itemId: string) => Decimal = () => Decimal.ZERO): QcItem[] {
  return d.items.map((i) => ({
    id: i.id,
    sortOrder: i.sortOrder,
    code: i.code,
    description: i.description,
    unit: i.unit,
    quantity: Decimal.from(i.quantity),
    pctMaterial: Decimal.from(i.pctMaterial),
    pctEquipment: Decimal.from(i.pctEquipment),
    pctRetention: Decimal.from(i.pctRetention),
    budgetTotal: budgetOf(i.id),
  }))
}

export function buildQcMap(d: QcMapSource, opts: { today?: string } = {}): QcMap {
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
  const winnerSupplier = suppliers.find((s) => s.supplierId === d.revision.winnerSupplierId)
  const winnerCsId = winnerSupplier?.id ?? null

  // Insumos referência: linhas puxadas do orçamento e a verba de cada referência
  const planning: PlanningLink[] = d.links.map((l) => ({
    id: l.id,
    referenceId: l.referenceId,
    materialId: l.materialId,
    packageCode: l.packageCode,
    packageDescription: l.packageDescription,
    lineKey: l.lineKey,
    activityItemId: l.activityItemId,
    quantity: Decimal.from(l.quantity),
    budgetUnitCost: Decimal.from(l.budgetUnitCost),
    share: Decimal.from(l.share),
    budgetValue: Decimal.from(l.budgetValue),
  }))
  const referenceIds = d.references.map((r) => r.id)
  const referenceBudget = referenceBudgets(referenceIds, planning)
  const byReference = linksByReference(planning)
  const mapItems: MapItemRef[] = d.items.map((i) => ({
    id: i.id,
    quantity: Decimal.from(i.quantity),
    referenceIds: i.referenceIds.filter((r) => referenceBudget.has(r)),
    planningCode: i.planningCode,
    planningDescription: i.planningDescription,
  }))
  const { groups, groupOfItem, groupOfReference } = comparisonGroups(mapItems, referenceBudget)

  /** Valor de cada insumo do mapa: preço da vencedora (se cotou) ou da melhor condição × quantidade */
  const contractedOf = (its: QcItem[], bestList: BestCondition[]) => {
    const unit = awardedUnitPrices(its, bestList, prices, winnerCsId)
    return new Map(its.map((i) => [i.id, unit.get(i.id) ? lineTotal(unit.get(i.id)!, i.quantity) : null] as const))
  }

  // Orçado de cada insumo: a verba do grupo. Só quando um grupo tem vários insumos é preciso uma
  // 1ª passada de preços para ratear pelo valor contratado.
  const shared = groups.some((g) => g.itemIds.length > 1)
  const firstPass = shared ? toDomainItems(d) : []
  const allocated = allocateGroupBudgets(groups, shared ? contractedOf(firstPass, computeBestConditions(firstPass, suppliers, prices, d.overrides)) : new Map())
  const items = toDomainItems(d, (id) => allocated.get(id) ?? Decimal.ZERO)

  const best = computeBestConditions(items, suppliers, prices, d.overrides)
  const summaries = computeSupplierSummaries(items, suppliers, prices, envelope, best)
  const mixTotal = bestMixTotal(best)
  const budgetTotal = Decimal.sum(best.map((b) => b.budgetTotal))
  const winnerSummary = winnerSupplier ? summaries.find((s) => s.competitionSupplierId === winnerSupplier.id) : undefined

  const issues = [
    ...validateForSubmission({
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
    }),
    ...validateReferences(mapItems, referenceIds),
  ]

  const awardedByItem = awardedUnitPrices(items, best, prices, winnerCsId)
  const contractedByItem = contractedOf(items, best)
  const linkAmounts = linkAwardedAmounts(planning, groupOfReference, contractedByItem)
  const links = planning.map((l) => {
    const total = linkAmounts.get(l.id!) ?? null
    return { ...l, awardedTotal: total, awardedUnitPrice: total && l.quantity.isPositive() ? total.div(l.quantity, 4) : null }
  })

  const referenceUsage = new Map(referenceIds.map((r) => [r, [] as string[]]))
  for (const i of mapItems) for (const r of i.referenceIds) referenceUsage.get(r)!.push(i.id)

  return {
    awardedByItem,
    awardedTotal: awardedTotal(items, awardedByItem),
    links,
    referenceBudget,
    referenceUsage,
    unusedReferenceIds: referenceIds.filter((r) => !referenceUsage.get(r)!.length),
    groups,
    groupOfItem,
    contractedByItem,
    allocationsByItem: new Map(mapItems.map((i) => [i.id, itemPlanningAllocations(i, byReference)])),
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
