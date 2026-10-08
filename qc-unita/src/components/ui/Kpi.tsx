import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { toneClasses, type Tone } from './Badge'

interface KpiProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: Tone
  emphasis?: boolean
}

/** Cartão de indicador (DESIGN_SYSTEM: label 12px, valor 18px semibold tabular). */
export function Kpi({ label, value, hint, tone, emphasis }: KpiProps) {
  return (
    <div className={cn('rounded-card border border-border bg-surface px-4 py-3 shadow-card', emphasis && 'border-primary/40 bg-primary-soft')}>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="tabular mt-1 text-lg font-semibold whitespace-nowrap text-text">{value}</p>
      {hint && (
        <p className={cn('mt-0.5 inline-flex rounded-full text-xs font-medium', tone ? cn(toneClasses[tone], 'px-2 py-0.5') : 'text-text-muted')}>{hint}</p>
      )}
    </div>
  )
}

export interface KpiStripItem extends KpiProps {
  key?: string
}

/**
 * Faixa compacta de indicadores: um único cartão com divisórias (≈ 60px de altura),
 * para liberar a tela às áreas de preenchimento.
 */
export function KpiStrip({ items, className }: { items: KpiStripItem[]; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 overflow-hidden rounded-card border border-border bg-surface shadow-card sm:grid-cols-3',
        items.length >= 5 ? 'lg:grid-cols-5' : items.length === 4 ? 'lg:grid-cols-4' : '',
        className,
      )}
    >
      {items.map((k, i) => (
        <div
          key={k.key ?? k.label}
          className={cn('min-w-0 border-border px-4 py-2', i > 0 && 'border-l', k.emphasis && 'bg-primary-soft')}
        >
          <p className="truncate text-[11px] font-medium text-text-muted">{k.label}</p>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <p className="tabular text-base font-semibold whitespace-nowrap text-text">{k.value}</p>
            {k.hint && (
              <p
                className={cn(
                  'truncate text-[11px] font-medium',
                  k.tone ? cn(toneClasses[k.tone], 'rounded-full px-1.5') : 'text-text-muted',
                )}
                title={typeof k.hint === 'string' ? k.hint : undefined}
              >
                {k.hint}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
