import { describe, expect, it } from 'vitest'
import { D } from '../decimal'
import { buildApprovalPlan, decide, flowOutcome } from './approval-flow'

const steps = [
  { stepOrder: 1, name: 'Suprimentos', roleId: 'proc', minAmount: null, active: true },
  { stepOrder: 2, name: 'Gerente', roleId: 'mgr', minAmount: null, active: true },
  { stepOrder: 3, name: 'Diretoria', roleId: 'dir', minAmount: D('500000'), active: true },
]

describe('fluxo de aprovação', () => {
  it('aplica alçada por valor', () => {
    expect(buildApprovalPlan(steps, D('100000')).map((s) => s.stepOrder)).toEqual([1, 2])
    expect(buildApprovalPlan(steps, D('500000')).map((s) => s.stepOrder)).toEqual([1, 2, 3])
  })
  it('exige ordem e papel', () => {
    const plan = buildApprovalPlan(steps, D('1'))
    const base = { actorId: 'u', now: '2026-10-06T12:00:00Z' }
    expect(() => decide(plan, { ...base, stepOrder: 2, decision: 'approved', actorRoleIds: ['mgr'] })).toThrow(/etapa atual/)
    expect(() => decide(plan, { ...base, stepOrder: 1, decision: 'approved', actorRoleIds: ['mgr'] })).toThrow(/papel/)
    const r1 = decide(plan, { ...base, stepOrder: 1, decision: 'approved', actorRoleIds: ['proc'] })
    expect(r1.outcome).toBe('pending')
    const r2 = decide(r1.approvals, { ...base, stepOrder: 2, decision: 'approved', actorRoleIds: ['mgr'] })
    expect(r2.outcome).toBe('approved')
  })
  it('reprovação exige comentário e encerra o fluxo', () => {
    const plan = buildApprovalPlan(steps, D('1'))
    const base = { actorId: 'u', now: 'x', stepOrder: 1, actorRoleIds: ['proc'] }
    expect(() => decide(plan, { ...base, decision: 'rejected' })).toThrow(/motivo/)
    const r = decide(plan, { ...base, decision: 'rejected', comment: 'Preço acima' })
    expect(r.outcome).toBe('rejected')
    expect(r.approvals[1]!.status).toBe('skipped')
    expect(flowOutcome(r.approvals)).toBe('rejected')
  })
})
