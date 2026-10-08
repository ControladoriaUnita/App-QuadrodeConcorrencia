/**
 * Tela inicial: seleção da obra. Cada obra mostra o orçamento geral e quanto dele
 * já está comprometido pelas concorrências.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, ChevronRight, MapPin, Plus } from 'lucide-react'
import type { WorkDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, ConsumptionMeter, EmptyState, Skeleton, type Tone } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { formatBRL, formatPercent } from '@/utils/format'
import { useWorks } from '@/features/competitions/api'
import { NewWorkDialog } from './NewWorkDialog'

const status: Record<WorkDTO['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  not_started: { label: 'Não iniciada', tone: 'primary' },
  active: { label: 'Ativa', tone: 'success' },
  completed: { label: 'Concluída', tone: 'info' },
  archived: { label: 'Arquivada', tone: 'warning' },
}

export function WorkSelectPage() {
  const works = useWorks()
  const navigate = useNavigate()
  const { can } = useAuth()
  const [creating, setCreating] = useState(false)
  const newButton = can('work.manage') && (
    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
      Nova obra
    </Button>
  )
  return (
    <div>
      <PageHeader
        eyebrow="Quadro de Concorrência"
        title="Selecione a obra"
        description="Cada obra tem um orçamento geral; as concorrências consomem esse orçamento por tipo de serviço."
        actions={newButton}
      />
      <NewWorkDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          navigate(`/obras/${id}?importar=1`)
        }}
      />
      {works.error ? (
        <Alert tone="error">{(works.error as Error).message}</Alert>
      ) : works.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-52" />)}</div>
      ) : !works.data?.length ? (
        <Card>
          <EmptyState title="Nenhuma obra disponível" description="Cadastre uma obra, sincronize com o ERP ou peça ao administrador acesso a uma obra." action={newButton} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {works.data.map((w) => (
            <WorkCard key={w.id} w={w} />
          ))}
        </div>
      )}
    </div>
  )
}

function WorkCard({ w }: { w: WorkDTO }) {
  const s = w.summary
  const budget = Decimal.from(s?.budgetTotal ?? w.currentBudgetTotal ?? '0')
  const contracted = Decimal.from(s?.contracted ?? '0')
  const inApproval = Decimal.from(s?.inApproval ?? '0')
  const committed = contracted.plus(inApproval)
  return (
    <Link
      to={`/obras/${w.id}`}
      className="group rounded-card border border-border bg-surface p-5 shadow-card transition-colors hover:border-primary/50 focus-visible:border-primary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
            <Building2 className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wider text-primary uppercase">Obra {w.code}</p>
            <h2 className="truncate text-lg font-semibold text-text">{w.name}</h2>
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-text-muted">
              <MapPin className="size-3" aria-hidden />
              {[w.city, w.state].filter(Boolean).join(' / ') || '—'} · {w.clientName ?? '—'}
            </p>
          </div>
        </div>
        <Badge tone={status[w.status].tone}>{status[w.status].label}</Badge>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-text-muted">Orçamento geral</dt>
          <dd className="tabular font-semibold">{w.currentBudgetId ? formatBRL(budget) : 'Sem orçamento'}</dd>
        </div>
        <div className="text-right">
          <dt className="text-xs text-text-muted">Comprometido</dt>
          <dd className="tabular font-semibold">
            {formatBRL(committed)} <span className="text-text-muted">· {formatPercent(budget.isZero() ? null : committed.div(budget, 6), 1)}</span>
          </dd>
        </div>
      </dl>
      {w.currentBudgetId && (
        <ConsumptionMeter
          className="mt-3"
          size="sm"
          showLegend={false}
          values={{ budget, contracted, inApproval, quoting: Decimal.from(s?.quoting ?? '0') }}
        />
      )}
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-text-muted">{s?.competitions ?? 0} concorrência(s)</span>
        <span className="inline-flex items-center gap-1 font-medium text-primary">
          Abrir obra <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  )
}
