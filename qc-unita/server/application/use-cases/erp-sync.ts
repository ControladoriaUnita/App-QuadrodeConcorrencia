/**
 * Sincronização ERP → base local.
 *
 * Garantias
 *  - Executa somente no servidor, com o ErpSyncWriter (service_role).
 *  - Nunca altera revisões de QC: os valores orçados de um QC são cópias feitas na
 *    montagem e revisões aprovadas estão congeladas (trigger no banco + snapshot).
 *  - Cada operação gera um integration_log com correlationId, status, contagens e erro.
 *  - Escopo "Tudo" roda só o que o provider implementa (ERPProvider.supports); o resto
 *    volta como etapa "skipped", sem log de erro. Escopo específico não suportado → erro claro.
 */
import type { ErpSyncInput } from '../../../shared/contracts'
import { erpSupports, type ERPProvider, type ErpOperation } from '../../infrastructure/erp/erp-provider'
import { requirePermission, type RequestContext } from '../context'
import type { Repositories } from '../ports'

interface StepResult {
  operation: string
  status: 'success' | 'error' | 'skipped'
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

  const run = async (operation: string, fn: () => Promise<{ records: number; message?: string; summary?: unknown; integrationId?: string }>) => {
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
        message: r.message ?? `${r.records} registro(s) sincronizado(s)`,
        payloadSummary: r.summary ?? null,
      })
      steps.push({ operation, status: 'success', records: r.records, message: r.message })
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
  /** Etapa entra se foi pedida; no "Tudo", só se o provider a implementa. */
  const wants = (scope: ErpOperation, operation: string) => {
    if (input.scope === scope) return true
    if (!all) return false
    if (erpSupports(erp, scope)) return true
    steps.push({ operation, status: 'skipped', records: 0, message: `Ainda não implementado para ${erp.name.toUpperCase()}.` })
    return false
  }

  if (wants('works', 'getWorks')) {
    await run('getWorks', async () => ({ records: await repos.erpWriter.upsertWorks(await erp.getWorks()) }))
  }
  if (wants('suppliers', 'getSuppliers')) {
    await run('getSuppliers', async () => {
      // Leitura completa: quem é do ERP e não veio é inativado (só chega aqui se a leitura não falhou)
      const suppliers = await erp.getSuppliers()
      const r = await repos.erpWriter.upsertSuppliers(suppliers, { deactivateMissing: true })
      return {
        records: r.upserted,
        message: `${r.upserted} fornecedor(es) sincronizado(s)` + (r.deactivated ? `; ${r.deactivated} inativado(s) por não constar(em) no ERP` : ''),
        summary: { read: suppliers.length, upserted: r.upserted, deactivated: r.deactivated },
      }
    })
  }
  if (wants('materials', 'getMaterials')) {
    await run('getMaterials', async () => ({ records: await repos.erpWriter.upsertMaterials(await erp.getMaterials()) }))
  }
  if (wants('budget', 'getBudget')) {
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
