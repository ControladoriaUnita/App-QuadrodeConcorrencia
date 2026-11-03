/**
 * Solicitação de Contrato (aba "Solic. Contrato") e aditivos (aba "Solic. Aditivo").
 *
 * Regras
 *  - A solicitação nasce da revisão APROVADA do QC, com a empresa vencedora indicada.
 *  - Com cotação escolhida (empresa escolhida por insumo no mapa), nasce uma solicitação por empresa
 *    escolhida, só com os insumos escolhidos para ela; a vencedora indicada não é usada. A verba de cada
 *    uma é a dos seus insumos (não a do QC inteiro), para o resultado de cada contrato não sair inflado.
 *  - Entram os itens com quantidade > 0 que a vencedora cotou, ao preço dela (R$ TOTAL = quant. × unit., 4 casas).
 *    Itens que a vencedora não cotou ficam de fora e são informados (exigiriam outro contrato).
 *  - Vínculos (IP · Qtd · Valor): IP manual do item ou herdados das linhas dos insumos referência
 *    (pela verba de cada linha); valor = quantidade × R$ unitário.
 *  - Cada item leva os insumos referência usados (código, IPs, verba).
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
  references: DraftReference[]
}

export interface DraftReference {
  code: string
  description: string
  unit: string
  packageCodes: string[]
  budget: Decimal
}

export interface ContractDraft {
  winnerCompetitionSupplierId: string
  /** Fornecedor do cadastro (o contratado) */
  supplierId: string
  items: DraftContractItem[]
  /** Itens com quantidade que a vencedora não cotou */
  excluded: { itemId: string; code: string; description: string }[]
  total: Decimal
  /** Orçado (verba) dos insumos que entraram nesta solicitação */
  budgetTotal: Decimal
  distribution: ContractDistribution
}

/** Monta os itens da solicitação a partir da revisão aprovada (fonte + mapa calculado). */
export function buildContractDraft(source: QcMapSource, map: QcMap): ContractDraft {
  const winner = source.suppliers.find((s) => s.supplierId === source.revision.winnerSupplierId)
  if (!winner) throw new Error('A revisão não possui empresa vencedora participante.')
  return draftFor(source, map, winner, () => true)
}

/** A revisão tem cotação escolhida (ao menos um insumo com empresa escolhida)? */
export function hasChosenQuotation(source: Pick<QcMapSource, 'items'>): boolean {
  return source.items.some((i) => !!i.chosenSupplierId)
}

/** Cotação escolhida: uma solicitação por empresa escolhida, na ordem do mapa, com os insumos dela. */
export function buildChosenContractDrafts(source: QcMapSource, map: QcMap): ContractDraft[] {
  const chosenOf = new Map(source.items.map((i) => [i.id, i.chosenSupplierId]))
  const chosen = new Set(source.items.map((i) => i.chosenSupplierId).filter(Boolean))
  return [...source.suppliers]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((s) => chosen.has(s.id))
    .map((s) => draftFor(source, map, s, (itemId) => chosenOf.get(itemId) === s.id))
}

/** Insumos com quantidade sem empresa escolhida (ficam fora das solicitações da cotação escolhida). */
export function unchosenItems(source: Pick<QcMapSource, 'items'>, map: QcMap): { itemId: string; code: string }[] {
  const chosen = new Set(source.items.filter((i) => i.chosenSupplierId).map((i) => i.id))
  return map.items.filter((i) => i.quantity.isPositive() && !chosen.has(i.id)).map((i) => ({ itemId: i.id, code: i.code }))
}

function draftFor(
  source: QcMapSource,
  map: QcMap,
  winner: QcMapSource['suppliers'][number],
  includes: (itemId: string) => boolean,
): ContractDraft {
  const priceOf = new Map(
    map.prices
      .filter((p) => p.competitionSupplierId === winner.id && p.unitPrice?.isPositive())
      .map((p) => [p.itemId, p.unitPrice as Decimal]),
  )
  const dto = new Map(source.items.map((i) => [i.id, i]))
  const refById = new Map(source.references.map((r) => [r.id, r]))
  const packagesOf = new Map<string, Set<string>>()
  for (const l of source.links) if (l.packageCode) packagesOf.set(l.referenceId, (packagesOf.get(l.referenceId) ?? new Set()).add(l.packageCode))
  const items: DraftContractItem[] = []
  const excluded: ContractDraft['excluded'] = []
  let budgetTotal = ZERO

  for (const i of map.items) {
    if (!i.quantity.isPositive() || !includes(i.id)) continue
    const unitPrice = priceOf.get(i.id)
    if (!unitPrice) {
      excluded.push({ itemId: i.id, code: i.code, description: i.description })
      continue
    }
    budgetTotal = budgetTotal.plus(i.budgetTotal)
    const allocations = (map.allocationsByItem.get(i.id) ?? []).map((a) => ({ packageCode: a.packageCode, quantity: a.quantity }))
    const raw = dto.get(i.id)!
    const references = raw.referenceIds.map((rid) => refById.get(rid)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({
      code: r.code,
      description: r.description,
      unit: r.unit,
      packageCodes: [...(packagesOf.get(r.id) ?? [])].sort(),
      budget: map.referenceBudget.get(r.id) ?? ZERO,
    }))
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
      allocations,
      references,
    })
  }

  return {
    winnerCompetitionSupplierId: winner.id,
    supplierId: winner.supplierId,
    items,
    excluded,
    total: Decimal.sum(items.map((i) => i.totalPrice)),
    budgetTotal,
    distribution: contractDistribution(items),
  }
}

export function contractDistribution(items: { totalPrice: Decimal; pctMaterial: Decimal; pctEquipment: Decimal }[]): ContractDistribution {
  return computeDistribution(items.map((i) => ({ total: i.totalPrice, pctMaterial: i.pctMaterial, pctEquipment: i.pctEquipment })))
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

/** Verba e disponível de uma solicitação da cotação escolhida: a parte do QC que cabe aos seus insumos. */
export function contractBudgetShare(draft: Pick<ContractDraft, 'budgetTotal'>, map: Pick<QcMap, 'budgetTotal' | 'available'>) {
  if (!map.budgetTotal.isPositive()) return { budgetAmount: draft.budgetTotal, availableAmount: map.available }
  return { budgetAmount: draft.budgetTotal, availableAmount: map.available.times(draft.budgetTotal).div(map.budgetTotal, 4) }
}

/**
 * Próximo número de solicitação da obra (SC-<obra>-NNN): o maior existente + 1. Pela contagem, um
 * número que faltasse na sequência fazia o próximo repetir um já usado.
 */
export function nextContractCode(workCode: string, existing: string[]): string {
  const n = existing.reduce((max, code) => Math.max(max, Number(/-(\d+)$/.exec(code)?.[1] ?? 0)), 0)
  return `SC-${workCode}-${String(n + 1).padStart(3, '0')}`
}
