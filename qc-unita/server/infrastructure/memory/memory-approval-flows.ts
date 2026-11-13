/**
 * Fluxos de aprovação, diretores e etapas de aprovação dos aditivos em memória (modo demonstração).
 * Mesmo comportamento das tabelas da migration 028.
 */
import type { ApprovalDirectorDTO, ApprovalDTO, ApprovalFlowDTO } from '../../../shared/contracts'
import type { ApprovalFlowRepository } from '../../application/ports'
import type { AuditCtx, MemoryDb, Row } from './memory-db'

export function createMemoryApprovalFlows(db: MemoryDb, audit: AuditCtx): ApprovalFlowRepository {
  const roleName = (id: string) => (db.get('roles', id)?.name as string) ?? ''
  const personName = (id: unknown) => (typeof id === 'string' ? ((db.get('profiles', id)?.fullName as string) ?? null) : null)
  const directorName = (id: unknown) => (typeof id === 'string' ? ((db.get('approval_directors', id)?.name as string) ?? null) : null)
  const workOfAddendum = (addendumId: string) => {
    const a = db.get('contract_addenda', addendumId)
    const c = a ? db.get('contract_requests', a.contractRequestId as string) : undefined
    return (c?.workId as string) ?? null
  }
  const toFlow = (f: Row): ApprovalFlowDTO => ({
    id: f.id,
    kind: f.kind as ApprovalFlowDTO['kind'],
    name: f.name as string,
    origin: (f.origin as ApprovalFlowDTO['origin']) ?? null,
    requestKind: (f.requestKind as ApprovalFlowDTO['requestKind']) ?? null,
    directorId: (f.directorId as string) ?? null,
    active: f.active !== false,
    steps: db
      .find('approval_flow_steps', (s) => s.flowId === f.id)
      .sort((a, b) => (a.stepOrder as number) - (b.stepOrder as number))
      .map((s) => ({
        stepOrder: s.stepOrder as number,
        name: s.name as string,
        roleId: s.roleId as string,
        roleName: roleName(s.roleId as string),
        director: s.director === true,
        minAmount: (s.minAmount as string) ?? null,
        active: s.active !== false,
      })),
  })
  const toApproval = (a: Row): ApprovalDTO => ({
    stepOrder: a.stepOrder as number,
    stepName: a.stepName as string,
    roleId: a.roleId as string,
    roleName: roleName(a.roleId as string),
    directorId: (a.directorId as string) ?? null,
    directorName: directorName(a.directorId),
    directorUserId: typeof a.directorId === 'string' ? ((db.get('approval_directors', a.directorId)?.userId as string) ?? null) : null,
    status: a.status as ApprovalDTO['status'],
    decidedById: (a.decidedBy as string) ?? null,
    decidedByName: personName(a.decidedBy),
    decidedAt: (a.decidedAt as string) ?? null,
    comment: (a.comment as string) ?? null,
  })

  return {
    async listFlows() {
      return db.all('approval_flows').map(toFlow).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'pt-BR'))
    },
    async saveFlow(id, input) {
      const { steps, ...head } = input
      const flowId = id ?? db.insert('approval_flows', { ...head }, audit).id
      if (id) db.update('approval_flows', id, { ...head }, audit)
      for (const s of db.find('approval_flow_steps', (x) => x.flowId === flowId)) db.remove('approval_flow_steps', s.id, audit)
      steps.forEach((s, k) => db.insert('approval_flow_steps', { flowId, stepOrder: k + 1, ...s }, audit))
      return flowId
    },
    async deleteFlow(id) {
      for (const s of db.find('approval_flow_steps', (x) => x.flowId === id)) db.remove('approval_flow_steps', s.id, audit)
      db.remove('approval_flows', id, audit)
    },
    async listDirectors() {
      return db
        .all('approval_directors')
        .map<ApprovalDirectorDTO>((d) => ({
          id: d.id,
          code: d.code as string,
          name: d.name as string,
          userId: (d.userId as string) ?? null,
          userName: personName(d.userId),
          active: d.active !== false,
        }))
        .sort((a, b) => a.code.localeCompare(b.code))
    },
    async saveDirector(id, input) {
      if (db.find('approval_directors', (d) => (d.code as string).toUpperCase() === input.code.toUpperCase() && d.id !== id).length) {
        throw new Error(`DIRECTOR_CODE_DUPLICATED: ${input.code}`)
      }
      if (id) {
        db.update('approval_directors', id, { ...input }, audit)
        return id
      }
      return db.insert('approval_directors', { ...input }, audit).id
    },
    async listRoles() {
      return db.all('roles').map((r) => ({ id: r.id, key: r.key as string, name: r.name as string }))
    },
    async listPeople() {
      return db
        .all('profiles')
        .filter((p) => p.active !== false)
        .map((p) => ({ id: p.id, fullName: p.fullName as string }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'pt-BR'))
    },
    async listForAddenda(addendumIds) {
      const ids = new Set(addendumIds)
      const out = new Map<string, ApprovalDTO[]>(addendumIds.map((id) => [id, []]))
      for (const a of db.all('addendum_approvals').filter((x) => ids.has(x.addendumId as string)).sort((x, y) => (x.stepOrder as number) - (y.stepOrder as number))) {
        out.get(a.addendumId as string)!.push(toApproval(a))
      }
      return out
    },
    async createAddendumPlan(addendumId, plan) {
      const workId = workOfAddendum(addendumId)
      for (const a of db.find('addendum_approvals', (x) => x.addendumId === addendumId)) db.remove('addendum_approvals', a.id, audit, { workId })
      for (const step of plan) db.insert('addendum_approvals', { addendumId, ...step, directorId: step.directorId ?? null }, audit, { workId })
    },
    async saveAddendumDecision(addendumId, step) {
      const row = db.find('addendum_approvals', (a) => a.addendumId === addendumId && a.stepOrder === step.stepOrder)[0]!
      db.update('addendum_approvals', row.id, { status: step.status, decidedBy: step.decidedBy, decidedAt: step.decidedAt, comment: step.comment }, audit, { workId: workOfAddendum(addendumId) })
    },
  }
}
