/**
 * Linha de "Materiais globais" da Solicitação de Contrato.
 *
 * Padrão para solicitações com % de material definido no QC: em cada linha, o valor de material é
 * a média ponderada entre o % de material do item e o valor total daquela linha (total × % material).
 * A linha de materiais globais soma esses valores ponderados; o restante de cada linha é serviço.
 * O total do contrato não muda: a linha só separa a parte de material.
 * Os IPs da linha vêm dos vínculos dos itens de origem, na proporção da quantidade de cada vínculo.
 */
import { Decimal } from '../decimal'

const SCALE = 4

export interface GlobalMaterialItem {
  id: string
  totalPrice: Decimal | string
  pctMaterial: Decimal | string
  quantity: Decimal | string
  allocations: { packageCode: string | null; quantity: Decimal | string }[]
}

export interface GlobalMaterials {
  /** Σ (total da linha × % material) */
  total: Decimal
  /** Valor de material de cada linha (só as com % > 0) */
  byItem: Map<string, Decimal>
  /** Total da solicitação menos os materiais globais */
  service: Decimal
  /** Materiais globais por IP (vínculo de planejamento), maior primeiro */
  byPackage: { packageCode: string | null; amount: Decimal }[]
}

export function globalMaterials(items: GlobalMaterialItem[]): GlobalMaterials {
  const byItem = new Map<string, Decimal>()
  const pkg = new Map<string | null, Decimal>()
  for (const i of items) {
    const pct = Decimal.from(i.pctMaterial)
    if (!pct.isPositive()) continue
    const value = Decimal.from(i.totalPrice).times(pct).round(SCALE)
    if (value.isZero()) continue
    byItem.set(i.id, value)
    const qty = Decimal.from(i.quantity)
    const allocs = i.allocations.filter((a) => !Decimal.from(a.quantity).isZero())
    if (!allocs.length || qty.isZero()) {
      pkg.set(null, (pkg.get(null) ?? Decimal.ZERO).plus(value))
      continue
    }
    // Rateio pela quantidade de cada vínculo; o último fica com a sobra do arredondamento
    let rest = value
    allocs.forEach((a, k) => {
      const part = k === allocs.length - 1 ? rest : value.times(a.quantity).div(qty, SCALE)
      rest = rest.minus(part)
      pkg.set(a.packageCode, (pkg.get(a.packageCode) ?? Decimal.ZERO).plus(part))
    })
  }
  const total = Decimal.sum([...byItem.values()])
  const contract = Decimal.sum(items.map((i) => Decimal.from(i.totalPrice)))
  return {
    total,
    byItem,
    service: contract.minus(total),
    byPackage: [...pkg.entries()].map(([packageCode, amount]) => ({ packageCode, amount })).sort((a, b) => b.amount.compare(a.amount)),
  }
}
