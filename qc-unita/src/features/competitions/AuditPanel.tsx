import type { CompetitionDetailDTO } from '@shared/contracts'
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/ui'
import { formatDate, formatDateTime, formatDecimal, formatRevision } from '@/utils/format'
import { useAudit } from './api'
import { entityLabel, fieldLabel, originLabel, valueLabel } from './status'

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v)
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v)
    if (/^-?\d+\.\d+$/.test(v)) return formatDecimal(v, 2)
    return valueLabel[v] ?? v
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return 'registro completo'
}

export function AuditPanel({ detail }: { detail: CompetitionDetailDTO }) {
  const audit = useAudit(detail.competition.id, true)
  const revNumber = new Map(detail.revisions.map((r) => [r.id, r.number]))
  const rows = (audit.data ?? []).filter((l) => l.entity !== 'best_conditions')

  return (
    <Card>
      <CardHeader title="Histórico de alterações" description="Quem alterou, o quê, quando, valores anterior e novo, revisão e origem." />
      {audit.isLoading ? (
        <div className="grid gap-2 p-5">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Sem registros" />
      ) : (
        <div className="max-h-[calc(100dvh-12rem)] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-text-muted">
                {['Data/hora', 'Usuário', 'Revisão', 'Registro', 'Campo', 'Anterior', 'Novo', 'Origem'].map((h) => (
                  <th key={h} className="sticky top-0 border-b border-border bg-ink-50 px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="hover:bg-ink-50">
                  <td className="tabular border-b border-border px-3 py-2 whitespace-nowrap text-ink-700">{formatDateTime(l.occurredAt)}</td>
                  <td className="border-b border-border px-3 py-2 whitespace-nowrap">{l.userName ?? 'Sistema'}</td>
                  <td className="border-b border-border px-3 py-2 whitespace-nowrap text-text-muted">
                    {l.revisionId && revNumber.has(l.revisionId) ? formatRevision(revNumber.get(l.revisionId)!) : '—'}
                  </td>
                  <td className="border-b border-border px-3 py-2 whitespace-nowrap">
                    {entityLabel[l.entity] ?? l.entity}
                    <span className="ml-1 text-xs text-text-muted">{l.action === 'insert' ? '(inclusão)' : l.action === 'delete' ? '(exclusão)' : ''}</span>
                  </td>
                  <td className="border-b border-border px-3 py-2 whitespace-nowrap">{l.field ? (fieldLabel[l.field] ?? l.field) : '—'}</td>
                  <td className="tabular max-w-56 truncate border-b border-border px-3 py-2 text-text-muted" title={show(l.oldValue)}>{show(l.oldValue)}</td>
                  <td className="tabular max-w-56 truncate border-b border-border px-3 py-2 font-medium" title={show(l.newValue)}>{show(l.newValue)}</td>
                  <td className="border-b border-border px-3 py-2 whitespace-nowrap text-xs text-text-muted" title={l.correlationId ?? undefined}>
                    {originLabel[l.origin] ?? l.origin}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
