/**
 * Orçamento na estrutura da planilha "Orçamento": Item → composição (CPU/CPO) → insumos,
 * com as composições auxiliares abertas (nó da auxiliar → seus insumos) dentro da composição,
 * com as mesmas colunas (Item · Código · Descrição · Unid · Quantidade · Custo Unit. · Custo Total ·
 * Vínculo PL · Classificação) e, à direita, o comprometido em concorrências e o saldo livre.
 * Níveis recolhíveis como o agrupamento do Excel; lista virtualizada (orçamentos com milhares de linhas).
 *
 * Modo seletor (`selectable`): a MESMA tela serve para escolher os insumos de uma concorrência.
 * Cada insumo marcado recebe o "% a consumir" (verba puxada = custo total × %). Em Item e composição,
 * a caixa marca todos os insumos abaixo e o % digitado vale para todos eles (limitado ao livre de cada um).
 *
 * Filtros por coluna como no Excel (▾ no cabeçalho): lista de valores com busca ou faixa numérica;
 * a árvore mantém os ancestrais das linhas que passam. Com `planning`, a coluna Vínculo PL vira
 * um seletor do IP (lista de IPs da obra), gravado na hora. Com `onRenameGroup`, o nome dos Itens
 * da EAP fica editável (a planilha não traz esses nomes).
 */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronsDownUp, FilterX, Pencil, Percent, Search } from 'lucide-react'
import type { BudgetLineUsageDTO, BudgetStructureDTO, PlanningCodeDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { buildBudgetTree } from '@shared/domain/budget/structure'
import { Badge, Button, Combobox, DecimalInput, Dialog, Field, Input, Select } from '@/components/ui'
import { cn } from '@/utils/cn'
import { EMPTY, formatBRL, formatCoefficient, formatDecimal, formatPercent, formatQuantity } from '@/utils/format'
import { freeShare, pulledValue } from './BudgetLinesTable'
import { withAuxCompositions, type AuxRow, type TreeRowWithAux } from './budgetAux'
import { ColumnFilter, EMPTY_VALUE, matchesFilter, type ColumnFilterValue } from './ColumnFilter'
import { planningOptions } from './planning'

type Row = TreeRowWithAux<BudgetLineUsageDTO>
type LineRow = Extract<Row, { kind: 'line' }>
type Depth = 'items' | 'compositions' | 'all'

const ROW_H = 34
const OVERSCAN = 12
// Classes literais (o Tailwind só gera o que encontra escrito por extenso)
const COLS = 'grid-cols-[6.5rem_6.5rem_minmax(20rem,1fr)_4.5rem_7rem_7.5rem_8.5rem_7rem_9rem_10rem_7.5rem]'
const SELECT_COLS = 'grid-cols-[2.25rem_6.5rem_6.5rem_minmax(18rem,1fr)_4.5rem_7rem_7.5rem_8.5rem_7rem_9rem_10rem_7.5rem_6.5rem_8.5rem]'
const tone = { contracted: 'success', in_approval: 'warning', quoting: 'primary' } as const
/** Colunas do seletor fixas à direita (como "congelar painéis"): sempre visíveis ao rolar para o lado */
const PIN_SHARE = 'sticky right-[8.5rem] z-[1] grid h-full items-center bg-primary-soft shadow-[-1px_0_0_var(--color-border)]'
const PIN_VALUE = 'sticky right-0 z-[1] flex h-full items-center justify-end bg-primary-soft'

export interface BudgetTreeSelection {
  /** Insumos escolhidos → % a consumir (canônico, 0..1) */
  value: Map<string, string>
  onChange: (next: Map<string, string>) => void
  /** Insumos que não podem ser escolhidos (ex.: já estão no QC) */
  disabledIds?: Set<string>
}

/** Escolha manual do IP de cada linha (tela do orçamento) */
export interface BudgetTreePlanning {
  options: PlanningCodeDTO[]
  loading?: boolean
  warning?: string | null
  onSet: (line: BudgetLineUsageDTO, planning: { code: string; description: string | null } | null) => Promise<unknown>
}

interface Props {
  structure: BudgetStructureDTO
  lines: BudgetLineUsageDTO[]
  maxHeight?: string
  selection?: BudgetTreeSelection
  initialOnlyBalance?: boolean
  planning?: BudgetTreePlanning
  /** Renomeia um Item da EAP (null volta ao nome da planilha) */
  onRenameGroup?: (wbs: string, description: string | null) => Promise<unknown>
}

type ColKey = 'item' | 'code' | 'description' | 'unit' | 'quantity' | 'unitCost' | 'total' | 'package' | 'classification' | 'usage' | 'free'
const NUMERIC: ColKey[] = ['quantity', 'unitCost', 'total', 'free']
const NO_USAGE = 'Sem compromisso'

export function BudgetTree({ structure, lines, maxHeight = 'calc(100dvh - 15rem)', selection, initialOnlyBalance = false, planning, onRenameGroup }: Props) {
  const selectable = !!selection
  const [search, setSearch] = useState('')
  const [pkg, setPkg] = useState('')
  const [onlyBalance, setOnlyBalance] = useState(initialOnlyBalance)
  const [onlySelected, setOnlySelected] = useState(false)
  const [bulk, setBulk] = useState<string | null>(null)
  const [filters, setFilters] = useState<Partial<Record<ColKey, ColumnFilterValue>>>({})
  const [editingLine, setEditingLine] = useState<BudgetLineUsageDTO | null>(null)
  const setFilter = (k: ColKey) => (f: ColumnFilterValue | undefined) =>
    setFilters((s) => {
      const n = { ...s }
      if (f) n[k] = f
      else delete n[k]
      return n
    })
  const [depth, setDepthState] = useState<Depth>('all')
  /** Recolhidos / expandidos manualmente (sobre o nível escolhido) */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)
  const scroller = useRef<HTMLDivElement>(null)

  const packages = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of lines) if (l.packageCode && !m.has(l.packageCode)) m.set(l.packageCode, l.packageDescription ?? l.packageCode)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [lines])

  const tree = useMemo(() => withAuxCompositions(buildBudgetTree(structure, lines)), [structure, lines])
  const byKey = useMemo(() => new Map(tree.map((r) => [r.key, r])), [tree])
  /** Insumos abaixo de cada Item/composição/auxiliar (para marcar em bloco) */
  const linesUnder = useMemo(() => {
    const m = new Map<string, LineRow[]>()
    for (const r of tree) {
      if (r.kind !== 'line') continue
      for (let p = r.parentKey; p; p = byKey.get(p)!.parentKey) m.set(p, [...(m.get(p) ?? []), r])
    }
    return m
  }, [tree, byKey])
  /** Item (grupo de 1º nível) de cada linha, para o filtro da coluna Item */
  const rootOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of tree) {
      if (r.kind !== 'line') continue
      let p = r.parentKey ? byKey.get(r.parentKey) : undefined
      while (p?.parentKey) p = byKey.get(p.parentKey)
      m.set(r.key, p && p.kind === 'group' ? `${p.wbs} — ${p.description}` : EMPTY_VALUE)
    }
    return m
  }, [tree, byKey])
  /** Valor de cada coluna numa linha: número (colunas de valor) ou lista de textos (as demais) */
  const valueOf = (r: LineRow, k: ColKey): string[] | Decimal => {
    const l = r.line
    const text = (v: string | null) => [v || EMPTY_VALUE]
    switch (k) {
      case 'item': return text(rootOf.get(r.key) ?? null)
      case 'code': return text(l.code)
      case 'description': return text(l.description)
      case 'unit': return text(l.unit)
      case 'package': return text(l.packageCode)
      case 'classification': return text(l.packageDescription)
      case 'usage': return l.usage.length ? l.usage.map((u) => u.competitionCode) : [NO_USAGE]
      case 'quantity': return Decimal.from(l.quantity)
      case 'unitCost': return Decimal.from(l.unitCost)
      case 'total': return Decimal.from(l.total)
      case 'free': return Decimal.from(l.total).minus(l.committedValue)
    }
  }
  const activeFilters = Object.entries(filters) as [ColKey, ColumnFilterValue][]
  const passes = (r: LineRow) => activeFilters.every(([k, f]) => matchesFilter(f, valueOf(r, k)))
  /** Valores distintos de cada coluna de lista (com contagem) */
  const distinct = useMemo(() => {
    const out = {} as Record<ColKey, { value: string; count: number }[]>
    for (const k of ['item', 'code', 'description', 'unit', 'package', 'classification', 'usage'] as ColKey[]) {
      const m = new Map<string, number>()
      for (const r of tree) {
        if (r.kind !== 'line') continue
        for (const v of valueOf(r, k) as string[]) m.set(v, (m.get(v) ?? 0) + 1)
      }
      out[k] = [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value, 'pt-BR', { numeric: true }))
    }
    return out
  }, [tree, rootOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const columnFilters = Object.keys(filters).length
  const filtering = !!(search.trim() || pkg || onlyBalance || onlySelected || columnFilters)

  /** Linhas visíveis: filtro mantém os ancestrais; sem filtro, respeita os níveis recolhidos. */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (filtering) {
      const keep = new Set<string>()
      const text = (r: Row) =>
        r.kind === 'line'
          ? `${r.line.code} ${r.line.description} ${r.line.packageCode ?? ''} ${r.line.packageDescription ?? ''}`
          : r.kind === 'aux'
            ? `${r.code} ${r.description}`
            : `${r.wbs} ${r.kind === 'activity' ? (r.code ?? '') : ''} ${r.description}`
      for (const r of tree) {
        if (r.kind !== 'line') continue
        const l = r.line
        if (pkg && l.packageCode !== pkg) continue
        if (onlyBalance && !Decimal.from(l.balanceShare).isPositive()) continue
        if (onlySelected && !selection?.value.has(l.id)) continue
        if (columnFilters && !passes(r)) continue
        // busca casa no insumo ou em qualquer ancestral (auxiliar/composição/Item)
        let hit = !q || text(r).toLowerCase().includes(q)
        for (let p = r.parentKey; !hit && p; p = byKey.get(p)!.parentKey) hit = text(byKey.get(p)!).toLowerCase().includes(q)
        if (!hit) continue
        keep.add(r.key)
        for (let p = r.parentKey; p && !keep.has(p); p = byKey.get(p)!.parentKey) keep.add(p)
      }
      return tree.filter((r) => keep.has(r.key))
    }
    const out: Row[] = []
    const shown = new Set<string>()
    for (const r of tree) {
      if (r.parentKey && !(shown.has(r.parentKey) && childVisible(byKey.get(r.parentKey)!, r))) continue
      shown.add(r.key)
      out.push(r)
    }
    return out
  }, [tree, byKey, search, pkg, onlyBalance, onlySelected, filtering, collapsed, expanded, depth, filters, onlySelected && selection?.value]) // eslint-disable-line react-hooks/exhaustive-deps

  const shownLines = visible.filter((r): r is LineRow => r.kind === 'line')
  const allLines = tree.filter((r): r is LineRow => r.kind === 'line')
  const footerLines = filtering ? shownLines : allLines
  const footer = {
    total: Decimal.sum(footerLines.map((r) => r.total)),
    committed: Decimal.sum(footerLines.map((r) => r.committed)),
    count: filtering ? shownLines.length : lines.length,
  }

  // ------------------------------------------------------------------ seleção
  const canPick = (l: BudgetLineUsageDTO) => !selection?.disabledIds?.has(l.id) && freeShare(l).isPositive()
  const update = (fn: (m: Map<string, string>) => void) => {
    if (!selection) return
    const next = new Map(selection.value)
    fn(next)
    selection.onChange(next)
  }
  const setLines = (rows: LineRow[], on: boolean, share?: string) =>
    update((m) => {
      for (const { line: l } of rows) {
        if (!on) m.delete(l.id)
        else if (canPick(l)) m.set(l.id, share ? Decimal.min(Decimal.from(share), freeShare(l)).toFixed(6) : (m.get(l.id) ?? freeShare(l).toFixed(6)))
      }
    })
  const selectedUnder = (key: string) => {
    const ls = linesUnder.get(key) ?? []
    const pickable = ls.filter((r) => canPick(r.line))
    const chosen = ls.filter((r) => selection?.value.has(r.line.id))
    const pulled = Decimal.sum(chosen.map((r) => pulledValue(r.line, selection!.value.get(r.line.id)!)))
    return { ls, pickable, chosen, pulled }
  }
  const pulledTotal = selection ? Decimal.sum(allLines.filter((r) => selection.value.has(r.line.id)).map((r) => pulledValue(r.line, selection.value.get(r.line.id)!))) : Decimal.ZERO

  /** Filho aparece se o pai está aberto: pelo nível escolhido ou por expansão manual (auxiliar: aberta por padrão) */
  function childVisible(parent: Row, child: Row): boolean {
    if (collapsed.has(parent.key)) return false
    if (child.kind === 'group' || parent.kind === 'aux') return true
    if (child.kind === 'activity') return depth !== 'items' || expanded.has(parent.key)
    return depth === 'all' || expanded.has(parent.key)
  }
  const isOpen = (r: Row) =>
    !collapsed.has(r.key) &&
    (r.kind === 'aux' ||
      (r.kind === 'group' ? depth !== 'items' || expanded.has(r.key) || !tree.some((c) => c.parentKey === r.key && c.kind === 'activity') : depth === 'all' || expanded.has(r.key)))
  const setDepth = (d: Depth) => {
    setDepthState(d)
    setCollapsed(new Set())
    setExpanded(new Set())
    scroller.current?.scrollTo({ top: 0 })
  }
  const toggle = (r: Row) => {
    const open = isOpen(r)
    setCollapsed((s) => {
      const n = new Set(s)
      if (open) n.add(r.key)
      else n.delete(r.key)
      return n
    })
    setExpanded((s) => {
      const n = new Set(s)
      if (open) n.delete(r.key)
      else n.add(r.key)
      return n
    })
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const end = Math.min(visible.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN)
  const cols = selectable ? SELECT_COLS : COLS

  const hd = 'px-2 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input aria-label="Buscar no orçamento" placeholder="Item, composição, código ou insumo" className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Vínculo PL" className="h-9 w-auto max-w-80" value={pkg} onChange={(e) => setPkg(e.target.value)}>
          <option value="">Todos os vínculos PL ({packages.length})</option>
          {packages.map(([code, desc]) => (
            <option key={code} value={code}>{code} — {desc}</option>
          ))}
        </Select>
        <label className="inline-flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" className="size-4 accent-primary" checked={onlyBalance} onChange={(e) => setOnlyBalance(e.target.checked)} />
          Somente com saldo
        </label>
        {selectable && (
          <label className="inline-flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" className="size-4 accent-primary" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
            Somente marcados
          </label>
        )}
        <div className="inline-flex overflow-hidden rounded-control border border-border text-sm" role="group" aria-label="Nível de detalhe">
          <ChevronsDownUp className="mx-2 size-4 self-center text-ink-400" aria-hidden />
          {([['items', 'Itens'], ['compositions', 'Composições'], ['all', 'Insumos']] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              disabled={filtering}
              aria-pressed={depth === k}
              onClick={() => setDepth(k)}
              className={cn('border-l border-border px-3 py-1.5 font-medium hover:bg-ink-100 disabled:opacity-50', depth === k ? 'bg-primary-soft text-primary' : 'text-ink-700')}
            >
              {label}
            </button>
          ))}
        </div>
        {columnFilters > 0 && (
          <Button size="sm" variant="ghost" icon={<FilterX className="size-4" />} onClick={() => setFilters({})}>
            Limpar filtros ({columnFilters})
          </Button>
        )}
        {selectable && (
          <div className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface pl-2">
            <Percent className="size-3.5 text-ink-400" aria-hidden />
            <DecimalInput aria-label="Percentual para aplicar aos insumos marcados" className="h-8 w-20" scale="ratio" max="1" placeholder="% todos" value={bulk} onCommit={setBulk} />
            <Button
              size="sm"
              variant="ghost"
              disabled={!bulk || !selection.value.size}
              onClick={() => setLines(allLines.filter((r) => selection.value.has(r.line.id)), true, bulk ?? undefined)}
            >
              Aplicar aos marcados
            </Button>
          </div>
        )}
      </div>

      <div
        ref={(el) => {
          scroller.current = el
          if (el && el.clientHeight !== viewport) setViewport(el.clientHeight)
        }}
        className="overflow-auto"
        style={{ maxHeight }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="tabular min-w-max text-sm" role="table" aria-label="Orçamento da obra" aria-rowcount={visible.length}>
          <div role="row" className={cn('sticky top-0 z-10 grid border-b border-border bg-ink-50', cols)}>
            {selectable && <span role="columnheader" className={hd} aria-label="Marcar" />}
            {([
              ['item', 'Item'], ['code', 'Código'], ['description', 'Descrição'], ['unit', 'Unid'], ['quantity', 'Quantidade'],
              ['unitCost', 'Custo Unit.'], ['total', 'Custo Total'], ['package', 'Vínculo PL'], ['classification', 'Classificação'],
              ['usage', 'Comprometido em'], ['free', 'Livre'],
            ] as [ColKey, string][]).map(([k, label]) => {
              const numeric = NUMERIC.includes(k)
              return (
                <span key={k} role="columnheader" className={cn(hd, 'flex items-center', numeric && 'justify-end')}>
                  <span className="truncate">{label}</span>
                  <ColumnFilter label={label} numeric={numeric} values={numeric ? undefined : distinct[k]} filter={filters[k]} onChange={setFilter(k)} align={numeric ? 'right' : 'left'} />
                </span>
              )
            })}
            {selectable && <span role="columnheader" className={cn(hd, PIN_SHARE, 'text-right text-primary')}>% a consumir</span>}
            {selectable && <span role="columnheader" className={cn(hd, PIN_VALUE, 'text-right text-primary')}>Verba puxada</span>}
          </div>
          <div style={{ height: visible.length * ROW_H, position: 'relative' }}>
            {visible.slice(start, end).map((r, i) => (
              <TreeRow
                key={r.key}
                r={r}
                cols={cols}
                top={(start + i) * ROW_H}
                open={filtering || isOpen(r)}
                onToggle={() => toggle(r)}
                onEditPlanning={planning ? setEditingLine : undefined}
                onRenameGroup={onRenameGroup}
                select={
                  selection &&
                  (r.kind === 'line'
                    ? {
                        kind: 'line',
                        share: selection.value.get(r.line.id),
                        disabled: !canPick(r.line),
                        onCheck: (on) => setLines([r], on),
                        onShare: (v) => setLines([r], true, v),
                      }
                    : { kind: 'block', ...selectedUnder(r.key), onCheck: (on) => setLines(linesUnder.get(r.key) ?? [], on), onShare: (v) => setLines(linesUnder.get(r.key) ?? [], true, v) })
                }
              />
            ))}
          </div>
          {visible.length === 0 && <p className="px-5 py-8 text-center text-sm text-text-muted">Nenhuma linha encontrada.</p>}
        </div>
      </div>
      {planning && editingLine && <LinePlanningDialog line={editingLine} planning={planning} onClose={() => setEditingLine(null)} />}
      <div className="tabular flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-border bg-ink-50 px-5 py-2 text-sm">
        <span className="text-text-muted">{footer.count.toLocaleString('pt-BR')} insumo(s){filtering && ' filtrados'}</span>
        <span>Custo total <strong>{formatBRL(footer.total)}</strong></span>
        <span>Comprometido <strong>{formatBRL(footer.committed)}</strong> ({formatPercent(footer.total.isZero() ? null : footer.committed.div(footer.total, 6), 1)})</span>
        <span>Livre <strong className="text-success">{formatBRL(footer.total.minus(footer.committed))}</strong></span>
        {selectable && (
          <span className="text-primary">
            {selection.value.size.toLocaleString('pt-BR')} marcado(s) · verba puxada <strong>{formatBRL(pulledTotal)}</strong>
          </span>
        )}
      </div>
    </div>
  )
}

type RowSelect =
  | { kind: 'line'; share: string | undefined; disabled: boolean; onCheck: (on: boolean) => void; onShare: (v: string) => void }
  | { kind: 'block'; ls: LineRow[]; pickable: LineRow[]; chosen: LineRow[]; pulled: Decimal; onCheck: (on: boolean) => void; onShare: (v: string) => void }

function TreeRow({ r, cols, top, open, onToggle, select, onEditPlanning, onRenameGroup }: {
  r: Row
  cols: string
  top: number
  open: boolean
  onToggle: () => void
  select?: RowSelect
  onEditPlanning?: (l: BudgetLineUsageDTO) => void
  onRenameGroup?: (wbs: string, description: string | null) => Promise<unknown>
}) {
  const cell = 'min-w-0 truncate px-2'
  const indent = { paddingLeft: `${0.5 + r.level * 0.9}rem` }
  const chevron = (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? 'Recolher' : 'Expandir'} className="mr-1 shrink-0 rounded p-0.5 text-ink-500 hover:bg-ink-200">
      {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
    </button>
  )
  const label = r.kind === 'line' ? `${r.line.code} ${r.line.activityWbs}` : r.kind === 'aux' ? `${r.code} ${r.activityWbs}` : r.wbs
  const base = cn('absolute inset-x-0 grid items-center border-b border-border', cols)
  const style = { top, height: ROW_H }
  const checked = select?.kind === 'line' ? select.share !== undefined : !!select && select.chosen.length > 0

  const lead = select && (
    <span className="flex justify-center">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        aria-label={`Marcar ${label}`}
        checked={select.kind === 'line' ? checked : select.pickable.length > 0 && select.pickable.every((x) => select.chosen.includes(x))}
        ref={(el) => {
          if (el) el.indeterminate = select.kind === 'block' && checked && !select.pickable.every((x) => select.chosen.includes(x))
        }}
        disabled={select.kind === 'line' ? select.disabled && !checked : select.pickable.length === 0 && !checked}
        onChange={(e) => select.onCheck(e.target.checked)}
      />
    </span>
  )
  const tail = select && <SelectCells r={r} select={select} label={label} />

  if (r.kind === 'group') {
    return (
      <div role="row" style={style} className={cn(base, 'font-semibold', r.level === 0 ? 'bg-ink-100 text-text' : 'bg-ink-50 text-ink-800')}>
        {lead}
        <span className={cn(cell, 'flex items-center')} style={indent}>{chevron}{r.wbs}</span>
        <span className={cn(cell, 'text-xs text-text-muted')}>Item</span>
        {onRenameGroup ? <GroupName wbs={r.wbs} name={r.description} onRename={onRenameGroup} /> : <span className={cell} title={r.description}>{r.description}</span>}
        <span />
        <span />
        <span />
        <span className={cn(cell, 'text-right')}>{formatBRL(r.total)}</span>
        <span />
        <span className={cn(cell, 'text-xs font-normal text-text-muted')}>{r.lines} insumo(s)</span>
        <Aggregate total={r.total} committed={r.committed} />
        <Free total={r.total} committed={r.committed} />
        {tail}
      </div>
    )
  }
  if (r.kind === 'activity') {
    const diverges = r.quantity && !r.total.minus(r.linesTotal).abs().lte('0.05')
    return (
      <div role="row" style={style} className={cn(base, 'bg-surface font-medium text-text')}>
        {lead}
        <span className={cn(cell, 'flex items-center')} style={indent}>{r.lines > 0 ? chevron : <span className="w-5" />}{r.wbs}</span>
        <span className={cn(cell, 'text-xs')}>{r.code ?? EMPTY}</span>
        <span className={cell} title={r.description}>{r.description}</span>
        <span className={cn(cell, 'text-xs')}>{r.unit ?? ''}</span>
        <span className={cn(cell, 'text-right')}>{r.quantity ? formatQuantity(r.quantity) : ''}</span>
        <span className={cn(cell, 'text-right')}>{r.unitCost ? formatDecimal(r.unitCost, 2) : ''}</span>
        <span className={cn(cell, 'text-right', diverges && 'text-warning')} title={diverges ? `Σ insumos ${formatBRL(r.linesTotal)}` : undefined}>{formatBRL(r.total)}</span>
        <span />
        <span />
        <Aggregate total={r.linesTotal} committed={r.committed} />
        <Free total={r.linesTotal} committed={r.committed} />
        {tail}
      </div>
    )
  }
  if (r.kind === 'aux') return <AuxTreeRow r={r} style={style} base={base} lead={lead} tail={tail} chevron={chevron} />
  const l = r.line
  const free = Decimal.from(l.balanceShare)
  const dimmed = select?.kind === 'line' && select.disabled && !checked
  return (
    <div
      role="row"
      style={style}
      className={cn(base, 'bg-surface text-ink-700 hover:bg-primary-soft/30', checked && 'bg-primary-soft/50', dimmed && 'opacity-55')}
    >
      {lead}
      <span className={cn(cell, 'text-[11px] text-ink-400')} style={indent}>{l.activityWbs}</span>
      <span className={cn(cell, 'text-xs font-medium text-text')}>{l.code}</span>
      <span className={cn(cell, 'pl-5')} title={l.description}>{l.description}</span>
      <span className={cn(cell, 'text-xs')}>{l.unit}</span>
      <span className={cn(cell, 'text-right')}>{formatQuantity(l.quantity)}</span>
      <span className={cn(cell, 'text-right')}>{formatDecimal(l.unitCost, 2)}</span>
      <span className={cn(cell, 'text-right text-text')}>{formatBRL(l.total)}</span>
      {onEditPlanning ? (
        <button
          type="button"
          onClick={() => onEditPlanning(l)}
          title={l.packageManual ? 'IP escolhido à mão — clique para trocar' : 'Escolher o vínculo de planejamento (IP)'}
          className={cn('group/ip mx-1 flex min-w-0 items-center gap-1 rounded px-1 text-left text-xs font-medium hover:bg-ink-100', l.packageManual && 'text-primary')}
        >
          <span className="truncate">{l.packageCode ?? EMPTY}</span>
          {l.packageManual && <Badge tone="primary" className="px-1 py-0 text-[9px]">M</Badge>}
          <Pencil className="size-3 shrink-0 text-ink-400 opacity-0 group-hover/ip:opacity-100" aria-hidden />
        </button>
      ) : (
        <span className={cn(cell, 'text-xs font-medium')}>{l.packageCode ?? EMPTY}{l.packageManual && <Badge tone="primary" className="ml-1 px-1 py-0 text-[9px]">M</Badge>}</span>
      )}
      <span className={cn(cell, 'text-xs')} title={l.packageDescription ?? undefined}>{l.packageDescription ?? EMPTY}</span>
      <span className={cn(cell, 'flex gap-1')}>
        {l.usage.length ? (
          l.usage.map((u) => (
            <Badge key={u.competitionId} tone={tone[u.category]} title={`${formatQuantity(u.quantity)} ${l.unit} · verba ${formatBRL(u.budgetValue)}`}>
              {u.competitionCode} · {formatPercent(u.share, 0)}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-text-muted">—</span>
        )}
      </span>
      <span
        className={cn(cell, 'text-right text-xs font-medium', free.isNegative() ? 'text-error' : free.isZero() ? 'text-text-muted' : 'text-success')}
        title={`${formatPercent(free, free.eq(1) || free.isZero() ? 0 : 1)} da linha livre`}
      >
        {formatBRL(Decimal.from(l.total).minus(l.committedValue))}
      </span>
      {tail}
    </div>
  )
}

/**
 * Composição auxiliar aberta dentro do serviço: na coluna Quantidade vai o coeficiente
 * (quantidade da auxiliar por unidade do serviço), como na tabela de origem.
 */
function AuxTreeRow({ r, style, base, lead, tail, chevron }: { r: AuxRow; style: CSSProperties; base: string; lead: ReactNode; tail: ReactNode; chevron: ReactNode }) {
  const cell = 'min-w-0 truncate px-2'
  return (
    <div role="row" style={style} className={cn(base, 'bg-ink-50/60 text-ink-800')}>
      {lead}
      <span className={cn(cell, 'flex items-center gap-1')} style={{ paddingLeft: `${0.5 + r.level * 0.9}rem` }}>
        {chevron}
        <Badge tone="neutral" className="px-1.5 text-[10px]" title="Composição auxiliar">AUX</Badge>
      </span>
      <span className={cn(cell, 'text-xs font-medium text-text')}>{r.code}</span>
      <span className={cn(cell, 'pl-5 font-medium')} title={r.description}>{r.description}</span>
      <span className={cn(cell, 'text-xs')}>{r.unit ?? ''}</span>
      <span className={cn(cell, 'text-right')} title="Coeficiente: quantidade da auxiliar por unidade do serviço">{formatCoefficient(r.coefficient)}</span>
      <span className={cn(cell, 'text-right')}>{formatDecimal(r.unitCost, 2)}</span>
      <span className={cn(cell, 'text-right font-medium text-text')}>{formatBRL(r.total)}</span>
      <span />
      <span className={cn(cell, 'text-xs text-text-muted')}>{r.lines} insumo(s)</span>
      <Aggregate total={r.total} committed={r.committed} />
      <Free total={r.total} committed={r.committed} />
      {tail}
    </div>
  )
}

/** Colunas "% a consumir" e "Verba puxada" do modo seletor. */
function SelectCells({ r, select, label }: { r: Row; select: RowSelect; label: string }) {
  const box = 'h-7 border-border bg-surface text-xs'
  if (select.kind === 'line' && r.kind === 'line') {
    const share = select.share
    const free = freeShare(r.line)
    const over = share !== undefined && Decimal.from(share).gt(free)
    return (
      <>
        <span className={cn(PIN_SHARE, 'px-1')} title={over ? `Máximo livre: ${formatPercent(free, 1)}` : undefined}>
          {share !== undefined ? (
            <DecimalInput aria-label={`% a consumir de ${label}`} scale="ratio" suffix="%" max="1" allowEmpty={false} className={cn(box, over && 'border-error bg-error-soft')} value={share} onCommit={(v) => v && select.onShare(v)} />
          ) : (
            <span className="block w-full px-2 text-right text-xs text-text-muted">{EMPTY}</span>
          )}
        </span>
        <span className={cn(PIN_VALUE, 'truncate px-2 text-xs font-medium text-text')} title={share !== undefined ? `${formatQuantity(Decimal.from(r.line.quantity).times(share).round(4))} ${r.line.unit}` : undefined}>
          {share !== undefined ? formatBRL(pulledValue(r.line, share)) : EMPTY}
        </span>
      </>
    )
  }
  if (select.kind !== 'block') return null
  const base = Decimal.sum(select.chosen.map((x) => x.total))
  const ratio = base.isZero() ? null : select.pulled.div(base, 6)
  return (
    <>
      <span className={cn(PIN_SHARE, 'px-1')}>
        {select.pickable.length > 0 || select.chosen.length > 0 ? (
          <DecimalInput
            aria-label={`% a consumir em todos os insumos de ${label}`}
            scale="ratio"
            suffix="%"
            max="1"
            className={box}
            placeholder={ratio ? formatPercent(ratio, 0) : '%'}
            value={null}
            onCommit={(v) => v && select.onShare(v)}
          />
        ) : (
          <span className="block w-full px-2 text-right text-xs text-text-muted">{EMPTY}</span>
        )}
      </span>
      <span className={cn(PIN_VALUE, 'truncate px-2 text-xs font-semibold text-primary')} title={`${select.chosen.length} de ${select.ls.length} insumo(s) marcados`}>
        {select.chosen.length ? formatBRL(select.pulled) : EMPTY}
      </span>
    </>
  )
}

/** Comprometido de um Item/composição: % da verba e barra. */
function Aggregate({ total, committed }: { total: Decimal; committed: Decimal }): ReactNode {
  if (committed.isZero()) return <span className="px-2 text-xs font-normal text-text-muted">—</span>
  const ratio = total.isZero() ? Decimal.ZERO : committed.div(total, 6)
  const pct = Math.min(100, Math.max(0, Number(ratio.times(100).toFixed(1))))
  return (
    <span className="flex items-center gap-2 px-2 text-xs font-normal" title={formatBRL(committed)}>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-200">
        <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-11 text-right">{formatPercent(ratio, 0)}</span>
    </span>
  )
}

function Free({ total, committed }: { total: Decimal; committed: Decimal }) {
  const free = total.minus(committed)
  return <span className={cn('truncate px-2 text-right text-xs font-normal', free.isNegative() ? 'text-error' : 'text-text-muted')}>{formatBRL(free)}</span>
}

/** Escolha do IP de uma linha do orçamento (lista de IPs da obra) */
function LinePlanningDialog({ line, planning, onClose }: { line: BudgetLineUsageDTO; planning: BudgetTreePlanning; onClose: () => void }) {
  const [code, setCode] = useState<string | null>(line.packageCode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = useMemo(() => planningOptions(planning.options, { code: line.packageCode, description: line.packageDescription }), [planning.options, line])
  const save = async (value: { code: string; description: string | null } | null) => {
    setSaving(true)
    setError(null)
    try {
      await planning.onSet(line, value)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      width="min(94vw, 34rem)"
      title="Vínculo de planejamento da linha"
      description={`${line.activityWbs} · ${line.code} — ${line.description}`}
      footer={
        <>
          {line.packageManual && (
            <Button variant="ghost" className="mr-auto" disabled={saving} onClick={() => save(null)}>Voltar ao IP da planilha</Button>
          )}
          <Button variant="ghost" className={line.packageManual ? undefined : 'mr-auto'} onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!code || code === line.packageCode}
            onClick={() => save({ code: code!, description: planning.options.find((o) => o.code === code)?.description ?? null })}
          >
            Salvar
          </Button>
        </>
      }
    >
      <Field label="IP" hint={planning.warning ?? 'Vale para as próximas versões do orçamento e para os QCs em rascunho.'} error={error}>
        <Combobox options={options} value={code} onChange={setCode} loading={planning.loading} placeholder="Buscar IP por código ou descrição…" aria-label="IP da linha" />
      </Field>
    </Dialog>
  )
}

/** Nome de um Item da EAP editável no lugar: lápis para editar, Enter salva, Esc cancela; vazio volta ao nome da planilha */
function GroupName({ wbs, name, onRename }: { wbs: string; name: string; onRename: (wbs: string, description: string | null) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(name)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    const next = text.trim()
    if (next === name) return setEditing(false)
    setSaving(true)
    try {
      await onRename(wbs, next || null)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }
  if (editing) {
    return (
      <span className="min-w-0 px-1">
        <input
          autoFocus
          aria-label={`Nome do item ${wbs}`}
          value={text}
          disabled={saving}
          placeholder="Vazio = nome da planilha"
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') {
              setText(name)
              setEditing(false)
            }
          }}
          className="h-7 w-full rounded-control border border-primary bg-surface px-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        setText(name)
        setEditing(true)
      }}
      title="Renomear o item"
      className="group/name mx-1 flex min-w-0 items-center gap-1.5 rounded px-1 text-left hover:bg-ink-200/60"
    >
      <span className="truncate">{name}</span>
      <Pencil className="size-3 shrink-0 text-ink-400 opacity-0 group-hover/name:opacity-100" aria-hidden />
    </button>
  )
}
