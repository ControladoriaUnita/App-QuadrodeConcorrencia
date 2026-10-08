import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export interface TabItem<K extends string> {
  key: K
  label: string
  icon?: ReactNode
  count?: number
}

/**
 * Abas horizontais roláveis; ativa com borda inferior laranja.
 * `sticky`: fixa as abas logo abaixo do header ao rolar, para a área de preenchimento ocupar a tela.
 */
export function Tabs<K extends string>({ items, value, onChange, sticky, trailing }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; sticky?: boolean; trailing?: ReactNode }) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex items-center gap-1 overflow-x-auto border-b border-border',
        sticky && 'sticky top-[58px] z-20 -mx-4 bg-background px-4 lg:-mx-6 lg:px-6 2xl:-mx-10 2xl:px-10',
      )}
    >
      {items.map((t) => {
        const active = t.key === value
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              active ? 'border-primary text-primary' : 'border-transparent text-ink-600 hover:text-text',
            )}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && (
              <span className={cn('tabular rounded-full px-1.5 text-xs', active ? 'bg-primary-soft' : 'bg-ink-100 text-ink-600')}>{t.count}</span>
            )}
          </button>
        )
      })}
      {trailing && <div className="ml-auto flex shrink-0 items-center gap-3 pl-3">{trailing}</div>}
    </div>
  )
}
