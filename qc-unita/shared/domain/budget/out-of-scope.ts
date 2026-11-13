/**
 * Custos fora de escopo da obra: itens que não estão previstos no orçamento (não há linha para
 * vincular numa concorrência). Ficam registrados à parte, com motivo e justificativa, para que a
 * obra saiba quanto está gastando além do orçado.
 *
 * Regras
 *  - Total = quantidade × custo unitário, 4 casas (mesma regra do mapa de cotação).
 *  - Quantidade > 0; custo unitário ≥ 0; descrição, unidade e justificativa obrigatórias.
 *  - Resumo: total geral, por motivo e por Item da EAP, e a razão sobre o orçamento vigente.
 */
import { Decimal, type DecimalInput } from '../decimal'
import { lineTotal } from '../competition/best-condition'

export const OUT_OF_SCOPE_CATEGORIES = {
  client_request: 'Solicitação do cliente',
  budget_omission: 'Omissão do orçamento',
  design_change: 'Alteração de projeto',
  technical_requirement: 'Exigência técnica',
  regulatory: 'Exigência legal / concessionária',
  other: 'Outros',
} as const
export type OutOfScopeCategory = keyof typeof OUT_OF_SCOPE_CATEGORIES

export const outOfScopeCode = (number: number) => `FE-${String(number).padStart(3, '0')}`

export function outOfScopeTotal(quantity: DecimalInput, unitCost: DecimalInput): Decimal {
  return lineTotal(Decimal.from(unitCost), Decimal.from(quantity))
}

export interface OutOfScopeLike {
  quantity: string
  unitCost: string
  category: OutOfScopeCategory
  wbs: string | null
  wbsDescription: string | null
}

export interface OutOfScopeSummary {
  total: Decimal
  count: number
  byCategory: { category: OutOfScopeCategory; label: string; total: Decimal; count: number }[]
  /** Por Item da EAP de 1º nível (02, 03…); sem Item = "—" */
  byItem: { wbs: string | null; description: string | null; total: Decimal; count: number }[]
  /** Total fora de escopo ÷ orçamento vigente (null sem orçamento) */
  ratio: Decimal | null
  /** Orçamento vigente + fora de escopo */
  budgetWithOutOfScope: Decimal
}

/**
 * @param groupName nome do Item da EAP pelo código (estrutura do orçamento); sem ele usa a
 *                  descrição gravada no lançamento quando aponta direto para o Item de 1º nível.
 */
export function summarizeOutOfScope(items: OutOfScopeLike[], budgetTotal: DecimalInput | null, groupName?: (wbs: string) => string | null): OutOfScopeSummary {
  const totals = items.map((i) => outOfScopeTotal(i.quantity, i.unitCost))
  const total = Decimal.sum(totals)
  const cat = new Map<OutOfScopeCategory, { total: Decimal; count: number }>()
  const item = new Map<string, { wbs: string | null; description: string | null; total: Decimal; count: number }>()
  items.forEach((i, k) => {
    const c = cat.get(i.category) ?? { total: Decimal.ZERO, count: 0 }
    cat.set(i.category, { total: c.total.plus(totals[k]!), count: c.count + 1 })
    const top = i.wbs ? i.wbs.split('.')[0]! : null
    const key = top ?? ''
    const e = item.get(key) ?? { wbs: top, description: top ? (groupName?.(top) ?? null) : null, total: Decimal.ZERO, count: 0 }
    if (!e.description && top === i.wbs) e.description = i.wbsDescription
    item.set(key, { ...e, total: e.total.plus(totals[k]!), count: e.count + 1 })
  })
  const budget = budgetTotal == null ? null : Decimal.from(budgetTotal)
  return {
    total,
    count: items.length,
    byCategory: (Object.keys(OUT_OF_SCOPE_CATEGORIES) as OutOfScopeCategory[])
      .filter((k) => cat.has(k))
      .map((k) => ({ category: k, label: OUT_OF_SCOPE_CATEGORIES[k], ...cat.get(k)! }))
      .sort((a, b) => b.total.compare(a.total)),
    byItem: [...item.values()].sort((a, b) => (a.wbs === null ? 1 : b.wbs === null ? -1 : a.wbs.localeCompare(b.wbs, 'pt-BR', { numeric: true }))),
    ratio: budget && !budget.isZero() ? total.div(budget, 6) : null,
    budgetWithOutOfScope: (budget ?? Decimal.ZERO).plus(total),
  }
}
