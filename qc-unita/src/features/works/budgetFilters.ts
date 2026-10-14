/**
 * Filtros por coluna do orçamento, como no Excel (▾ no cabeçalho), sem React para dar para testar.
 *
 * Valem para TODAS as linhas da árvore (Item, composição, auxiliar e insumo), cada uma com o valor
 * que mostra na coluna. Coluna que não se aplica ao tipo de linha (ex.: Vínculo PL num Item) não
 * passa no filtro por conta própria; a linha só aparece como ancestral de algo que passou.
 *
 * Coluna Item: lista todos os níveis da EAP (01, 01.01, 01.01.01…), em ordem e recuados; cada linha
 * vale pelo nível da EAP mais próximo dela (o próprio, ou o da composição/Item onde está). Marcar ou
 * desmarcar um nível leva junto os que estão abaixo dele (ver `ValuesEditor`).
 */
import type { BudgetLineUsageDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import type { TreeRowWithAux } from './budgetAux'

export type BudgetRow = TreeRowWithAux<BudgetLineUsageDTO>

/** Valores escolhidos (lista) ou faixa numérica (já convertida ao aplicar) */
export type ColumnFilterValue = { kind: 'values'; values: Set<string> } | { kind: 'range'; min: Decimal | null; max: Decimal | null }

/** Um valor da lista do filtro; `depth` só nas listas em árvore (marcar um nível leva os de baixo) */
export interface FilterOption {
  value: string
  count: number
  depth?: number
}

export const EMPTY_VALUE = '(vazio)'
export const NO_USAGE = 'Sem compromisso'

export type BudgetColumn = 'item' | 'code' | 'description' | 'unit' | 'quantity' | 'unitCost' | 'total' | 'package' | 'classification' | 'usage' | 'free'

/** Colunas do orçamento, na ordem da tela */
export const BUDGET_COLUMNS: { key: BudgetColumn; label: string; numeric?: boolean }[] = [
  { key: 'item', label: 'Item' },
  { key: 'code', label: 'Código' },
  { key: 'description', label: 'Descrição' },
  { key: 'unit', label: 'Unid' },
  { key: 'quantity', label: 'Quantidade', numeric: true },
  { key: 'unitCost', label: 'Custo Unit.', numeric: true },
  { key: 'total', label: 'Custo Total', numeric: true },
  { key: 'package', label: 'Vínculo PL' },
  { key: 'classification', label: 'Classificação' },
  { key: 'usage', label: 'Comprometido' },
  { key: 'free', label: 'Livre', numeric: true },
]
const LIST_COLUMNS = BUDGET_COLUMNS.filter((c) => !c.numeric).map((c) => c.key)

export type BudgetFilters = Partial<Record<BudgetColumn, ColumnFilterValue>>

/** O valor passa no filtro? Colunas de lista recebem os valores da linha (um ou vários). */
export function matchesFilter(f: ColumnFilterValue, value: string[] | Decimal): boolean {
  if (f.kind === 'values') return Array.isArray(value) && value.some((v) => f.values.has(v))
  if (Array.isArray(value)) return false
  return (!f.min || !value.lt(f.min)) && (!f.max || !value.gt(f.max))
}

/** Rótulo de um nível da EAP na lista da coluna Item */
const itemLabel = (r: Extract<BudgetRow, { kind: 'group' | 'activity' }>) => `${r.wbs} — ${r.description}`

/** Nível da EAP de cada linha (o próprio Item/composição, ou o mais próximo acima) */
export function itemOfRows(tree: BudgetRow[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of tree) {
    if (r.kind === 'group' || r.kind === 'activity') m.set(r.key, itemLabel(r))
    else m.set(r.key, (r.parentKey && m.get(r.parentKey)) || EMPTY_VALUE) // pai vem antes na árvore
  }
  return m
}

const text = (v: string | null | undefined) => [v || EMPTY_VALUE]

/**
 * Valor da linha na coluna: lista de textos ou número. `null` = a coluna não se aplica a esse
 * tipo de linha (a linha não passa no filtro por conta própria).
 */
export function cellValue(r: BudgetRow, k: BudgetColumn, itemOf: Map<string, string>): string[] | Decimal | null {
  if (k === 'item') return [itemOf.get(r.key) ?? EMPTY_VALUE]
  if (k === 'total') return r.total
  if (k === 'free') return r.kind === 'line' ? Decimal.from(r.line.total).minus(r.line.committedValue) : r.total.minus(r.committed)
  switch (r.kind) {
    case 'line': {
      const l = r.line
      switch (k) {
        case 'code': return text(l.code)
        case 'description': return text(l.description)
        case 'unit': return text(l.unit)
        case 'quantity': return Decimal.from(l.quantity)
        case 'unitCost': return Decimal.from(l.unitCost)
        case 'package': return text(l.packageCode)
        case 'classification': return text(l.packageDescription)
        case 'usage': return l.usage.length ? l.usage.map((u) => u.competitionCode) : [NO_USAGE]
      }
      break
    }
    case 'activity':
      switch (k) {
        case 'code': return text(r.code)
        case 'description': return text(r.description)
        case 'unit': return text(r.unit)
        case 'quantity': return r.quantity
        case 'unitCost': return r.unitCost
      }
      break
    case 'aux':
      switch (k) {
        case 'code': return text(r.code)
        case 'description': return text(r.description)
        case 'unit': return text(r.unit)
        case 'quantity': return r.coefficient
        case 'unitCost': return r.unitCost
      }
      break
    case 'group':
      if (k === 'description') return text(r.description)
  }
  return null
}

/** A linha passa em todos os filtros ativos? */
export function passesFilters(r: BudgetRow, filters: BudgetFilters, itemOf: Map<string, string>): boolean {
  for (const [k, f] of Object.entries(filters) as [BudgetColumn, ColumnFilterValue][]) {
    const v = cellValue(r, k, itemOf)
    if (v === null || !matchesFilter(f, v)) return false
  }
  return true
}

/**
 * Valores de cada coluna de lista, com a contagem de linhas. A coluna Item segue a ordem e os
 * níveis da EAP (contagem = insumos abaixo); as demais vão em ordem alfabética.
 */
export function filterOptions(tree: BudgetRow[], itemOf: Map<string, string>): Record<BudgetColumn, FilterOption[]> {
  const out = {} as Record<BudgetColumn, FilterOption[]>
  out.item = tree.flatMap((r) => (r.kind === 'group' || r.kind === 'activity' ? [{ value: itemLabel(r), count: r.lines, depth: r.level }] : []))
  if (tree.some((r) => itemOf.get(r.key) === EMPTY_VALUE)) out.item.push({ value: EMPTY_VALUE, count: 0, depth: 0 })
  for (const k of LIST_COLUMNS) {
    if (k === 'item') continue
    const m = new Map<string, number>()
    for (const r of tree) {
      const v = cellValue(r, k, itemOf)
      if (Array.isArray(v)) for (const x of v) m.set(x, (m.get(x) ?? 0) + 1)
    }
    out[k] = [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value, 'pt-BR', { numeric: true }))
  }
  return out
}
