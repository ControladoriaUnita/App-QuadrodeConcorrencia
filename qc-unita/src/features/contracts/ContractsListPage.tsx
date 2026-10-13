/** Solicitações de contrato e aditivos da obra (geradas a partir de QCs aprovados). */
import { useNavigate, useParams } from 'react-router-dom'
import { Decimal } from '@shared/domain/decimal'
import { Alert, Badge, Card, CardHeader, EmptyState, Skeleton } from '@/components/ui'
import { cn } from '@/utils/cn'
import { EMPTY, formatBRL, formatDate, formatRevision } from '@/utils/format'
import { workPath } from '@/features/works/currentWork'
import { useWorkModel, WorkHeader, WorkPageSkeleton } from '@/features/works/WorkHeader'
import { useContracts } from './api'
import { contractStatus } from './status'

export function ContractsListPage() {
  const { workId = '' } = useParams()
  const navigate = useNavigate()
  const { q, data, ov } = useWorkModel(workId)
  const contracts = useContracts({ workId })

  if (q.error) return <Alert tone="error" title="Não foi possível carregar a obra">{(q.error as Error).message}</Alert>
  if (!data || !ov) return <WorkPageSkeleton />

  const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
  const td = 'border-b border-border px-3 py-2 whitespace-nowrap'
  return (
    <div>
      <WorkHeader section="Contratos e aditivos" data={data} ov={ov} />
      <Card>
        <CardHeader
          title="Solicitações de contrato"
          description="Geradas a partir de QCs aprovados. Novo total = contrato inicial + aditivos aprovados (entra no “Contratado” da obra)."
        />
        {contracts.error ? (
          <Alert tone="error" className="m-4">{(contracts.error as Error).message}</Alert>
        ) : contracts.isLoading ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : !contracts.data?.length ? (
          <EmptyState title="Nenhuma solicitação de contrato" description="Abra um QC aprovado (coluna “Aprovada” em Concorrências) e use “Gerar solicitação de contrato”." />
        ) : (
          <div className="overflow-auto">
            <table className="tabular w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className={cn(th, 'text-left')}>Solicitação</th>
                  <th className={cn(th, 'text-left')}>Concorrência</th>
                  <th className={cn(th, 'text-left')}>Contratado</th>
                  <th className={cn(th, 'text-left')}>Vigência</th>
                  <th className={cn(th, 'text-right')}>Contrato inicial</th>
                  <th className={cn(th, 'text-right')}>Aditivos</th>
                  <th className={cn(th, 'text-right')}>Novo total</th>
                </tr>
              </thead>
              <tbody>
                {contracts.data.map((c) => {
                  const open = () => navigate(workPath.contract(workId, c.id))
                  return (
                    <tr key={c.id} tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()} className={cn('cursor-pointer hover:bg-primary-soft/40', c.status === 'cancelled' && 'opacity-60')}>
                      <td className={td}>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{c.code}</span>
                          <Badge tone={contractStatus[c.status].tone}>{contractStatus[c.status].label}</Badge>
                        </div>
                        {c.erpContractId && <p className="text-[11px] text-text-muted">ERP {c.erpContractId}</p>}
                      </td>
                      <td className={td}>
                        <span className="font-medium">{c.competitionCode}</span> <span className="text-ink-700">{c.competitionTitle}</span>
                        <span className="ml-1 text-xs text-text-muted">{formatRevision(c.revisionNumber)}</span>
                      </td>
                      <td className={td}>{c.supplierName}</td>
                      <td className={td}>{formatDate(c.startOn)} → {formatDate(c.endOn)}</td>
                      <td className={cn(td, 'text-right')}>{formatBRL(c.totalAmount)}</td>
                      <td className={cn(td, 'text-right')}>{Decimal.from(c.addendaTotal).isZero() ? EMPTY : formatBRL(c.addendaTotal)}</td>
                      <td className={cn(td, 'text-right font-semibold')}>{formatBRL(Decimal.from(c.totalAmount).plus(c.addendaTotal))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
