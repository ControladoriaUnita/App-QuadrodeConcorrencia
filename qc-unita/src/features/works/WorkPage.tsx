/**
 * Painel da obra: consumo do orçamento geral e concorrências agrupadas por tipo de serviço
 * (vínculo de planejamento). Cálculo em shared/domain/work/overview.ts.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, FileSignature, FileSpreadsheet, Layers, Plus, Rows3 } from 'lucide-react'
import { buildWorkOverview, UNLINKED, type ServiceGroup } from '@shared/domain/work/overview'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, CardHeader, ConsumptionMeter, EmptyState, Skeleton, Tabs } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { cn } from '@/utils/cn'
import { EMPTY, formatBRL, formatDate, formatDateTime, formatPercent, formatRevision } from '@/utils/format'
import { NewCompetitionDialog } from '@/features/competitions/NewCompetitionDialog'
import { competitionStatus, revisionStatus } from '@/features/competitions/status'
import { useContracts } from '@/features/contracts/api'
import { contractStatus } from '@/features/contracts/status'
import { Decimal } from '@shared/domain/decimal'
import { useBudgetLines, useBudgetStructure, useWorkOverview } from './api'
import { BudgetImportDialog } from './BudgetImportDialog'
import { BudgetTree } from './BudgetTree'

const categoryLabel = { contracted: 'Contratado', in_approval: 'Em aprovação', quoting: 'Em cotação' } as const
type View = 'servicos' | 'orcamento' | 'contratos'

export function WorkPage() {
  const { workId = '' } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const q = useWorkOverview(workId)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [params, setParams] = useSearchParams()
  const view = (params.get('aba') as View) ?? 'servicos'
  // Obra recém-criada: abre a importação do orçamento
  useEffect(() => {
    if (params.get('importar') === '1') {
      setImporting(true)
      setParams((p) => (p.delete('importar'), p), { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const setView = (k: View) => setParams((p) => (p.set('aba', k), p), { replace: true })
  const budgetLines = useBudgetLines(workId, {}, view === 'orcamento')
  const budgetStructure = useBudgetStructure(workId, view === 'orcamento')
  const contracts = useContracts({ workId }, can('contract.read'))
  const [onlyWithQc, setOnlyWithQc] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const ov = useMemo(() => (q.data ? buildWorkOverview(q.data) : null), [q.data])

  if (q.error) return <Alert tone="error" title="Não foi possível carregar a obra">{(q.error as Error).message}</Alert>
  if (!q.data || !ov) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16 w-1/3" />
        <Skeleton className="h-40" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const { work } = q.data
  const t = ov.totals
  const groups = ov.groups.filter((g) => !onlyWithQc || g.competitions.length > 0 || !g.contracted.plus(g.inApproval).plus(g.quoting).isZero())
  const toggle = (k: string) => setCollapsed((s) => (s.has(k) ? (s.delete(k), new Set(s)) : new Set(s.add(k))))
  const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
  const td = 'border-b border-border px-3 py-2 whitespace-nowrap'

  return (
    <div>
      <PageHeader
        backTo="/obras"
        eyebrow={`Obras · Obra ${work.code}`}
        title={work.name}
        description={
          <>
            {[work.clientName, [work.city, work.state].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')}
            {work.currentBudget && (
              <>
                {' '}· Orçamento vigente v{work.currentBudget.version}
                {work.currentBudget.fileName && <> · <span className="font-medium text-ink-700">{work.currentBudget.fileName}</span></>}
                {work.currentBudget.importedAt && <> · {work.currentBudget.source === 'excel' ? 'importado' : 'sincronizado'} em {formatDateTime(work.currentBudget.importedAt)}</>}
                {work.currentBudget.importedByName && <> por {work.currentBudget.importedByName}</>}
                {' '}· {work.currentBudget.lines.toLocaleString('pt-BR')} linhas
              </>
            )}
          </>
        }
        meta={
          work.currentBudget && (
            <Badge tone={work.currentBudget.source === 'excel' ? 'info' : 'neutral'} icon={<FileSpreadsheet className="size-3" />}>
              Orçamento v{work.currentBudget.version} · {work.currentBudget.source === 'excel' ? 'Excel' : 'ERP'}
            </Badge>
          )
        }
        actions={
          <>
            {can('budget.import') && (
              <Button icon={<FileSpreadsheet className="size-4" />} onClick={() => setImporting(true)}>
                Importar orçamento (Excel)
              </Button>
            )}
            {can('competition.create') && (
              <Button variant="primary" icon={<Plus className="size-4" />} disabled={!work.currentBudgetId} onClick={() => setCreating(true)}>
                Nova concorrência
              </Button>
            )}
          </>
        }
      />
      {!work.currentBudgetId && (
        <Alert tone="warning" className="mb-3" title="Obra sem orçamento">
          Importe o orçamento em Excel para começar a montar as concorrências.
        </Alert>
      )}

      {/* Consumo do orçamento geral — faixa compacta para priorizar as tabelas */}
      <Card className="mb-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <div
            className="flex items-baseline gap-2"
            title="Contratado = revisões aprovadas · em aprovação = enviadas · em cotação = estimativa pela vencedora indicada ou melhor condição."
          >
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

      <div className="mb-3">
        <Tabs<View>
          sticky
          value={view}
          onChange={setView}
          items={[
            { key: 'servicos', label: 'Concorrências por tipo de serviço', icon: <Layers className="size-4" /> },
            { key: 'orcamento', label: 'Orçamento', icon: <Rows3 className="size-4" /> },
            ...(can('contract.read')
              ? [{ key: 'contratos' as const, label: 'Contratos e aditivos', icon: <FileSignature className="size-4" />, count: contracts.data?.filter((c) => c.status !== 'cancelled').length }]
              : []),
          ]}
        />
      </div>

      {view === 'orcamento' && (
        <Card>
          <CardHeader
            title="Orçamento"
            description="Estrutura da planilha: Item → composição → insumos com Vínculo PL. “Comprometido em” mostra o % de cada QC (revisão efetiva); “Livre”, o que resta."
          />
          {budgetLines.isLoading || budgetStructure.isLoading ? (
            <div className="grid gap-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : (
            <BudgetTree
              structure={budgetStructure.data ?? { budgetId: '', groups: [], activities: [] }}
              lines={budgetLines.data ?? []}
              maxHeight="calc(100dvh - 17rem)"
            />
          )}
        </Card>
      )}

      {view === 'contratos' && (
        <Card>
          <CardHeader
            title="Solicitações de contrato"
            description="Geradas a partir de QCs aprovados. Novo total = contrato inicial + aditivos aprovados (entra no “Contratado” da obra)."
          />
          {contracts.isLoading ? (
            <div className="grid gap-2 p-5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : !contracts.data?.length ? (
            <EmptyState title="Nenhuma solicitação de contrato" description="Abra um QC aprovado e use “Gerar solicitação de contrato”." />
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
                    const open = () => navigate(`/obras/${workId}/contratos/${c.id}`)
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
      )}

      {view === 'servicos' && (
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
                            onClick={() => navigate(`/obras/${workId}/qc/${c.id}`)}
                            onKeyDown={(e) => e.key === 'Enter' && navigate(`/obras/${workId}/qc/${c.id}`)}
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
      )}

      <BudgetImportDialog open={importing} work={work} onClose={() => setImporting(false)} />
      <NewCompetitionDialog
        open={creating}
        work={work}
        packages={q.data.packages.map((p) => {
          const g = ov.groups.find((x) => x.packageCode === p.packageCode)
          return { ...p, consumption: g?.projectedRatio ?? null }
        })}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          navigate(`/obras/${workId}/qc/${id}?aba=fornecedores`)
        }}
      />
    </div>
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
