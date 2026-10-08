/**
 * Fornecedores participantes e condições comerciais (prazo, pagamento, reajuste, pontos +/−).
 */
import { useState } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import type { CompetitionDetailDTO, QcSupplierDTO, UpdateSupplierTermsInput } from '@shared/contracts'
import type { QcMap } from '@shared/domain/competition/qc-map'
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, Field, Input, Select, Textarea } from '@/components/ui'
import { formatBRL, formatDate, formatTaxId } from '@/utils/format'
import { useSuppliers } from './api'
import { supplierStatus } from './status'

interface Props {
  detail: CompetitionDetailDTO
  map: QcMap
  today: string
  onAdd: (supplierId: string) => Promise<unknown>
  onUpdate: (id: string, patch: UpdateSupplierTermsInput) => void
  onRemove: (id: string) => Promise<unknown>
}

export function SuppliersPanel({ detail, map, today, onAdd, onUpdate, onRemove }: Props) {
  const catalog = useSuppliers()
  const [selected, setSelected] = useState('')
  const [removing, setRemoving] = useState<QcSupplierDTO | null>(null)
  const participating = new Set(detail.suppliers.map((s) => s.supplierId))
  const available = (catalog.data ?? []).filter((s) => !participating.has(s.id))

  return (
    <div className="grid gap-3">
      {detail.can.edit && (
        <Card>
          <CardBody className="flex flex-wrap items-end gap-3">
            <Field label="Convidar fornecedor" className="min-w-72 flex-1">
              <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">Selecione um fornecedor cadastrado…</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.legalName} — {formatTaxId(s.taxId)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              disabled={!selected}
              onClick={async () => {
                await onAdd(selected)
                setSelected('')
              }}
            >
              Adicionar
            </Button>
          </CardBody>
        </Card>
      )}

      {detail.suppliers.length === 0 ? (
        <Card>
          <EmptyState title="Nenhum fornecedor convidado" description="Adicione ao menos três fornecedores para comparar propostas." />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {detail.suppliers.map((s) => (
            <SupplierCard
              key={`${s.id}-${detail.revision.id}`}
              s={s}
              total={map.summaryBySupplier.get(s.id)?.total.toFixed() ?? null}
              rank={map.summaryBySupplier.get(s.id)?.rank ?? null}
              cndExpired={!!s.cndValidUntil && s.cndValidUntil < today}
              editable={detail.can.editPrices}
              removable={detail.can.edit}
              onSave={(patch) => onUpdate(s.id, patch)}
              onRemove={() => setRemoving(s)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!removing}
        title="Remover fornecedor?"
        description={`Os preços lançados por ${removing?.tradeName || removing?.legalName} nesta revisão serão excluídos. A alteração fica registrada na auditoria.`}
        confirmLabel="Remover"
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await onRemove(removing.id)
          setRemoving(null)
        }}
      />
    </div>
  )
}

function SupplierCard({
  s, total, rank, cndExpired, editable, removable, onSave, onRemove,
}: {
  s: QcSupplierDTO
  total: string | null
  rank: number | null
  cndExpired: boolean
  editable: boolean
  removable: boolean
  onSave: (patch: UpdateSupplierTermsInput) => void
  onRemove: () => void
}) {
  const [form, setForm] = useState({
    status: s.status,
    deliveryTerms: s.deliveryTerms ?? '',
    paymentTerms: s.paymentTerms ?? '',
    readjustmentTerms: s.readjustmentTerms ?? '',
    notes: s.notes ?? '',
    strengths: s.strengths ?? '',
    weaknesses: s.weaknesses ?? '',
    proposalRef: s.proposalRef ?? '',
    proposalReceivedOn: s.proposalReceivedOn ?? '',
    proposalValidUntil: s.proposalValidUntil ?? '',
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const nul = (v: string) => (v.trim() === '' ? null : v)
  const dirty =
    form.status !== s.status ||
    (['deliveryTerms', 'paymentTerms', 'readjustmentTerms', 'notes', 'strengths', 'weaknesses', 'proposalRef', 'proposalReceivedOn', 'proposalValidUntil'] as const).some(
      (k) => (form[k] || null) !== (s[k] || null),
    )

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {s.tradeName || s.legalName}
            {rank && <Badge tone={rank === 1 ? 'primary' : 'neutral'}>{rank}º menor preço</Badge>}
            <Badge tone={supplierStatus[s.status].tone}>{supplierStatus[s.status].label}</Badge>
          </span>
        }
        description={
          <span className="tabular">
            {s.legalName} · {formatTaxId(s.taxId)} · Total {formatBRL(total)}
          </span>
        }
        actions={
          removable && (
            <Button variant="ghost" size="sm" aria-label="Remover fornecedor" icon={<Trash2 className="size-4" />} onClick={onRemove} />
          )
        }
      />
      <CardBody className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm sm:col-span-2">
          <dt className="text-text-muted">Contato</dt>
          <dd>{[s.contactName, s.phone, s.email].filter(Boolean).join(' · ') || '—'}</dd>
          <dt className="text-text-muted">Validade CND</dt>
          <dd className="inline-flex items-center gap-1">
            {formatDate(s.cndValidUntil)}
            {cndExpired && (
              <Badge tone="warning" icon={<AlertTriangle className="size-3" />}>
                Vencida
              </Badge>
            )}
          </dd>
        </dl>
        <Field label="Situação">
          <Select value={form.status} onChange={set('status')} disabled={!editable}>
            {Object.entries(supplierStatus).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Nº da proposta">
          <Input value={form.proposalRef} onChange={set('proposalRef')} disabled={!editable} />
        </Field>
        <Field label="Recebida em">
          <Input type="date" value={form.proposalReceivedOn} onChange={set('proposalReceivedOn')} disabled={!editable} />
        </Field>
        <Field label="Validade da proposta">
          <Input type="date" value={form.proposalValidUntil} onChange={set('proposalValidUntil')} disabled={!editable} />
        </Field>
        <Field label="Prazo de execução / entrega">
          <Input value={form.deliveryTerms} onChange={set('deliveryTerms')} disabled={!editable} />
        </Field>
        <Field label="Condição de pagamento">
          <Input value={form.paymentTerms} onChange={set('paymentTerms')} disabled={!editable} />
        </Field>
        <Field label="Forma de reajuste">
          <Input value={form.readjustmentTerms} onChange={set('readjustmentTerms')} disabled={!editable} />
        </Field>
        <Field label="Observações">
          <Input value={form.notes} onChange={set('notes')} disabled={!editable} />
        </Field>
        <Field label="Pontos positivos">
          <Textarea rows={2} value={form.strengths} onChange={set('strengths')} disabled={!editable} />
        </Field>
        <Field label="Pontos negativos">
          <Textarea rows={2} value={form.weaknesses} onChange={set('weaknesses')} disabled={!editable} />
        </Field>
        {editable && (
          <div className="flex justify-end sm:col-span-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!dirty}
              onClick={() =>
                onSave({
                  status: form.status,
                  deliveryTerms: nul(form.deliveryTerms),
                  paymentTerms: nul(form.paymentTerms),
                  readjustmentTerms: nul(form.readjustmentTerms),
                  notes: nul(form.notes),
                  strengths: nul(form.strengths),
                  weaknesses: nul(form.weaknesses),
                  proposalRef: nul(form.proposalRef),
                  proposalReceivedOn: nul(form.proposalReceivedOn),
                  proposalValidUntil: nul(form.proposalValidUntil),
                })
              }
            >
              Salvar condições
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
