/**
 * Solicitação de Contrato (aba "Solic. Contrato") e aditivos (aba "Solic. Aditivo").
 *
 * Regras
 *  - A solicitação nasce da revisão APROVADA do QC, com a empresa vencedora indicada.
 *  - Entram os itens com quantidade > 0 que a vencedora cotou, ao preço dela (R$ TOTAL = quant. × unit., 4 casas).
 *    Itens que a vencedora não cotou ficam de fora e são informados (exigiriam outro contrato).
 *  - Vínculos (IP · Qtd · Valor) vêm dos vínculos de planejamento do item; valor = quantidade × R$ unitário.
 *  - Distribuição (§1.6) ponderada pelo valor contratado de cada item.
 *  - Aditivo: quantidade aditiva (±) por item do contrato ou item novo; a quantidade acumulada
 *    (contrato + aditivos aprovados + este) não pode ficar negativa.
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

// ----------------------------------------------------------------------------- aditivos
export interface AddendumLine {
  contractItemId: string | null
  code: string
  quantityDelta: Decimal
  unitPrice: Decimal
}

export interface AddendumLineResult extends AddendumLine {
  totalDelta: Decimal
  /** Quantidade do item após este aditivo (contrato + aditivos aprovados + este) */
  quantityAfter: Decimal
}

export interface AddendumSummary {
  lines: AddendumLineResult[]
  /** Total do contrato inicial */
  initialTotal: Decimal
  /** Σ aditivos aprovados anteriores */
  previousTotal: Decimal
  /** Total deste aditamento */
  totalDelta: Decimal
  /** Novo total do contrato (inicial + anteriores + este) */
  newTotal: Decimal
}

/**
 * Calcula o aditamento: total por linha (Δ quant. × R$ unit.), quantidade acumulada por item e
 * o novo total do contrato. `previous` = linhas de aditivos já aprovados.
 */
export function computeAddendum(
  contractItems: { id: string; quantity: Decimal; totalPrice: Decimal }[],
  previous: AddendumLine[],
  lines: AddendumLine[],
): AddendumSummary {
  const qty = new Map(contractItems.map((i) => [i.id, i.quantity]))
  for (const p of previous) if (p.contractItemId) qty.set(p.contractItemId, (qty.get(p.contractItemId) ?? ZERO).plus(p.quantityDelta))
  const result = lines.map<AddendumLineResult>((l) => {
    const totalDelta = lineTotal(l.unitPrice, l.quantityDelta)
    const before = l.contractItemId ? (qty.get(l.contractItemId) ?? ZERO) : ZERO
    return { ...l, totalDelta, quantityAfter: before.plus(l.quantityDelta) }
  })
  const initialTotal = Decimal.sum(contractItems.map((i) => i.totalPrice))
  const previousTotal = Decimal.sum(previous.map((p) => lineTotal(p.unitPrice, p.quantityDelta)))
  const totalDelta = Decimal.sum(result.map((r) => r.totalDelta))
  return { lines: result, initialTotal, previousTotal, totalDelta, newTotal: initialTotal.plus(previousTotal).plus(totalDelta) }
}

export function validateAddendum(
  a: { reason: string; newEndOn: string | null; contractStartOn: string; currentEndOn: string },
  summary: AddendumSummary,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (a.reason.trim().length < 5) issues.push({ field: 'reason', message: 'Descreva o motivo do aditamento.' })
  const hasValue = summary.lines.some((l) => !l.quantityDelta.isZero())
  if (!hasValue && !a.newEndOn) issues.push({ field: 'items', message: 'Informe quantidades aditivas ou uma nova data de término.' })
  if (a.newEndOn && a.newEndOn < a.contractStartOn) issues.push({ field: 'newEndOn', message: 'A nova data de término é anterior ao início do contrato.' })
  if (a.newEndOn && a.newEndOn === a.currentEndOn) issues.push({ field: 'newEndOn', message: 'A nova data de término é igual à vigente.' })
  const negative = summary.lines.filter((l) => l.quantityAfter.isNegative())
  if (negative.length) {
    issues.push({ field: 'items', message: `Quantidade acumulada negativa em ${negative.map((n) => n.code).join(', ')}.` })
  }
  const zeroNew = summary.lines.filter((l) => !l.contractItemId && !l.quantityDelta.isPositive())
  if (zeroNew.length) issues.push({ field: 'items', message: 'Itens novos precisam de quantidade positiva.' })
  if (summary.lines.some((l) => l.unitPrice.isNegative())) issues.push({ field: 'items', message: 'R$ unitário não pode ser negativo.' })
  return issues
}

/** Término vigente do contrato: maior "nova data de término" dos aditivos aprovados, senão o original. */
export function currentEndOn(endOn: string, approvedAddenda: { newEndOn: string | null; number: number }[]): string {
  const last = [...approvedAddenda].filter((a) => a.newEndOn).sort((a, b) => b.number - a.number)[0]
  return last?.newEndOn ?? endOn
}
