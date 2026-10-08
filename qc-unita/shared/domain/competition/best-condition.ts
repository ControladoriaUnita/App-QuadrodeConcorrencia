/**
 * Cálculo de melhor condição por item e consolidação por fornecedor.
 *
 * Regras (equivalentes à planilha "QC rev00", colunas V:X e linhas 120–123):
 *  - Considera apenas preços unitários informados e > 0 (vazio ou zero = não cotado).
 *  - Fornecedores "declined"/"disqualified" não participam.
 *  - Melhor condição = menor preço unitário; empate → fornecedor de menor ordem (coluna mais à esquerda).
 *  - Total = unitário × quantidade equalizada, arredondado a 4 casas (numeric(18,4)).
 *  - Override manual permitido com justificativa obrigatória.
 *  - Resultado do QC = verba disponível − total equalizado; % sobre o total orçado.
 */
import { Decimal } from '../decimal'
import { availableBudget } from './budget-comparison'
import type {
  BestCondition,
  BestConditionOverride,
  BudgetEnvelope,
  QcItem,
  QcPrice,
  QcSupplier,
  SupplierSummary,
} from './types'

const MONEY_SCALE = 4
const RATIO_SCALE = 6

export function lineTotal(unitPrice: Decimal, quantity: Decimal): Decimal {
  return unitPrice.times(quantity).round(MONEY_SCALE)
}

export function budgetTotalOf(item: QcItem): Decimal {
  return lineTotal(item.budgetUnitCost, item.budgetQuantity)
}

function isEligible(s: QcSupplier) {
  return s.status !== 'declined' && s.status !== 'disqualified'
}

function isQuoted(p: QcPrice | undefined): p is QcPrice & { unitPrice: Decimal } {
  return !!p && p.unitPrice !== null && p.unitPrice.isPositive()
}

export function priceIndex(prices: QcPrice[]): Map<string, QcPrice> {
  const m = new Map<string, QcPrice>()
  for (const p of prices) m.set(`${p.itemId}::${p.competitionSupplierId}`, p)
  return m
}

export function computeBestConditions(
  items: QcItem[],
  suppliers: QcSupplier[],
  prices: QcPrice[],
  overrides: BestConditionOverride[] = [],
): BestCondition[] {
  const idx = priceIndex(prices)
  const eligible = suppliers.filter(isEligible).sort((a, b) => a.sortOrder - b.sortOrder)
  const overrideByItem = new Map(overrides.map((o) => [o.itemId, o]))

  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => {
      const budgetTotal = budgetTotalOf(item)
      let winner: { supplierId: string; unit: Decimal } | null = null

      const override = overrideByItem.get(item.id)
      if (override) {
        if (!override.reason.trim()) throw new Error('Override de melhor condição exige justificativa')
        const p = idx.get(`${item.id}::${override.competitionSupplierId}`)
        if (!isQuoted(p)) throw new Error('Override aponta para fornecedor sem preço no item')
        winner = { supplierId: override.competitionSupplierId, unit: p.unitPrice }
      } else {
        for (const s of eligible) {
          const p = idx.get(`${item.id}::${s.id}`)
          if (!isQuoted(p)) continue
          if (!winner || p.unitPrice.lt(winner.unit)) winner = { supplierId: s.id, unit: p.unitPrice }
        }
      }

      if (!winner) {
        return {
          itemId: item.id,
          competitionSupplierId: null,
          unitPrice: null,
          totalPrice: null,
          budgetTotal,
          varianceAmount: null,
          varianceRatio: null,
          isOverride: false,
          overrideReason: null,
        }
      }

      const totalPrice = lineTotal(winner.unit, item.quantity)
      const varianceAmount = budgetTotal.minus(totalPrice)
      return {
        itemId: item.id,
        competitionSupplierId: winner.supplierId,
        unitPrice: winner.unit,
        totalPrice,
        budgetTotal,
        varianceAmount,
        varianceRatio: budgetTotal.isZero() ? null : varianceAmount.div(budgetTotal, RATIO_SCALE),
        isOverride: !!override,
        overrideReason: override?.reason ?? null,
      }
    })
}

export function computeSupplierSummaries(
  items: QcItem[],
  suppliers: QcSupplier[],
  prices: QcPrice[],
  envelope: BudgetEnvelope,
  best: BestCondition[] = [],
): SupplierSummary[] {
  const idx = priceIndex(prices)
  const available = availableBudget(envelope)
  const requiredItems = items.filter((i) => i.quantity.isPositive())

  const summaries = suppliers.map((s) => {
    let total = Decimal.ZERO
    let quoted = 0
    for (const item of items) {
      const p = idx.get(`${item.id}::${s.id}`)
      if (!isQuoted(p)) continue
      quoted++
      total = total.plus(lineTotal(p.unitPrice, item.quantity))
    }
    const quotedRequired = requiredItems.filter((i) => isQuoted(idx.get(`${i.id}::${s.id}`))).length
    const result = available.minus(total)
    return {
      competitionSupplierId: s.id,
      total,
      quotedItems: quoted,
      totalItems: items.length,
      complete: isEligible(s) && requiredItems.length > 0 && quotedRequired === requiredItems.length,
      result,
      resultRatio: envelope.budgetAmount.isZero() ? null : result.div(envelope.budgetAmount, RATIO_SCALE),
      rank: null as number | null,
      bestItemsCount: best.filter((b) => b.competitionSupplierId === s.id).length,
    }
  })

  // Ranking entre propostas completas (menor total primeiro; empate pela ordem da coluna)
  const order = new Map(suppliers.map((s) => [s.id, s.sortOrder]))
  summaries
    .filter((x) => x.complete)
    .sort((a, b) => a.total.compare(b.total) || order.get(a.competitionSupplierId)! - order.get(b.competitionSupplierId)!)
    .forEach((x, i) => (x.rank = i + 1))

  return summaries
}

/** Soma das melhores condições item a item (cenário "mix" de fornecedores). */
export function bestMixTotal(best: BestCondition[]): Decimal {
  return Decimal.sum(best.map((b) => b.totalPrice ?? Decimal.ZERO))
}

/** Itens com quantidade > 0 sem nenhuma cotação válida. */
export function itemsWithoutQuote(best: BestCondition[], items: QcItem[]): QcItem[] {
  const byId = new Map(best.map((b) => [b.itemId, b]))
  return items.filter((i) => i.quantity.isPositive() && !byId.get(i.id)?.competitionSupplierId)
}
