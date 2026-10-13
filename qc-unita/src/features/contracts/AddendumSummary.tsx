/** Tabela de itens (com os IPs de cada item) e totais de um aditivo/distrato. */
import type { AddendumSummary } from '@shared/domain/contract/addendum'
import { cn } from '@/utils/cn'
import { formatBRL, formatQuantity } from '@/utils/format'

export function AddendumItemsTable({ summary, items }: { summary: AddendumSummary; items: { code: string; description: string; unit: string }[] }) {
  const th = 'border-b border-border bg-ink-50 px-3 py-1.5 text-xs font-semibold text-text-muted whitespace-nowrap'
  const td = 'border-b border-border px-3 py-1.5 whitespace-nowrap align-top'
  return (
    <div className="overflow-x-auto rounded-control border border-border">
      <table className="tabular w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>Insumo</th>
            <th className={cn(th, 'text-left')}>Vínculos (IP)</th>
            <th className={cn(th, 'text-right')}>Qtd lançada</th>
            <th className={cn(th, 'text-right')}>Qtd final</th>
            <th className={cn(th, 'text-right')}>R$ unitário</th>
            <th className={cn(th, 'text-right')}>R$ total</th>
          </tr>
        </thead>
        <tbody>
          {summary.lines.map((l, k) => (
            <tr key={k}>
              <td className={cn(td, 'max-w-72')}>
                <p className="truncate">{items[k]?.description}</p>
                <p className="text-[11px] text-text-muted">
                  {l.code}
                  {!l.contractItemId && ' · item novo'}
                </p>
              </td>
              <td className={cn(td, 'text-xs')}>
                {l.allocations.length ? (
                  l.allocations.map((a) => (
                    <p key={a.packageCode}>
                      {a.packageCode} <span className="text-text-muted">{formatQuantity(a.quantity)}</span>
                    </p>
                  ))
                ) : (
                  <span className="text-error">sem vínculo</span>
                )}
              </td>
              <td className={cn(td, 'text-right', l.quantityDelta.isNegative() && 'text-error')}>
                {formatQuantity(l.quantityDelta)} {items[k]?.unit}
              </td>
              <td className={cn(td, 'text-right', l.quantityAfter.isNegative() && 'font-semibold text-error')}>{formatQuantity(l.quantityAfter)}</td>
              <td className={cn(td, 'text-right')}>{formatBRL(l.unitPrice)}</td>
              <td className={cn(td, 'text-right font-medium', l.totalDelta.isNegative() && 'text-error')}>{formatBRL(l.totalDelta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AddendumTotals({ summary, title }: { summary: AddendumSummary; title: string }) {
  return (
    <div className="tabular flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
      <span className="text-text-muted">
        Contrato inicial <strong className="text-text">{formatBRL(summary.initialTotal)}</strong>
      </span>
      {!summary.previousTotal.isZero() && (
        <span className="text-text-muted">
          Lançamentos anteriores <strong className="text-text">{formatBRL(summary.previousTotal)}</strong>
        </span>
      )}
      <span className="text-text-muted">
        Total do {title} <strong className={summary.totalDelta.isNegative() ? 'text-error' : 'text-text'}>{formatBRL(summary.totalDelta)}</strong>
      </span>
      <span>
        Novo total do contrato <strong>{formatBRL(summary.newTotal)}</strong>
      </span>
    </div>
  )
}
