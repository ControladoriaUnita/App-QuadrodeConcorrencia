/**
 * Solicitação de Contrato (aba "Solic. Contrato") e aditivos (aba "Solic. Aditivo").
 *
 * Regras
 *  - A solicitação nasce da revisão APROVADA do QC, com a empresa vencedora indicada.
 *  - Entram os itens com quantidade > 0 que a vencedora cotou, ao preço dela (R$ TOTAL = quant. × unit., 4 casas).
 *    Itens que a vencedora não cotou ficam de fora e são informados (exigiriam outro contrato).
 *  - Vínculos (IP · Qtd · Valor) vêm dos vínculos de planejamento do item; valor = quantidade × R$ unitário.
 *  - Distribuição (§1.6) ponderada pelo valor contratado de cada item.
 *  - Aditivos e distratos: ver ./addendum.ts.
 */
import { Decimal } from '../decimal'
import { lineTotal } from '../competition/best-condition'
import type { QcMap, QcMapSource } from '../competition/qc-map'
import type { ValidationIssue } from '../competition/revision'
import { computeDistribution, type ContractDistribution } from './distribution'

const ZERO = Decimal.ZERO

export interface DraftAllocation {
  packageCode: string | null
  quantity: Decimal
}

export interface DraftContractItem {
  competitionItemId: string
  materialId: string | null
  code: string
  description: string
  specification: string | null
  unit: string
  quantity: Decimal
  unitPrice: Decimal
  totalPrice: Decimal
  pctRetention: Decimal
  pctMaterial: Decimal
  pctEquipment: Decimal
  allocations: DraftAllocation[]
}

export interface ContractDraft {
  winnerCompetitionSupplierId: string
  items: DraftContractItem[]
  /** Itens com quantidade que a vencedora não cotou */
  excluded: { itemId: string; code: string; description: string }[]
  total: Decimal
  distribution: ContractDistribution
}

/** Monta os itens da solicitação a partir da revisão aprovada (fonte + mapa calculado). */
export function buildContractDraft(source: QcMapSource, map: QcMap): ContractDraft {
  const winner = source.suppliers.find((s) => s.supplierId === source.revision.winnerSupplierId)
  if (!winner) throw new Error('A revisão não possui empresa vencedora participante.')
  const priceOf = new Map(
    map.prices
      .filter((p) => p.competitionSupplierId === winner.id && p.unitPrice?.isPositive())
      .map((p) => [p.itemId, p.unitPrice as Decimal]),
  )
  const dto = new Map(source.items.map((i) => [i.id, i]))
  const items: DraftContractItem[] = []
  const excluded: ContractDraft['excluded'] = []

  for (const i of map.items) {
    if (!i.quantity.isPositive()) continue
    const unitPrice = priceOf.get(i.id)
    if (!unitPrice) {
      excluded.push({ itemId: i.id, code: i.code, description: i.description })
      continue
    }
    const byPackage = new Map<string, DraftAllocation>()
    for (const l of source.links.filter((x) => x.itemId === i.id)) {
      const k = l.packageCode ?? ''
      const a = byPackage.get(k) ?? { packageCode: l.packageCode, quantity: ZERO }
      a.quantity = a.quantity.plus(l.quantity)
      byPackage.set(k, a)
    }
    const raw = dto.get(i.id)!
    items.push({
      competitionItemId: i.id,
      materialId: raw.materialId,
      code: i.code,
      description: i.description,
      specification: raw.scopeDescription,
      unit: i.unit,
      quantity: i.quantity,
      unitPrice,
      totalPrice: lineTotal(unitPrice, i.quantity),
      pctRetention: i.pctRetention,
      pctMaterial: i.pctMaterial,
      pctEquipment: i.pctEquipment,
      allocations: [...byPackage.values()].sort((a, b) => (a.packageCode ?? '').localeCompare(b.packageCode ?? '')),
    })
  }

  return {
    winnerCompetitionSupplierId: winner.id,
    items,
    excluded,
    total: Decimal.sum(items.map((i) => i.totalPrice)),
    distribution: contractDistribution(items),
  }
}

export function contractDistribution(items: { totalPrice: Decimal; pctMaterial: Decimal; pctEquipment: Decimal }[]): ContractDistribution {
  return computeDistribution(items.map((i) => ({ total: i.totalPrice, pctMaterial: i.pctMaterial, pctEquipment: i.pctEquipment })))
}

/** Valor de um vínculo do item contratado. */
export function allocationAmount(quantity: Decimal, unitPrice: Decimal): Decimal {
  return lineTotal(unitPrice, quantity)
}

// ----------------------------------------------------------------------------- validação da solicitação
export interface ContractHeader {
  contractTypeId: string | null
  startOn: string | null
  endOn: string | null
  supplierId: string
  secondSupplierId: string | null
  directBilling: boolean
  directBillingMaterials: string | null
  measurementCriteria: string | null
  supplierCndValidUntil: string | null
}

/** Pendências para enviar a solicitação a Contratos. */
export function validateContractRequest(h: ContractHeader, items: { quantity: Decimal }[], today?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const req = (cond: unknown, field: string, message: string) => {
    if (!cond) issues.push({ field, message })
  }
  req(h.contractTypeId, 'contractTypeId', 'Selecione o tipo de contrato.')
  req(h.startOn, 'startOn', 'Informe a data de início do contrato.')
  req(h.endOn, 'endOn', 'Informe a data de término do contrato.')
  if (h.startOn && h.endOn && h.endOn < h.startOn) issues.push({ field: 'endOn', message: 'O término deve ser posterior ao início.' })
  req(items.some((i) => i.quantity.isPositive()), 'items', 'A solicitação não possui itens com quantidade.')
  if (h.secondSupplierId && h.secondSupplierId === h.supplierId) {
    issues.push({ field: 'secondSupplierId', message: 'O 2º contratado deve ser diferente do contratado principal.' })
  }
  if (h.directBilling) {
    req(h.directBillingMaterials?.trim(), 'directBillingMaterials', 'Contrato com faturamento direto: liste os materiais faturados diretamente à contratante (seção 5).')
  }
  req(h.measurementCriteria?.trim(), 'measurementCriteria', 'Descreva os critérios de medição (seção 6).')
  if (today && h.supplierCndValidUntil && h.supplierCndValidUntil < today) {
    issues.push({ field: 'supplier', message: `CND do contratado vencida em ${h.supplierCndValidUntil}.` })
  }
  return issues
}
