/**
 * 2. Especificação dos serviços contratados: insumo, especificação, % retenção, quantidade, preço e
 * vínculos (IP · Qtd · Valor). Rodapé com os totais da planilha (orçado, verba, a contratar, resultado).
 */
import { useState } from 'react'
import type { ContractRequestDTO, UpdateContractItemInput } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { Card, CardHeader, DecimalInput } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatBRL, formatPercent, formatQuantity } from '@/utils/format'

export function ContractItemsTable({ c, onUpdate }: { c: ContractRequestDTO; onUpdate: (itemId: string, patch: UpdateContractItemInput) => void }) {
  const editable = c.can.edit
  const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
  const td = 'border-b border-border px-3 py-1.5 align-top'
  const result = Decimal.from(c.availableAmount).minus(c.totalAmount)
  const ratio = Decimal.from(c.budgetAmount).isZero() ? null : result.div(c.budgetAmount, 6)

  return (
    <Card>
      <CardHeader
        title="2. Especificação dos serviços contratados"
        description={`${c.items.length} item(ns) · preços da vencedora na ${c.competition.code}; vínculos de planejamento por IP`}
      />
      <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={cn(th, 'text-left')}>Cód. do insumo / descrição</th>
              <th className={cn(th, 'min-w-56 text-left')}>Especificação</th>
              <th className={cn(th, 'w-24 text-right')}>% Retenção</th>
              <th className={cn(th, 'text-right')}>Quant.</th>
              <th className={cn(th, 'text-right')}>R$ unitário</th>
              <th className={cn(th, 'text-right')}>R$ total</th>
              <th className={cn(th, 'min-w-64 text-left')}>Vínculos (IP · Qtd · Valor)</th>
            </tr>
          </thead>
          <tbody>
            {c.items.map((i) => (
              <tr key={i.id} className="hover:bg-ink-50">
                <td className={cn(td, 'max-w-80')}>
                  <p className="truncate font-medium" title={i.description}>{i.description}</p>
                  <p className="text-[11px] leading-4 text-text-muted">{i.code}</p>
                </td>
                <td className={td}>
                  {editable ? (
                    <TextCell value={i.specification} label={`Especificação de ${i.code}`} onCommit={(v) => onUpdate(i.id, { specification: v })} />
                  ) : (
                    <span className="text-ink-700">{i.specification ?? '—'}</span>
                  )}
                </td>
                <td className={cn(td, 'px-1')}>
                  <DecimalInput
                    value={i.pctRetention}
                    scale="ratio"
                    fractionDigits={1}
                    allowEmpty={false}
                    max="1"
                    suffix="%"
                    disabled={!editable}
                    gridColumn="retention"
                    aria-label={`% retenção de ${i.code}`}
                    onCommit={(v) => v !== null && onUpdate(i.id, { pctRetention: v })}
                  />
                </td>
                <td className={cn(td, 'text-right whitespace-nowrap')}>{formatQuantity(i.quantity)} <span className="text-text-muted">{i.unit}</span></td>
                <td className={cn(td, 'text-right whitespace-nowrap')}>{formatBRL(i.unitPrice)}</td>
                <td className={cn(td, 'text-right font-medium whitespace-nowrap')}>{formatBRL(i.totalPrice)}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    {i.allocations.length === 0 && <span className="text-xs text-warning">Sem vínculo</span>}
                    {i.allocations.map((a, k) => (
                      <span key={k} className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-2 py-0.5 text-xs whitespace-nowrap">
                        <span className="font-semibold">{a.packageCode ?? 'Sem IP'}</span>
                        <span className="text-text-muted">{formatQuantity(a.quantity)}</span>
                        <span>{formatBRL(a.amount)}</span>
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-semibold">
            <tr>
              <td className="bg-ink-50 px-3 py-2" colSpan={3}>
                Total orçado <span className="ml-2 font-normal text-text-muted">{formatBRL(c.budgetAmount)}</span>
                <span className="ml-6">Verba disponível</span> <span className="ml-2 font-normal text-text-muted">{formatBRL(c.availableAmount)}</span>
              </td>
              <td className="bg-ink-50 px-3 py-2 text-right" colSpan={2}>Total a contratar</td>
              <td className="bg-ink-50 px-3 py-2 text-right whitespace-nowrap">{formatBRL(c.totalAmount)}</td>
              <td className={cn('bg-ink-50 px-3 py-2 whitespace-nowrap', result.isNegative() ? 'text-error' : 'text-success')}>
                Resultado QC {formatBRL(result)} {ratio && <span className="font-normal">({formatPercent(ratio, 1)})</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  )
}

function TextCell({ value, onCommit, label }: { value: string | null; onCommit: (v: string | null) => void; label: string }) {
  const [text, setText] = useState(value ?? '')
  return (
    <input
      aria-label={label}
      value={text}
      placeholder="—"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = text.trim() || null
        if (v !== (value ?? null)) onCommit(v)
      }}
      className="h-8 w-full rounded-control border border-transparent bg-transparent px-2 text-sm placeholder:text-ink-300 hover:border-border focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
    />
  )
}
