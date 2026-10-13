/**
 * Aditivos e distratos do contrato (aba "Aditivos"): lançamentos numerados por tipo, item a item e com os
 * vínculos de planejamento (IP) de cada item, totais e decisão da Gerência/Diretoria.
 * O cálculo usa o mesmo domínio do servidor (shared/domain/contract/addendum).
 */
import { useState } from 'react'
import { Check, FileMinus2, FilePlus2, Pencil, Send, Trash2, X } from 'lucide-react'
import type { AddendumDTO, AddendumKind, ContractRequestDTO, SaveAddendumInput } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { computeAddendum, currentEndOn } from '@shared/domain/contract/addendum'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Textarea } from '@/components/ui'
import { usePackages } from '@/features/competitions/api'
import { cn } from '@/utils/cn'
import { formatBRL, formatDate, formatDateTime } from '@/utils/format'
import { AddendumEditor } from './AddendumEditor'
import { AddendumItemsTable, AddendumTotals } from './AddendumSummary'
import { KIND_TEXT, addendumTitle, approvedBefore, contractItemsOf, lineOf } from './addendum-model'
import { addendumStatus } from './status'

type Editing = { kind: AddendumKind; addendum: AddendumDTO | null } | null

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
  const [editing, setEditing] = useState<Editing>(null)
  const packages = usePackages(c.work.id).data ?? []
  const approved = approvedBefore(c)
  const approvedTotal = Decimal.sum(approved.map((a) => a.totalDelta))
  const newTotal = Decimal.from(c.totalAmount).plus(approvedTotal)
  const balance = Decimal.from(c.availableAmount).minus(newTotal)
  const endOn = currentEndOn(c.endOn, approved)

  const newButtons = (size: 'sm' | 'md') =>
    c.can.addendum && !editing && (
      <>
        <Button size={size} icon={<FileMinus2 className="size-4" />} onClick={() => setEditing({ kind: 'termination', addendum: null })}>
          Solicitar distrato
        </Button>
        <Button size={size} variant="primary" icon={<FilePlus2 className="size-4" />} onClick={() => setEditing({ kind: 'addendum', addendum: null })}>
          Solicitar aditivo
        </Button>
      </>
    )

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_20rem]">
      <div className="grid content-start gap-3">
        {editing && (
          <AddendumEditor
            c={c}
            kind={editing.kind}
            addendum={editing.addendum}
            packages={packages}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={async (b) => {
              if (editing.addendum) await onSave(editing.addendum.id, b)
              else await onCreate(b)
              setEditing(null)
            }}
          />
        )}
        {c.addenda.length === 0 && !editing && (
          <Card>
            <EmptyState
              title="Nenhum aditivo ou distrato"
              description={
                c.status === 'draft'
                  ? 'Aditivos e distratos podem ser solicitados depois que a solicitação de contrato for enviada.'
                  : 'Aditivo acrescenta e distrato retira quantidades do contrato, item a item, com os IPs de cada item.'
              }
              action={<div className="flex gap-2">{newButtons('md')}</div>}
            />
          </Card>
        )}
        {[...c.addenda].reverse().map((a) =>
          editing?.addendum?.id === a.id ? null : (
            <AddendumCard
              key={a.id}
              c={c}
              a={a}
              busy={busy}
              onEdit={() => setEditing({ kind: a.kind, addendum: a })}
              onDelete={() => onDelete(a.id)}
              onSubmit={() => onSubmit(a.id)}
              onDecide={(d, comment) => onDecide(a.id, d, comment)}
            />
          ),
        )}
      </div>

      <Card className="self-start">
        <CardHeader title="Verbas orçamentárias" actions={c.addenda.length > 0 && <div className="flex gap-1">{newButtons('sm')}</div>} />
        <CardBody>
          <dl className="tabular grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt className="text-text-muted">Total do contrato inicial</dt>
            <dd className="text-right">{formatBRL(c.totalAmount)}</dd>
            <dt className="text-text-muted">Aditivos e distratos aprovados ({approved.length})</dt>
            <dd className={cn('text-right', approvedTotal.isNegative() && 'text-error')}>{formatBRL(approvedTotal)}</dd>
            <dt className="font-semibold">Novo total do contrato</dt>
            <dd className="text-right font-semibold">{formatBRL(newTotal)}</dd>
            <dt className="border-t border-border pt-2 text-text-muted">Verba disponível dos itens</dt>
            <dd className="border-t border-border pt-2 text-right">{formatBRL(c.availableAmount)}</dd>
            <dt className="font-semibold">Saldo após lançamentos</dt>
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
  const summary = computeAddendum(contractItemsOf(c), approvedBefore(c, a).flatMap((x) => x.items.map(lineOf)), a.items.map(lineOf))
  const st = addendumStatus[a.status]
  const title = addendumTitle(a)

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="capitalize">{title}</span>
            <Badge tone={KIND_TEXT[a.kind].tone}>{KIND_TEXT[a.kind].title}</Badge>
            <Badge tone={st.tone}>{st.label}</Badge>
          </span>
        }
        description={`Solicitado em ${formatDate(a.requestedOn)}${a.newEndOn ? ` · nova data de término ${formatDate(a.newEndOn)}` : ''}${a.submittedAt ? ` · enviado em ${formatDateTime(a.submittedAt)}` : ''}`}
        actions={
          a.status === 'draft' &&
          c.can.manage && (
            <>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={onDelete} disabled={busy}>Excluir</Button>
              <Button size="sm" icon={<Pencil className="size-4" />} onClick={onEdit}>Editar</Button>
              <Button size="sm" variant="primary" icon={<Send className="size-4" />} onClick={onSubmit} loading={busy}>Enviar para aprovação</Button>
            </>
          )
        }
      />
      <CardBody className="grid gap-3">
        <p className="text-sm">
          <span className="text-text-muted">Motivo: </span>
          {a.reason}
        </p>
        {a.items.length > 0 && <AddendumItemsTable summary={summary} items={a.items} />}
        <AddendumTotals summary={summary} title={title} />
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
                Aprovar {KIND_TEXT[a.kind].title}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
