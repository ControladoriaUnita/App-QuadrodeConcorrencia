/**
 * Aba "Solicitação de contrato" do QC: a solicitação nasce antes da aprovação do quadro.
 *  - Sem solicitação: botão para gerar (precisa de vencedora ou cotação escolhida, tipo de contrato e
 *    datas na aba Dados); ao enviar o QC para aprovação ela é gerada automaticamente.
 *  - Em rascunho: dados, itens e "Atualizar pelo mapa". "Enviar e concluir" só depois do QC aprovado.
 *  - Vínculos de planejamento (IP · Qtd) editáveis pelo Planejamento, também depois do envio.
 *  - O QC é enviado para aprovação daqui (botão "Enviar QC para aprovação"), não do cabeçalho do QC.
 *  - Itens do contrato em destaque, antes dos dados; os blocos de dados podem ser ocultados
 *    ("Ocultar campos" ou por bloco), e a escolha fica lembrada neste navegador.
 *  - Aditivos e distratos continuam na tela de Contratos.
 * Com cotação escolhida há uma solicitação por empresa (seletor no topo).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Ban, Eye, EyeOff, FileSignature, FileStack, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import { Decimal } from '@shared/domain/decimal'
import { Alert, Badge, Button, Card, CardBody, ConfirmDialog, Dialog, EmptyState, Field, KpiStrip, SegmentedControl, Skeleton, Textarea, toneClasses } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { cn } from '@/utils/cn'
import { formatBRL, formatDateTime, formatPercent } from '@/utils/format'
import { useContract, useContractMutations, useContracts, useCreateContract } from './api'
import { CONTRACT_FORM_SECTIONS, ContractForm, type ContractFormSection } from './ContractForm'
import { ContractItemsTable } from './ContractItemsTable'
import { contractStatus } from './status'

const HIDDEN_KEY = 'qc.solicitacao.ocultos'
function readHidden(): Set<ContractFormSection> {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as ContractFormSection[]
    return new Set(v.filter((k) => CONTRACT_FORM_SECTIONS.includes(k)))
  } catch {
    return new Set()
  }
}
function saveHidden(v: Set<ContractFormSection>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...v]))
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}

/** Envio do QC para aprovação, feito na aba da solicitação */
export interface QcSubmitAction {
  can: boolean
  pending: boolean
  /** Pendências do mapa (o envio é recusado enquanto houver) */
  issues: number
  onSubmit: () => void
}

export function ContractRequestPanel({ competitionId, workId, canCreate, qcSubmit }: { competitionId: string; workId: string; canCreate: boolean; qcSubmit?: QcSubmitAction }) {
  const list = useContracts({ competitionId })
  const create = useCreateContract()
  const active = (list.data ?? []).filter((x) => x.status !== 'cancelled').sort((a, b) => a.code.localeCompare(b.code))
  const [picked, setPicked] = useState<string | null>(null)
  const selected = active.find((x) => x.id === picked) ?? active[0]

  if (list.isLoading) return <Skeleton className="h-64" />

  return (
    <div className="grid gap-3">
      {qcSubmit?.can && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-primary/30 bg-primary-soft/40 px-4 py-2.5">
          <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-ink-700">
            <span className="font-semibold text-text">Mapa montado? Envie o QC para aprovação por aqui.</span>{' '}
            {active.length
              ? 'Os itens da solicitação são atualizados pelo mapa no envio.'
              : 'Se ainda não houver solicitação, ela é gerada no envio.'}
            {qcSubmit.issues > 0 && <span className="text-warning"> · {qcSubmit.issues} pendência(s) no QC</span>}
          </p>
          <Button variant="primary" icon={<Send className="size-4" />} loading={qcSubmit.pending} onClick={qcSubmit.onSubmit}>
            Enviar QC para aprovação
          </Button>
        </div>
      )}
      {(canCreate || active.length > 1) && (
        <div className="flex flex-wrap items-center gap-2">
          {active.length > 1 && (
            <SegmentedControl
              label="Solicitação"
              value={selected?.id ?? ''}
              onChange={setPicked}
              items={active.map((x) => ({ key: x.id, label: `${x.code} · ${x.supplierName}` }))}
            />
          )}
          {canCreate && active.length > 0 && (
            <Button className="ml-auto" icon={<FileSignature className="size-4" />} loading={create.isPending} onClick={() => create.mutate(competitionId)}>
              Gerar solicitação das empresas que faltam
            </Button>
          )}
        </div>
      )}
      {create.error && <Alert tone="error">{(create.error as Error).message}</Alert>}

      {selected ? (
        <ContractRequestView key={selected.id} id={selected.id} workId={workId} />
      ) : (
        <Card>
          <EmptyState
            title="Ainda sem solicitação de contrato"
            description="A solicitação nasce antes da aprovação do quadro: gere agora ou ela será gerada automaticamente ao enviar o QC para aprovação. Precisa da empresa vencedora (ou da cotação escolhida no mapa), do tipo de contrato e das datas do serviço na aba Dados."
            action={
              canCreate ? (
                <Button variant="primary" icon={<FileSignature className="size-4" />} loading={create.isPending} onClick={() => create.mutate(competitionId)}>
                  Gerar solicitação de contrato
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}
    </div>
  )
}

function ContractRequestView({ id, workId }: { id: string; workId: string }) {
  const q = useContract(id)
  const m = useContractMutations(id)
  const [dialog, setDialog] = useState<'submit' | 'cancel' | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [hidden, setHidden] = useState<Set<ContractFormSection>>(readHidden)
  const update = (next: Set<ContractFormSection>) => {
    setHidden(next)
    saveHidden(next)
  }
  const toggleSection = (k: ContractFormSection) => {
    const next = new Set(hidden)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    update(next)
  }
  const allHidden = CONTRACT_FORM_SECTIONS.every((k) => hidden.has(k))
  const anyError = [m.update, m.updateItem, m.setAllocations, m.sync, m.submit, m.cancel].map((x) => x.error).find(Boolean) as ApiError | undefined

  if (q.error) return <Alert tone="error" title="Não foi possível carregar a solicitação">{(q.error as Error).message}</Alert>
  const c = q.data
  if (!c) return <Skeleton className="h-96" />

  const st = contractStatus[c.status]
  const result = Decimal.from(c.availableAmount).minus(c.totalAmount)
  const close = () => setDialog(null)
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } finally {
      close()
    }
  }

  return (
    <div className="grid gap-3">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-semibold text-text">{c.code}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
            {!c.qcApproved && c.status === 'draft' && <Badge tone="warning">QC ainda não aprovado</Badge>}
            <span className="text-sm text-text-muted">
              Contratado <span className="font-medium text-ink-700">{c.supplier.tradeName || c.supplier.legalName}</span>
              {c.submittedAt && <> · concluída em {formatDateTime(c.submittedAt)}{c.submittedByName && ` por ${c.submittedByName}`}</>}
            </span>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={allHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />} aria-pressed={allHidden} onClick={() => update(allHidden ? new Set() : new Set(CONTRACT_FORM_SECTIONS))}>
              {allHidden ? 'Mostrar campos' : 'Ocultar campos'}
            </Button>
            {c.status !== 'draft' && c.status !== 'cancelled' && (
              <Link to={`/obras/${workId}/contratos/${c.id}?aba=aditivos`}>
                <Button size="sm" icon={<FileStack className="size-4" />}>Aditivos e distratos</Button>
              </Link>
            )}
            {c.can.sync && (
              <Button size="sm" icon={<RefreshCw className="size-4" />} loading={m.sync.isPending} title="Refaz os itens pelo mapa do QC (mantém especificação, % retenção e vínculos editados de itens que não mudaram)" onClick={() => m.sync.mutate()}>
                Atualizar pelo mapa
              </Button>
            )}
            {c.can.cancel && (
              <Button size="sm" variant="ghost" icon={<Ban className="size-4" />} onClick={() => setDialog('cancel')}>
                Cancelar solicitação
              </Button>
            )}
            {c.status === 'draft' && c.can.manage && (
              <Button
                size="sm"
                variant="primary"
                icon={<Send className="size-4" />}
                disabled={!c.can.submit}
                title={c.can.submit ? undefined : 'O contrato só é concluído depois da aprovação do QC'}
                onClick={() => setDialog('submit')}
              >
                Enviar e concluir
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {c.status === 'draft' && c.issues.length > 0 && (
        <div className={cn('flex min-w-0 items-center gap-2 overflow-hidden rounded-card border border-warning/30 px-3 py-1.5 text-sm', toneClasses.warning)}>
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="shrink-0 font-semibold">{c.issues.length} pendência(s) para envio</span>
          <span className="min-w-0 truncate text-ink-700" title={c.issues.map((i) => i.message).join('\n')}>· {c.issues.map((i) => i.message).join(' · ')}</span>
        </div>
      )}
      {c.status !== 'draft' && c.status !== 'cancelled' && (
        <p className="text-xs text-text-muted">
          Contrato concluído: dados e itens bloqueados. Alterações de quantidade, preço ou prazo seguem por aditivo.
          {c.can.planning && ' Os vínculos de planejamento continuam editáveis.'}
        </p>
      )}
      {anyError && (
        <Alert tone="error" title={anyError.message}>
          {Array.isArray(anyError.details) && (
            <ul className="mt-1 list-disc pl-5">{(anyError.details as { message: string }[]).map((d) => <li key={d.message}>{d.message}</li>)}</ul>
          )}
        </Alert>
      )}

      <KpiStrip
        items={[
          { label: 'Total a contratar', value: formatBRL(c.totalAmount), hint: `${c.items.length} itens` },
          { label: 'Verba disponível (QC)', value: formatBRL(c.availableAmount), hint: `orçado ${formatBRL(c.budgetAmount)}` },
          {
            label: 'Resultado (verba − contrato)',
            value: formatBRL(result),
            hint: Decimal.from(c.budgetAmount).isZero() ? undefined : formatPercent(result.div(c.budgetAmount, 6), 1),
            tone: result.isNegative() ? 'error' : 'success',
          },
          { label: 'Distribuição', value: `Mat. ${formatPercent(Decimal.from(c.pctMaterial), 1)}`, hint: `Equip. ${formatPercent(Decimal.from(c.pctEquipment), 1)} · Serv. ${formatPercent(Decimal.from(c.pctService), 1)}` },
        ]}
      />

      {/* Linhas do contrato em destaque; os dados da solicitação vêm depois e podem ser ocultados */}
      <ContractItemsTable
        c={c}
        onUpdate={(itemId, patch) => m.updateItem.mutate({ itemId, ...patch })}
        onAllocations={(itemId, allocations) => m.setAllocations.mutateAsync({ itemId, allocations })}
      />
      <ContractForm c={c} saving={m.update.isPending} onSave={(v) => m.update.mutate(v)} hidden={hidden} onToggle={toggleSection} />

      <ConfirmDialog
        open={dialog === 'submit'}
        title="Enviar e concluir o contrato?"
        description="O contrato passa a “Concluído”: dados e itens ficam bloqueados e a concorrência passa a “Contratada”. Mudanças posteriores seguem por aditivo, na tela de Contratos."
        confirmLabel="Enviar e concluir"
        loading={m.submit.isPending}
        onCancel={close}
        onConfirm={() => run(() => m.submit.mutateAsync())}
      >
        {c.issues.length > 0 && <Alert tone="warning" title="Há pendências">O envio será recusado até que sejam resolvidas.</Alert>}
      </ConfirmDialog>

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
    </div>
  )
}
