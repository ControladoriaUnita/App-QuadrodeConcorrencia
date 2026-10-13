import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Truck } from 'lucide-react'
import type { ErpSyncInput, IntegrationLogDTO } from '@shared/contracts'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Select, Skeleton, type Tone } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/utils/cn'
import { formatDateTime } from '@/utils/format'

const tone: Record<IntegrationLogDTO['status'], Tone> = { started: 'info', success: 'success', partial: 'warning', error: 'error' }
const label: Record<IntegrationLogDTO['status'], string> = { started: 'Em execução', success: 'Sucesso', partial: 'Parcial', error: 'Erro' }

interface SyncStep { operation: string; status: 'success' | 'error' | 'skipped'; records: number; message?: string }
const stepTone: Record<SyncStep['status'], Tone> = { success: 'success', error: 'error', skipped: 'neutral' }
const stepLabel: Record<SyncStep['status'], string> = { success: 'Sucesso', error: 'Erro', skipped: 'Ignorado' }

export function IntegrationPage() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [scope, setScope] = useState<ErpSyncInput['scope']>('all')
  const logs = useQuery({ queryKey: ['integration-logs'], queryFn: () => api<IntegrationLogDTO[]>('/integration/logs') })
  const sync = useMutation({
    mutationFn: (s: ErpSyncInput['scope']) => api<{ correlationId: string; steps: SyncStep[] }>('/integration/erp-sync', { method: 'POST', body: { scope: s } }),
    onSettled: () => qc.invalidateQueries(),
  })
  const th = 'border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap text-left'
  const td = 'border-b border-border px-3 py-2'

  return (
    <div>
      <PageHeader
        eyebrow="Integração"
        title="ERP (UAU / Senior)"
        description="Sincronização server-side. Revisões aprovadas de QC nunca são sobrescritas — mantêm snapshot congelado."
        actions={
          can('integration.run') && (
            <>
              <Select aria-label="Escopo" className="h-10 w-auto" value={scope} onChange={(e) => setScope(e.target.value as ErpSyncInput['scope'])}>
                <option value="all">Tudo</option>
                <option value="works">Obras</option>
                <option value="suppliers">Fornecedores</option>
                <option value="materials">Insumos</option>
                <option value="budget">Orçamentos</option>
              </Select>
              <Button variant="primary" icon={<RefreshCw className="size-4" />} loading={sync.isPending && sync.variables !== 'suppliers'} disabled={sync.isPending} onClick={() => sync.mutate(scope)}>
                Sincronizar agora
              </Button>
              <Button icon={<Truck className="size-4" />} loading={sync.isPending && sync.variables === 'suppliers'} disabled={sync.isPending} onClick={() => sync.mutate('suppliers')}>
                Só fornecedores
              </Button>
            </>
          )
        }
      />
      {sync.isPending && (
        <Alert tone="info" className="mb-6">Sincronizando com o ERP. Fornecedores da UAU levam de 20 s a 1 minuto; não feche a página.</Alert>
      )}
      {sync.data && (
        <Alert tone={sync.data.steps.some((s) => s.status === 'error') ? 'warning' : 'success'} title="Sincronização concluída" className="mb-6">
          <ul className="grid gap-1">
            {sync.data.steps.map((s) => (
              <li key={s.operation} className="flex flex-wrap items-center gap-2">
                <Badge tone={stepTone[s.status]}>{stepLabel[s.status]}</Badge>
                <span className="font-medium">{s.operation}</span>
                <span className="tabular text-text-muted">{s.message ?? `${s.records} registro(s)`}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-muted">correlationId <code>{sync.data.correlationId}</code></p>
        </Alert>
      )}
      {sync.error && <Alert tone="error" className="mb-6">{(sync.error as Error).message}</Alert>}
      <Card>
        <CardHeader title="Logs de integração" description="Data/hora, origem, ID da integração, status, mensagens e correlationId." />
        {logs.isLoading ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : logs.error ? (
          <div className="p-5"><Alert tone="error">{(logs.error as Error).message}</Alert></div>
        ) : !logs.data?.length ? (
          <EmptyState title="Nenhuma sincronização registrada" />
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="tabular w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>{['Início', 'Provider', 'Operação', 'Status', 'Registros', 'Mensagem', 'correlationId'].map((h) => <th key={h} className={cn(th, 'sticky top-0')}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {logs.data.map((l) => (
                  <tr key={l.id} className="hover:bg-ink-50">
                    <td className={cn(td, 'whitespace-nowrap')}>{formatDateTime(l.startedAt)}</td>
                    <td className={cn(td, 'uppercase')}>{l.provider}</td>
                    <td className={td}>{l.operation}</td>
                    <td className={td}><Badge tone={tone[l.status]}>{label[l.status]}</Badge></td>
                    <td className={cn(td, 'text-right')}>{l.recordsProcessed}{l.recordsFailed ? ` / ${l.recordsFailed} falha(s)` : ''}</td>
                    <td className={cn(td, 'max-w-80 truncate text-text-muted')} title={l.message ?? undefined}>{l.message ?? '—'}</td>
                    <td className={cn(td, 'font-mono text-xs text-text-muted')}>{l.correlationId.slice(0, 13)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
