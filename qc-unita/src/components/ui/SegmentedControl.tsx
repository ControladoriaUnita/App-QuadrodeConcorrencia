import { cn } from '@/utils/cn'

/** Alternância entre poucas opções (visões, modos), em botões lado a lado */
export function SegmentedControl<K extends string>({ items, value, onChange, label }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit rounded-control border border-border bg-surface p-0.5">
      {items.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-[calc(var(--radius-control)-2px)] px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors',
            value === o.key ? 'bg-secondary text-white' : 'text-ink-600 hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
