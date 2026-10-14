/**
 * Nova obra a partir da planilha de orçamentos "BD_Orcamento" (SharePoint).
 *
 *  - A planilha é a fonte da verdade do que pode ser criado: Empresa_pla · Obra_pla · NumOrca_pla.
 *    Empresa e obra são os próprios códigos da UAU (o mesmo código de obra pode existir em mais de
 *    uma empresa, então a chave é sempre empresa + obra). A UAU só completa os nomes.
 *  - O orçamento é carregado e conferido ANTES de criar a obra: erro na planilha não deixa obra
 *    criada sem orçamento. Se a gravação do orçamento falhar depois (banco), o erro diz que a obra
 *    foi criada e como completar ("Atualizar da planilha").
 *  - Reimportar cria uma nova versão vigente; versões anteriores e QCs ficam intactos.
 */
import type {
  BudgetImportInput,
  CreateWorkFromUauData,
  RefreshSheetBudgetInput,
  WorkDTO,
  WorkSetupCompanyDTO,
  WorkSetupOptionsDTO,
} from '../../../shared/contracts'
import { compareItemCodes, type BudgetSheetEntry, type BudgetSheetKey, type SheetBudget } from '../../../shared/domain/budget/budget-sheet'
import type { ERPProvider, ErpCompany, ErpWorkOption } from '../../infrastructure/erp/erp-provider'
import { AppError, notFound, requirePermission, type RequestContext } from '../context'
import type { BudgetSheetSource, Repositories } from '../ports'
import { assertConsistentBudget, saveBudgetVersion } from './works'

export interface SheetBudgetImportResult {
  id: string
  budget: { budgetId: string; version: number; lines: number; total: string }
  warnings: string[]
}

// ----------------------------------------------------------------------------- opções da tela
/** Empresas → obras → orçamentos da planilha, com os nomes da UAU e as obras já cadastradas no QC. */
export async function listWorkSetupOptions(
  repos: Repositories,
  erp: ERPProvider,
  sheet: BudgetSheetSource,
  ctx: RequestContext,
): Promise<WorkSetupOptionsDTO> {
  requirePermission(ctx, 'work.manage')
  const [entries, works, uau] = await Promise.all([readSheet(() => sheet.listBudgets()), repos.catalog.listWorks(), uauNames(erp)])
  return { companies: groupOptions(entries, works, uau), warnings: uau.warning ? [uau.warning] : [] }
}

function groupOptions(entries: BudgetSheetEntry[], works: WorkDTO[], uau: UauNames): WorkSetupCompanyDTO[] {
  const companies = new Map<string, WorkSetupCompanyDTO>()
  for (const e of entries) {
    const company = companies.get(e.company) ?? { code: e.company, name: uau.company(e.company), works: [] }
    let work = company.works.find((w) => w.code === e.work)
    if (!work) {
      work = { code: e.work, name: uau.work(e.company, e.work), existingWorkId: findExisting(works, e.company, e.work)?.id ?? null, budgets: [] }
      company.works.push(work)
    }
    work.budgets.push({ budget: e.budget, services: e.services, lines: e.lines, total: e.total })
    companies.set(e.company, company)
  }
  const byCode = (a: { code: string }, b: { code: string }) => compareItemCodes(a.code, b.code) || a.code.localeCompare(b.code)
  return [...companies.values()].sort(byCode).map((c) => ({
    ...c,
    works: c.works.sort(byCode).map((w) => ({ ...w, budgets: w.budgets.sort((a, b) => compareItemCodes(a.budget, b.budget)) })),
  }))
}

// ----------------------------------------------------------------------------- criação e reimportação
export async function createWorkFromUau(
  repos: Repositories,
  erp: ERPProvider,
  sheet: BudgetSheetSource,
  ctx: RequestContext,
  input: CreateWorkFromUauData,
): Promise<SheetBudgetImportResult> {
  requirePermission(ctx, 'work.manage')
  const key = sheetKey(input.company, input.work, input.budget)

  const existing = findExisting(await repos.catalog.listWorks(), key.company, key.work)
  if (existing) {
    throw new AppError(
      'WORK_EXISTS',
      `A obra ${existing.code} — ${existing.name} já existe no QC. Para trazer o orçamento de novo, use "Atualizar da planilha" nela.`,
      409,
      { workId: existing.id },
    )
  }

  // Planilha primeiro: só cria a obra com o orçamento já lido e conferido
  const budget = await readSheet(() => sheet.loadBudget(key))
  const importInput = toImportInput(budget, sheet.sheetName, key)
  assertConsistentBudget(importInput)

  const uau = await uauNames(erp)
  const name = uau.work(key.company, key.work) ?? `Obra ${key.work}`
  const warnings = [...(uau.warning ? [uau.warning] : []), ...budget.warnings]

  const id = await repos.catalog.createWork(
    { code: key.work, name, clientName: input.clientName ?? null, status: input.status },
    ctx.actor.id,
    { erpId: `${key.company}:${key.work}`, uau: { ...key } },
  )
  try {
    const saved = await saveBudgetVersion(repos, ctx, id, importInput, { provider: 'sharepoint', integrationId: keyId(key), sheet: key })
    return { id, budget: saved, warnings }
  } catch (err) {
    const reason = err instanceof AppError ? err.message : 'erro ao gravar no banco'
    throw new AppError(
      'WORK_CREATED_WITHOUT_BUDGET',
      `A obra ${key.work} foi criada, mas o orçamento não foi gravado (${reason}). Abra a obra e use "Atualizar da planilha".`,
      502,
      { workId: id },
    )
  }
}

/** Reimporta o orçamento da planilha (o mesmo nº guardado na obra, ou outro da mesma empresa + obra). */
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
  if (!work.uau) throw new AppError('SHEET_BUDGET_REQUIRED', 'Esta obra não foi criada pela planilha de orçamentos (falta a empresa e a obra da UAU).', 422)

  const budget = input.budget ?? work.uau.budget
  if (!budget) throw new AppError('SHEET_BUDGET_REQUIRED', 'Escolha o nº do orçamento da planilha para esta obra.', 422)
  const key = sheetKey(work.uau.company, work.uau.work, budget)
  const loaded = await readSheet(() => sheet.loadBudget(key))
  const saved = await saveBudgetVersion(repos, ctx, workId, toImportInput(loaded, sheet.sheetName, key), {
    provider: 'sharepoint',
    integrationId: keyId(key),
    sheet: key,
  })
  return { id: workId, budget: saved, warnings: loaded.warnings }
}

// ----------------------------------------------------------------------------- apoio
const sheetKey = (company: string, work: string, budget: string): BudgetSheetKey => ({
  company: company.trim(),
  work: work.trim().toUpperCase(),
  budget: budget.trim(),
})

const keyId = (k: BudgetSheetKey) => `${k.company}|${k.work}|${k.budget}`

/** Obra do QC com a mesma chave UAU (empresa + obra) ou, se não tiver chave, o mesmo código. */
function findExisting(works: WorkDTO[], company: string, code: string): WorkDTO | undefined {
  const c = code.toUpperCase()
  return works.find((w) => (w.uau ? w.uau.company === company && w.uau.work.toUpperCase() === c : w.code.toUpperCase() === c))
}

interface UauNames {
  company: (code: string) => string | null
  work: (company: string, code: string) => string | null
  /** A UAU não respondeu: a tela mostra só os códigos */
  warning: string | null
}

/** Nomes de empresas e obras da UAU. Falha na UAU não impede criar a obra (fica só com os códigos). */
async function uauNames(erp: ERPProvider): Promise<UauNames> {
  let companies: ErpCompany[] = []
  let works: ErpWorkOption[] = []
  let warning: string | null = null
  try {
    ;[companies, works] = await Promise.all([erp.listCompanies(), erp.listWorkOptions()])
  } catch (err) {
    warning = `Nomes da UAU indisponíveis (${err instanceof Error ? err.message : String(err)}). As obras aparecem só pelo código.`
  }
  const companyName = new Map(companies.map((c) => [c.code, c.name]))
  const workName = new Map(works.map((w) => [`${w.company}|${w.code.toUpperCase()}`, w.name]))
  return {
    company: (code) => companyName.get(code) ?? null,
    work: (company, code) => workName.get(`${company}|${code.toUpperCase()}`) ?? null,
    warning,
  }
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

function toImportInput(budget: SheetBudget, sheetName: string, key: BudgetSheetKey): BudgetImportInput {
  return {
    fileName: `SharePoint · ${sheetName} · empresa ${key.company} · obra ${key.work} · orçamento ${key.budget}`,
    sheetName,
    groups: budget.groups,
    activities: budget.activities,
    lines: budget.lines,
    materials: budget.materials,
  }
}
