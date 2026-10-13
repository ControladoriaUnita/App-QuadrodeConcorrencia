/**
 * Concorrências da obra em quadro kanban: uma coluna por etapa do fluxo
 * (Em cotação → Em aprovação → Aprovada → Contratada), cada QC numa caixa.
 * A visão "Por tipo de serviço" (consumo por vínculo de planejamento) continua disponível.
 */
import { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronDown, ChevronRight, KanbanSquare, Layers, Plus, Search, Users } from 'lucide-react'
import type { WorkCompetitionDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { UNLINKED, type ServiceGroup, type WorkOverview } from '@shared/domain/work/overview'
import { Alert, Badge, Button, Card, CardHeader, ConsumptionMeter, EmptyState, Input, Select, Tabs, type Tone } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { cn } from '@/utils/cn'
import { EMPTY, formatBRL, formatDate, formatPercent, formatRevision } from '@/utils/format'
import { workPath } from '@/features/works/currentWork'
import { useWorkModel, WorkHeader, WorkPageSkeleton } from '@/features/works/WorkHeader'
import { competitionStatus, revisionStatus } from './status'

type View = 'quadro' | 'servicos'
type Column = 'quoting' | 'in_approval' | 'approved' | 'contracted' | 'cancelled'

const COLUMNS: { key: Column; label: string; hint: string; tone: Tone; bar: string }[] = [
  { key: 'quoting', label: 'Em cotação', hint: 'Montando escopo, fornecedores e propostas', tone: 'primary', bar: 'bg-primary' },
  { key: 'in_approval', label: 'Em aprovação', hint: 'Revisão enviada, aguardando as alçadas', tone: 'warning', bar: 'bg-warning' },
  { key: 'approved', label: 'Aprovada', hint: 'Pronta para gerar a solicitação de contrato', tone: 'success', bar: 'bg-success' },
  { key: 'contracted', label: 'Contratada', hint: 'Solicitação de contrato enviada', tone: 'info', bar: 'bg-info' },
  { key: 'cancelled', label: 'Cancelada', hint: 'Fora do consumo da obra', tone: 'neutral', bar: 'bg-ink-300' },
]

function columnOf(c: WorkCompetitionDTO): Column {
  return c.status === 'open' ? 'quoting' : c.status
}

const valueLabel = { contracted: 'Contratado', in_approval: 'Em aprovação', quoting: 'Estimado' } as const

export function CompetitionsBoardPage() {
  const { workId = '' } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { q, data, ov } = useWorkModel(workId)
  const [params, setParams] = useSearchParams()
  const view = (params.get('visao') as View) ?? 'quadro'
  const setView = (k: View) => setParams((p) => (p.set('visao', k), p), { replace: true })

  if (q.error) return <Alert tone="error" title="Não foi possível carregar a obra">{(q.error as Error).message}</Alert>
  if (!data || !ov) return <WorkPageSkeleton />

  return (
    <div>
      <WorkHeader
        section="Concorrências"
        data={data}
        ov={ov}
        actions={
          can('competition.create') && (
            <Button variant="primary" icon={<Plus className="size-4" />} disabled={!data.work.currentBudgetId} onClick={() => navigate(workPath.newCompetition(workId))}>
              Nova concorrência
            </Button>
          )
        }
      />
      {!data.work.currentBudgetId && (
        <Alert tone="warning" className="mb-3" title="Obra sem orçamento">
          Importe o orçamento na aba <Link className="font-medium underline" to={workPath.budget(workId)}>Orçamento</Link> para começar a montar as concorrências.
        </Alert>
      )}
      <div className="mb-3">
        <Tabs<View>
          value={view}
          onChange={setView}
          items={[
            { key: 'quadro', label: 'Quadro', icon: <KanbanSquare className="size-4" />, count: data.competitions.filter((c) => c.status !== 'cancelled').length },
            { key: 'servicos', label: 'Por tipo de serviço', icon: <Layers className="size-4" /> },
          ]}
        />
      </div>
      {view === 'quadro' ? <Board workId={workId} competitions={data.competitions} packages={data.packages} /> : <ServiceTable workId={workId} ov={ov} />}
    </div>
  )
}

// ----------------------------------------------------------------------------- kanban
function Board({ workId, competitions, packages }: { workId: string; competitions: WorkCompetitionDTO[]; packages: { packageCode: string; description: string }[] }) {
  const [search, setSearch] = useState('')
  const [pkg, setPkg] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const pkgName = useMemo(() => new Map(packages.map((p) => [p.packageCode, p.description])), [packages])

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase()
    return competitions.filter((c) => (!pkg || c.packageCode === pkg) && (!t || `${c.code} ${c.title} ${c.packageCode ?? ''}`.toLowerCase().includes(t)))
  }, [competitions, search, pkg])
  const used = useMemo(() => [...new Set(competitions.map((c) => c.packageCode).filter((x): x is string => !!x))].sort(), [competitions])
  const columns = COLUMNS.filter((c) => c.key !== 'cancelled' || showCancelled)
  const cancelledCount = competitions.filter((c) => c.status === 'cancelled').length

  if (!competitions.length) {
    return (
      <Card>
        <EmptyState title="Nenhuma concorrência nesta obra" description="Crie a primeira concorrência escolhendo os insumos direto no orçamento." />
      </Card>
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input aria-label="Buscar concorrência" placeholder="Código ou objeto" className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Tipo de serviço" className="h-9 w-auto max-w-80" value={pkg} onChange={(e) => setPkg(e.target.value)}>
          <option value="">Todos os tipos de serviço</option>
          {used.map((p) => (
            <option key={p} value={p}>{p} — {pkgName.get(p) ?? p}</option>
          ))}
        </Select>
        {cancelledCount > 0 && (
          <label className="inline-flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" className="size-4 accent-primary" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            Mostrar canceladas ({cancelledCount})
          </label>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const items = filtered.filter((c) => columnOf(c) === col.key).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          const total = Decimal.sum(items.map((c) => c.committedTotal))
          return (
            <section key={col.key} aria-label={col.label} className="flex w-76 min-w-76 flex-1 flex-col rounded-card border border-border bg-ink-100/60">
              <header className="border-b border-border px-3 pt-2.5 pb-2">
                <div className="flex items-center gap-2">
                  <span className={cn('size-2.5 rounded-full', col.bar)} aria-hidden />
                  <h2 className="text-sm font-semibold text-text">{col.label}</h2>
                  <span className="tabular rounded-full bg-surface px-1.5 text-xs font-medium text-ink-600">{items.length}</span>
                  <span className="tabular ml-auto text-xs font-semibold text-text">{items.length ? formatBRL(total) : ''}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-text-muted">{col.hint}</p>
              </header>
              <div className="flex max-h-[calc(100dvh-24rem)] min-h-32 flex-col gap-2 overflow-y-auto p-2">
                {items.length ? (
                  items.map((c) => <CompetitionCard key={c.id} c={c} workId={workId} bar={col.bar} pkgName={pkgName} />)
                ) : (
                  <p className="px-2 py-6 text-center text-xs text-text-muted">Nenhuma concorrência</p>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function CompetitionCard({ c, workId, bar, pkgName }: { c: WorkCompetitionDTO; workId: string; bar: string; pkgName: Map<string, string> }) {
  const budget = Decimal.from(c.budgetAmount)
  const value = Decimal.from(c.committedTotal)
  const hasValue = !value.isZero()
  const diff = budget.minus(value)
  const ratio = budget.isZero() || !hasValue ? null : diff.div(budget, 6)
  const rs = revisionStatus[c.revisionStatus]
  return (
    <Link
      to={workPath.competition(workId, c.id)}
      className="group relative block overflow-hidden rounded-control border border-border bg-surface p-3 pl-3.5 shadow-card transition-colors hover:border-primary/60 focus-visible:border-primary"
    >
      <span className={cn('absolute inset-y-0 left-0 w-1', bar)} aria-hidden />
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-text">{c.code}</span>
        <Badge tone={rs.tone} title={`Revisão ${formatRevision(c.revisionNumber)} — ${rs.label}`}>
          {formatRevision(c.revisionNumber)}
          {c.revisionStatus === 'rejected' && ' · reprovada'}
        </Badge>
      </div>
      <p className="mt-1 line-clamp-2 text-sm leading-5 text-ink-800 group-hover:text-text">{c.title}</p>
      {c.packageCode && (
        <p className="mt-1 truncate text-[11px] text-text-muted" title={pkgName.get(c.packageCode)}>
          <span className="font-medium text-ink-700">{c.packageCode}</span> · {pkgName.get(c.packageCode) ?? 'Tipo de serviço'}
        </p>
      )}
      <dl className="tabular mt-2.5 grid grid-cols-2 gap-x-3 border-t border-border pt-2 text-xs">
        <div>
          <dt className="text-text-muted">Orçado</dt>
          <dd className="font-medium text-text">{formatBRL(budget)}</dd>
        </div>
        <div className="text-right">
          <dt className="text-text-muted">{valueLabel[c.category]}</dt>
          <dd className="font-semibold text-text">{hasValue ? formatBRL(value) : EMPTY}</dd>
        </div>
      </dl>
      {ratio && (
        <p className={cn('mt-1 text-right text-[11px] font-medium', ratio.isNegative() ? 'text-error' : 'text-success')}>
          {ratio.isNegative() ? `${formatPercent(ratio.abs(), 1)} acima do orçado` : `${formatPercent(ratio, 1)} abaixo do orçado`}
        </p>
      )}
      <div className="mt-2 flex items-center gap-3 text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-1" title="Fornecedores convidados">
          <Users className="size-3.5" aria-hidden /> {c.suppliersCount}
        </span>
        <span className="inline-flex items-center gap-1" title="Data da solicitação">
          <CalendarDays className="size-3.5" aria-hidden /> {formatDate(c.requestedOn)}
        </span>
        {c.effectiveRevisionNumber !== c.revisionNumber && <span className="ml-auto">Consumo pela {formatRevision(c.effectiveRevisionNumber)}</span>}
      </div>
    </Link>
  )
}

// ----------------------------------------------------------------------------- por tipo de serviço
const categoryLabel = { contracted: 'Contratado', in_approval: 'Em aprovação', quoting: 'Em cotação' } as const

function ServiceTable({ workId, ov }: { workId: string; ov: WorkOverview }) {
  const navigate = useNavigate()
  const [onlyWithQc, setOnlyWithQc] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const t = ov.totals
  const groups = ov.groups.filter((g) => !onlyWithQc || g.competitions.length > 0 || !g.contracted.plus(g.inApproval).plus(g.quoting).isZero())
  const toggle = (k: string) => setCollapsed((s) => (s.has(k) ? (s.delete(k), new Set(s)) : new Set(s.add(k))))
  const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
  const td = 'border-b border-border px-3 py-2 whitespace-nowrap'
  return (
    <Card>
      <CardHeader
        title="Concorrências por tipo de serviço"
        description={
          <>
            Agrupadas pelo vínculo de planejamento; o valor de cada QC é distribuído pelos vínculos dos seus itens.
            {ov.uncovered > 0 && !onlyWithQc && <span className="font-medium text-info"> · {ov.uncovered} tipo(s) de serviço ainda sem concorrência.</span>}
          </>
        }
        actions={
          <label className="inline-flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" className="size-4 accent-primary" checked={onlyWithQc} onChange={(e) => setOnlyWithQc(e.target.checked)} />
            Somente com concorrência
          </label>
        }
      />
      {groups.length === 0 ? (
        <EmptyState title="Nenhum tipo de serviço" description="O orçamento da obra ainda não foi importado (Excel) nem sincronizado com o ERP." />
      ) : (
        <div className="max-h-[calc(100dvh-12rem)] overflow-auto">
          <table className="tabular w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={cn(th, 'text-left')}>Tipo de serviço</th>
                <th className={cn(th, 'text-right')}>Orçado</th>
                <th className={cn(th, 'text-right')}>Contratado</th>
                <th className={cn(th, 'text-right')}>Em aprovação</th>
                <th className={cn(th, 'text-right')}>Em cotação</th>
                <th className={cn(th, 'text-right')}>Saldo</th>
                <th className={cn(th, 'min-w-44 text-left')}>Consumo</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const open = g.competitions.length > 0 && !collapsed.has(g.packageCode)
                return (
                  <Fragment key={g.packageCode}>
                    <GroupRow g={g} open={open} td={td} onToggle={() => toggle(g.packageCode)} />
                    {open &&
                      g.competitions.map((c) => (
                        <tr
                          key={c.id}
                          tabIndex={0}
                          onClick={() => navigate(workPath.competition(workId, c.id))}
                          onKeyDown={(e) => e.key === 'Enter' && navigate(workPath.competition(workId, c.id))}
                          className="cursor-pointer bg-surface hover:bg-primary-soft/40 focus-visible:bg-primary-soft/40"
                        >
                          <td className={cn(td, 'pl-12')}>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-text">{c.code}</span>
                              <span className="max-w-72 truncate text-ink-700">{c.title}</span>
                              <Badge tone={competitionStatus[c.status].tone}>{competitionStatus[c.status].label}</Badge>
                              <Badge tone={revisionStatus[c.revisionStatus].tone}>{formatRevision(c.revisionNumber)}</Badge>
                            </div>
                            {c.effectiveRevisionNumber !== c.revisionNumber && (
                              <p className="text-[11px] leading-4 text-text-muted">Consumo pela {formatRevision(c.effectiveRevisionNumber)} aprovada</p>
                            )}
                          </td>
                          <td className={cn(td, 'text-right text-text-muted')}>{formatBRL(c.budgetAmount)}</td>
                          <td className={cn(td, 'text-right')}>{c.category === 'contracted' ? formatBRL(c.committedTotal) : EMPTY}</td>
                          <td className={cn(td, 'text-right')}>{c.category === 'in_approval' ? formatBRL(c.committedTotal) : EMPTY}</td>
                          <td className={cn(td, 'text-right')}>{c.category === 'quoting' ? formatBRL(c.committedTotal) : EMPTY}</td>
                          <td className={td} />
                          <td className={cn(td, 'text-xs text-text-muted')}>{categoryLabel[c.category]}</td>
                        </tr>
                      ))}
                  </Fragment>
                )
              })}
            </tbody>
            <tfoot className="font-semibold">
              <tr>
                <td className={cn(td, 'bg-ink-50')}>Total da obra</td>
                <td className={cn(td, 'bg-ink-50 text-right')}>{formatBRL(ov.budget)}</td>
                <td className={cn(td, 'bg-ink-50 text-right')}>{formatBRL(t.contracted)}</td>
                <td className={cn(td, 'bg-ink-50 text-right')}>{formatBRL(t.inApproval)}</td>
                <td className={cn(td, 'bg-ink-50 text-right')}>{formatBRL(t.quoting)}</td>
                <td className={cn(td, 'bg-ink-50 text-right', t.balance.isNegative() && 'text-error')}>{formatBRL(t.balance)}</td>
                <td className={cn(td, 'bg-ink-50')}>{formatPercent(t.projectedRatio, 1)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  )
}

function GroupRow({ g, open, td, onToggle }: { g: ServiceGroup; open: boolean; td: string; onToggle: () => void }) {
  const isUnlinked = g.packageCode === UNLINKED
  const hasQc = g.competitions.length > 0
  return (
    <tr className={cn('bg-surface', hasQc && 'cursor-pointer hover:bg-ink-50')} onClick={hasQc ? onToggle : undefined}>
      <td className={td}>
        <div className="flex items-center gap-2">
          {hasQc ? (
            <button type="button" aria-expanded={open} aria-label={open ? 'Recolher' : 'Expandir'} className="rounded p-0.5 text-ink-500 hover:bg-ink-100" onClick={(e) => (e.stopPropagation(), onToggle())}>
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ) : (
            <span className="w-5" />
          )}
          <div>
            <p className="font-medium text-text">{g.description}</p>
            <p className="text-[11px] leading-4 text-text-muted">
              {isUnlinked ? 'Valores de QC sem vínculo com o orçamento' : g.packageCode} · {g.competitions.length} concorrência(s)
              {!hasQc && !g.contracted.plus(g.inApproval).plus(g.quoting).isZero() && ' · consumido por itens de QCs de outros tipos'}
            </p>
          </div>
        </div>
      </td>
      <td className={cn(td, 'text-right')}>{isUnlinked ? EMPTY : formatBRL(g.budget)}</td>
      <td className={cn(td, 'text-right')}>{g.contracted.isZero() ? EMPTY : formatBRL(g.contracted)}</td>
      <td className={cn(td, 'text-right')}>{g.inApproval.isZero() ? EMPTY : formatBRL(g.inApproval)}</td>
      <td className={cn(td, 'text-right')}>{g.quoting.isZero() ? EMPTY : formatBRL(g.quoting)}</td>
      <td className={cn(td, 'text-right', g.balance.isNegative() && 'font-semibold text-error')}>{isUnlinked ? EMPTY : formatBRL(g.balance)}</td>
      <td className={td}>
        {isUnlinked ? (
          <span className="text-xs text-warning">Vincular itens nos QCs</span>
        ) : (
          <div className="flex items-center gap-2">
            <ConsumptionMeter className="min-w-28 flex-1" size="sm" showLegend={false} values={{ budget: g.budget, contracted: g.contracted, inApproval: g.inApproval, quoting: g.quoting }} />
            <span className={cn('w-14 text-right text-xs font-medium', g.balance.isNegative() ? 'text-error' : 'text-text')}>{formatPercent(g.projectedRatio, 1)}</span>
          </div>
        )}
      </td>
    </tr>
  )
}
