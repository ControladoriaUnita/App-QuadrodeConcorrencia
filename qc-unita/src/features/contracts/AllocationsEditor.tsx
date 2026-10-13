/**
 * Vínculos de planejamento (IP) de um item do aditivo/distrato: quanto da quantidade vai para cada IP.
 * Quantidades sempre positivas na tela; o sinal é aplicado pelo servidor conforme o tipo.
 */
import { Plus, Trash2 } from 'lucide-react'
import { Decimal } from '@shared/domain/decimal'
import { Button, DecimalInput, Select } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatQuantity } from '@/utils/format'

export interface AllocationRow {
  packageCode: string
  quantity: string | null
}

export interface IpOption {
  packageCode: string
  label: string
  /** Quantidade vigente do IP no item (limite do distrato) */
  available?: Decimal
}

export function allocationsTotal(rows: AllocationRow[]): Decimal {
  return Decimal.sum(rows.map((r) => r.quantity ?? '0'))
}

export function AllocationsEditor({ rows, options, target, unit, onChange }: {
  rows: AllocationRow[]
  options: IpOption[]
  /** Quantidade do item que os vínculos devem somar */
  target: Decimal
  unit: string
  onChange: (rows: AllocationRow[]) => void
}) {
  const sum = allocationsTotal(rows)
  const diff = target.minus(sum)
  const set = (k: number, patch: Partial<AllocationRow>) => onChange(rows.map((r, i) => (i === k ? { ...r, ...patch } : r)))
  const used = new Set(rows.map((r) => r.packageCode))

  return (
    <div className="grid gap-1.5 rounded-control border border-border bg-surface p-2">
      <p className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">Vínculos de planejamento (IP)</p>
      {rows.map((r, k) => {
        const opt = options.find((o) => o.packageCode === r.packageCode)
        const over = opt?.available && r.quantity ? Decimal.from(r.quantity).gt(opt.available) : false
        return (
          <div key={k} className="grid grid-cols-[minmax(10rem,1fr)_8rem_auto] items-center gap-1">
            <Select className="h-8" aria-label="IP" value={r.packageCode} onChange={(e) => set(k, { packageCode: e.target.value })}>
              <option value="">Selecione o IP…</option>
              {options
                .filter((o) => o.packageCode === r.packageCode || !used.has(o.packageCode))
                .map((o) => (
                  <option key={o.packageCode} value={o.packageCode}>
                    {o.label}
                  </option>
                ))}
            </Select>
            <DecimalInput
              value={r.quantity}
              fractionDigits={4}
              trimZeros
              suffix={unit}
              className={cn(over && 'border-error')}
              aria-label={`Quantidade no ${r.packageCode || 'IP'}`}
              onCommit={(v) => set(k, { quantity: v })}
            />
            <button
              type="button"
              className="rounded-control p-1 text-ink-500 hover:bg-error-soft hover:text-error"
              aria-label="Remover vínculo"
              onClick={() => onChange(rows.filter((_, i) => i !== k))}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => onChange([...rows, { packageCode: '', quantity: diff.isPositive() ? diff.toDb() : null }])}>
          Adicionar IP
        </Button>
        <span className={cn('tabular text-xs', diff.isZero() ? 'text-success' : 'text-error')}>
          {diff.isZero() ? 'Vínculos fecham com a quantidade' : `${diff.isPositive() ? 'Falta vincular' : 'Vinculado a mais'} ${formatQuantity(diff.abs())} ${unit}`}
        </span>
      </div>
    </div>
  )
}
