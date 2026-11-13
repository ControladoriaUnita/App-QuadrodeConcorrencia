/**
 * Fora de escopo e desvio no mapa do QC, linha a linha.
 *
 * Fora de escopo (FE) é o que NÃO está no orçamento: a parte da quantidade de um insumo do mapa que
 * não tem verba prevista. Desvio é outra coisa: preço ou quantidade acima do orçado num insumo que
 * ESTÁ no orçamento.
 *
 * Regras
 *  - Quant. FE de cada linha: a informada pelo solicitante; sem informar, a linha sem referência
 *    do orçamento é 100% FE e a linha com referência é 0.
 *  - Unit. FE = preço contratado do insumo (empresa escolhida, senão vencedora, senão melhor condição).
 *    Total FE = Quant. FE × Unit. FE.
 *  - Desvio é apontado por linha (nunca por pacote ou Item da EAP), só na parte dentro do escopo:
 *      · de preço: preço contratado acima do unitário orçado;
 *      · de quantidade: quantidade dentro do escopo acima da quantidade orçada das referências
 *        (só quando a comparação é possível: as referências do insumo são só dele e na mesma unidade).
 *  - Totais com e sem FE: por fornecedor (preço dele × Quant. FE), melhor condição e cotação escolhida.
 */
import { Decimal } from '../decimal'
import { lineTotal } from './best-condition'
import type { QcMap, QcMapSource } from './qc-map'

const ZERO = Decimal.ZERO

export interface ScopeLine {
  itemId: string
  /** Quantidade fora de escopo (informada ou automática) */
  outOfScopeQuantity: Decimal
  /** true = não informada: veio da regra (sem referência → 100% FE) */
  automatic: boolean
  inScopeQuantity: Decimal
  /** Preço contratado (Unit. FE) */
  unitPrice: Decimal | null
  outOfScopeTotal: Decimal
  /** Orçado da linha (para o desvio); null quando a linha não está no orçamento */
  budgetUnit: Decimal | null
  /** Quantidade orçada das referências; null quando não dá para comparar */
  budgetQuantity: Decimal | null
  priceDeviation: boolean
  quantityDeviation: boolean
}

export interface ScopeSummary {
  lines: ScopeLine[]
  byItem: Map<string, ScopeLine>
  /** Σ total FE pelo preço contratado */
  outOfScopeTotal: Decimal
  /** Σ preço do fornecedor × Quant. FE, por competition_supplier */
  bySupplier: Map<string, Decimal>
  /** Melhor condição: Σ melhor preço × Quant. FE */
  best: Decimal
  /** Cotação escolhida: Σ preço escolhido × Quant. FE */
  chosen: Decimal
  /** Linhas com FE e linhas com desvio */
  outOfScopeItems: number
  deviationItems: number
}

/** Quantidade FE da linha: a informada (limitada à quantidade) ou a automática. */
export function outOfScopeQuantityOf(item: { quantity: string; referenceIds: string[]; outOfScopeQuantity?: string | null }): { quantity: Decimal; automatic: boolean } {
  const qty = Decimal.from(item.quantity)
  if (item.outOfScopeQuantity != null) return { quantity: Decimal.min(qty, Decimal.from(item.outOfScopeQuantity)), automatic: false }
  return { quantity: item.referenceIds.length ? ZERO : qty, automatic: true }
}

export function computeScope(source: Pick<QcMapSource, 'items' | 'references' | 'links' | 'prices'>, map: QcMap): ScopeSummary {
  const refUnit = new Map(source.references.map((r) => [r.id, r.unit.trim().toLowerCase()]))
  const refQty = new Map<string, Decimal>()
  for (const l of source.links) refQty.set(l.referenceId, (refQty.get(l.referenceId) ?? ZERO).plus(l.quantity))
  const price = new Map(source.prices.filter((p) => p.unitPrice).map((p) => [`${p.itemId}::${p.competitionSupplierId}`, Decimal.from(p.unitPrice!)]))
  const domain = new Map(map.items.map((i) => [i.id, i]))

  const lines = source.items.map<ScopeLine>((item) => {
    const d = domain.get(item.id)!
    const { quantity: fe, automatic } = outOfScopeQuantityOf(item)
    const inScope = d.quantity.minus(fe)
    const unitPrice = map.awardedByItem.get(item.id) ?? null
    const group = map.groupOfItem.get(item.id)
    // Quantidade orçada só é comparável quando as referências são só deste insumo e na mesma unidade
    const comparable =
      item.referenceIds.length > 0 &&
      (group?.itemIds.length ?? 1) === 1 &&
      item.referenceIds.every((r) => refUnit.get(r) === item.unit.trim().toLowerCase())
    const budgetQuantity = comparable ? Decimal.sum(item.referenceIds.map((r) => refQty.get(r) ?? ZERO)) : null
    const inBudget = d.budgetTotal.isPositive()
    const budgetUnit = !inBudget
      ? null
      : budgetQuantity?.isPositive()
        ? d.budgetTotal.div(budgetQuantity, 4)
        : inScope.isPositive()
          ? d.budgetTotal.div(inScope, 4)
          : null
    return {
      itemId: item.id,
      outOfScopeQuantity: fe,
      automatic,
      inScopeQuantity: inScope,
      unitPrice,
      outOfScopeTotal: unitPrice && fe.isPositive() ? lineTotal(unitPrice, fe) : ZERO,
      budgetUnit,
      budgetQuantity,
      priceDeviation: !!(inBudget && budgetUnit && unitPrice && inScope.isPositive() && unitPrice.gt(budgetUnit)),
      quantityDeviation: !!(inBudget && budgetQuantity && inScope.gt(budgetQuantity)),
    }
  })

  const feQty = new Map(lines.map((l) => [l.itemId, l.outOfScopeQuantity]))
  const sumWith = (unitOf: (itemId: string) => Decimal | null | undefined) =>
    Decimal.sum(lines.filter((l) => l.outOfScopeQuantity.isPositive()).map((l) => {
      const u = unitOf(l.itemId)
      return u ? lineTotal(u, feQty.get(l.itemId)!) : ZERO
    }))

  return {
    lines,
    byItem: new Map(lines.map((l) => [l.itemId, l])),
    outOfScopeTotal: Decimal.sum(lines.map((l) => l.outOfScopeTotal)),
    bySupplier: new Map(map.suppliers.map((s) => [s.id, sumWith((itemId) => price.get(`${itemId}::${s.id}`))])),
    best: sumWith((itemId) => map.bestByItem.get(itemId)?.unitPrice),
    chosen: sumWith((itemId) => map.chosen.byItem.get(itemId)?.unitPrice),
    outOfScopeItems: lines.filter((l) => l.outOfScopeQuantity.isPositive()).length,
    deviationItems: lines.filter((l) => l.priceDeviation || l.quantityDeviation).length,
  }
}
