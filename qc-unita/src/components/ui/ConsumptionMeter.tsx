/**
 * Medidor de consumo do orçamento (barra empilhada horizontal).
 * Rampa sequencial de um único matiz: contratado (forte) → em aprovação → em cotação (claro, hachurado
 * por ser estimativa). Segmentos separados por 2px de superfície; marcador do orçamento quando há estouro.
 * Identidade nunca só pela cor: legenda com rótulo, valor e % sempre visível.
 */
import { Decimal } from '@shared/domain/decimal'
import { cn } from '@/utils/cn'
import { formatBRL, formatPercent } from '@/utils/format'

export interface MeterValues {
  budget: Decimal
  contracted: Decimal
  inApproval: Decimal
  quoting: Decimal
}

const SEGMENTS = [
  { key: 'contracted', label: 'Contratado', cls: 'bg-consumption-contracted' },
  { key: 'inApproval', label: 'Em aprovação', cls: 'bg-consumption-approval' },
  { key: 'quoting', label: 'Em cotação (estimado)', cls: 'bg-consumption-quoting hatch' },
] as const

function pct(part: Decimal, whole: Decimal): number {
  if (whole.isZero()) return 0
  return Math.max(0, part.div(whole, 6).toNumberUnsafe() * 100) // apenas geometria visual
}

export function ConsumptionMeter({ values, size = 'md', showLegend = true, className }: { values: MeterValues; size?: 'sm' | 'md'; showLegend?: boolean; className?: string }) {
  const total = values.contracted.plus(values.inApproval).plus(values.quoting)
  const scale = Decimal.max(values.budget, total)
  const over = total.gt(values.budget) && values.budget.isPositive()
  const budgetMark = pct(values.budget, scale)
  const summary = SEGMENTS.map((s) => `${s.label}: ${formatBRL(values[s.key])} (${formatPercent(values.budget.isZero() ? null : values[s.key].div(values.budget, 6), 1)})`).join('; ')

  return (
    <div className={className}>
      <div
        role="img"
        aria-label={`Consumo do orçamento de ${formatBRL(values.budget)}. ${summary}.`}
        className={cn('relative flex w-full gap-0.5 overflow-hidden rounded-full bg-ink-100', size === 'md' ? 'h-3' : 'h-2')}
      >
        {SEGMENTS.map((s) => {
          const w = pct(values[s.key], scale)
          if (w <= 0) return null
          return (
            <div
              key={s.key}
              className={cn('h-full first:rounded-l-full', s.cls)}
              style={{ width: `${w}%` }}
              title={`${s.label}: ${formatBRL(values[s.key])}`}
            />
          )
        })}
        {over && <div className="absolute inset-y-0 w-0.5 bg-error" style={{ left: `${budgetMark}%` }} title="Limite do orçamento" />}
      </div>
      {showLegend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          {SEGMENTS.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn('size-2.5 rounded-sm', s.cls)} />
              {s.label}
              <span className="tabular font-medium text-text">{formatPercent(values.budget.isZero() ? null : values[s.key].div(values.budget, 6), 1)}</span>
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-ink-100 ring-1 ring-border" />
            Saldo
            <span className={cn('tabular font-medium', over ? 'text-error' : 'text-text')}>{formatBRL(values.budget.minus(total))}</span>
          </li>
        </ul>
      )}
    </div>
  )
}
