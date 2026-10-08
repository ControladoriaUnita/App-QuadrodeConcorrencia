/**
 * Orçamento na estrutura da planilha "Orçamento": Item → composição (CPU/CPO) → insumos,
 * com as mesmas colunas (Item · Código · Descrição · Unid · Quantidade · Custo Unit. · Custo Total ·
 * Vínculo PL · Classificação) e, à direita, o comprometido em concorrências e o saldo livre.
 * Níveis recolhíveis como o agrupamento do Excel; lista virtualizada (orçamentos com milhares de linhas).
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronsDownUp, Search } from 'lucide-react'
import type { BudgetLineUsageDTO, BudgetStructureDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { buildBudgetTree, type BudgetTreeRow } from '@shared/domain/budget/structure'
import { Badge, Input, Select } from '@/components/ui'
import { cn } from '@/utils/cn'
import { EMPTY, formatBRL, formatDecimal, formatPercent, formatQuantity } from '@/utils/format'

type Row = BudgetTreeRow<BudgetLineUsageDTO>
type Depth = 'items' | 'compositions' | 'all'

const ROW_H = 34
const OVERSCAN = 12
const COLS = 'grid-cols-[6.5rem_6.5rem_minmax(20rem,1fr)_3.5rem_7rem_7.5rem_8.5rem_5.5rem_9rem_10rem_7.5rem]'
const tone = { contracted: 'success', in_approval: 'warning', quoting: 'primary' } as const

export function BudgetTree({ structure, lines, maxHeight = 'calc(100dvh - 15rem)' }: { structure: BudgetStructureDTO; lines: BudgetLineUsageDTO[]; maxHeight?: string }) {
  const [search, setSearch] = useState('')
  const [pkg, setPkg] = useState('')
  const [onlyBalance, setOnlyBalance] = useState(false)
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

  const tree = useMemo(() => buildBudgetTree(structure, lines), [structure, lines])
  const byKey = useMemo(() => new Map(tree.map((r) => [r.key, r])), [tree])
  const filtering = !!(search.trim() || pkg || onlyBalance)

  /** Linhas visíveis: filtro mantém os ancestrais; sem filtro, respeita os níveis recolhidos. */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (filtering) {
      const keep = new Set<string>()
      const text = (r: Row) =>
        r.kind === 'line'
          ? `${r.line.code} ${r.line.description} ${r.line.packageCode ?? ''} ${r.line.packageDescription ?? ''}`
          : `${r.wbs} ${r.kind === 'activity' ? (r.code ?? '') : ''} ${r.description}`
      for (const r of tree) {
        if (r.kind !== 'line') continue
        const l = r.line
        if (pkg && l.packageCode !== pkg) continue
        if (onlyBalance && !Decimal.from(l.balanceShare).isPositive()) continue
        // busca casa no insumo ou em qualquer ancestral (composição/Item)
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
  }, [tree, byKey, search, pkg, onlyBalance, collapsed, expanded, depth, filtering]) // eslint-disable-line react-hooks/exhaustive-deps

  const shownLines = visible.filter((r): r is Extract<Row, { kind: 'line' }> => r.kind === 'line')
  const footer = filtering
    ? { total: Decimal.sum(shownLines.map((r) => r.total)), committed: Decimal.sum(shownLines.map((r) => r.committed)), count: shownLines.length }
    : {
        total: Decimal.sum(tree.filter((r) => r.kind === 'line').map((r) => r.total)),
        committed: Decimal.sum(tree.filter((r) => r.kind === 'line').map((r) => r.committed)),
        count: lines.length,
      }

  /** Filho aparece se o pai está aberto: pelo nível escolhido ou por expansão manual */
  function childVisible(parent: Row, child: Row): boolean {
    if (collapsed.has(parent.key)) return false
    if (child.kind === 'group') return true
    if (child.kind === 'activity') return depth !== 'items' || expanded.has(parent.key)
    return depth === 'all' || expanded.has(parent.key)
  }
  const isOpen = (r: Row) =>
    !collapsed.has(r.key) && (r.kind === 'group' ? depth !== 'items' || expanded.has(r.key) || !tree.some((c) => c.parentKey === r.key && c.kind === 'activity') : depth === 'all' || expanded.has(r.key))
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
          <div role="row" className={cn('sticky top-0 z-10 grid border-b border-border bg-ink-50', COLS)}>
            <span role="columnheader" className={hd}>Item</span>
            <span role="columnheader" className={hd}>Código</span>
            <span role="columnheader" className={hd}>Descrição</span>
            <span role="columnheader" className={hd}>Unid</span>
            <span role="columnheader" className={cn(hd, 'text-right')}>Quantidade</span>
            <span role="columnheader" className={cn(hd, 'text-right')}>Custo Unit.</span>
            <span role="columnheader" className={cn(hd, 'text-right')}>Custo Total</span>
            <span role="columnheader" className={hd}>Vínculo PL</span>
            <span role="columnheader" className={hd}>Classificação</span>
            <span role="columnheader" className={hd}>Comprometido em</span>
            <span role="columnheader" className={cn(hd, 'text-right')}>Livre</span>
          </div>
          <div style={{ height: visible.length * ROW_H, position: 'relative' }}>
            {visible.slice(start, end).map((r, i) => (
              <TreeRow
                key={r.key}
                r={r}
                top={(start + i) * ROW_H}
                open={filtering || isOpen(r)}
                onToggle={() => toggle(r)}
              />
            ))}
          </div>
          {visible.length === 0 && <p className="px-5 py-8 text-center text-sm text-text-muted">Nenhuma linha encontrada.</p>}
        </div>
      </div>
      <div className="tabular flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-border bg-ink-50 px-5 py-2 text-sm">
        <span className="text-text-muted">{footer.count.toLocaleString('pt-BR')} insumo(s){filtering && ' filtrados'}</span>
        <span>Custo total <strong>{formatBRL(footer.total)}</strong></span>
        <span>Comprometido <strong>{formatBRL(footer.committed)}</strong> ({formatPercent(footer.total.isZero() ? null : footer.committed.div(footer.total, 6), 1)})</span>
        <span>Livre <strong className="text-success">{formatBRL(footer.total.minus(footer.committed))}</strong></span>
      </div>
    </div>
  )
}

function TreeRow({ r, top, open, onToggle }: { r: Row; top: number; open: boolean; onToggle: () => void }) {
  const cell = 'min-w-0 truncate px-2'
  const indent = { paddingLeft: `${0.5 + r.level * 0.9}rem` }
  const chevron = (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? 'Recolher' : 'Expandir'} className="mr-1 shrink-0 rounded p-0.5 text-ink-500 hover:bg-ink-200">
      {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
    </button>
  )
  const base = cn('absolute inset-x-0 grid items-center border-b border-border', COLS)
  const style = { top, height: ROW_H }

  if (r.kind === 'group') {
    return (
      <div role="row" style={style} className={cn(base, 'font-semibold', r.level === 0 ? 'bg-ink-100 text-text' : 'bg-ink-50 text-ink-800')}>
        <span className={cn(cell, 'flex items-center')} style={indent}>{chevron}{r.wbs}</span>
        <span className={cn(cell, 'text-xs text-text-muted')}>Item</span>
        <span className={cell} title={r.description}>{r.description}</span>
        <span />
        <span />
        <span />
        <span className={cn(cell, 'text-right')}>{formatBRL(r.total)}</span>
        <span />
        <span className={cn(cell, 'text-xs font-normal text-text-muted')}>{r.lines} insumo(s)</span>
        <Aggregate total={r.total} committed={r.committed} />
        <Free total={r.total} committed={r.committed} />
      </div>
    )
  }
  if (r.kind === 'activity') {
    const diverges = r.quantity && !r.total.minus(r.linesTotal).abs().lte('0.05')
    return (
      <div role="row" style={style} className={cn(base, 'bg-surface font-medium text-text')}>
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
      </div>
    )
  }
  const l = r.line
  const free = Decimal.from(l.balanceShare)
  return (
    <div role="row" style={style} className={cn(base, 'bg-surface text-ink-700 hover:bg-primary-soft/30')}>
      <span className={cn(cell, 'text-[11px] text-ink-400')} style={indent}>{l.activityWbs}</span>
      <span className={cn(cell, 'text-xs font-medium text-text')}>{l.code}</span>
      <span className={cn(cell, 'pl-5')} title={l.description}>{l.description}</span>
      <span className={cn(cell, 'text-xs')}>{l.unit}</span>
      <span className={cn(cell, 'text-right')}>{formatQuantity(l.quantity)}</span>
      <span className={cn(cell, 'text-right')}>{formatDecimal(l.unitCost, 2)}</span>
      <span className={cn(cell, 'text-right text-text')}>{formatBRL(l.total)}</span>
      <span className={cn(cell, 'text-xs font-medium')}>{l.packageCode ?? EMPTY}</span>
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
    </div>
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
