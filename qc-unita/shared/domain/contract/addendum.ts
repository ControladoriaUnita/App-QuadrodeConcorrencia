/**
 * Aditivos e distratos do contrato (aba "Solic. Aditivo").
 *
 * Regras
 *  - Lançamento é item a item: o valor do aditamento é sempre a soma dos itens (Δ quant. × R$ unit.),
 *    nunca um valor geral do contrato.
 *  - Aditivo soma quantidade (itens do contrato ou itens novos); distrato subtrai, só de itens do contrato
 *    e ao preço contratado. Quem digita informa a quantidade positiva; o sinal vem do tipo.
 *  - Cada item é distribuído entre os IPs (vínculos de planejamento), para o planejamento vincular no ERP.
 *    A soma dos vínculos fecha com a quantidade do item; no distrato, nenhum IP fica negativo.
 *  - A quantidade acumulada do item (contrato + lançamentos aprovados + este) não pode ficar negativa.
 */
import { Decimal } from '../decimal'
import { lineTotal } from '../competition/best-condition'
import type { ValidationIssue } from '../competition/revision'

const ZERO = Decimal.ZERO

export type AddendumKind = 'addendum' | 'termination'

export const ADDENDUM_KIND_LABEL: Record<AddendumKind, { singular: string; verb: string }> = {
  addendum: { singular: 'aditivo', verb: 'aditivar' },
  termination: { singular: 'distrato', verb: 'distratar' },
}

/** Aplica o sinal do tipo a uma quantidade informada como positiva. */
export function signedQuantity(kind: AddendumKind, quantity: Decimal): Decimal {
  return kind === 'termination' ? quantity.abs().neg() : quantity.abs()
}

export interface AddendumAllocation {
  packageCode: string
  /** Com o mesmo sinal do item */
  quantity: Decimal
}

export interface AddendumLine {
  contractItemId: string | null
  code: string
  /** Com sinal: positivo no aditivo, negativo no distrato */
  quantityDelta: Decimal
  unitPrice: Decimal
  allocations: AddendumAllocation[]
}

export interface AddendumLineResult extends AddendumLine {
  totalDelta: Decimal
  /** Quantidade do item após este lançamento (contrato + aprovados + este) */
  quantityAfter: Decimal
}

export interface AddendumSummary {
  lines: AddendumLineResult[]
  /** Total do contrato inicial */
  initialTotal: Decimal
  /** Σ lançamentos aprovados anteriores (aditivos − distratos) */
  previousTotal: Decimal
  /** Total deste lançamento (soma dos itens) */
  totalDelta: Decimal
  /** Novo total do contrato (inicial + anteriores + este) */
  newTotal: Decimal
}

export interface ContractItemBase {
  id: string
  quantity: Decimal
  totalPrice: Decimal
  allocations: { packageCode: string | null; quantity: Decimal }[]
}

/**
 * Calcula o lançamento: total por item, quantidade acumulada por item e o novo total do contrato.
 * `previous` = itens de lançamentos já aprovados.
 */
export function computeAddendum(contractItems: ContractItemBase[], previous: AddendumLine[], lines: AddendumLine[]): AddendumSummary {
  const qty = new Map(contractItems.map((i) => [i.id, i.quantity]))
  for (const p of previous) if (p.contractItemId) qty.set(p.contractItemId, (qty.get(p.contractItemId) ?? ZERO).plus(p.quantityDelta))
  const result = lines.map<AddendumLineResult>((l) => {
    const before = l.contractItemId ? (qty.get(l.contractItemId) ?? ZERO) : ZERO
    return { ...l, totalDelta: lineTotal(l.unitPrice, l.quantityDelta), quantityAfter: before.plus(l.quantityDelta) }
  })
  const initialTotal = Decimal.sum(contractItems.map((i) => i.totalPrice))
  const previousTotal = Decimal.sum(previous.map((p) => lineTotal(p.unitPrice, p.quantityDelta)))
  const totalDelta = Decimal.sum(result.map((r) => r.totalDelta))
  return { lines: result, initialTotal, previousTotal, totalDelta, newTotal: initialTotal.plus(previousTotal).plus(totalDelta) }
}

/** Quantidade vigente de cada IP de um item do contrato: vínculos do contrato + lançamentos aprovados. */
export function currentAllocations(item: ContractItemBase, previous: AddendumLine[]): Map<string, Decimal> {
  const byPackage = new Map<string, Decimal>()
  const add = (code: string | null, q: Decimal) => {
    const k = code ?? ''
    byPackage.set(k, (byPackage.get(k) ?? ZERO).plus(q))
  }
  for (const a of item.allocations) add(a.packageCode, a.quantity)
  for (const p of previous) if (p.contractItemId === item.id) for (const a of p.allocations) add(a.packageCode, a.quantity)
  for (const [k, q] of byPackage) if (q.isZero()) byPackage.delete(k)
  return byPackage
}

/**
 * Sugestão de vínculos para uma quantidade (positiva, como digitada): proporcional à quantidade vigente
 * de cada IP do item, com o arredondamento na última. Sem IP vigente, devolve vazio (usuário escolhe).
 */
export function suggestAllocations(current: Map<string, Decimal>, quantity: Decimal): { packageCode: string; quantity: Decimal }[] {
  const entries = [...current.entries()].filter(([k, q]) => k && q.isPositive()).sort(([a], [b]) => a.localeCompare(b))
  const base = Decimal.sum(entries.map(([, q]) => q))
  if (!entries.length || !base.isPositive() || !quantity.isPositive()) return []
  let rest = quantity
  return entries.map(([packageCode, q], idx) => {
    const share = idx === entries.length - 1 ? rest : quantity.times(q).div(base, 8).round(4)
    rest = rest.minus(share)
    return { packageCode, quantity: share }
  })
}

export function validateAddendum(
  a: { kind: AddendumKind; reason: string; newEndOn: string | null; contractStartOn: string; currentEndOn: string },
  summary: AddendumSummary,
  context: { contractItems: ContractItemBase[]; previous: AddendumLine[] },
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const label = ADDENDUM_KIND_LABEL[a.kind].singular
  const codes = (ls: { code: string }[]) => ls.map((l) => l.code).join(', ')

  if (a.reason.trim().length < 5) issues.push({ field: 'reason', message: `Descreva o motivo do ${label}.` })
  if (a.kind === 'addendum') {
    if (!summary.lines.length && !a.newEndOn) issues.push({ field: 'items', message: 'Informe as quantidades a aditivar ou uma nova data de término.' })
  } else if (!summary.lines.length) {
    issues.push({ field: 'items', message: 'Informe as quantidades a distratar.' })
  }
  if (a.newEndOn && a.newEndOn < a.contractStartOn) issues.push({ field: 'newEndOn', message: 'A nova data de término é anterior ao início do contrato.' })
  if (a.newEndOn && a.newEndOn === a.currentEndOn) issues.push({ field: 'newEndOn', message: 'A nova data de término é igual à vigente.' })

  const wrongSign = summary.lines.filter((l) => (a.kind === 'addendum' ? !l.quantityDelta.isPositive() : !l.quantityDelta.isNegative()))
  if (wrongSign.length) issues.push({ field: 'items', message: `Quantidade inválida em ${codes(wrongSign)}: informe um valor maior que zero.` })
  if (a.kind === 'termination' && summary.lines.some((l) => !l.contractItemId)) {
    issues.push({ field: 'items', message: 'O distrato só reduz itens do contrato.' })
  }
  const negative = summary.lines.filter((l) => l.quantityAfter.isNegative())
  if (negative.length) issues.push({ field: 'items', message: `O distrato passa da quantidade contratada em ${codes(negative)}.` })
  if (summary.lines.some((l) => l.unitPrice.isNegative())) issues.push({ field: 'items', message: 'R$ unitário não pode ser negativo.' })

  // Vínculos de planejamento: todo item distribuído entre IPs, soma igual à quantidade do item
  const unlinked = summary.lines.filter((l) => !l.allocations.length)
  if (unlinked.length) issues.push({ field: 'allocations', message: `Vincule ao planejamento (IP) os itens ${codes(unlinked)}.` })
  const mismatch = summary.lines.filter(
    (l) => l.allocations.length && !Decimal.sum(l.allocations.map((x) => x.quantity)).eq(l.quantityDelta),
  )
  if (mismatch.length) issues.push({ field: 'allocations', message: `A soma dos vínculos não fecha com a quantidade em ${codes(mismatch)}.` })
  if (summary.lines.some((l) => l.allocations.some((x) => !x.packageCode.trim()))) {
    issues.push({ field: 'allocations', message: 'Todo vínculo precisa de um IP.' })
  }
  if (a.kind === 'termination') {
    const items = new Map(context.contractItems.map((i) => [i.id, i]))
    const over = summary.lines.filter((l) => {
      const item = l.contractItemId ? items.get(l.contractItemId) : undefined
      if (!item) return false
      const current = currentAllocations(item, context.previous)
      return l.allocations.some((x) => (current.get(x.packageCode) ?? ZERO).plus(x.quantity).isNegative())
    })
    if (over.length) issues.push({ field: 'allocations', message: `O distrato passa da quantidade vigente do IP em ${codes(over)}.` })
  }
  return issues
}

/** Término vigente do contrato: maior "nova data de término" dos lançamentos aprovados, senão o original. */
export function currentEndOn(endOn: string, approvedAddenda: { newEndOn: string | null; number: number; kind?: AddendumKind; decidedAt?: string | null }[]): string {
  const withDate = approvedAddenda.filter((a) => a.newEndOn)
  // Aditivos e distratos têm numeração própria: a ordem real é a da aprovação
  const last = [...withDate].sort((a, b) => (a.decidedAt ?? '').localeCompare(b.decidedAt ?? '') || a.number - b.number).at(-1)
  return last?.newEndOn ?? endOn
}
