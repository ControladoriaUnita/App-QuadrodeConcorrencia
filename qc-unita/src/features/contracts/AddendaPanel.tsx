/**
 * Aditivos do contrato (aba "Solic. Aditivo"): aditamentos numerados com motivo, nova data de término,
 * quantidade aditiva por item (± ou item novo), totais e decisão da Gerência/Diretoria.
 * O cálculo usa o mesmo domínio do servidor (computeAddendum).
 */
import { useMemo, useState } from 'react'
import { Check, FilePlus2, Pencil, Plus, Send, Trash2, X } from 'lucide-react'
import type { AddendumDTO, ContractRequestDTO, SaveAddendumInput } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { computeAddendum, currentEndOn, type AddendumLine, type AddendumSummary } from '@shared/domain/contract/contract-request'
import { Badge, Button, Card, CardBody, CardHeader, DecimalInput, EmptyState, Field, Input, Textarea } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatBRL, formatDate, formatDateTime, formatQuantity } from '@/utils/format'
import { addendumStatus, ordinal } from './status'

const lineOf = (i: { contractItemId: string | null; code: string; quantityDelta: string; unitPrice: string }): AddendumLine => ({
  contractItemId: i.contractItemId, code: i.code, quantityDelta: Decimal.from(i.quantityDelta), unitPrice: Decimal.from(i.unitPrice),
})
const contractLines = (c: ContractRequestDTO) => c.items.map((i) => ({ id: i.id, quantity: Decimal.from(i.quantity), totalPrice: Decimal.from(i.totalPrice) }))
/** Aditivos aprovados anteriores ao de número `n` (ou todos) */
const previousApproved = (c: ContractRequestDTO, n = Infinity) => c.addenda.filter((a) => a.status === 'approved' && a.number < n)

interface Props {
  c: ContractRequestDTO
  busy: boolean
  onCreate: (b: SaveAddendumInput) => Promise<unknown>
  onSave: (id: string, b: SaveAddendumInput) => Promise<unknown>
  onDelete: (id: string) => void
  onSubmit: (id: string) => void
  onDecide: (id: string, decision: 'approved' | 'rejected', comment: string | null) => void
}

export function AddendaPanel({ c, busy, onCreate, onSave, onDelete, onSubmit, onDecide }: Props) {
  const [editing, setEditing] = useState<AddendumDTO | 'new' | null>(null)
  const approved = previousApproved(c)
  const approvedTotal = Decimal.sum(approved.map((a) => a.totalDelta))
  const newTotal = Decimal.from(c.totalAmount).plus(approvedTotal)
  const balance = Decimal.from(c.availableAmount).minus(newTotal)
  const endOn = currentEndOn(c.endOn, approved)

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_20rem]">
      <div className="grid content-start gap-3">
        {editing && (
          <AddendumEditor
            c={c}
            addendum={editing === 'new' ? null : editing}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={async (b) => {
              if (editing === 'new') await onCreate(b)
              else await onSave(editing.id, b)
              setEditing(null)
            }}
          />
        )}
        {c.addenda.length === 0 && !editing && (
          <Card>
            <EmptyState
              title="Nenhum aditivo"
              description={
                c.status === 'draft'
                  ? 'Aditivos podem ser solicitados depois que a solicitação de contrato for enviada.'
                  : 'Aditamento de quantidades, preços ou prazo sem novo processo de contratação.'
              }
              action={c.can.addendum && <Button variant="primary" icon={<FilePlus2 className="size-4" />} onClick={() => setEditing('new')}>Solicitar aditivo</Button>}
            />
          </Card>
        )}
        {[...c.addenda].reverse().map((a) =>
          editing !== 'new' && editing?.id === a.id ? null : (
            <AddendumCard
              key={a.id}
              c={c}
              a={a}
              busy={busy}
              onEdit={() => setEditing(a)}
              onDelete={() => onDelete(a.id)}
              onSubmit={() => onSubmit(a.id)}
              onDecide={(d, comment) => onDecide(a.id, d, comment)}
            />
          ),
        )}
      </div>

      <Card className="self-start">
        <CardHeader
          title="Verbas orçamentárias"
          actions={c.can.addendum && !editing && c.addenda.length > 0 && (
            <Button size="sm" variant="primary" icon={<FilePlus2 className="size-4" />} onClick={() => setEditing('new')}>Solicitar aditivo</Button>
          )}
        />
        <CardBody>
          <dl className="tabular grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt className="text-text-muted">Total do contrato inicial</dt>
            <dd className="text-right">{formatBRL(c.totalAmount)}</dd>
            <dt className="text-text-muted">Aditivos aprovados ({approved.length})</dt>
            <dd className="text-right">{formatBRL(approvedTotal)}</dd>
            <dt className="font-semibold">Novo total do contrato</dt>
            <dd className="text-right font-semibold">{formatBRL(newTotal)}</dd>
            <dt className="border-t border-border pt-2 text-text-muted">Verba disponível dos itens</dt>
            <dd className="border-t border-border pt-2 text-right">{formatBRL(c.availableAmount)}</dd>
            <dt className="font-semibold">Saldo após aditivos</dt>
            <dd className={cn('text-right font-semibold', balance.isNegative() ? 'text-error' : 'text-success')}>{formatBRL(balance)}</dd>
          </dl>
          <p className="tabular mt-3 border-t border-border pt-2 text-sm">
            <span className="text-text-muted">Vigência </span>
            {formatDate(c.startOn)} → {formatDate(endOn)}
            {endOn !== c.endOn && <span className="block text-[11px] text-text-muted">término original {formatDate(c.endOn)}</span>}
          </p>
        </CardBody>
      </Card>
    </div>
  )
}

function AddendumCard({ c, a, busy, onEdit, onDelete, onSubmit, onDecide }: {
  c: ContractRequestDTO
  a: AddendumDTO
  busy: boolean
  onEdit: () => void
  onDelete: () => void
  onSubmit: () => void
  onDecide: (d: 'approved' | 'rejected', comment: string | null) => void
}) {
  const [comment, setComment] = useState('')
  const summary = computeAddendum(contractLines(c), previousApproved(c, a.number).flatMap((x) => x.items.map(lineOf)), a.items.map(lineOf))
  const st = addendumStatus[a.status]

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {ordinal(a.number)} aditamento <Badge tone={st.tone}>{st.label}</Badge>
          </span>
        }
        description={`Solicitado em ${formatDate(a.requestedOn)}${a.newEndOn ? ` · nova data de término ${formatDate(a.newEndOn)}` : ''}${a.submittedAt ? ` · enviado em ${formatDateTime(a.submittedAt)}` : ''}`}
        actions={
          a.status === 'draft' && c.can.manage && (
            <>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={onDelete} disabled={busy}>Excluir</Button>
              <Button size="sm" icon={<Pencil className="size-4" />} onClick={onEdit}>Editar</Button>
              <Button size="sm" variant="primary" icon={<Send className="size-4" />} onClick={onSubmit} loading={busy}>Enviar para aprovação</Button>
            </>
          )
        }
      />
      <CardBody className="grid gap-3">
        <p className="text-sm"><span className="text-text-muted">Motivo: </span>{a.reason}</p>
        {a.items.length > 0 && <SummaryTable summary={summary} items={a.items} />}
        <Totals summary={summary} number={a.number} />
        {a.decidedAt && (
          <p className={cn('rounded-control px-3 py-2 text-sm', a.status === 'approved' ? 'bg-success-soft text-success' : 'bg-error-soft text-error')}>
            {a.status === 'approved' ? 'Aprovado' : 'Reprovado'} por {a.decidedByName ?? '—'} em {formatDateTime(a.decidedAt)}
            {a.decisionComment && <span className="text-ink-700"> — “{a.decisionComment}”</span>}
          </p>
        )}
        {a.status === 'submitted' && c.can.decideAddendum && (
          <div className="grid gap-2 rounded-control border border-warning/30 bg-warning-soft/40 p-3">
            <Field label="Comentário da Gerência / Diretoria" hint="Obrigatório para reprovar.">
              <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="danger" size="sm" icon={<X className="size-4" />} disabled={!comment.trim()} loading={busy} onClick={() => onDecide('rejected', comment.trim())}>
                Reprovar
              </Button>
              <Button variant="primary" size="sm" icon={<Check className="size-4" />} loading={busy} onClick={() => onDecide('approved', comment.trim() || null)}>
                Aprovar aditivo
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function SummaryTable({ summary, items }: { summary: AddendumSummary; items: { code: string; description: string; unit: string }[] }) {
  const th = 'border-b border-border bg-ink-50 px-3 py-1.5 text-xs font-semibold text-text-muted whitespace-nowrap'
  const td = 'border-b border-border px-3 py-1.5 whitespace-nowrap'
  return (
    <div className="overflow-x-auto rounded-control border border-border">
      <table className="tabular w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>Insumo</th>
            <th className={cn(th, 'text-right')}>Qtd aditivo</th>
            <th className={cn(th, 'text-right')}>Qtd total</th>
            <th className={cn(th, 'text-right')}>R$ unitário</th>
            <th className={cn(th, 'text-right')}>R$ total</th>
          </tr>
        </thead>
        <tbody>
          {summary.lines.map((l, k) => (
            <tr key={k}>
              <td className={cn(td, 'max-w-80')}>
                <p className="truncate">{items[k]?.description}</p>
                <p className="text-[11px] text-text-muted">{l.code}{!l.contractItemId && ' · item novo'}</p>
              </td>
              <td className={cn(td, 'text-right', l.quantityDelta.isNegative() && 'text-error')}>{formatQuantity(l.quantityDelta)} {items[k]?.unit}</td>
              <td className={cn(td, 'text-right', l.quantityAfter.isNegative() && 'font-semibold text-error')}>{formatQuantity(l.quantityAfter)}</td>
              <td className={cn(td, 'text-right')}>{formatBRL(l.unitPrice)}</td>
              <td className={cn(td, 'text-right font-medium', l.totalDelta.isNegative() && 'text-error')}>{formatBRL(l.totalDelta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Totals({ summary, number }: { summary: AddendumSummary; number: number }) {
  return (
    <div className="tabular flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
      <span className="text-text-muted">Contrato inicial <strong className="text-text">{formatBRL(summary.initialTotal)}</strong></span>
      {!summary.previousTotal.isZero() && <span className="text-text-muted">Aditivos anteriores <strong className="text-text">{formatBRL(summary.previousTotal)}</strong></span>}
      <span className="text-text-muted">Total do aditamento {number} <strong className={summary.totalDelta.isNegative() ? 'text-error' : 'text-text'}>{formatBRL(summary.totalDelta)}</strong></span>
      <span>Novo total do contrato <strong>{formatBRL(summary.newTotal)}</strong></span>
    </div>
  )
}

// ----------------------------------------------------------------------------- editor
interface NewRow { key: number; code: string; description: string; unit: string; quantityDelta: string | null; unitPrice: string | null }

function AddendumEditor({ c, addendum, busy, onCancel, onSave }: {
  c: ContractRequestDTO
  addendum: AddendumDTO | null
  busy: boolean
  onCancel: () => void
  onSave: (b: SaveAddendumInput) => Promise<void>
}) {
  const number = addendum?.number ?? c.addenda.reduce((m, a) => Math.max(m, a.number), 0) + 1
  const [reason, setReason] = useState(addendum?.reason ?? '')
  const [requestedOn, setRequestedOn] = useState(addendum?.requestedOn ?? new Date().toISOString().slice(0, 10))
  const [newEndOn, setNewEndOn] = useState(addendum?.newEndOn ?? '')
  const [deltas, setDeltas] = useState<Record<string, { q: string | null; p: string | null }>>(() =>
    Object.fromEntries((addendum?.items ?? []).filter((i) => i.contractItemId).map((i) => [i.contractItemId!, { q: i.quantityDelta, p: i.unitPrice }])),
  )
  const [rows, setRows] = useState<NewRow[]>(() =>
    (addendum?.items ?? []).filter((i) => !i.contractItemId).map((i, k) => ({ key: k, code: i.code, description: i.description, unit: i.unit, quantityDelta: i.quantityDelta, unitPrice: i.unitPrice })),
  )

  const input: SaveAddendumInput = useMemo(() => ({
    reason,
    requestedOn,
    newEndOn: newEndOn || null,
    items: [
      ...c.items
        .filter((i) => deltas[i.id]?.q && !Decimal.from(deltas[i.id]!.q!).isZero())
        .map((i) => ({ contractItemId: i.id, quantityDelta: deltas[i.id]!.q!, unitPrice: deltas[i.id]!.p ?? i.unitPrice })),
      ...rows
        .filter((r) => r.code.trim() && r.quantityDelta)
        .map((r) => ({ code: r.code.trim(), description: r.description.trim() || r.code.trim(), unit: r.unit.trim() || 'un', quantityDelta: r.quantityDelta!, unitPrice: r.unitPrice ?? '0' })),
    ],
  }), [reason, requestedOn, newEndOn, deltas, rows, c.items])

  const summary = computeAddendum(
    contractLines(c),
    previousApproved(c, number).flatMap((x) => x.items.map(lineOf)),
    input.items.map((i) => lineOf({ contractItemId: i.contractItemId ?? null, code: 'code' in i ? i.code : '', quantityDelta: i.quantityDelta, unitPrice: i.unitPrice ?? '0' })),
  )
  const prevQty = new Map(contractLines(c).map((i) => [i.id, i.quantity]))
  for (const a of previousApproved(c, number)) for (const i of a.items) if (i.contractItemId) prevQty.set(i.contractItemId, (prevQty.get(i.contractItemId) ?? Decimal.ZERO).plus(i.quantityDelta))

  const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
  const td = 'border-b border-border px-3 py-1 whitespace-nowrap'

  return (
    <Card className="border-primary/40">
      <CardHeader
        title={`${ordinal(number)} aditamento — ${addendum ? 'editar rascunho' : 'nova solicitação'}`}
        description="Informe a quantidade a aditivar (negativa para redução) e, se preciso, um novo R$ unitário ou itens novos."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={reason.trim().length < 5} onClick={() => onSave(input)}>Salvar rascunho</Button>
          </>
        }
      />
      <CardBody className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_12rem]">
          <Field label="Motivo do aditamento" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: volume adicional apontado pela engenharia" />
          </Field>
          <Field label="Data da solicitação">
            <Input type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
          </Field>
          <Field label="Nova data de término" hint={`Vigente: ${formatDate(currentEndOn(c.endOn, previousApproved(c, number)))}`}>
            <Input type="date" value={newEndOn} min={c.startOn} onChange={(e) => setNewEndOn(e.target.value)} />
          </Field>
        </div>

        <div className="max-h-[28rem] overflow-auto rounded-control border border-border">
          <table className="tabular w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={cn(th, 'text-left')}>Insumo</th>
                <th className={cn(th, 'text-right')}>Qtd atual</th>
                <th className={cn(th, 'w-36 text-right')}>Qtd aditivo</th>
                <th className={cn(th, 'text-right')}>Qtd total</th>
                <th className={cn(th, 'w-36 text-right')}>R$ unitário</th>
                <th className={cn(th, 'text-right')}>R$ total</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((i) => {
                const d = deltas[i.id]
                const delta = d?.q ? Decimal.from(d.q) : Decimal.ZERO
                const price = Decimal.from(d?.p ?? i.unitPrice)
                const before = prevQty.get(i.id) ?? Decimal.ZERO
                const after = before.plus(delta)
                return (
                  <tr key={i.id} className={cn(!delta.isZero() && 'bg-primary-soft/40')}>
                    <td className={cn(td, 'max-w-72')}>
                      <p className="truncate" title={i.description}>{i.description}</p>
                      <p className="text-[11px] text-text-muted">{i.code}</p>
                    </td>
                    <td className={cn(td, 'text-right text-text-muted')}>{formatQuantity(before)} {i.unit}</td>
                    <td className={cn(td, 'px-1')}>
                      <DecimalInput
                        value={d?.q ?? null}
                        fractionDigits={4}
                        trimZeros
                        allowNegative
                        gridColumn="addendum-qty"
                        aria-label={`Quantidade aditiva de ${i.code}`}
                        onCommit={(v) => setDeltas((s) => ({ ...s, [i.id]: { q: v, p: s[i.id]?.p ?? null } }))}
                      />
                    </td>
                    <td className={cn(td, 'text-right', after.isNegative() && 'font-semibold text-error')}>{formatQuantity(after)}</td>
                    <td className={cn(td, 'px-1')}>
                      <DecimalInput
                        value={d?.p ?? i.unitPrice}
                        allowEmpty={false}
                        gridColumn="addendum-price"
                        aria-label={`R$ unitário de ${i.code}`}
                        onCommit={(v) => setDeltas((s) => ({ ...s, [i.id]: { q: s[i.id]?.q ?? null, p: v } }))}
                      />
                    </td>
                    <td className={cn(td, 'text-right', delta.isNegative() && 'text-error')}>{delta.isZero() ? '—' : formatBRL(price.times(delta).round(4))}</td>
                  </tr>
                )
              })}
              {rows.map((r) => {
                const set = (patch: Partial<NewRow>) => setRows((s) => s.map((x) => (x.key === r.key ? { ...x, ...patch } : x)))
                const total = r.quantityDelta && r.unitPrice ? Decimal.from(r.quantityDelta).times(r.unitPrice).round(4) : null
                return (
                  <tr key={`n${r.key}`} className="bg-info-soft/40">
                    <td className={td}>
                      <div className="grid grid-cols-[6rem_1fr_3.5rem_auto] items-center gap-1">
                        <Input className="h-8" placeholder="Código" aria-label="Código do item novo" value={r.code} onChange={(e) => set({ code: e.target.value })} />
                        <Input className="h-8" placeholder="Descrição" aria-label="Descrição do item novo" value={r.description} onChange={(e) => set({ description: e.target.value })} />
                        <Input className="h-8" placeholder="Un." aria-label="Unidade do item novo" value={r.unit} onChange={(e) => set({ unit: e.target.value })} />
                        <button type="button" className="rounded-control p-1 text-ink-500 hover:bg-error-soft hover:text-error" aria-label="Remover item novo" onClick={() => setRows((s) => s.filter((x) => x.key !== r.key))}>
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                    <td className={cn(td, 'text-right text-text-muted')}>item novo</td>
                    <td className={cn(td, 'px-1')}>
                      <DecimalInput value={r.quantityDelta} fractionDigits={4} trimZeros aria-label="Quantidade do item novo" onCommit={(v) => set({ quantityDelta: v })} />
                    </td>
                    <td className={cn(td, 'text-right')}>{formatQuantity(r.quantityDelta)}</td>
                    <td className={cn(td, 'px-1')}>
                      <DecimalInput value={r.unitPrice} aria-label="R$ unitário do item novo" onCommit={(v) => set({ unitPrice: v })} />
                    </td>
                    <td className={cn(td, 'text-right')}>{total ? formatBRL(total) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() => setRows((s) => [...s, { key: Date.now(), code: '', description: '', unit: '', quantityDelta: null, unitPrice: null }])}
          >
            Incluir item novo
          </Button>
          <Totals summary={summary} number={number} />
        </div>
      </CardBody>
    </Card>
  )
}
