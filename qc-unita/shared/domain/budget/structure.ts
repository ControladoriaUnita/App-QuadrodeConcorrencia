/**
 * Árvore do orçamento na estrutura da planilha "Orçamento":
 *   Item (grupo da EAP: 01, 02, 02.01 …) → composição (CPU/CPO, nº do item 02.02.01) → insumos (IM/IS/IP + Vínculo PL)
 *
 * Função pura: recebe grupos/composições e as linhas (insumos) e devolve as linhas da tabela na ordem
 * da EAP, com nível, pai e subtotais (custo total e verba já comprometida em concorrências).
 */
import type { BudgetStructureDTO } from '../../contracts'
import { Decimal } from '../decimal'

export interface TreeLineInput {
  id: string
  activityWbs: string
  activityCode: string | null
  activityDescription: string
  total: string
  /** Verba já puxada por concorrências (opcional) */
  committedValue?: string
}

interface Base {
  key: string
  /** 0 = item de 1º nível */
  level: number
  parentKey: string | null
  /** Custo total (grupo: Σ insumos; composição: quant. × custo unit.; insumo: custo total da linha) */
  total: Decimal
  /** Σ verba comprometida dos insumos abaixo */
  committed: Decimal
}
export interface GroupRow extends Base { kind: 'group'; wbs: string; description: string; lines: number }
export interface ActivityRow extends Base {
  kind: 'activity'
  wbs: string
  code: string | null
  description: string
  unit: string | null
  quantity: Decimal | null
  unitCost: Decimal | null
  /** Σ custo total dos insumos (para conferir com quant. × unit.) */
  linesTotal: Decimal
  lines: number
}
export interface LineRow<L> extends Base { kind: 'line'; line: L }
export type BudgetTreeRow<L> = GroupRow | ActivityRow | LineRow<L>

/** Comparação natural de EAP: "02.10" depois de "02.9"; "02" antes de "02.01". */
export function compareWbs(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    const na = Number(pa[i])
    const nb = Number(pb[i])
    const c = Number.isNaN(na) || Number.isNaN(nb) ? pa[i]!.localeCompare(pb[i]!) : na - nb
    if (c !== 0) return c
  }
  return 0
}

/** Pai = grupo cujo código é o maior prefixo próprio (por segmentos) do código informado. */
function parentGroup(wbs: string, groups: Set<string>): string | null {
  const parts = wbs.split('.')
  for (let n = parts.length - 1; n > 0; n--) {
    const p = parts.slice(0, n).join('.')
    if (groups.has(p)) return p
  }
  return null
}

export function buildBudgetTree<L extends TreeLineInput>(structure: Pick<BudgetStructureDTO, 'groups' | 'activities'>, lines: L[]): BudgetTreeRow<L>[] {
  const ZERO = Decimal.ZERO
  const groupCodes = new Set(structure.groups.map((g) => g.wbs))
  const linesBy = new Map<string, L[]>()
  for (const l of lines) linesBy.set(l.activityWbs, [...(linesBy.get(l.activityWbs) ?? []), l])

  // Composições da estrutura + as que só aparecem nas linhas (orçamento sem cabeçalho de composição)
  const activities = new Map(structure.activities.map((a) => [a.wbs, a]))
  for (const [wbs, ls] of linesBy) {
    if (!activities.has(wbs) && !groupCodes.has(wbs)) {
      activities.set(wbs, { wbs, code: ls[0]!.activityCode, description: ls[0]!.activityDescription, unit: null, quantity: '', unitCost: '', total: '' })
    }
  }

  type Node = { wbs: string; kind: 'group' | 'activity'; children: Node[] }
  const nodes = new Map<string, Node>()
  for (const g of structure.groups) nodes.set(`g:${g.wbs}`, { wbs: g.wbs, kind: 'group', children: [] })
  for (const a of activities.values()) nodes.set(`a:${a.wbs}`, { wbs: a.wbs, kind: 'activity', children: [] })
  const roots: Node[] = []
  for (const n of nodes.values()) {
    const p = parentGroup(n.wbs, groupCodes)
    ;(p ? nodes.get(`g:${p}`)!.children : roots).push(n)
  }
  const sortNodes = (ns: Node[]) => {
    ns.sort((a, b) => compareWbs(a.wbs, b.wbs) || (a.kind === 'group' ? -1 : 1))
    ns.forEach((n) => sortNodes(n.children))
  }
  sortNodes(roots)

  const out: BudgetTreeRow<L>[] = []
  const walk = (n: Node, level: number, parentKey: string | null): { total: Decimal; committed: Decimal; lines: number } => {
    if (n.kind === 'activity') {
      const a = activities.get(n.wbs)!
      const key = `a:${n.wbs}`
      const own = linesBy.get(n.wbs) ?? []
      const row: ActivityRow = {
        kind: 'activity', key, level, parentKey, wbs: n.wbs, code: a.code, description: a.description, unit: a.unit,
        quantity: a.quantity ? Decimal.from(a.quantity) : null,
        unitCost: a.unitCost ? Decimal.from(a.unitCost) : null,
        linesTotal: Decimal.sum(own.map((l) => l.total)),
        total: ZERO, committed: Decimal.sum(own.map((l) => l.committedValue ?? '0')), lines: own.length,
      }
      row.total = a.total ? Decimal.from(a.total) : row.linesTotal
      out.push(row)
      for (const l of own) {
        out.push({ kind: 'line', key: `l:${l.id}`, level: level + 1, parentKey: key, line: l, total: Decimal.from(l.total), committed: Decimal.from(l.committedValue ?? '0') })
      }
      return { total: row.linesTotal, committed: row.committed, lines: own.length }
    }
    const key = `g:${n.wbs}`
    const row: GroupRow = { kind: 'group', key, level, parentKey, wbs: n.wbs, description: structure.groups.find((g) => g.wbs === n.wbs)!.description, total: ZERO, committed: ZERO, lines: 0 }
    out.push(row)
    for (const c of n.children) {
      const r = walk(c, level + 1, key)
      row.total = row.total.plus(r.total)
      row.committed = row.committed.plus(r.committed)
      row.lines += r.lines
    }
    return { total: row.total, committed: row.committed, lines: row.lines }
  }
  for (const r of roots) walk(r, 0, null)
  return out
}
