/**
 * Sincronização ERP → base local.
 *
 * Garantias
 *  - Executa somente no servidor, com o ErpSyncWriter (service_role).
 *  - Nunca altera revisões de QC: os valores orçados de um QC são cópias feitas na
 *    montagem e revisões aprovadas estão congeladas (trigger no banco + snapshot).
 *  - Cada operação gera um integration_log com correlationId, status, contagens e erro.
 */
import type { ErpSyncInput } from '../../../shared/contracts'
import type { ERPProvider } from '../../infrastructure/erp/erp-provider'
import { requirePermission, type RequestContext } from '../context'
import type { Repositories } from '../ports'

interface StepResult {
  operation: string
  status: 'success' | 'error'
  records: number
  message?: string
}

export async function syncFromErp(
  repos: Repositories,
  erp: ERPProvider,
  ctx: RequestContext,
  input: ErpSyncInput,
): Promise<{ correlationId: string; steps: StepResult[] }> {
  requirePermission(ctx, 'integration.run')
  const steps: StepResult[] = []

  const run = async (operation: string, fn: () => Promise<{ records: number; summary?: unknown; integrationId?: string }>) => {
    const logId = await repos.integrationLogs.start({
      correlationId: ctx.correlationId,
      provider: erp.name,
      operation,
      direction: 'inbound',
      triggeredBy: ctx.actor.id,
    })
    try {
      const r = await fn()
      await repos.integrationLogs.finish(logId, {
        status: 'success',
        recordsProcessed: r.records,
        recordsFailed: 0,
        message: `${r.records} registro(s) sincronizado(s)`,
        payloadSummary: r.summary ?? null,
      })
      steps.push({ operation, status: 'success', records: r.records })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await repos.integrationLogs.finish(logId, {
        status: 'error',
        recordsProcessed: 0,
        recordsFailed: 1,
        message,
        errorDetail: { name: err instanceof Error ? err.name : 'Error', message },
      })
      steps.push({ operation, status: 'error', records: 0, message })
    }
  }

  const all = input.scope === 'all'
  if (all || input.scope === 'works') {
    await run('getWorks', async () => ({ records: await repos.erpWriter.upsertWorks(await erp.getWorks()) }))
  }
  if (all || input.scope === 'suppliers') {
    await run('getSuppliers', async () => ({ records: await repos.erpWriter.upsertSuppliers(await erp.getSuppliers()) }))
  }
  if (all || input.scope === 'materials') {
    await run('getMaterials', async () => ({ records: await repos.erpWriter.upsertMaterials(await erp.getMaterials()) }))
  }
  if (all || input.scope === 'budget') {
    const works = await repos.catalog.listWorks()
    const targets = works.filter((w) => w.erpId && (!input.workId || w.id === input.workId))
    for (const w of targets) {
      await run(`getBudget:${w.code}`, async () => {
        const budget = await erp.getBudget(w.erpId!)
        if (!budget) return { records: 0, summary: { work: w.code, budget: null } }
        await repos.erpWriter.upsertMaterials(budget.materials)
        const r = await repos.erpWriter.upsertBudget(budget)
        return { records: r.lines, integrationId: budget.erpId, summary: { work: w.code, budgetId: r.budgetId, version: budget.version } }
      })
    }
  }

  return { correlationId: ctx.correlationId, steps }
}
