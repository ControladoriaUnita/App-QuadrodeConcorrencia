/**
 * Custos fora de escopo da obra: itens não previstos no orçamento, lançados à parte com motivo e
 * justificativa. Leitura com budget.read; lançamento, edição e exclusão com out_of_scope.manage.
 */
import type { OutOfScopeListDTO, SaveOutOfScopeInput } from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import { AppError, can, notFound, requirePermission, type RequestContext } from '../context'
import type { OutOfScopeWrite, Repositories } from '../ports'
import { namedBudgetStructure } from './works'

async function loadWork(repos: Repositories, workId: string) {
  const work = await repos.catalog.getWork(workId)
  if (!work) throw notFound('Obra')
  return work
}

export async function listOutOfScope(repos: Repositories, ctx: RequestContext, workId: string): Promise<OutOfScopeListDTO> {
  requirePermission(ctx, 'budget.read', workId)
  const work = await loadWork(repos, workId)
  return {
    items: await repos.outOfScope.list(workId),
    budgetTotal: work.currentBudgetId ? (work.currentBudgetTotal ?? '0.0000') : null,
    canManage: can(ctx.actor, 'out_of_scope.manage', workId),
  }
}

/** Normaliza a entrada e confere o Item da EAP contra o orçamento vigente (nome vem do orçamento). */
async function toWrite(repos: Repositories, budgetId: string | null, input: SaveOutOfScopeInput): Promise<OutOfScopeWrite> {
  const text = (v: string | null | undefined) => (v?.trim() ? v.trim() : null)
  const wbs = text(input.wbs)
  let wbsDescription: string | null = null
  if (wbs) {
    if (!budgetId) throw new AppError('OUT_OF_SCOPE_WBS', 'A obra não tem orçamento vigente para indicar o Item da EAP.', 422)
    const s = await namedBudgetStructure(repos, budgetId)
    const found = s.groups.find((g) => g.wbs === wbs) ?? s.activities.find((a) => a.wbs === wbs)
    if (!found) throw new AppError('OUT_OF_SCOPE_WBS', `O Item ${wbs} não existe no orçamento vigente.`, 422)
    wbsDescription = found.description
  }
  const planningCode = text(input.planningCode)
  return {
    code: text(input.code),
    description: input.description.trim(),
    unit: input.unit.trim(),
    quantity: Decimal.from(input.quantity).round(4).toDb(),
    unitCost: Decimal.from(input.unitCost).round(4).toDb(),
    wbs,
    wbsDescription,
    planningCode,
    planningDescription: planningCode ? text(input.planningDescription) : null,
    category: input.category,
    justification: input.justification.trim(),
    requestedBy: text(input.requestedBy),
    occurredOn: input.occurredOn,
  }
}

export async function createOutOfScope(repos: Repositories, ctx: RequestContext, workId: string, input: SaveOutOfScopeInput) {
  requirePermission(ctx, 'out_of_scope.manage', workId)
  const work = await loadWork(repos, workId)
  return repos.outOfScope.create(workId, await toWrite(repos, work.currentBudgetId, input), ctx.actor.id)
}

async function loadCost(repos: Repositories, ctx: RequestContext, workId: string, id: string) {
  requirePermission(ctx, 'out_of_scope.manage', workId)
  const cost = await repos.outOfScope.get(id)
  // Lançamento de outra obra (id trocado na URL) é tratado como inexistente
  if (!cost || cost.workId !== workId) throw notFound('Custo fora de escopo')
  return cost
}

export async function updateOutOfScope(repos: Repositories, ctx: RequestContext, workId: string, id: string, input: SaveOutOfScopeInput) {
  await loadCost(repos, ctx, workId, id)
  const work = await loadWork(repos, workId)
  await repos.outOfScope.update(id, await toWrite(repos, work.currentBudgetId, input), ctx.actor.id)
}

export async function deleteOutOfScope(repos: Repositories, ctx: RequestContext, workId: string, id: string) {
  await loadCost(repos, ctx, workId, id)
  await repos.outOfScope.delete(id)
}
