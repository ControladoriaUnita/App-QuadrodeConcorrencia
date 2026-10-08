/**
 * Visão por obra: o orçamento geral da obra e o quanto as concorrências o consomem.
 */
import type { BudgetImportInput, BudgetLineUsageDTO, BudgetStructureDTO, CreateWorkInput, WorkCompetitionDTO, WorkDTO, WorkOverviewDTO } from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import { summarizeWork } from '../../../shared/domain/work/overview'
import { AppError, can, notFound, requirePermission, type RequestContext } from '../context'
import type { Repositories } from '../ports'

async function competitionsOf(repos: Repositories, ctx: RequestContext, workId: string): Promise<WorkCompetitionDTO[]> {
  if (!can(ctx.actor, 'competition.read', workId)) return []
  const [list, commitments, addenda] = await Promise.all([
    repos.competitions.list({ workId }),
    repos.competitions.workCommitments(workId),
    repos.contracts.approvedAddendaTotals(workId),
  ])
  return list
    .filter((c) => c.status !== 'cancelled')
    .map((c) => {
      const eff = commitments.competitions.find((x) => x.competitionId === c.id)
      const category = eff?.category ?? 'quoting'
      // Aditivos aprovados somam ao contratado da concorrência
      const extra = category === 'contracted' ? (addenda.find((a) => a.competitionId === c.id)?.total ?? '0') : '0'
      return {
        ...c,
        effectiveRevisionNumber: eff?.revisionNumber ?? c.revisionNumber,
        category,
        committedTotal: Decimal.from(eff?.awardedTotal ?? '0').plus(extra).toDb(),
      }
    })
}

/** Lista de obras com o resumo de consumo do orçamento (tela inicial). */
export async function listWorksWithSummary(repos: Repositories, ctx: RequestContext): Promise<WorkDTO[]> {
  const works = (await repos.catalog.listWorks()).filter((w) => can(ctx.actor, 'work.read', w.id))
  return Promise.all(
    works.map(async (w) => ({
      ...w,
      summary: summarizeWork(w.currentBudgetTotal ?? '0', await competitionsOf(repos, ctx, w.id)),
    })),
  )
}

export async function getWorkOverview(repos: Repositories, ctx: RequestContext, workId: string): Promise<WorkOverviewDTO> {
  requirePermission(ctx, 'work.read', workId)
  const work = await repos.catalog.getWork(workId)
  if (!work) throw notFound('Obra')
  const competitions = await competitionsOf(repos, ctx, workId)
  const [packages, commitments] = await Promise.all([
    work.currentBudgetId && can(ctx.actor, 'budget.read', workId) ? repos.catalog.listPackages(work.currentBudgetId) : Promise.resolve([]),
    repos.competitions.workCommitments(workId),
  ])
  return {
    work,
    budgetTotal: work.currentBudgetTotal ?? '0.0000',
    packages,
    competitions,
    links: commitments.links.filter((l) => competitions.some((c) => c.id === l.competitionId)),
  }
}

// ----------------------------------------------------------------------------- orçamento da obra
/**
 * Linhas do orçamento vigente com o que já está comprometido em concorrências (linha a linha).
 * Filtros opcionais: IPs e texto (código/descrição/EAP).
 */
/** Cadastro manual de obra; o orçamento vem depois pela importação do Excel. */
export async function createWork(repos: Repositories, ctx: RequestContext, input: CreateWorkInput) {
  requirePermission(ctx, 'work.manage')
  const id = await repos.catalog.createWork(input, ctx.actor.id)
  return { id }
}

/** Estrutura do orçamento vigente (grupos "Item" e composições), na ordem da planilha. */
export async function getBudgetStructure(repos: Repositories, ctx: RequestContext, workId: string): Promise<BudgetStructureDTO | null> {
  requirePermission(ctx, 'budget.read', workId)
  const work = await repos.catalog.getWork(workId)
  if (!work) throw notFound('Obra')
  return work.currentBudgetId ? repos.catalog.getBudgetStructure(work.currentBudgetId) : null
}

export async function listBudgetLinesUsage(
  repos: Repositories,
  ctx: RequestContext,
  workId: string,
  filter: { packages?: string[]; search?: string; excludeCompetitionId?: string },
): Promise<BudgetLineUsageDTO[]> {
  requirePermission(ctx, 'budget.read', workId)
  const work = await repos.catalog.getWork(workId)
  if (!work) throw notFound('Obra')
  if (!work.currentBudgetId) return []
  const [lines, commitments, comps] = await Promise.all([
    repos.catalog.listBudgetLines(work.currentBudgetId, filter.packages?.length ? filter.packages : undefined),
    repos.competitions.workCommitments(workId),
    repos.competitions.list({ workId }),
  ])
  const q = filter.search?.trim().toLowerCase()
  const codeOf = new Map(comps.map((c) => [c.id, c.code]))
  const links = commitments.links.filter((l) => l.competitionId !== filter.excludeCompetitionId)
  return lines
    .filter((l) => !q || `${l.code} ${l.description} ${l.activityWbs} ${l.activityDescription} ${l.packageCode ?? ''}`.toLowerCase().includes(q))
    .map((l) => {
      const usage = links
        .filter((c) => c.lineKey === l.lineKey)
        .map((c) => ({
          competitionId: c.competitionId,
          competitionCode: codeOf.get(c.competitionId) ?? '—',
          category: c.category,
          quantity: c.quantity,
          share: c.share,
          budgetValue: c.budgetValue,
        }))
      const committed = Decimal.sum(usage.map((u) => u.quantity))
      const share = Decimal.sum(usage.map((u) => u.share))
      return {
        ...l,
        usage,
        committedQuantity: committed.toDb(),
        balanceQuantity: Decimal.from(l.quantity).minus(committed).toDb(),
        committedShare: share.toFixed(6),
        balanceShare: Decimal.from(1).minus(share).toFixed(6),
        committedValue: Decimal.sum(usage.map((u) => u.budgetValue)).toDb(),
      }
    })
}

/**
 * Importa o orçamento da obra a partir do Excel (estrutura já interpretada por
 * shared/domain/budget/excel-import.ts e validada pelo Zod). Cria uma nova versão vigente;
 * versões anteriores e QCs existentes permanecem intactos (vínculos rastreados pela chave da linha).
 */
export async function importBudget(repos: Repositories, ctx: RequestContext, workId: string, input: BudgetImportInput) {
  requirePermission(ctx, 'budget.import', workId)
  const work = await repos.catalog.getWork(workId)
  if (!work) throw notFound('Obra')

  // Consistência mínima (o cliente pode ter sido adulterado)
  const keys = new Set<string>()
  for (const l of input.lines) {
    if (keys.has(l.lineKey)) throw new AppError('IMPORT_DUPLICATED_LINE', `Chave de linha duplicada: ${l.lineKey}`, 422)
    keys.add(l.lineKey)
  }
  const materialCodes = new Set(input.materials.map((m) => m.code))
  const missing = input.lines.find((l) => !materialCodes.has(l.materialCode))
  if (missing) throw new AppError('IMPORT_MATERIAL', `Insumo ${missing.materialCode} sem cadastro no arquivo.`, 422)
  const activities = new Set(input.activities.map((a) => a.wbs))
  const orphan = input.lines.find((l) => !activities.has(l.activityWbs))
  if (orphan) throw new AppError('IMPORT_ACTIVITY', `Linha ${orphan.sourceRow}: composição ${orphan.activityWbs} inexistente.`, 422)

  const logId = await repos.integrationLogs.start({
    correlationId: ctx.correlationId, provider: 'excel', operation: 'importBudget', direction: 'inbound', triggeredBy: ctx.actor.id, integrationId: input.fileName,
  })
  try {
    const r = await repos.budgetWriter.importBudget(workId, input, { actorId: ctx.actor.id })
    const total = Decimal.sum(input.lines.map((l) => l.total))
    await repos.integrationLogs.finish(logId, {
      status: 'success', recordsProcessed: r.lines, recordsFailed: 0,
      message: `Orçamento v${r.version} importado de ${input.fileName} (${r.lines} linhas)`,
      payloadSummary: { workId, fileName: input.fileName, sheet: input.sheetName, version: r.version, total: total.toDb() },
    })
    return { ...r, total: total.toDb() }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await repos.integrationLogs.finish(logId, { status: 'error', recordsProcessed: 0, recordsFailed: input.lines.length, message })
    throw err
  }
}
