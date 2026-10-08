/**
 * Orçamento linha a linha: EAP/composição, insumo, IP, quantidade, custo e o que já está
 * comprometido em concorrências (percentual e verba, com saldo livre). Usado na obra e nos
 * seletores de linhas do QC — no modo seletor, cada linha escolhida recebe o "% a comprometer",
 * que define a verba puxada para a contratação.
 */
import { useMemo, useState } from 'react'
import { Percent, Search } from 'lucide-react'
import type { BudgetLineUsageDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { Badge, Button, DecimalInput, Input, Select } from '@/components/ui'
import { cn } from '@/utils/cn'
import { EMPTY, formatBRL, formatPercent, formatQuantity } from '@/utils/format'

const MAX_ROWS = 600
const tone = { contracted: 'success', in_approval: 'warning', quoting: 'primary' } as const
const ONE = Decimal.from(1)

/** Percentual ainda livre da linha (0..1). */
export function freeShare(l: Pick<BudgetLineUsageDTO, 'balanceShare'>): Decimal {
  return Decimal.max(Decimal.ZERO, Decimal.min(ONE, Decimal.from(l.balanceShare)))
}

/** Verba puxada = custo total × percentual (100% = custo total exato). */
export function pulledValue(l: Pick<BudgetLineUsageDTO, 'total'>, share: string | Decimal): Decimal {
  const s = Decimal.from(share)
  return s.eq(ONE) ? Decimal.from(l.total) : Decimal.from(l.total).times(s).round(4)
}

interface Props {
  lines: BudgetLineUsageDTO[]
  selectable?: boolean
  /** Linhas escolhidas → percentual a comprometer (canônico, 0..1) */
  selection?: Map<string, string>
  onSelectionChange?: (next: Map<string, string>) => void
  /** Linhas que não podem ser escolhidas (já no QC) */
  disabledIds?: Set<string>
  maxHeight?: string
  initialOnlyBalance?: boolean
}

export function BudgetLinesTable({ lines, selectable, selection, onSelectionChange, disabledIds, maxHeight = '60vh', initialOnlyBalance = false }: Props) {
  const [search, setSearch] = useState('')
  const [pkg, setPkg] = useState('')
  const [onlyBalance, setOnlyBalance] = useState(initialOnlyBalance)
  const [bulk, setBulk] = useState<string | null>(null)

  const packages = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of lines) if (l.packageCode && !m.has(l.packageCode)) m.set(l.packageCode, l.packageDescription ?? l.packageCode)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [lines])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return lines.filter(
      (l) =>
        (!pkg || l.packageCode === pkg) &&
        (!onlyBalance || freeShare(l).isPositive()) &&
        (!q || `${l.code} ${l.description} ${l.activityWbs} ${l.activityCode ?? ''} ${l.activityDescription} ${l.packageCode ?? ''}`.toLowerCase().includes(q)),
    )
  }, [lines, search, pkg, onlyBalance])
  const shown = filtered.slice(0, MAX_ROWS)
  const selectableShown = shown.filter((l) => !disabledIds?.has(l.id) && freeShare(l).isPositive())
  const allChecked = selectable && selectableShown.length > 0 && selectableShown.every((l) => selection?.has(l.id))
  const total = Decimal.sum(filtered.map((l) => l.total))

  const update = (fn: (m: Map<string, string>) => void) => {
    const next = new Map(selection)
    fn(next)
    onSelectionChange?.(next)
  }
  const toggle = (ls: BudgetLineUsageDTO[], on: boolean) =>
    update((m) => ls.forEach((l) => (on ? !m.has(l.id) && m.set(l.id, freeShare(l).toFixed(6)) : m.delete(l.id))))
  /** Aplica o mesmo % às linhas escolhidas, limitado ao livre de cada uma */
  const applyBulk = () => {
    if (!bulk) return
    const want = Decimal.from(bulk)
    const byId = new Map(lines.map((l) => [l.id, l]))
    update((m) => {
      for (const id of m.keys()) {
        const l = byId.get(id)
        if (l) m.set(id, Decimal.min(want, freeShare(l)).toFixed(6))
      }
    })
  }

  const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
  const td = 'border-b border-border px-3 py-2 align-top'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input aria-label="Buscar no orçamento" placeholder="Código, insumo, composição ou EAP" className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="IP de planejamento" className="h-9 w-auto max-w-80" value={pkg} onChange={(e) => setPkg(e.target.value)}>
          <option value="">Todos os IPs ({packages.length})</option>
          {packages.map(([code, desc]) => (
            <option key={code} value={code}>{code} — {desc}</option>
          ))}
        </Select>
        <label className="inline-flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" className="size-4 accent-primary" checked={onlyBalance} onChange={(e) => setOnlyBalance(e.target.checked)} />
          Somente com saldo
        </label>
        {selectable && (
          <div className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface pl-2">
            <Percent className="size-3.5 text-ink-400" aria-hidden />
            <DecimalInput
              aria-label="Percentual para aplicar às linhas selecionadas"
              className="h-8 w-20"
              scale="ratio"
              max="1"
              placeholder="% todas"
              value={bulk}
              onCommit={setBulk}
            />
            <Button size="sm" variant="ghost" disabled={!bulk || !selection?.size} onClick={applyBulk}>
              Aplicar às selecionadas
            </Button>
          </div>
        )}
        <span className="tabular ml-auto text-xs text-text-muted">
          {filtered.length} linha(s) · {formatBRL(total)}
        </span>
      </div>
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {selectable && (
                <th className={cn(th, 'w-10')}>
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas as linhas filtradas"
                    className="size-4 accent-primary"
                    checked={!!allChecked}
                    onChange={(e) => toggle(selectableShown, e.target.checked)}
                  />
                </th>
              )}
              <th className={cn(th, 'text-left')}>IP de planejamento</th>
              <th className={cn(th, 'text-left')}>EAP · composição</th>
              <th className={cn(th, 'text-left')}>Insumo</th>
              {!selectable && <th className={cn(th, 'text-right')}>Quantidade</th>}
              <th className={cn(th, 'text-right')}>Custo total</th>
              <th className={cn(th, 'text-left')}>Comprometido em</th>
              <th className={cn(th, 'text-right')}>Livre</th>
              {selectable && <th className={cn(th, 'w-28 text-right')}>% a comprometer</th>}
              {selectable && <th className={cn(th, 'text-right')}>Verba puxada</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => {
              const free = freeShare(l)
              const rawFree = Decimal.from(l.balanceShare)
              const freeValue = Decimal.from(l.total).minus(l.committedValue)
              const disabled = disabledIds?.has(l.id) || !free.isPositive()
              const share = selection?.get(l.id)
              const checked = share !== undefined
              const over = checked && Decimal.from(share).gt(free)
              return (
                <tr
                  key={l.id}
                  className={cn('hover:bg-ink-50', selectable && !disabled && 'cursor-pointer', checked && 'bg-primary-soft/50', disabled && selectable && 'opacity-60')}
                  onClick={() => selectable && !disabled && toggle([l], !checked)}
                >
                  {selectable && (
                    <td className={td}>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar linha ${l.code} ${l.activityWbs}`}
                        className="size-4 accent-primary"
                        checked={checked}
                        disabled={disabled}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => toggle([l], e.target.checked)}
                      />
                    </td>
                  )}
                  <td className={cn(td, 'whitespace-nowrap')}>
                    <p className="font-medium">{l.packageCode ?? 'Sem IP'}</p>
                    <p className="max-w-48 truncate text-[11px] leading-4 text-text-muted" title={l.packageDescription ?? undefined}>{l.packageDescription ?? EMPTY}</p>
                  </td>
                  <td className={cn(td, selectable ? 'max-w-56' : 'max-w-72')}>
                    <p className="truncate" title={l.activityDescription}>{l.activityWbs} · {l.activityDescription}</p>
                    <p className="text-[11px] leading-4 text-text-muted">{l.activityCode ?? EMPTY}</p>
                  </td>
                  <td className={cn(td, selectable ? 'max-w-56' : 'max-w-72')}>
                    <p className="truncate font-medium" title={l.description}>{l.description}</p>
                    <p className="text-[11px] leading-4 text-text-muted">{l.code} · {l.unit}</p>
                  </td>
                  {!selectable && <td className={cn(td, 'text-right whitespace-nowrap')}>{formatQuantity(l.quantity)}</td>}
                  <td className={cn(td, 'text-right whitespace-nowrap')}>
                    {formatBRL(l.total)}
                    {selectable && <p className="text-[11px] leading-4 text-text-muted">{formatQuantity(l.quantity)} {l.unit}</p>}
                  </td>
                  <td className={td}>
                    {l.usage.length ? (
                      <div className="flex flex-wrap gap-1">
                        {l.usage.map((u) => (
                          <Badge
                            key={u.competitionId}
                            tone={tone[u.category]}
                            className="tabular"
                            title={`${formatQuantity(u.quantity)} ${l.unit} · verba ${formatBRL(u.budgetValue)}`}
                          >
                            {u.competitionCode} · {formatPercent(u.share, 0)}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-text-muted">Livre</span>
                    )}
                  </td>
                  <td className={cn(td, 'text-right whitespace-nowrap')}>
                    <p className={cn('font-medium', rawFree.isNegative() ? 'text-error' : rawFree.isZero() ? 'text-text-muted' : 'text-success')}>
                      {formatPercent(rawFree, rawFree.eq(ONE) || rawFree.isZero() ? 0 : 1)}
                    </p>
                    <p className="text-[11px] leading-4 text-text-muted">{formatBRL(freeValue)}</p>
                  </td>
                  {selectable && (
                    <td className={cn(td, 'py-1')} onClick={(e) => e.stopPropagation()}>
                      {checked ? (
                        <DecimalInput
                          aria-label={`% a comprometer da linha ${l.code} ${l.activityWbs}`}
                          scale="ratio"
                          suffix="%"
                          max="1"
                          allowEmpty={false}
                          className={cn('border-border bg-surface', over && 'border-error bg-error-soft')}
                          value={share}
                          onCommit={(v) => v && update((m) => m.set(l.id, v))}
                        />
                      ) : (
                        <span className="block px-2 text-right text-text-muted">{EMPTY}</span>
                      )}
                      {over && <p className="px-2 text-right text-[11px] leading-4 text-error">Máx. {formatPercent(free, 1)}</p>}
                    </td>
                  )}
                  {selectable && (
                    <td className={cn(td, 'text-right whitespace-nowrap')}>
                      {checked ? (
                        <>
                          <p className="font-medium">{formatBRL(pulledValue(l, share))}</p>
                          <p className="text-[11px] leading-4 text-text-muted">
                            {formatQuantity(Decimal.from(l.quantity).times(share).round(4))} {l.unit}
                          </p>
                        </>
                      ) : (
                        <span className="text-text-muted">{EMPTY}</span>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length > MAX_ROWS && (
          <p className="px-5 py-3 text-xs text-text-muted">Mostrando {MAX_ROWS} de {filtered.length} linhas — refine a busca ou filtre por IP.</p>
        )}
        {filtered.length === 0 && <p className="px-5 py-8 text-center text-sm text-text-muted">Nenhuma linha encontrada.</p>}
      </div>
    </div>
  )
}
