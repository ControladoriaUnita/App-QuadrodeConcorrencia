/**
 * Nova obra a partir da UAU + orçamento da planilha "BD_Orcamentos" (SharePoint).
 *
 *  - Empresa e obra vêm das listas da UAU; o nº do orçamento, da planilha (filtrada pelo código
 *    da obra: a empresa na planilha, Empresa_pla, pode diferir da empresa da obra na UAU).
 *  - O orçamento é carregado e conferido ANTES de criar a obra: erro na planilha não deixa obra
 *    criada sem orçamento. Se a gravação do orçamento falhar depois (banco), o erro diz que a obra
 *    foi criada e como completar ("Atualizar orçamento").
 *  - Reimportar cria uma nova versão vigente; versões anteriores e QCs ficam intactos.
 */
import type {
  BudgetImportInput,
  CreateWorkFromUauInput,
  RefreshSheetBudgetInput,
  SheetBudgetDTO,
  UauCompanyDTO,
  UauWorkOptionDTO,
  WorkDTO,
} from '../../../shared/contracts'
import type { BudgetSheetKey, SheetBudget } from '../../../shared/domain/budget/budget-sheet'
import type { ERPProvider } from '../../infrastructure/erp/erp-provider'
import { AppError, can, notFound, requirePermission, type RequestContext } from '../context'
import type { BudgetSheetSource, Repositories, SheetBudgetRef } from '../ports'
import { assertConsistentBudget, saveBudgetVersion } from './works'

export interface SheetBudgetImportResult {
  id: string
  budget: { budgetId: string; version: number; lines: number; total: string }
  warnings: string[]
}

// ----------------------------------------------------------------------------- listas
export async function listUauCompanies(erp: ERPProvider, ctx: RequestContext): Promise<UauCompanyDTO[]> {
  requirePermission(ctx, 'work.manage')
  return erp.listCompanies()
}

/** Obras ativas da UAU, marcando as que já existem no QC (mesma chave UAU ou mesmo código). */
export async function listUauWorks(repos: Repositories, erp: ERPProvider, ctx: RequestContext): Promise<UauWorkOptionDTO[]> {
  requirePermission(ctx, 'work.manage')
  const [options, works] = await Promise.all([erp.listWorkOptions(), repos.catalog.listWorks()])
  return options.map((o) => ({ ...o, existingWorkId: findExisting(works, o.company, o.code)?.id ?? null }))
}

/** Orçamentos da obra na planilha (todas as empresas). Também serve à reimportação. */
export async function listSheetBudgets(sheet: BudgetSheetSource, ctx: RequestContext, workCode: string): Promise<SheetBudgetDTO[]> {
  if (!can(ctx.actor, 'work.manage') && !ctx.actor.permissions.some((p) => p.key === 'budget.import')) {
    requirePermission(ctx, 'work.manage')
  }
  return readSheet(() => sheet.listBudgets(workCode.trim().toUpperCase()))
}

// ----------------------------------------------------------------------------- criação e reimportação
export async function createWorkFromUau(
  repos: Repositories,
  erp: ERPProvider,
  sheet: BudgetSheetSource,
  ctx: RequestContext,
  input: CreateWorkFromUauInput,
): Promise<SheetBudgetImportResult> {
  requirePermission(ctx, 'work.manage')
  const code = input.work.toUpperCase()
  const option = (await erp.listWorkOptions()).find((o) => o.company === input.company && o.code.toUpperCase() === code)
  if (!option) throw new AppError('UAU_WORK_NOT_FOUND', `A obra ${code} da empresa ${input.company} não está entre as obras ativas da UAU.`, 422)

  const existing = findExisting(await repos.catalog.listWorks(), option.company, option.code)
  if (existing) {
    throw new AppError(
      'WORK_EXISTS',
      `A obra ${existing.code} — ${existing.name} já existe no QC. Para trazer o orçamento de novo, use "Atualizar orçamento" nela.`,
      409,
      { workId: existing.id },
    )
  }

  // Planilha primeiro: só cria a obra com o orçamento já lido e conferido
  const ref: SheetBudgetRef = { work: option.code.toUpperCase(), budget: input.budget, sheetCompany: input.sheetCompany ?? option.company }
  const budget = await loadSheetBudget(sheet, ref)
  const importInput = toImportInput(budget, sheet.sheetName, ref)
  assertConsistentBudget(importInput)

  const id = await repos.catalog.createWork(
    { code: option.code, name: option.name, clientName: input.clientName ?? null, status: input.status },
    ctx.actor.id,
    { erpId: `${option.company}:${option.code}`, uau: { company: option.company, work: option.code, budget: ref.budget, sheetCompany: ref.sheetCompany } },
  )
  try {
    const saved = await saveBudgetVersion(repos, ctx, id, importInput, { provider: 'sharepoint', integrationId: keyId(ref), sheet: ref })
    return { id, budget: saved, warnings: budget.warnings }
  } catch (err) {
    const reason = err instanceof AppError ? err.message : 'erro ao gravar no banco'
    throw new AppError(
      'WORK_CREATED_WITHOUT_BUDGET',
      `A obra ${option.code} foi criada, mas o orçamento não foi gravado (${reason}). Abra a obra e use "Atualizar orçamento".`,
      502,
      { workId: id },
    )
  }
}

/** Reimporta o orçamento da planilha (o mesmo nº guardado na obra, ou outro informado). */
export async function refreshSheetBudget(
  repos: Repositories,
  sheet: BudgetSheetSource,
  ctx: RequestContext,
  workId: string,
  input: RefreshSheetBudgetInput,
): Promise<SheetBudgetImportResult> {
  requirePermission(ctx, 'budget.import', workId)
  const work = await repos.catalog.getWork(workId)
  if (!work) throw notFound('Obra')

  const budget = input.budget ?? work.uau?.budget
  const sheetCompany = input.sheetCompany ?? work.uau?.sheetCompany ?? work.uau?.company
  if (!budget || !sheetCompany) {
    throw new AppError('SHEET_BUDGET_REQUIRED', 'Escolha o orçamento da planilha (nº e empresa) para esta obra.', 422)
  }
  const ref: SheetBudgetRef = { work: (work.uau?.work ?? work.code).toUpperCase(), budget, sheetCompany }
  const loaded = await loadSheetBudget(sheet, ref)
  const saved = await saveBudgetVersion(repos, ctx, workId, toImportInput(loaded, sheet.sheetName, ref), {
    provider: 'sharepoint',
    integrationId: keyId(ref),
    sheet: ref,
  })
  return { id: workId, budget: saved, warnings: loaded.warnings }
}

// ----------------------------------------------------------------------------- apoio
/** Obra do QC com a mesma chave UAU (empresa + obra) ou, na falta dela, o mesmo código. */
function findExisting(works: WorkDTO[], company: string, code: string): WorkDTO | undefined {
  const c = code.toUpperCase()
  return works.find((w) => (w.uau && w.uau.company === company && w.uau.work.toUpperCase() === c) || w.code.toUpperCase() === c)
}

const keyId = (ref: SheetBudgetRef) => `${ref.sheetCompany}|${ref.work}|${ref.budget}`

async function loadSheetBudget(sheet: BudgetSheetSource, ref: SheetBudgetRef): Promise<SheetBudget> {
  const key: BudgetSheetKey = { company: ref.sheetCompany, work: ref.work, budget: ref.budget }
  return readSheet(() => sheet.loadBudget(key))
}

/** Erros do parser (colunas ausentes, orçamento inexistente ou vazio) viram mensagens claras. */
async function readSheet<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof AppError) throw err
    const message = err instanceof Error ? err.message : String(err)
    const missing = /não encontrado/i.test(message)
    throw new AppError(missing ? 'SHEET_BUDGET_NOT_FOUND' : 'SHEET_BUDGET_INVALID', message, missing ? 404 : 422)
  }
}

function toImportInput(budget: SheetBudget, sheetName: string, ref: SheetBudgetRef): BudgetImportInput {
  return {
    fileName: `SharePoint · ${sheetName} · orçamento ${ref.budget}`,
    sheetName,
    groups: budget.groups,
    activities: budget.activities,
    lines: budget.lines,
    materials: budget.materials,
  }
}
