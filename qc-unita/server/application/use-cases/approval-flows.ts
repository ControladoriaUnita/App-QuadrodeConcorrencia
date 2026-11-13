/**
 * Fluxos de aprovação configuráveis (ver shared/domain/approval/flows.ts): configuração pelo
 * administrador e apoio aos casos de uso que montam e decidem planos (QC e aditivos).
 */
import type { ApprovalConfigDTO, ApprovalDTO, SaveApprovalFlowInput, SaveDirectorInput } from '../../../shared/contracts'
import { currentStep, type ApprovalInstance } from '../../../shared/domain/approval/approval-flow'
import type { FlowContext } from '../../../shared/domain/approval/flows'
import { AppError, roleIdsFor, type Actor, type RequestContext } from '../context'
import type { CompetitionData, Repositories } from '../ports'

const isAdmin = (actor: Actor) => actor.roles.some((r) => r.roleKey === 'admin' && r.workId === null)

function requireAdmin(ctx: RequestContext) {
  if (!isAdmin(ctx.actor)) throw new AppError('FORBIDDEN', 'Só o administrador configura os fluxos de aprovação.', 403)
}

/** Critérios do pedido para escolher o fluxo */
export const flowContextOf = (c: Pick<CompetitionData['competition'], 'origin' | 'requestKind' | 'directorId'>): FlowContext => ({
  origin: c.origin,
  requestKind: c.requestKind,
  directorId: c.directorId,
})

/** directorId → usuário ligado (null = qualquer um com o papel da etapa) */
export async function directorUsers(repos: Repositories): Promise<Map<string, string | null>> {
  return new Map((await repos.approvalFlows.listDirectors()).map((d) => [d.id, d.userId]))
}

export const toInstances = (approvals: ApprovalDTO[]): ApprovalInstance[] =>
  approvals.map((a) => ({
    stepOrder: a.stepOrder,
    stepName: a.stepName,
    roleId: a.roleId,
    directorId: a.directorId ?? null,
    status: a.status,
    decidedBy: a.decidedById,
    decidedAt: a.decidedAt,
    comment: a.comment,
  }))

/** O usuário pode decidir a etapa atual do plano? (papel da etapa e, na etapa de diretor, o diretor ligado) */
export function canDecideCurrent(actor: Actor, workId: string, approvals: ApprovalDTO[], users: Map<string, string | null>): boolean {
  const step = currentStep(toInstances(approvals))
  if (!step) return false
  if (!roleIdsFor(actor, workId).includes(step.roleId)) return false
  const user = step.directorId ? users.get(step.directorId) : null
  return !user || user === actor.id
}

// ----------------------------------------------------------------------------- configuração
export async function getApprovalConfig(repos: Repositories, ctx: RequestContext): Promise<ApprovalConfigDTO> {
  const [flows, directors, roles, people] = await Promise.all([
    repos.approvalFlows.listFlows(),
    repos.approvalFlows.listDirectors(),
    repos.approvalFlows.listRoles(),
    isAdmin(ctx.actor) ? repos.approvalFlows.listPeople() : Promise.resolve([]),
  ])
  return { flows, directors, roles, people, canManage: isAdmin(ctx.actor) }
}

async function assertFlow(repos: Repositories, input: SaveApprovalFlowInput) {
  const roles = new Set((await repos.approvalFlows.listRoles()).map((r) => r.id))
  if (input.steps.some((s) => !roles.has(s.roleId))) throw new AppError('FLOW_ROLE', 'Papel inexistente numa etapa do fluxo.', 422)
  if (input.directorId && !(await repos.approvalFlows.listDirectors()).some((d) => d.id === input.directorId)) {
    throw new AppError('FLOW_DIRECTOR', 'Diretor inexistente.', 422)
  }
}

export async function saveApprovalFlow(repos: Repositories, ctx: RequestContext, id: string | null, input: SaveApprovalFlowInput) {
  requireAdmin(ctx)
  if (id && !(await repos.approvalFlows.listFlows()).some((f) => f.id === id)) throw new AppError('NOT_FOUND', 'Fluxo não encontrado.', 404)
  await assertFlow(repos, input)
  return { id: await repos.approvalFlows.saveFlow(id, input) }
}

export async function deleteApprovalFlow(repos: Repositories, ctx: RequestContext, id: string) {
  requireAdmin(ctx)
  await repos.approvalFlows.deleteFlow(id)
}

export async function saveDirector(repos: Repositories, ctx: RequestContext, id: string | null, input: SaveDirectorInput) {
  requireAdmin(ctx)
  const others = (await repos.approvalFlows.listDirectors()).filter((d) => d.id !== id)
  if (others.some((d) => d.code.toUpperCase() === input.code.toUpperCase())) {
    throw new AppError('DIRECTOR_CODE_DUPLICATED', `Já existe o diretor ${input.code.toUpperCase()}.`, 409)
  }
  return { id: await repos.approvalFlows.saveDirector(id, { ...input, code: input.code.toUpperCase() }) }
}
