/**
 * Cotação escolhida: cenário montado à mão no mapa, insumo a insumo.
 *
 * Regras
 *  - Cada insumo do mapa pode ter um fornecedor escolhido para contratá-lo (mais de uma empresa
 *    vencedora na mesma concorrência). Sem escolha, o insumo fica fora do cenário.
 *  - Preço = o unitário que o fornecedor escolhido cotou para o insumo; total = unitário × quantidade
 *    equalizada (4 casas). Escolha de fornecedor sem preço (> 0) no insumo é sinalizada e não soma.
 *  - Não altera a melhor condição, a vencedora indicada nem o ranking.
 *  - Resultado = verba disponível − total escolhido, como nos demais cenários.
 */
import { Decimal } from '../decimal'
import { lineTotal, priceIndex } from './best-condition'
import { compareWithBudget, type BudgetComparison } from './budget-comparison'
import type { BudgetEnvelope, QcItem, QcPrice } from './types'

export interface ChosenLine {
  itemId: string
  competitionSupplierId: string | null
  unitPrice: Decimal | null
  totalPrice: Decimal | null
  budgetTotal: Decimal
  /** (orçado − escolhido) / orçado, como na melhor condição */
  varianceRatio: Decimal | null
  /** Fornecedor escolhido não cotou o insumo */
  missingPrice: boolean
}

export interface ChosenQuotation {
  lines: ChosenLine[]
  byItem: Map<string, ChosenLine>
  total: Decimal
  /** Insumos com quantidade e escolha com preço */
  chosenItems: number
  /** Insumos com quantidade (os que precisam de escolha) */
  activeItems: number
  /** Fornecedores escolhidos, na ordem das colunas do mapa */
  suppliers: { competitionSupplierId: string; total: Decimal; items: number }[]
  comparison: BudgetComparison
}

export function computeChosenQuotation(
  items: QcItem[],
  prices: QcPrice[],
  choices: Map<string, string | null>,
  envelope: BudgetEnvelope,
  supplierOrder: string[] = [],
): ChosenQuotation {
  const idx = priceIndex(prices)
  const lines = [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map<ChosenLine>((item) => {
      const csId = choices.get(item.id) ?? null
      const unit = csId ? idx.get(`${item.id}::${csId}`)?.unitPrice ?? null : null
      const quoted = !!unit && unit.isPositive()
      const totalPrice = quoted ? lineTotal(unit, item.quantity) : null
      const budgetTotal = item.budgetTotal
      return {
        itemId: item.id,
        competitionSupplierId: csId,
        unitPrice: quoted ? unit : null,
        totalPrice,
        budgetTotal,
        varianceRatio: totalPrice && !budgetTotal.isZero() ? budgetTotal.minus(totalPrice).div(budgetTotal, 6) : null,
        missingPrice: !!csId && !quoted,
      }
    })

  const total = Decimal.sum(lines.map((l) => l.totalPrice ?? Decimal.ZERO))
  const active = new Set(items.filter((i) => i.quantity.isPositive()).map((i) => i.id))
  const bySupplier = new Map<string, { total: Decimal; items: number }>()
  for (const l of lines) {
    if (!l.competitionSupplierId || !l.totalPrice) continue
    const acc = bySupplier.get(l.competitionSupplierId) ?? { total: Decimal.ZERO, items: 0 }
    bySupplier.set(l.competitionSupplierId, { total: acc.total.plus(l.totalPrice), items: acc.items + 1 })
  }
  const rank = (id: string) => supplierOrder.indexOf(id) + 1 || Number.MAX_SAFE_INTEGER

  return {
    lines,
    byItem: new Map(lines.map((l) => [l.itemId, l])),
    total,
    chosenItems: lines.filter((l) => l.totalPrice && active.has(l.itemId)).length,
    activeItems: active.size,
    suppliers: [...bySupplier]
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([competitionSupplierId, v]) => ({ competitionSupplierId, ...v })),
    comparison: compareWithBudget(envelope, total),
  }
}
