import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ChevronDown, ClipboardList, FileSignature, Link2, FilePlus2, GitBranch, History, Lock, Send, ShieldCheck, Table2, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { buildQcMap } from '@shared/domain/competition/qc-map'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, ConfirmDialog, Dialog, Field, KpiStrip, Select, Skeleton, Tabs, Textarea, toneClasses } from '@/components/ui'
import { cn } from '@/utils/cn'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useContracts, useCreateContract } from '@/features/contracts/api'
import { contractStatus } from '@/features/contracts/status'
import { formatBRL, formatDateTime, formatPercent, formatRevision } from '@/utils/format'
import { useCompetition, useCreateRevision, useQcMutations } from './api'
import { ApprovalsPanel } from './ApprovalsPanel'
import { AuditPanel } from './AuditPanel'
import { LinksPanel } from './LinksPanel'
import { QcGrid } from './QcGrid'
import { RevisionForm } from './RevisionForm'
import { ScopePanel } from './ScopePanel'
import { SuppliersPanel } from './SuppliersPanel'
import { budgetTone, competitionStatus, revisionStatus } from './status'

type TabKey = 'mapa' | 'vinculos' | 'dados' | 'escopo' | 'fornecedores' | 'aprovacoes' | 'historico'
const today = () => new Date().toISOString().slice(0, 10)

export function CompetitionPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const revisionParam = params.get('rev') ?? undefined
  const tab = (params.get('aba') as TabKey) ?? 'mapa'
  const setTab = (k: TabKey) => setParams((p) => (p.set('aba', k), p), { replace: true })

  const q = useCompetition(id, revisionParam)
  const detail = q.data
  const map = useMemo(() => (detail ? buildQcMap(detail, { today: today() }) : null), [detail])
  const m = useQcMutations(id, detail?.revision.id ?? '')
  const newRevision = useCreateRevision(id)
  const navigate = useNavigate()
  const { can } = useAuth()
  const contracts = useContracts({ competitionId: id }, can('contract.read'))
  const createContract = useCreateContract()
  const activeContract = contracts.data?.find((x) => x.status !== 'cancelled')

  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [revisionDialog, setRevisionDialog] = useState(false)
  const [reason, setReason] = useState('')

  const anyError = [m.addLines, m.removeItem, m.setLinks, m.updateRevision, m.updateItem, m.addSupplier, m.updateSupplier, m.removeSupplier, m.upsertPrices, m.submit, m.decide, newRevision, createContract]
    .map((x) => x.error)
    .find(Boolean) as ApiError | undefined

  if (q.isLoading || !detail || !map) {
    if (q.error) return <Alert tone="error" title="Não foi possível carregar a concorrência">{(q.error as Error).message}</Alert>
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16 w-1/2" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  const { competition: c, revision: r } = detail
  const rs = revisionStatus[r.status]
  const winner = map.winner
  const lowest = map.lowestComplete
  const lowestSupplier = lowest && detail.suppliers.find((s) => s.id === lowest.competitionSupplierId)

  return (
    <div>
      <PageHeader
        backTo={`/obras/${c.workId}`}
        eyebrow={`Obra ${c.workCode} · ${c.workName}`}
        title={`${c.code} — ${c.title}`}
        meta={
          <>
            <Badge tone={competitionStatus[c.status].tone}>{competitionStatus[c.status].label}</Badge>
            <Badge tone={rs.tone}>{formatRevision(r.number)} · {rs.label}</Badge>
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <span>IPs de planejamento:</span>
            {[...new Set(detail.links.map((l) => l.packageCode).filter(Boolean))].sort().map((p) => (
              <Badge key={p} tone="neutral">{p}</Badge>
            ))}
            {r.reason && <span className="ml-2">· Motivo da revisão: {r.reason}</span>}
          </span>
        }
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              <GitBranch className="size-4" aria-hidden />
              <Select
                aria-label="Revisão"
                className="h-8 w-auto"
                value={r.id}
                onChange={(e) => setParams((p) => (p.set('rev', e.target.value), p))}
              >
                {detail.revisions.map((x) => (
                  <option key={x.id} value={x.id}>{formatRevision(x.number)} — {revisionStatus[x.status].label}</option>
                ))}
              </Select>
            </label>
            {activeContract ? (
              <Button
                icon={<FileSignature className="size-4" />}
                title={contractStatus[activeContract.status].label}
                onClick={() => navigate(`/obras/${c.workId}/contratos/${activeContract.id}`)}
              >
                Solicitação {activeContract.code}
              </Button>
            ) : (
              can('contract.manage') &&
              detail.revisions.some((x) => x.status === 'approved') && (
                <Button
                  variant={detail.can.submit ? 'secondary' : 'primary'}
                  icon={<FileSignature className="size-4" />}
                  loading={createContract.isPending}
                  onClick={async () => {
                    const r = await createContract.mutateAsync(c.id)
                    navigate(`/obras/${c.workId}/contratos/${r.id}`)
                  }}
                >
                  Gerar solicitação de contrato
                </Button>
              )
            )}
            {detail.can.createRevision && (
              <Button icon={<FilePlus2 className="size-4" />} onClick={() => setRevisionDialog(true)}>
                Nova revisão
              </Button>
            )}
            {detail.can.submit && (
              <Button variant="primary" icon={<Send className="size-4" />} onClick={() => setConfirmSubmit(true)}>
                Enviar para aprovação
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 grid gap-2">
        {r.frozenAt && (
          <CompactNotice tone="success" icon={<Lock className="size-4" />}>
            <span className="font-semibold">Revisão aprovada e congelada em {formatDateTime(r.frozenAt)}</span>
            <span className="text-ink-700"> · snapshot imutável (hash <code className="text-xs">{r.snapshotHash?.slice(0, 12)}…</code>); o ERP não altera esta revisão.</span>
          </CompactNotice>
        )}
        {r.status === 'draft' && map.issues.length > 0 && <IssuesBar issues={map.issues.map((i) => i.message)} />}
        {anyError && (
          <Alert tone="error" title={anyError.message}>
            {Array.isArray(anyError.details) && (
              <ul className="mt-1 list-disc pl-5">{(anyError.details as { message: string }[]).map((d) => <li key={d.message}>{d.message}</li>)}</ul>
            )}
            {anyError.correlationId && <span className="text-xs">Protocolo: {anyError.correlationId}</span>}
          </Alert>
        )}
      </div>

      <KpiStrip
        className="mb-3"
        items={[
          { label: 'Total orçado', value: formatBRL(map.budgetTotal), hint: `${detail.items.length} insumos` },
          { label: 'Verba disponível (orçado − utilizado ± ajustes)', value: formatBRL(map.available) },
          {
            label: 'Menor proposta completa',
            value: lowest ? formatBRL(lowest.total) : '—',
            hint: lowestSupplier ? `${lowestSupplier.tradeName || lowestSupplier.legalName} · ${formatPercent(lowest!.resultRatio, 1)}` : 'nenhuma completa',
            tone: lowest ? (lowest.result.isNegative() ? 'error' : 'success') : undefined,
          },
          {
            label: 'Melhor condição por item',
            value: formatBRL(map.mixTotal),
            hint: `resultado ${formatBRL(map.mixComparison.result)}`,
            tone: budgetTone[map.mixComparison.status],
          },
          {
            label: 'Vencedora indicada',
            emphasis: !!winner,
            value: winner ? formatBRL(winner.summary.total) : '—',
            hint: winner
              ? `${detail.suppliers.find((s) => s.id === winner.summary.competitionSupplierId)?.tradeName ?? ''} · ${formatPercent(winner.comparison.resultRatio, 1)}`
              : 'não definida',
            tone: winner ? budgetTone[winner.comparison.status] : undefined,
          },
        ]}
      />

      <div className="mb-3">
        <Tabs<TabKey>
          sticky
          value={tab}
          onChange={setTab}
          items={[
            { key: 'mapa', label: 'Mapa de cotação', icon: <Table2 className="size-4" /> },
            {
              key: 'vinculos',
              label: 'Vínculos e insumos',
              icon: <Link2 className="size-4" />,
              count: detail.items.filter((i) => {
                const b = map.linkBalance.get(i.id)
                return !b || b.count === 0 || !b.diff.isZero()
              }).length || undefined,
            },
            { key: 'dados', label: 'Dados do QC', icon: <ClipboardList className="size-4" /> },
            { key: 'escopo', label: 'Escopo e distribuição', icon: <ClipboardList className="size-4" /> },
            { key: 'fornecedores', label: 'Fornecedores e condições', icon: <Users className="size-4" />, count: detail.suppliers.length },
            { key: 'aprovacoes', label: 'Aprovações', icon: <ShieldCheck className="size-4" /> },
            { key: 'historico', label: 'Histórico', icon: <History className="size-4" /> },
          ]}
        />
      </div>

      {tab === 'mapa' && (
        <QcGrid
          detail={detail}
          map={map}
          today={today()}
          onPrice={(competitionSupplierId, itemId, unitPrice) => m.upsertPrices.mutate({ prices: [{ competitionSupplierId, itemId, unitPrice }] })}
          onQuantity={(itemId, quantity) => m.updateItem.mutate({ itemId, quantity })}
        />
      )}
      {tab === 'vinculos' && (
        <LinksPanel
          detail={detail}
          map={map}
          saving={m.setLinks.isPending || m.removeItem.isPending || m.updateItem.isPending}
          adding={m.addLines.isPending}
          onSave={(itemId, links) => m.setLinks.mutate({ itemId, links })}
          onAddLines={(selection) => m.addLines.mutateAsync(selection)}
          onRemoveItem={(itemId) => m.removeItem.mutate(itemId)}
          onItemQuantity={(itemId, quantity) => m.updateItem.mutate({ itemId, quantity })}
        />
      )}
      {tab === 'dados' && <RevisionForm detail={detail} map={map} saving={m.updateRevision.isPending} onSave={(v) => m.updateRevision.mutate(v)} />}
      {tab === 'escopo' && <ScopePanel detail={detail} map={map} onUpdate={(itemId, patch) => m.updateItem.mutate({ itemId, ...patch })} />}
      {tab === 'fornecedores' && (
        <SuppliersPanel
          detail={detail}
          map={map}
          today={today()}
          onAdd={(sid) => m.addSupplier.mutateAsync(sid)}
          onUpdate={(sid, patch) => m.updateSupplier.mutate({ id: sid, ...patch })}
          onRemove={(sid) => m.removeSupplier.mutateAsync(sid)}
        />
      )}
      {tab === 'aprovacoes' && <ApprovalsPanel detail={detail} deciding={m.decide.isPending} onDecide={(d) => m.decide.mutate(d)} />}
      {tab === 'historico' && <AuditPanel detail={detail} />}

      <ConfirmDialog
        open={confirmSubmit}
        title="Enviar para aprovação?"
        description="A revisão fica bloqueada para edição enquanto estiver em aprovação. As etapas são definidas pela alçada do valor."
        confirmLabel="Enviar"
        loading={m.submit.isPending}
        onCancel={() => setConfirmSubmit(false)}
        onConfirm={async () => {
          try {
            await m.submit.mutateAsync()
            setTab('aprovacoes')
          } finally {
            setConfirmSubmit(false)
          }
        }}
      >
        {map.issues.length > 0 && (
          <Alert tone="warning" title="Há pendências">
            O envio será recusado até que sejam resolvidas.
          </Alert>
        )}
      </ConfirmDialog>

      <Dialog
        open={revisionDialog}
        onClose={() => setRevisionDialog(false)}
        title="Nova revisão"
        description={`A ${formatRevision(detail.revisions.length)} será criada a partir da última revisão aprovada/reprovada, com itens, fornecedores e preços copiados. A revisão anterior permanece congelada.`}
        footer={
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => setRevisionDialog(false)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={reason.trim().length < 5}
              loading={newRevision.isPending}
              onClick={async () => {
                const { revisionId } = await newRevision.mutateAsync(reason.trim())
                setRevisionDialog(false)
                setReason('')
                setParams((p) => (p.set('rev', revisionId), p.set('aba', 'mapa'), p))
              }}
            >
              Criar revisão
            </Button>
          </>
        }
      >
        <Field label="Motivo da revisão" required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  )
}

/** Aviso de uma linha (substitui alertas altos no topo do QC). */
function CompactNotice({ tone, icon, children }: { tone: 'success' | 'warning'; icon: ReactNode; children: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2 overflow-hidden rounded-card border px-3 py-1.5 text-sm', toneClasses[tone], tone === 'success' ? 'border-success/30' : 'border-warning/30')}>
      <span className="shrink-0">{icon}</span>
      <p className="min-w-0 truncate">{children}</p>
    </div>
  )
}

/** Pendências para envio: uma linha resumida, expansível para a lista completa. */
function IssuesBar({ issues }: { issues: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('min-w-0 overflow-hidden rounded-card border border-warning/30 text-sm', toneClasses.warning)}>
      <button type="button" className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <span className="shrink-0 font-semibold">{issues.length} pendência(s) para envio à aprovação</span>
        {!open && <span className="min-w-0 truncate text-ink-700">· {issues.join(' · ')}</span>}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium">
          {open ? 'Recolher' : 'Ver todas'}
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
        </span>
      </button>
      {open && (
        <ul className="list-disc border-t border-warning/20 py-2 pr-3 pl-10 text-ink-700">
          {issues.map((i) => <li key={i}>{i}</li>)}
        </ul>
      )}
    </div>
  )
}
