/**
 * Árvore do orçamento na estrutura da planilha "Orçamento":
 *   Item (grupo da EAP: 01, 02, 02.01 …) → composição (CPU/CPO, nº do item 02.02.01) → insumos (IM/IS/IP + Vínculo PL)
 *
 * Função pura: recebe grupos/composições e as linhas (insumos) e devolve as linhas da tabela na ordem
 * da EAP, com nível, pai e subtotais (custo total e verba já comprometida em concorrências).
 * O pai de um nível é o código mais longo que é prefixo dele (01 → 01.01 → 01.01.01), seja grupo
 * ou composição, e todo nível com dependentes totaliza os que estão abaixo dele.
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
  /** Custo total: Σ dos dependentes (insumos e subníveis); composição sem nada abaixo: custo da planilha */
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
  /** Custo da composição na planilha (quant. × unit.), para conferir com o total dos dependentes */
  sheetTotal: Decimal | null
  /** Σ custo total dos insumos da própria composição */
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

/** Pai = nó (grupo ou composição) cujo código é o maior prefixo próprio (por segmentos) do código informado. */
function parentOf(wbs: string, codes: Set<string>): string | null {
  const parts = wbs.split('.')
  for (let n = parts.length - 1; n > 0; n--) {
    const p = parts.slice(0, n).join('.')
    if (codes.has(p)) return p
  }
  return null
}

/**
 * Regra dos totais: todo nó com algo abaixo (insumos ou subníveis) vale a soma dos dependentes, em
 * qualquer profundidade. Só a composição sem nada abaixo usa o custo da planilha (quant. × unit.).
 */
export function buildBudgetTree<L extends TreeLineInput>(structure: Pick<BudgetStructureDTO, 'groups' | 'activities'>, lines: L[]): BudgetTreeRow<L>[] {
  const ZERO = Decimal.ZERO
  const linesBy = new Map<string, L[]>()
  for (const l of lines) {
    const own = linesBy.get(l.activityWbs)
    if (own) own.push(l)
    else linesBy.set(l.activityWbs, [l])
  }

  // Composições da estrutura + as que só aparecem nas linhas (orçamento sem cabeçalho de composição)
  const groupCodes = new Set(structure.groups.map((g) => g.wbs))
  const groupName = new Map(structure.groups.map((g) => [g.wbs, g.description]))
  const activities = new Map(structure.activities.map((a) => [a.wbs, a]))
  for (const [wbs, ls] of linesBy) {
    if (!activities.has(wbs) && !groupCodes.has(wbs)) {
      activities.set(wbs, { wbs, code: ls[0]!.activityCode, description: ls[0]!.activityDescription, unit: null, quantity: '', unitCost: '', total: '' })
    }
  }

  // Um nó por código (grupo tem prioridade se o mesmo código vier como grupo e composição)
  type Node = { wbs: string; kind: 'group' | 'activity'; children: Node[] }
  const nodes = new Map<string, Node>()
  for (const a of activities.values()) nodes.set(a.wbs, { wbs: a.wbs, kind: 'activity', children: [] })
  for (const g of structure.groups) nodes.set(g.wbs, { wbs: g.wbs, kind: 'group', children: [] })
  const codes = new Set(nodes.keys())
  const roots: Node[] = []
  for (const n of nodes.values()) {
    const p = parentOf(n.wbs, codes)
    ;(p ? nodes.get(p)!.children : roots).push(n)
  }
  const sortNodes = (ns: Node[]) => {
    ns.sort((a, b) => compareWbs(a.wbs, b.wbs))
    ns.forEach((n) => sortNodes(n.children))
  }
  sortNodes(roots)

  const out: BudgetTreeRow<L>[] = []
  type Sums = { total: Decimal; committed: Decimal; lines: number }
  const walk = (n: Node, level: number, parentKey: string | null): Sums => {
    const key = `${n.kind === 'group' ? 'g' : 'a'}:${n.wbs}`
    const own = n.kind === 'activity' ? (linesBy.get(n.wbs) ?? []) : []
    const linesTotal = Decimal.sum(own.map((l) => l.total))
    let row: GroupRow | ActivityRow
    if (n.kind === 'group') {
      row = { kind: 'group', key, level, parentKey, wbs: n.wbs, description: groupName.get(n.wbs)!, total: ZERO, committed: ZERO, lines: 0 }
    } else {
      const a = activities.get(n.wbs)!
      row = {
        kind: 'activity', key, level, parentKey, wbs: n.wbs, code: a.code, description: a.description, unit: a.unit,
        quantity: a.quantity ? Decimal.from(a.quantity) : null,
        unitCost: a.unitCost ? Decimal.from(a.unitCost) : null,
        sheetTotal: a.total ? Decimal.from(a.total) : null,
        linesTotal,
        total: ZERO, committed: ZERO, lines: 0,
      }
    }
    out.push(row)
    // Insumos da composição
    for (const l of own) {
      out.push({ kind: 'line', key: `l:${l.id}`, level: level + 1, parentKey: key, line: l, total: Decimal.from(l.total), committed: Decimal.from(l.committedValue ?? '0') })
    }
    const sums: Sums = { total: linesTotal, committed: Decimal.sum(own.map((l) => l.committedValue ?? '0')), lines: own.length }
    // Subníveis (grupos ou composições com código mais longo)
    for (const c of n.children) {
      const r = walk(c, level + 1, key)
      sums.total = sums.total.plus(r.total)
      sums.committed = sums.committed.plus(r.committed)
      sums.lines += r.lines
    }
    // Sem nada abaixo: o custo da planilha (composição); com dependentes: a soma deles
    const leaf = !own.length && !n.children.length
    row.total = leaf && row.kind === 'activity' && row.sheetTotal ? row.sheetTotal : sums.total
    row.committed = sums.committed
    row.lines = sums.lines
    return { ...sums, total: row.total }
  }
  for (const r of roots) walk(r, 0, null)
  return out
}
