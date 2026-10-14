/**
 * Filtro por coluna como no Excel: botão ▾ no cabeçalho abre uma caixa com busca, "Selecionar tudo"
 * e a lista de valores da coluna (com contagem); colunas numéricas filtram por faixa (mín. / máx.).
 * A caixa usa posição fixa para não ser cortada pela tabela com rolagem.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Filter } from 'lucide-react'
import { Decimal } from '@shared/domain/decimal'
import { Button, Input } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatDecimal } from '@/utils/format'
import { fold, matchesTerms, searchTerms } from '@/utils/search'

/** Valores escolhidos (lista) ou faixa numérica (já convertida ao aplicar) */
export type ColumnFilterValue = { kind: 'values'; values: Set<string> } | { kind: 'range'; min: Decimal | null; max: Decimal | null }

export const EMPTY_VALUE = '(vazio)'

/** A linha passa no filtro da coluna? Colunas de lista recebem os valores da linha (um ou vários). */
export function matchesFilter(f: ColumnFilterValue, value: string[] | Decimal): boolean {
  if (f.kind === 'values') return Array.isArray(value) && value.some((v) => f.values.has(v))
  if (Array.isArray(value)) return false
  return (!f.min || !value.lt(f.min)) && (!f.max || !value.gt(f.max))
}

interface Props {
  label: string
  /** Valores distintos da coluna com a contagem de linhas (colunas de lista) */
  values?: { value: string; count: number }[]
  numeric?: boolean
  filter: ColumnFilterValue | undefined
  onChange: (f: ColumnFilterValue | undefined) => void
  align?: 'left' | 'right'
}

export function ColumnFilter({ label, values = [], numeric, filter, onChange, align = 'left' }: Props) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const active = !!filter

  useLayoutEffect(() => {
    if (!open) return
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const width = 288
    const left = align === 'right' ? Math.max(8, r.right - width) : Math.min(window.innerWidth - width - 8, r.left)
    setPos({ top: r.bottom + 4, left })
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onScroll = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`Filtrar ${label}`}
        aria-expanded={open}
        aria-pressed={active}
        onClick={() => setOpen((o) => !o)}
        className={cn('ml-1 inline-flex shrink-0 items-center rounded p-0.5 hover:bg-ink-200', active ? 'bg-primary-soft text-primary' : 'text-ink-400')}
      >
        <Filter className="size-3" aria-hidden />
      </button>
      {open && pos && createPortal(
        <div
          ref={box}
          role="dialog"
          aria-label={`Filtro de ${label}`}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 288 }}
          className="z-50 rounded-card border border-border bg-surface p-3 text-sm font-normal text-text shadow-overlay"
        >
          {numeric ? (
            <RangeEditor filter={filter?.kind === 'range' ? filter : null} onApply={(f) => (onChange(f), setOpen(false))} />
          ) : (
            <ValuesEditor values={values} filter={filter?.kind === 'values' ? filter : null} onApply={(f) => (onChange(f), setOpen(false))} />
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

function ValuesEditor({ values, filter, onApply }: { values: NonNullable<Props['values']>; filter: { values: Set<string> } | null; onApply: (f: ColumnFilterValue | undefined) => void }) {
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(filter ? filter.values : values.map((v) => v.value)))
  const folded = useMemo(() => values.map((v) => ({ ...v, text: fold(v.value) })), [values])
  const terms = searchTerms(q)
  const shown = useMemo(() => folded.filter((v) => matchesTerms(v.text, terms)), [folded, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const allShown = shown.length > 0 && shown.every((v) => chosen.has(v.value))
  const toggleAll = () =>
    setChosen((s) => {
      const n = new Set(s)
      for (const v of shown) (allShown ? n.delete(v.value) : n.add(v.value))
      return n
    })
  // Como no Excel: com pesquisa, vale só o que está marcado entre os resultados
  const effective = terms.length ? new Set(shown.filter((v) => chosen.has(v.value)).map((v) => v.value)) : chosen
  const toggle = (v: string) => setChosen((s) => (s.has(v) ? (s.delete(v), new Set(s)) : new Set(s.add(v))))
  return (
    <div className="grid gap-2">
      <Input autoFocus className="h-8" placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pesquisar valores" />
      <label className="flex items-center gap-2 border-b border-border pb-1.5 font-medium">
        <input type="checkbox" className="size-4 accent-primary" checked={allShown} onChange={toggleAll} />
        {terms.length ? 'Selecionar resultados' : 'Selecionar tudo'}
      </label>
      <ul className="max-h-60 overflow-auto">
        {shown.map((v) => (
          <li key={v.value}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-ink-50">
              <input type="checkbox" className="size-4 accent-primary" checked={chosen.has(v.value)} onChange={() => toggle(v.value)} />
              <span className="min-w-0 flex-1 truncate" title={v.value}>{v.value}</span>
              <span className="tabular text-xs text-text-muted">{v.count}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="px-1 py-1 text-text-muted">Nada encontrado</li>}
      </ul>
      <div className="flex justify-between gap-2 border-t border-border pt-2">
        <Button size="sm" variant="ghost" onClick={() => onApply(undefined)}>Limpar filtro</Button>
        <Button
          size="sm"
          variant="primary"
          disabled={effective.size === 0}
          onClick={() => onApply(effective.size === values.length ? undefined : { kind: 'values', values: effective })}
        >
          Aplicar
        </Button>
      </div>
    </div>
  )
}

function RangeEditor({ filter, onApply }: { filter: { min: Decimal | null; max: Decimal | null } | null; onApply: (f: ColumnFilterValue | undefined) => void }) {
  const text = (d: Decimal | null | undefined) => (d ? formatDecimal(d, 4).replace(/,?0+$/, '') : '')
  const [min, setMin] = useState(text(filter?.min))
  const [max, setMax] = useState(text(filter?.max))
  const parse = (s: string) => (s.trim() ? Decimal.tryParseBR(s) : null)
  const ok = (!min.trim() || !!parse(min)) && (!max.trim() || !!parse(max))
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-text-muted">Maior ou igual a<Input autoFocus inputMode="decimal" className="h-8" value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label className="grid gap-1 text-xs text-text-muted">Menor ou igual a<Input inputMode="decimal" className="h-8" value={max} onChange={(e) => setMax(e.target.value)} /></label>
      </div>
      {!ok && <p className="text-xs text-error">Use números no formato 1.234,56</p>}
      <div className="flex justify-between gap-2 border-t border-border pt-2">
        <Button size="sm" variant="ghost" onClick={() => onApply(undefined)}>Limpar filtro</Button>
        <Button size="sm" variant="primary" disabled={!ok} onClick={() => onApply(min.trim() || max.trim() ? { kind: 'range', min: parse(min), max: parse(max) } : undefined)}>
          Aplicar
        </Button>
      </div>
    </div>
  )
}
