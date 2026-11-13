/**
 * Custos fora de escopo da obra: itens que não estão previstos no orçamento. Mostra o total e o
 * peso sobre o orçamento vigente, o resumo por motivo e por Item da EAP, as linhas fora de escopo
 * apontadas nos mapas dos QCs (automáticas, com link para o QC de origem) e os lançamentos manuais
 * (cada um pode apontar o QC a que se refere).
 */
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { OutOfScopeCategoryKey, OutOfScopeCostDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { OUT_OF_SCOPE_CATEGORIES, outOfScopeCode, summarizeOutOfScope } from '@shared/domain/budget/out-of-scope'
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Input, KpiStrip, Select, Skeleton, type Tone } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { cn } from '@/utils/cn'
import { EMPTY, formatBRL, formatDate, formatPercent, formatQuantity } from '@/utils/format'
import { fold } from '@/utils/search'
import { useBudgetStructure } from '@/features/works/api'
import { useWorkModel, WorkHeader, WorkPageSkeleton } from '@/features/works/WorkHeader'
import { useOutOfScope, useOutOfScopeMutations } from './api'
import { OutOfScopeDialog } from './OutOfScopeDialog'

const CATEGORY_TONE: Record<OutOfScopeCategoryKey, Tone> = {
  client_request: 'info',
  budget_omission: 'warning',
  design_change: 'primary',
  technical_requirement: 'neutral',
  regulatory: 'neutral',
  other: 'neutral',
}

export function OutOfScopePage() {
  const { workId = '' } = useParams()
  const { q, data, ov } = useWorkModel(workId)
  const list = useOutOfScope(workId)
  const structure = useBudgetStructure(workId, !!data?.work.currentBudgetId)
  const m = useOutOfScopeMutations(workId)
  const [editing, setEditing] = useState<OutOfScopeCostDTO | 'new' | null>(null)
  const [removing, setRemoving] = useState<OutOfScopeCostDTO | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<OutOfScopeCategoryKey | ''>('')

  const items = useMemo(() => list.data?.items ?? [], [list.data])
  const groupName = useMemo(() => {
    const names = new Map((structure.data?.groups ?? []).map((g) => [g.wbs, g.description]))
    return (wbs: string) => names.get(wbs) ?? null
  }, [structure.data])
  const summary = useMemo(() => summarizeOutOfScope(items, list.data?.budgetTotal ?? null, groupName), [items, list.data, groupName])
  const qcLines = useMemo(() => list.data?.fromCompetitions ?? [], [list.data])
  const qcTotal = useMemo(() => Decimal.sum(qcLines.map((l) => l.total)), [qcLines])
  const filtered = useMemo(() => {
    const terms = fold(search).split(/\s+/).filter(Boolean)
    return items.filter((i) => {
      if (category && i.category !== category) return false
      const text = fold(`${outOfScopeCode(i.number)} ${i.code ?? ''} ${i.description} ${i.justification} ${i.wbs ?? ''} ${i.wbsDescription ?? ''} ${i.planningCode ?? ''} ${i.requestedBy ?? ''} ${i.competition?.code ?? ''} ${i.competition?.title ?? ''}`)
      return terms.every((t) => text.includes(t))
    })
  }, [items, search, category])

  if (q.error) return <Alert tone="error" title="Não foi possível carregar a obra">{(q.error as Error).message}</Alert>
  if (!data || !ov) return <WorkPageSkeleton />

  const canManage = !!list.data?.canManage
  const budget = list.data?.budgetTotal ?? null
  // Total da obra: lançamentos manuais + linhas fora de escopo dos QCs
  const grandTotal = summary.total.plus(qcTotal)
  const ratio = budget && !Decimal.from(budget).isZero() ? grandTotal.div(budget, 6) : null
  const qcHref = (competitionId: string, revisionId?: string) => `/obras/${workId}/qc/${competitionId}${revisionId ? `?rev=${revisionId}` : ''}`
  const filteredTotal = Decimal.sum(filtered.map((i) => i.total))
  const saving = m.create.isPending || m.update.isPending
  const saveError = ((editing === 'new' ? m.create.error : m.update.error) as ApiError | null) ?? null
  const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
  const td = 'border-b border-border px-3 py-2 align-top'

  return (
    <div>
      <WorkHeader
        section="Custos fora de escopo"
        data={data}
        ov={ov}
        strip={false}
        actions={
          canManage && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => {
                m.create.reset()
                setEditing('new')
              }}
            >
              Novo custo fora de escopo
            </Button>
          )
        }
      />

      <KpiStrip
        className="mb-3"
        items={[
          { label: 'Orçamento vigente', value: budget ? formatBRL(budget) : 'Sem orçamento' },
          {
            label: 'Custos fora de escopo',
            value: formatBRL(grandTotal),
            hint: `${summary.count} lançamento(s) · ${qcLines.length} linha(s) de QC`,
            emphasis: !grandTotal.isZero(),
          },
          {
            label: 'Sobre o orçamento',
            value: ratio ? formatPercent(ratio, 2) : EMPTY,
            tone: ratio && ratio.gt('0.05') ? 'error' : ratio && !ratio.isZero() ? 'warning' : undefined,
            hint: ratio && ratio.gt('0.05') ? 'acima de 5%' : undefined,
          },
          { label: 'Orçamento + fora de escopo', value: budget ? formatBRL(Decimal.from(budget).plus(grandTotal)) : EMPTY },
        ]}
      />

      {summary.count > 0 && (
        <div className="mb-3 grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader title="Por motivo" />
            <ul className="tabular divide-y divide-border text-sm">
              {summary.byCategory.map((c) => (
                <li key={c.category} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="flex items-center gap-2">
                    <Badge tone={CATEGORY_TONE[c.category]}>{c.label}</Badge>
                    <span className="text-xs text-text-muted">{c.count} lançamento(s)</span>
                  </span>
                  <span className="font-medium">
                    {formatBRL(c.total)} <span className="text-xs font-normal text-text-muted">· {formatPercent(c.total.div(summary.total, 6), 0)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Por Item da EAP" />
            <ul className="tabular divide-y divide-border text-sm">
              {summary.byItem.map((i) => (
                <li key={i.wbs ?? '-'} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 truncate">
                    {i.wbs ? (
                      <>
                        <span className="font-semibold">{i.wbs}</span> <span className="text-ink-700">{i.description ?? ''}</span>
                      </>
                    ) : (
                      <span className="text-text-muted">Sem Item da EAP</span>
                    )}
                    <span className="ml-2 text-xs text-text-muted">{i.count} lançamento(s)</span>
                  </span>
                  <span className="shrink-0 font-medium">{formatBRL(i.total)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {qcLines.length > 0 && (
        <Card className="mb-3">
          <CardHeader
            title="Apontados nos QCs"
            description="Linhas fora de escopo dos mapas de cotação (revisão corrente de cada QC). São automáticas: mudam junto com o mapa. Para alterar, abra o QC de origem."
          />
          <div className="overflow-auto">
            <table className="tabular w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className={cn(th, 'text-left')}>QC de origem</th>
                  <th className={cn(th, 'text-left')}>Insumo do mapa</th>
                  <th className={cn(th, 'text-right')}>Quant. FE</th>
                  <th className={cn(th, 'text-right')}>Unit. FE</th>
                  <th className={cn(th, 'text-right')}>Total</th>
                  <th className={cn(th, 'text-left')}>Origem da quantidade</th>
                </tr>
              </thead>
              <tbody>
                {qcLines.map((l) => (
                  <tr key={`${l.competitionId}-${l.itemId}`} className="hover:bg-ink-50">
                    <td className={cn(td, 'whitespace-nowrap')}>
                      <Link className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" to={qcHref(l.competitionId, l.revisionId)}>
                        {l.competitionCode} <ExternalLink className="size-3.5" aria-hidden />
                      </Link>
                      <p className="max-w-56 truncate text-[11px] leading-4 text-text-muted" title={l.competitionTitle}>
                        {l.competitionTitle} · rev{String(l.revisionNumber).padStart(2, '0')}
                      </p>
                    </td>
                    <td className={cn(td, 'max-w-80')}>
                      <p className="truncate font-medium" title={l.description}>{l.description}</p>
                      <p className="text-[11px] leading-4 text-text-muted">{l.code} · {l.unit}</p>
                    </td>
                    <td className={cn(td, 'text-right whitespace-nowrap')}>{formatQuantity(l.quantity)}</td>
                    <td className={cn(td, 'text-right whitespace-nowrap')}>{l.unitCost ? formatBRL(l.unitCost) : <span className="text-text-muted">sem preço</span>}</td>
                    <td className={cn(td, 'text-right font-semibold whitespace-nowrap')}>{formatBRL(l.total)}</td>
                    <td className={td}>
                      <Badge tone={l.informed ? 'warning' : 'neutral'}>{l.informed ? 'informada no mapa' : 'sem referência do orçamento'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-semibold">
                <tr>
                  <td className="bg-ink-50 px-3 py-2" colSpan={4}>Total dos QCs</td>
                  <td className="bg-ink-50 px-3 py-2 text-right whitespace-nowrap">{formatBRL(qcTotal)}</td>
                  <td className="bg-ink-50" />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Lançamentos"
          description="Itens que não estão previstos no orçamento da obra. Cada lançamento guarda motivo, justificativa e quem lançou."
          actions={
            items.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
                  <Input aria-label="Buscar lançamentos" placeholder="Buscar…" className="h-8 w-56 pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select aria-label="Filtrar por motivo" className="h-8 w-auto" value={category} onChange={(e) => setCategory(e.target.value as OutOfScopeCategoryKey | '')}>
                  <option value="">Todos os motivos</option>
                  {(Object.keys(OUT_OF_SCOPE_CATEGORIES) as OutOfScopeCategoryKey[]).map((k) => (
                    <option key={k} value={k}>{OUT_OF_SCOPE_CATEGORIES[k]}</option>
                  ))}
                </Select>
              </div>
            )
          }
        />
        {list.error ? (
          <Alert tone="error" className="m-4">{(list.error as Error).message}</Alert>
        ) : list.isLoading ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Nenhum custo fora de escopo"
            description="Lance aqui os itens que a obra precisa e que não estão previstos no orçamento, com o motivo e a justificativa."
            action={canManage && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Novo custo fora de escopo</Button>}
          />
        ) : (
          <div className="overflow-auto">
            <table className="tabular w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className={cn(th, 'text-left')}>Nº</th>
                  <th className={cn(th, 'text-left')}>Data</th>
                  <th className={cn(th, 'text-left')}>Insumo</th>
                  <th className={cn(th, 'text-left')}>Motivo</th>
                  <th className={cn(th, 'text-left')}>QC</th>
                  <th className={cn(th, 'text-left')}>Item da EAP · IP</th>
                  <th className={cn(th, 'text-right')}>Quant.</th>
                  <th className={cn(th, 'text-right')}>Custo unit.</th>
                  <th className={cn(th, 'text-right')}>Total</th>
                  <th className={cn(th, 'min-w-64 text-left')}>Justificativa</th>
                  {canManage && <th className={cn(th, 'w-20')} />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.id} className="hover:bg-ink-50">
                    <td className={cn(td, 'font-semibold whitespace-nowrap')}>{outOfScopeCode(i.number)}</td>
                    <td className={cn(td, 'whitespace-nowrap')}>{formatDate(i.occurredOn)}</td>
                    <td className={cn(td, 'max-w-80')}>
                      <p className="truncate font-medium" title={i.description}>{i.description}</p>
                      <p className="text-[11px] leading-4 text-text-muted">{i.code ?? 'Insumo livre'} · {i.unit}</p>
                    </td>
                    <td className={td}>
                      <Badge tone={CATEGORY_TONE[i.category]}>{OUT_OF_SCOPE_CATEGORIES[i.category]}</Badge>
                    </td>
                    <td className={cn(td, 'whitespace-nowrap')}>
                      {i.competition ? (
                        <Link className="font-medium text-primary hover:underline" to={qcHref(i.competition.id)} title={i.competition.title}>
                          {i.competition.code}
                        </Link>
                      ) : (
                        EMPTY
                      )}
                    </td>
                    <td className={cn(td, 'max-w-60')}>
                      <p className="truncate" title={i.wbsDescription ?? undefined}>{i.wbs ? `${i.wbs} · ${i.wbsDescription ?? ''}` : EMPTY}</p>
                      <p className="text-[11px] leading-4 text-text-muted">{i.planningCode ? `${i.planningCode} — ${i.planningDescription ?? ''}` : 'Sem IP'}</p>
                    </td>
                    <td className={cn(td, 'text-right whitespace-nowrap')}>{formatQuantity(i.quantity)}</td>
                    <td className={cn(td, 'text-right whitespace-nowrap')}>{formatBRL(i.unitCost)}</td>
                    <td className={cn(td, 'text-right font-semibold whitespace-nowrap')}>{formatBRL(i.total)}</td>
                    <td className={cn(td, 'max-w-96')}>
                      <p className="line-clamp-2 text-ink-700" title={i.justification}>{i.justification}</p>
                      <p className="text-[11px] leading-4 text-text-muted">
                        {[i.requestedBy && `Solicitado por ${i.requestedBy}`, i.createdByName && `lançado por ${i.createdByName}`].filter(Boolean).join(' · ')}
                      </p>
                    </td>
                    {canManage && (
                      <td className={cn(td, 'whitespace-nowrap')}>
                        <button
                          type="button"
                          className="rounded-control p-1.5 text-ink-500 hover:bg-ink-100 hover:text-text"
                          aria-label={`Editar ${outOfScopeCode(i.number)}`}
                          onClick={() => {
                            m.update.reset()
                            setEditing(i)
                          }}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-control p-1.5 text-ink-500 hover:bg-error-soft hover:text-error"
                          aria-label={`Excluir ${outOfScopeCode(i.number)}`}
                          onClick={() => setRemoving(i)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 11 : 10} className="px-3 py-8 text-center text-text-muted">Nenhum lançamento com esse filtro.</td>
                  </tr>
                )}
              </tbody>
              <tfoot className="font-semibold">
                <tr>
                  <td className="bg-ink-50 px-3 py-2" colSpan={8}>
                    {filtered.length === items.length ? 'Total' : `Total filtrado (${filtered.length} de ${items.length})`}
                  </td>
                  <td className="bg-ink-50 px-3 py-2 text-right whitespace-nowrap">{formatBRL(filteredTotal)}</td>
                  <td className="bg-ink-50" colSpan={canManage ? 2 : 1} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <OutOfScopeDialog
          workId={workId}
          cost={editing === 'new' ? null : editing}
          competitions={list.data?.competitions ?? []}
          saving={saving}
          error={saveError}
          onClose={() => setEditing(null)}
          onSave={(input) => (editing === 'new' ? m.create.mutateAsync(input) : m.update.mutateAsync({ id: editing.id, ...input }))}
        />
      )}
      {m.remove.error && <Alert tone="error" className="mt-3" title={(m.remove.error as ApiError).message} />}
      <ConfirmDialog
        open={!!removing}
        tone="danger"
        title={removing ? `Excluir ${outOfScopeCode(removing.number)}?` : ''}
        description={removing ? `${removing.description} · ${formatBRL(removing.total)}. A exclusão fica registrada na auditoria.` : undefined}
        confirmLabel="Excluir"
        loading={m.remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          try {
            await m.remove.mutateAsync(removing.id)
          } finally {
            setRemoving(null)
          }
        }}
      />
    </div>
  )
}
