/**
 * Cabeçalho comum das telas da obra (Orçamento · Concorrências · Contratos): nome da obra,
 * orçamento vigente e a faixa compacta de consumo do orçamento geral.
 */
import { useMemo, type ReactNode } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import type { BudgetVersionDTO, WorkOverviewDTO } from '@shared/contracts'
import { buildWorkOverview, type WorkOverview } from '@shared/domain/work/overview'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Card, ConsumptionMeter, Skeleton, type Tone } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatBRL, formatDateTime, formatPercent } from '@/utils/format'
import { useWorkOverview } from './api'

/** Origem da versão do orçamento: selo, verbo ("importado em …") e tom do selo */
const SOURCE: Record<BudgetVersionDTO['source'], { badge: string; verb: string; tone: Tone }> = {
  excel: { badge: 'Excel', verb: 'importado', tone: 'info' },
  sharepoint: { badge: 'SharePoint', verb: 'importado', tone: 'info' },
  erp: { badge: 'ERP', verb: 'sincronizado', tone: 'neutral' },
  manual: { badge: 'Manual', verb: 'cadastrado', tone: 'neutral' },
}

export function WorkHeader({ section, data, ov, actions, strip = true }: { section: string; data: WorkOverviewDTO; ov: WorkOverview; actions?: ReactNode; strip?: boolean }) {
  const { work } = data
  const b = work.currentBudget
  return (
    <>
      <PageHeader
        eyebrow={`Obra ${work.code} · ${section}`}
        title={work.name}
        description={
          <>
            {[work.clientName, [work.city, work.state].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')}
            {b && (
              <>
                {' '}· Orçamento vigente v{b.version}
                {b.source === 'sharepoint' ? (
                  <>
                    {' '}· <span className="font-medium text-ink-700">SharePoint{work.uau?.budget && <> · orçamento {work.uau.budget}</>}</span>
                  </>
                ) : (
                  b.fileName && <> · <span className="font-medium text-ink-700">{b.fileName}</span></>
                )}
                {b.importedAt && <> · {SOURCE[b.source].verb} em {formatDateTime(b.importedAt)}</>}
                {b.importedByName && <> por {b.importedByName}</>}
                {' '}· {b.lines.toLocaleString('pt-BR')} linhas
              </>
            )}
          </>
        }
        meta={
          <>
            {work.archivedAt && <Badge tone="warning">Arquivada em {formatDateTime(work.archivedAt)}</Badge>}
            {b && (
              <Badge tone={SOURCE[b.source].tone} icon={<FileSpreadsheet className="size-3" />}>
                Orçamento v{b.version} · {SOURCE[b.source].badge}
              </Badge>
            )}
          </>
        }
        actions={actions}
      />
      {strip && <ConsumptionStrip ov={ov} />}
    </>
  )
}

/** Consumo do orçamento geral — faixa compacta para priorizar as tabelas. */
export function ConsumptionStrip({ ov }: { ov: WorkOverview }) {
  const t = ov.totals
  return (
    <Card className="mb-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <div className="flex items-baseline gap-2" title="Contratado = revisões aprovadas · em aprovação = enviadas · em cotação = estimativa pela vencedora indicada ou melhor condição.">
          <span className="tabular font-display text-2xl font-semibold text-text">{formatPercent(t.committedRatio, 1)}</span>
          <span className="text-xs leading-4 text-text-muted">
            do orçamento comprometido
            <span className="block">
              projetado com cotações: <span className="tabular font-medium text-text">{formatPercent(t.projectedRatio, 1)}</span>
            </span>
          </span>
        </div>
        <div className="min-w-72 flex-1">
          <ConsumptionMeter size="sm" values={{ budget: ov.budget, contracted: t.contracted, inApproval: t.inApproval, quoting: t.quoting }} />
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-border sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Orçamento geral', value: ov.budget, hint: null, tone: undefined },
          { label: 'Contratado', value: t.contracted, hint: formatPercent(t.contractedRatio, 1), tone: undefined },
          { label: 'Em aprovação', value: t.inApproval, hint: formatPercent(t.inApprovalRatio, 1), tone: undefined },
          { label: 'Em cotação (estimado)', value: t.quoting, hint: formatPercent(t.quotingRatio, 1), tone: undefined },
          {
            label: 'Saldo não comprometido',
            value: t.balance,
            hint: t.balance.isNegative() ? 'Estouro' : 'Disponível',
            tone: t.balance.isNegative() ? 'text-error' : 'text-success',
          },
        ].map((k, i) => (
          <div key={k.label} className={cn('min-w-0 px-4 py-1.5', i > 0 && 'border-l border-border')}>
            <p className="truncate text-[11px] font-medium text-text-muted">{k.label}</p>
            <p className="tabular text-sm font-semibold whitespace-nowrap text-text">
              {formatBRL(k.value)}
              {k.hint && <span className={cn('ml-1.5 text-[11px] font-medium', k.tone ?? 'text-text-muted')}>{k.hint}</span>}
            </p>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function WorkPageSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-16 w-1/3" />
      <Skeleton className="h-24" />
      <Skeleton className="h-96" />
    </div>
  )
}

/** Visão da obra + cálculo do consumo (compartilhado pelas telas da obra; cache do React Query). */
export function useWorkModel(workId: string) {
  const q = useWorkOverview(workId)
  const ov = useMemo(() => (q.data ? buildWorkOverview(q.data) : null), [q.data])
  return { q, data: q.data, ov }
}
