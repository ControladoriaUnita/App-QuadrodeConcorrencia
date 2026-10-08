/**
 * Distribuição do contrato (Solic. Contrato §1.6): % Material, % Equipamento e % MDO/Serviço
 * ponderados pelo valor de cada item contratado.
 */
import { Decimal } from '../decimal'

export interface DistributionLine {
  total: Decimal
  pctMaterial: Decimal
  pctEquipment: Decimal
}

export interface ContractDistribution {
  total: Decimal
  pctMaterial: Decimal
  pctEquipment: Decimal
  pctService: Decimal
}

export function computeDistribution(lines: DistributionLine[]): ContractDistribution {
  const total = Decimal.sum(lines.map((l) => l.total))
  if (total.isZero()) {
    return { total, pctMaterial: Decimal.ZERO, pctEquipment: Decimal.ZERO, pctService: Decimal.from(1) }
  }
  const mat = Decimal.sum(lines.map((l) => l.total.times(l.pctMaterial))).div(total, 6)
  const eqp = Decimal.sum(lines.map((l) => l.total.times(l.pctEquipment))).div(total, 6)
  return { total, pctMaterial: mat, pctEquipment: eqp, pctService: Decimal.from(1).minus(mat).minus(eqp) }
}
