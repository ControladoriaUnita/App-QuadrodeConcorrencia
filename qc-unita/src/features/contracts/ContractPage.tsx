/**
 * Solicitação de Contrato: formulário (seções da planilha), itens com vínculos e aditivos.
 *   rascunho → enviada a Contratos → no ERP → assinado   (cancelável até ir ao ERP)
 */
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Ban, ClipboardList, FileSignature, FileStack, Send, Server, Table2 } from 'lucide-react'
import { Decimal } from '@shared/domain/decimal'
import { currentEndOn } from '@shared/domain/contract/contract-request'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, ConfirmDialog, Dialog, Field, Input, KpiStrip, Skeleton, Tabs, Textarea, toneClasses } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { cn } from '@/utils/cn'
import { formatBRL, formatDate, formatDateTime, formatPercent, formatRevision } from '@/utils/format'
import { AddendaPanel } from './AddendaPanel'
import { useContract, useContractMutations } from './api'
import { ContractForm } from './ContractForm'
import { ContractItemsTable } from './ContractItemsTable'
import { contractStatus } from './status'

type TabKey = 'solicitacao' | 'itens' | 'aditivos'

export function ContractPage() {
  const { id = '', workId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('aba') as TabKey) ?? 'solicitacao'
  const setTab = (k: TabKey) => setParams((p) => (p.set('aba', k), p), { replace: true })
  const q = useContract(id)
  const m = useContractMutations(id)
  const [dialog, setDialog] = useState<'submit' | 'cancel' | 'sign' | 'erp' | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [signedOn, setSignedOn] = useState(new Date().toISOString().slice(0, 10))
  const [erpId, setErpId] = useState('')

  const anyError = Object.values(m).map((x) => x.error).find(Boolean) as ApiError | undefined

  if (q.error) return <Alert tone="error" title="Não foi possível carregar a solicitação">{(q.error as Error).message}</Alert>
  const c = q.data
  if (!c) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16 w-1/2" />
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const st = contractStatus[c.status]
  const approved = c.addenda.filter((a) => a.status === 'approved')
  const addendaTotal = Decimal.sum(approved.map((a) => a.totalDelta))
  const newTotal = Decimal.from(c.totalAmount).plus(addendaTotal)
  const result = Decimal.from(c.availableAmount).minus(newTotal)
  const pendingAddenda = c.addenda.filter((a) => a.status === 'submitted').length
  const close = () => setDialog(null)
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } finally {
      close()
    }
  }

  return (
    <div>
      <PageHeader
        backTo={`/obras/${workId || c.work.id}?aba=contratos`}
        eyebrow={`Obra ${c.work.code} · ${c.work.name}`}
        title={`${c.code} — ${c.competition.title}`}
        meta={
          <>
            <Badge tone={st.tone}>{st.label}</Badge>
            {c.erpContractId && <Badge tone="info" icon={<Server className="size-3" />}>ERP {c.erpContractId}</Badge>}
          </>
        }
        description={
          <span>
            Contratado <span className="font-medium text-ink-700">{c.supplier.tradeName || c.supplier.legalName}</span> · {c.contractType.code} — {c.contractType.name} · origem{' '}
            <Link className="font-medium text-primary hover:underline" to={`/obras/${c.work.id}/qc/${c.competition.id}?rev=${c.revision.id}`}>
              {c.competition.code} {formatRevision(c.revision.number)}
            </Link>
            {c.submittedAt && <> · enviada em {formatDateTime(c.submittedAt)}{c.submittedByName && ` por ${c.submittedByName}`}</>}
            {c.signedOn && <> · assinado em {formatDate(c.signedOn)}</>}
          </span>
        }
        actions={
          <>
            {c.can.cancel && (
              <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => setDialog('cancel')}>
                Cancelar solicitação
              </Button>
            )}
            {c.can.sign && (
              <Button icon={<FileSignature className="size-4" />} onClick={() => (setErpId(c.erpContractId ?? ''), setDialog('sign'))}>
                Registrar assinatura
              </Button>
            )}
            {c.can.pushToErp && (
              <Button variant="primary" icon={<Server className="size-4" />} onClick={() => setDialog('erp')}>
                Enviar ao ERP
              </Button>
            )}
            {c.can.submit && (
              <Button variant="primary" icon={<Send className="size-4" />} onClick={() => setDialog('submit')}>
                Enviar a Contratos
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 grid gap-2">
        {c.status === 'cancelled' && (
          <Alert tone="warning" title="Solicitação cancelada">{c.cancelReason}</Alert>
        )}
        {c.status === 'draft' && c.issues.length > 0 && (
          <div className={cn('flex min-w-0 items-center gap-2 overflow-hidden rounded-card border border-warning/30 px-3 py-1.5 text-sm', toneClasses.warning)}>
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span className="shrink-0 font-semibold">{c.issues.length} pendência(s) para envio</span>
            <span className="min-w-0 truncate text-ink-700" title={c.issues.map((i) => i.message).join('\n')}>· {c.issues.map((i) => i.message).join(' · ')}</span>
          </div>
        )}
        {c.status !== 'draft' && c.status !== 'cancelled' && (
          <p className="text-xs text-text-muted">Solicitação enviada: dados e itens bloqueados. Alterações de quantidade, preço ou prazo seguem por aditivo.</p>
        )}
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
          { label: 'Total a contratar', value: formatBRL(c.totalAmount), hint: `${c.items.length} itens` },
          { label: 'Aditivos aprovados', value: formatBRL(addendaTotal), hint: `${approved.length} de ${c.addenda.length}` },
          { label: 'Novo total do contrato', value: formatBRL(newTotal), emphasis: !addendaTotal.isZero() },
          { label: 'Verba disponível (QC)', value: formatBRL(c.availableAmount), hint: `orçado ${formatBRL(c.budgetAmount)}` },
          {
            label: 'Resultado (verba − contrato)',
            value: formatBRL(result),
            hint: Decimal.from(c.budgetAmount).isZero() ? undefined : formatPercent(result.div(c.budgetAmount, 6), 1),
            tone: result.isNegative() ? 'error' : 'success',
          },
        ]}
      />

      <div className="mb-3">
        <Tabs<TabKey>
          sticky
          value={tab}
          onChange={setTab}
          items={[
            { key: 'solicitacao', label: 'Solicitação', icon: <ClipboardList className="size-4" /> },
            { key: 'itens', label: 'Itens e vínculos', icon: <Table2 className="size-4" />, count: c.items.length },
            { key: 'aditivos', label: 'Aditivos', icon: <FileStack className="size-4" />, count: pendingAddenda || c.addenda.length || undefined },
          ]}
          trailing={<span className="text-xs text-text-muted">Vigência {formatDate(c.startOn)} → {formatDate(currentEndOn(c.endOn, approved))}</span>}
        />
      </div>

      {tab === 'solicitacao' && <ContractForm c={c} saving={m.update.isPending} onSave={(v) => m.update.mutate(v)} />}
      {tab === 'itens' && <ContractItemsTable c={c} onUpdate={(itemId, patch) => m.updateItem.mutate({ itemId, ...patch })} />}
      {tab === 'aditivos' && (
        <AddendaPanel
          c={c}
          busy={m.createAddendum.isPending || m.saveAddendum.isPending || m.submitAddendum.isPending || m.decideAddendum.isPending || m.deleteAddendum.isPending}
          onCreate={(b) => m.createAddendum.mutateAsync(b)}
          onSave={(addendumId, b) => m.saveAddendum.mutateAsync({ addendumId, ...b })}
          onDelete={(addendumId) => m.deleteAddendum.mutate(addendumId)}
          onSubmit={(addendumId) => m.submitAddendum.mutate(addendumId)}
          onDecide={(addendumId, decision, comment) => m.decideAddendum.mutate({ addendumId, decision, comment })}
        />
      )}

      <ConfirmDialog
        open={dialog === 'submit'}
        title="Enviar a solicitação a Contratos?"
        description="Os dados e itens ficam bloqueados; a concorrência passa a “Contratada”. Mudanças posteriores seguem por aditivo."
        confirmLabel="Enviar"
        loading={m.submit.isPending}
        onCancel={close}
        onConfirm={() => run(() => m.submit.mutateAsync())}
      >
        {c.issues.length > 0 && <Alert tone="warning" title="Há pendências">O envio será recusado até que sejam resolvidas.</Alert>}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'erp'}
        title="Enviar o contrato ao ERP?"
        description={`Cria o contrato no ERP com ${c.items.length} item(ns) e registra o log de integração. Obra ${c.work.erpId ?? 'sem código ERP'} · fornecedor ${c.supplier.erpId ?? 'sem código ERP'}.`}
        confirmLabel="Enviar ao ERP"
        loading={m.pushToErp.isPending}
        onCancel={close}
        onConfirm={() => run(() => m.pushToErp.mutateAsync())}
      />

      <Dialog
        open={dialog === 'cancel'}
        onClose={close}
        title="Cancelar a solicitação"
        description={c.status === 'submitted' ? 'A concorrência volta ao status da revisão corrente e poderá gerar nova solicitação.' : 'O rascunho será mantido como cancelado no histórico.'}
        footer={
          <>
            <Button variant="ghost" className="mr-auto" onClick={close}>Voltar</Button>
            <Button variant="danger" disabled={cancelReason.trim().length < 5} loading={m.cancel.isPending} onClick={() => run(() => m.cancel.mutateAsync(cancelReason.trim()))}>
              Cancelar solicitação
            </Button>
          </>
        }
      >
        <Field label="Motivo" required>
          <Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        </Field>
      </Dialog>

      <Dialog
        open={dialog === 'sign'}
        onClose={close}
        title="Registrar assinatura do contrato"
        footer={
          <>
            <Button variant="ghost" className="mr-auto" onClick={close}>Voltar</Button>
            <Button variant="primary" disabled={!signedOn} loading={m.sign.isPending} onClick={() => run(() => m.sign.mutateAsync({ signedOn, erpContractId: erpId.trim() || undefined }))}>
              Registrar
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="Data da assinatura" required>
            <Input type="date" value={signedOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setSignedOn(e.target.value)} />
          </Field>
          <Field label="Nº do contrato no ERP (UAU)" hint={c.erpContractId ? 'Preenchido pelo envio ao ERP.' : 'Opcional quando o contrato foi lançado manualmente.'}>
            <Input value={erpId} disabled={!!c.erpContractId} onChange={(e) => setErpId(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </div>
  )
}
