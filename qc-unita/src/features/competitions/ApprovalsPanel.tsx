import { useState } from 'react'
import { Check, CircleDashed, MinusCircle, X } from 'lucide-react'
import type { CompetitionDetailDTO, DecideApprovalInput } from '@shared/contracts'
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Textarea } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatDateTime } from '@/utils/format'
import { approvalStatus } from './status'

const icons = { pending: CircleDashed, approved: Check, rejected: X, skipped: MinusCircle }
const iconTone = {
  pending: 'bg-ink-100 text-ink-500',
  approved: 'bg-success-soft text-success',
  rejected: 'bg-error-soft text-error',
  skipped: 'bg-ink-100 text-ink-400',
}

export function ApprovalsPanel({ detail, deciding, onDecide }: { detail: CompetitionDetailDTO; deciding: boolean; onDecide: (d: DecideApprovalInput) => void }) {
  const [comment, setComment] = useState('')
  const current = detail.approvals.find((a) => a.status === 'pending')

  if (!detail.approvals.length) {
    return (
      <Card>
        <EmptyState
          title="Fluxo de aprovação ainda não iniciado"
          description="Ao enviar a revisão, as etapas são geradas conforme a alçada (Suprimentos → Engenharia → Gerente/Coordenador → Diretoria acima de R$ 500 mil)."
        />
      </Card>
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Etapas" description={`Revisão ${String(detail.revision.number).padStart(2, '0')} · aprovação sequencial`} />
        <CardBody>
          <ol className="relative grid gap-5">
            {detail.approvals.map((a, i) => {
              const Icon = icons[a.status]
              return (
                <li key={a.stepOrder} className="relative flex gap-4">
                  {i < detail.approvals.length - 1 && <span aria-hidden className="absolute top-9 left-4 h-[calc(100%-1rem)] w-px bg-border" />}
                  <span className={cn('z-[1] flex size-8 shrink-0 items-center justify-center rounded-full', iconTone[a.status], a === current && 'ring-2 ring-primary/30')}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-text">{a.stepName}</p>
                      <Badge tone={a === current ? 'primary' : approvalStatus[a.status].tone}>{a === current ? 'Aguardando' : approvalStatus[a.status].label}</Badge>
                    </div>
                    <p className="text-xs text-text-muted">
                      Papel: {a.roleName}
                      {a.decidedAt && ` · ${a.decidedByName ?? '—'} em ${formatDateTime(a.decidedAt)}`}
                    </p>
                    {a.comment && <p className="mt-1 rounded-control bg-ink-50 px-3 py-2 text-sm text-ink-700">“{a.comment}”</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Sua decisão" />
        <CardBody className="grid gap-4">
          {detail.can.decide && current ? (
            <>
              <p className="text-sm text-ink-600">
                Etapa atual: <span className="font-semibold text-text">{current.stepName}</span>
              </p>
              <Field label="Comentário" hint="Obrigatório para reprovar.">
                <Textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  icon={<X className="size-4" />}
                  disabled={!comment.trim()}
                  loading={deciding}
                  onClick={() => onDecide({ stepOrder: current.stepOrder, decision: 'rejected', comment })}
                >
                  Reprovar
                </Button>
                <Button
                  variant="primary"
                  icon={<Check className="size-4" />}
                  loading={deciding}
                  onClick={() => onDecide({ stepOrder: current.stepOrder, decision: 'approved', comment: comment || null })}
                >
                  Aprovar
                </Button>
              </div>
            </>
          ) : (
            <Alert tone="info">
              {current
                ? `Aguardando decisão do papel “${current.roleName}”.`
                : detail.revision.status === 'approved'
                  ? 'Fluxo concluído. A revisão está congelada.'
                  : 'Fluxo encerrado.'}
            </Alert>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
