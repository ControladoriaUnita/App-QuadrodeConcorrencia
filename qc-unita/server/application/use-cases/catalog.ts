import type { UserDTO } from '../../../shared/contracts'
import { can, notFound, requirePermission, type RequestContext } from '../context'
import type { Repositories } from '../ports'

export function me(ctx: RequestContext): UserDTO {
  return {
    id: ctx.actor.id,
    fullName: ctx.actor.fullName,
    email: ctx.actor.email,
    roles: ctx.actor.roles,
    permissions: [...new Set(ctx.actor.permissions.map((p) => p.key))].sort(),
  }
}

export async function listWorks(repos: Repositories, ctx: RequestContext) {
  const works = await repos.catalog.listWorks()
  return works.filter((w) => can(ctx.actor, 'work.read', w.id))
}

export async function listPackages(repos: Repositories, ctx: RequestContext, workId: string) {
  requirePermission(ctx, 'budget.read', workId)
  const work = await repos.catalog.getWork(workId)
  if (!work) throw notFound('Obra')
  if (!work.currentBudgetId) return []
  return repos.catalog.listPackages(work.currentBudgetId)
}

export async function listSuppliers(repos: Repositories, ctx: RequestContext, search?: string) {
  requirePermission(ctx, 'supplier.read')
  return repos.catalog.listSuppliers(search)
}

export async function listContractTypes(repos: Repositories) {
  return repos.catalog.listContractTypes()
}

export async function listIntegrationLogs(repos: Repositories, ctx: RequestContext) {
  requirePermission(ctx, 'integration.read')
  return repos.integrationLogs.list(100)
}
