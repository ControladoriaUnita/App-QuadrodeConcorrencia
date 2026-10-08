/**
 * Fluxo de aprovação sequencial com alçadas por valor.
 *
 * - O plano é gerado no envio: etapas ativas cujo `minAmount` é nulo ou ≤ valor do QC.
 * - Decisões seguem a ordem: só a primeira etapa pendente pode ser decidida.
 * - Quem decide precisa possuir o papel da etapa (global ou na obra).
 * - Reprovação exige comentário e encerra o fluxo (demais etapas → skipped).
 * - Todas aprovadas → revisão aprovada.
 */
import { Decimal } from '../decimal'
import { DomainError } from '../competition/revision'
import type { ApprovalStatus } from '../competition/types'

export interface ApprovalStepConfig {
  stepOrder: number
  name: string
  roleId: string
  minAmount: Decimal | null
  active: boolean
}

export interface ApprovalInstance {
  stepOrder: number
  stepName: string
  roleId: string
  status: ApprovalStatus
  decidedBy: string | null
  decidedAt: string | null
  comment: string | null
}

export type FlowOutcome = 'pending' | 'approved' | 'rejected'

export function buildApprovalPlan(steps: ApprovalStepConfig[], amount: Decimal): ApprovalInstance[] {
  const plan = steps
    .filter((s) => s.active && (s.minAmount === null || amount.gte(s.minAmount)))
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map<ApprovalInstance>((s) => ({
      stepOrder: s.stepOrder,
      stepName: s.name,
      roleId: s.roleId,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
    }))
  if (!plan.length) throw new DomainError('APPROVAL_PLAN_EMPTY', 'Nenhuma etapa de aprovação configurada.')
  return plan
}

export function currentStep(approvals: ApprovalInstance[]): ApprovalInstance | null {
  return [...approvals].sort((a, b) => a.stepOrder - b.stepOrder).find((a) => a.status === 'pending') ?? null
}

export function flowOutcome(approvals: ApprovalInstance[]): FlowOutcome {
  if (approvals.some((a) => a.status === 'rejected')) return 'rejected'
  if (approvals.length && approvals.every((a) => a.status === 'approved' || a.status === 'skipped')) return 'approved'
  return 'pending'
}

export interface DecisionInput {
  stepOrder: number
  decision: 'approved' | 'rejected'
  actorId: string
  actorRoleIds: string[]
  comment?: string | null
  now: string
}

export function decide(approvals: ApprovalInstance[], input: DecisionInput): { approvals: ApprovalInstance[]; outcome: FlowOutcome } {
  const step = currentStep(approvals)
  if (!step) throw new DomainError('APPROVAL_CLOSED', 'Não há etapas pendentes.')
  if (step.stepOrder !== input.stepOrder) {
    throw new DomainError('APPROVAL_OUT_OF_ORDER', `A etapa atual é "${step.stepName}".`)
  }
  if (!input.actorRoleIds.includes(step.roleId)) {
    throw new DomainError('APPROVAL_FORBIDDEN', `Você não possui o papel exigido para "${step.stepName}".`)
  }
  if (input.decision === 'rejected' && !input.comment?.trim()) {
    throw new DomainError('APPROVAL_COMMENT_REQUIRED', 'Informe o motivo da reprovação.')
  }

  const next = approvals.map((a) => {
    if (a.stepOrder === step.stepOrder) {
      return { ...a, status: input.decision, decidedBy: input.actorId, decidedAt: input.now, comment: input.comment ?? null }
    }
    if (input.decision === 'rejected' && a.status === 'pending') return { ...a, status: 'skipped' as const }
    return a
  })
  return { approvals: next, outcome: flowOutcome(next) }
}
