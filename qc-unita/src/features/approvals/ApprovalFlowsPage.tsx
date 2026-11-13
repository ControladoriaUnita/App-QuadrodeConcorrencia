/**
 * Fluxos de aprovação e diretores aprovadores. Todos consultam; o administrador cadastra.
 *
 * Cada fluxo vale para um tipo de solicitação (contratação, desvio, aditivo/distrato, prazo) e para
 * os critérios do pedido (origem, tipo, diretor; vazio = qualquer). O mais específico vence. As
 * etapas têm papel, alçada mínima e podem ser a etapa do diretor responsável do pedido.
 */
import { useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ApprovalConfigDTO, ApprovalDirectorDTO, ApprovalFlowDTO, ApprovalFlowKind, RequestKind, RequestOrigin, SaveApprovalFlowInput } from '@shared/contracts'
import { saveApprovalFlowSchema } from '@shared/contracts'
import { FLOW_KIND_LABEL, REQUEST_KIND_LABEL, REQUEST_ORIGIN_LABEL } from '@shared/domain/approval/flows'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, DecimalInput, Dialog, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { cn } from '@/utils/cn'
import { formatBRL } from '@/utils/format'
import { useApprovalConfig, useApprovalConfigMutations } from './api'

const KINDS: ApprovalFlowKind[] = ['competition', 'deviation', 'addendum', 'deadline']
const KIND_HINT: Record<ApprovalFlowKind, string> = {
  competition: 'Envio do QC para aprovação. Escolhido pela origem, pelo tipo e pelo diretor do pedido.',
  deviation: 'Entra no fim do fluxo da contratação quando alguma linha do mapa tem desvio de preço ou de quantidade.',
  addendum: 'Aditivos (inclusive com remanejamento) e distratos, na tela de Contratos.',
  deadline: 'Aditivo só de prazo (sem itens, com nova data de término).',
}

export function ApprovalFlowsPage() {
  const config = useApprovalConfig()
  const m = useApprovalConfigMutations()
  const [editing, setEditing] = useState<ApprovalFlowDTO | { kind: ApprovalFlowKind } | null>(null)
  const [removing, setRemoving] = useState<ApprovalFlowDTO | null>(null)
  const [director, setDirector] = useState<ApprovalDirectorDTO | 'new' | null>(null)
  const data = config.data
  const manage = !!data?.canManage
  const directorName = (id: string | null) => (id ? (data?.directors.find((d) => d.id === id)?.code ?? '—') : null)

  return (
    <div>
      <PageHeader
        title="Fluxos de aprovação"
        description="Quem aprova cada tipo de solicitação. O fluxo da contratação é escolhido pelo pedido do QC (tipo, origem e diretor); o mais específico vence. Etapas de desvio entram sozinhas quando o mapa tem desvio."
      />
      {config.error && <Alert tone="error" title={(config.error as Error).message} />}
      {!data ? (
        <div className="grid gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : (
        <div className="grid gap-3">
          {!manage && <Alert tone="info">Somente consulta. O administrador cadastra fluxos e diretores.</Alert>}

          <Card>
            <CardHeader
              title="Diretores aprovadores"
              description="Escolhidos pelo solicitante na criação do QC (não ficam presos às obras). Com usuário ligado, só ele decide as etapas de diretor; sem usuário, qualquer pessoa com o papel da etapa."
              actions={manage && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setDirector('new')}>Novo diretor</Button>}
            />
            <ul className="divide-y divide-border text-sm">
              {data.directors.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <Badge tone="info">{d.code}</Badge>
                  <span className="font-medium">{d.name}</span>
                  <span className="text-xs text-text-muted">{d.userName ? `Usuário: ${d.userName}` : 'Sem usuário ligado'}</span>
                  {!d.active && <Badge tone="neutral">inativo</Badge>}
                  {manage && (
                    <Button size="sm" variant="ghost" className="ml-auto" icon={<Pencil className="size-4" />} aria-label={`Editar diretor ${d.code}`} onClick={() => setDirector(d)}>
                      Editar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {KINDS.map((kind) => {
            const flows = data.flows.filter((f) => f.kind === kind)
            return (
              <Card key={kind}>
                <CardHeader
                  title={FLOW_KIND_LABEL[kind]}
                  description={KIND_HINT[kind]}
                  actions={manage && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing({ kind })}>Novo fluxo</Button>}
                />
                {flows.length === 0 ? (
                  <EmptyState title="Nenhum fluxo" description={kind === 'competition' ? 'Sem fluxo, valem as etapas gerais de aprovação.' : 'Sem fluxo, vale a regra anterior.'} />
                ) : (
                  <ul className="divide-y divide-border">
                    {flows.map((f) => (
                      <li key={f.id} className="grid gap-1.5 px-4 py-3" aria-label={`Fluxo ${f.name}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{f.name}</span>
                          {!f.active && <Badge tone="neutral">inativo</Badge>}
                          <Badge tone="neutral">Origem: {f.origin ? REQUEST_ORIGIN_LABEL[f.origin] : 'qualquer'}</Badge>
                          <Badge tone="neutral">Tipo: {f.requestKind ? REQUEST_KIND_LABEL[f.requestKind] : 'qualquer'}</Badge>
                          <Badge tone="neutral">Diretor: {directorName(f.directorId) ?? 'qualquer'}</Badge>
                          {manage && (
                            <span className="ml-auto flex gap-1">
                              <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} aria-label={`Editar ${f.name}`} onClick={() => setEditing(f)}>Editar</Button>
                              <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} aria-label={`Excluir ${f.name}`} onClick={() => setRemoving(f)} />
                            </span>
                          )}
                        </div>
                        <ol className="flex flex-wrap items-center gap-1.5 text-sm">
                          {f.steps.map((s, k) => (
                            <li key={s.stepOrder} className={cn('flex items-center gap-1.5', !s.active && 'opacity-50')}>
                              {k > 0 && <span className="text-text-muted">→</span>}
                              <span className="rounded-control bg-ink-50 px-2 py-0.5">
                                {s.name}
                                <span className="text-xs text-text-muted">
                                  {' · '}
                                  {s.director ? 'diretor do pedido' : s.roleName}
                                  {s.minAmount && ` · a partir de ${formatBRL(s.minAmount)}`}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ol>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {editing && data && (
        <FlowDialog
          config={data}
          flow={'id' in editing ? editing : null}
          kind={editing.kind}
          saving={m.saveFlow.isPending}
          error={(m.saveFlow.error as ApiError | null) ?? null}
          onClose={() => (m.saveFlow.reset(), setEditing(null))}
          onSave={async (input, id) => {
            await m.saveFlow.mutateAsync({ ...input, id })
            setEditing(null)
          }}
        />
      )}
      {director && data && (
        <DirectorDialog
          config={data}
          director={director === 'new' ? null : director}
          saving={m.saveDirector.isPending}
          error={(m.saveDirector.error as ApiError | null) ?? null}
          onClose={() => (m.saveDirector.reset(), setDirector(null))}
          onSave={async (input) => {
            await m.saveDirector.mutateAsync({ ...input, id: director === 'new' ? null : director.id })
            setDirector(null)
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        tone="danger"
        title={removing ? `Excluir o fluxo "${removing.name}"?` : ''}
        description="Planos já enviados não mudam. Os próximos envios usam os fluxos que sobrarem."
        confirmLabel="Excluir"
        loading={m.deleteFlow.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await m.deleteFlow.mutateAsync(removing.id)
          setRemoving(null)
        }}
      />
    </div>
  )
}

type StepDraft = SaveApprovalFlowInput['steps'][number]

function FlowDialog({ config, flow, kind, saving, error, onClose, onSave }: {
  config: ApprovalConfigDTO
  flow: ApprovalFlowDTO | null
  kind: ApprovalFlowKind
  saving: boolean
  error: ApiError | null
  onClose: () => void
  onSave: (input: SaveApprovalFlowInput, id: string | null) => Promise<void>
}) {
  const [name, setName] = useState(flow?.name ?? '')
  const [origin, setOrigin] = useState<RequestOrigin | ''>(flow?.origin ?? '')
  const [requestKind, setRequestKind] = useState<RequestKind | ''>(flow?.requestKind ?? '')
  const [directorId, setDirectorId] = useState(flow?.directorId ?? '')
  const [active, setActive] = useState(flow?.active ?? true)
  const [steps, setSteps] = useState<StepDraft[]>(
    flow?.steps.map((s) => ({ name: s.name, roleId: s.roleId, director: s.director, minAmount: s.minAmount, active: s.active })) ?? [],
  )
  const [touched, setTouched] = useState(false)
  const input = { kind, name, origin: origin || null, requestKind: requestKind || null, directorId: directorId || null, active, steps }
  const parsed = saveApprovalFlowSchema.safeParse(input)
  const directorRole = config.roles.find((r) => r.key === 'director')?.id ?? config.roles[0]?.id ?? ''
  const set = (k: number, patch: Partial<StepDraft>) => setSteps((s) => s.map((x, i) => (i === k ? { ...x, ...patch } : x)))
  const move = (k: number, d: -1 | 1) =>
    setSteps((s) => {
      const out = [...s]
      ;[out[k], out[k + d]] = [out[k + d]!, out[k]!]
      return out
    })

  return (
    <Dialog
      open
      onClose={onClose}
      width="min(96vw, 56rem)"
      title={flow ? `Editar fluxo — ${FLOW_KIND_LABEL[kind]}` : `Novo fluxo — ${FLOW_KIND_LABEL[kind]}`}
      description="Deixe um critério em branco para valer para qualquer pedido. As etapas são decididas na ordem."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={async () => {
              setTouched(true)
              if (!parsed.success) return
              try {
                await onSave(parsed.data, flow?.id ?? null)
              } catch {
                /* erro da API aparece no topo */
              }
            }}
          >
            Salvar fluxo
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {error && <Alert tone="error" title={error.message} />}
        {touched && !parsed.success && <Alert tone="warning">{parsed.error.issues.map((i) => i.message).join(' · ')}</Alert>}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Nome do fluxo" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Situação">
            <Select value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')}>
              <option value="1">Ativo</option>
              <option value="0">Inativo</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Origem do pedido">
            <Select value={origin} onChange={(e) => setOrigin(e.target.value as RequestOrigin | '')}>
              <option value="">Qualquer</option>
              {(Object.keys(REQUEST_ORIGIN_LABEL) as RequestOrigin[]).map((k) => <option key={k} value={k}>{REQUEST_ORIGIN_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Tipo do pedido">
            <Select value={requestKind} onChange={(e) => setRequestKind(e.target.value as RequestKind | '')}>
              <option value="">Qualquer</option>
              {(Object.keys(REQUEST_KIND_LABEL) as RequestKind[]).map((k) => <option key={k} value={k}>{REQUEST_KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Diretor do pedido">
            <Select value={directorId} onChange={(e) => setDirectorId(e.target.value)}>
              <option value="">Qualquer</option>
              {config.directors.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium text-ink-700">Etapas</p>
          {steps.map((s, k) => (
            <div key={k} className="grid items-end gap-2 rounded-control border border-border p-2 sm:grid-cols-[1.5rem_1fr_12rem_9rem_8rem_auto]">
              <span className="pb-2 text-xs text-text-muted">{k + 1}.</span>
              <Field label="Etapa">
                <Input value={s.name} aria-label={`Nome da etapa ${k + 1}`} onChange={(e) => set(k, { name: e.target.value })} />
              </Field>
              <Field label="Quem decide">
                <Select
                  aria-label={`Quem decide a etapa ${k + 1}`}
                  value={s.director ? `director:${s.roleId}` : s.roleId}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v.startsWith('director:')) set(k, { director: true, roleId: v.slice(9) })
                    else set(k, { director: false, roleId: v })
                  }}
                >
                  <option value={`director:${directorRole}`}>Diretor do pedido</option>
                  {config.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
              <Field label="A partir de (R$)">
                <DecimalInput value={s.minAmount} aria-label={`Alçada da etapa ${k + 1}`} placeholder="qualquer valor" onCommit={(v) => set(k, { minAmount: v })} className="border-border bg-surface" />
              </Field>
              <Field label="Situação">
                <Select value={s.active ? '1' : '0'} onChange={(e) => set(k, { active: e.target.value === '1' })}>
                  <option value="1">Ativa</option>
                  <option value="0">Inativa</option>
                </Select>
              </Field>
              <div className="flex gap-0.5 pb-1">
                <button type="button" className="rounded p-1.5 text-ink-500 hover:bg-ink-100 disabled:opacity-30" disabled={k === 0} aria-label="Subir etapa" onClick={() => move(k, -1)}>
                  <ArrowUp className="size-4" />
                </button>
                <button type="button" className="rounded p-1.5 text-ink-500 hover:bg-ink-100 disabled:opacity-30" disabled={k === steps.length - 1} aria-label="Descer etapa" onClick={() => move(k, 1)}>
                  <ArrowDown className="size-4" />
                </button>
                <button type="button" className="rounded p-1.5 text-ink-500 hover:bg-error-soft hover:text-error" aria-label={`Remover etapa ${k + 1}`} onClick={() => setSteps((x) => x.filter((_, i) => i !== k))}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
          <Button
            size="sm"
            className="justify-self-start"
            icon={<Plus className="size-4" />}
            onClick={() => setSteps((x) => [...x, { name: '', roleId: config.roles.find((r) => r.key === 'manager')?.id ?? config.roles[0]!.id, director: false, minAmount: null, active: true }])}
          >
            Incluir etapa
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function DirectorDialog({ config, director, saving, error, onClose, onSave }: {
  config: ApprovalConfigDTO
  director: ApprovalDirectorDTO | null
  saving: boolean
  error: ApiError | null
  onClose: () => void
  onSave: (input: { code: string; name: string; userId: string | null; active: boolean }) => Promise<void>
}) {
  const [code, setCode] = useState(director?.code ?? '')
  const [name, setName] = useState(director?.name ?? '')
  const [userId, setUserId] = useState(director?.userId ?? '')
  const [active, setActive] = useState(director?.active ?? true)
  const ok = code.trim().length >= 1 && name.trim().length >= 2

  return (
    <Dialog
      open
      onClose={onClose}
      title={director ? `Editar diretor ${director.code}` : 'Novo diretor aprovador'}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={saving} disabled={!ok} onClick={() => onSave({ code: code.trim(), name: name.trim(), userId: userId || null, active }).catch(() => undefined)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {error && <Alert tone="error" title={error.message} />}
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label="Sigla" required>
            <Input value={code} maxLength={10} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="RT" />
          </Field>
          <Field label="Nome" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Usuário que decide" hint="Sem usuário, qualquer pessoa com o papel da etapa decide.">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Sem usuário ligado</option>
            {config.people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </Select>
        </Field>
        <Field label="Situação">
          <Select value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')}>
            <option value="1">Ativo</option>
            <option value="0">Inativo</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  )
}
