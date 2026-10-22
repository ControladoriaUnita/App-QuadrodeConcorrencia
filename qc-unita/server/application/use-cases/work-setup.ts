/**
 * Obras e orçamentos vindos do SharePoint (aba "BD_Orcamento" do Excel online).
 *
 *  - O SharePoint é a fonte da verdade do que pode ser criado: Empresa_pla · Obra_pla · NumOrca_pla.
 *    Empresa e obra são os próprios códigos da UAU (o mesmo código de obra pode existir em mais de
 *    uma empresa, então a chave é sempre empresa + obra). A UAU só completa os nomes.
 *  - O orçamento é carregado e conferido ANTES de criar a obra: erro nos dados não deixa obra
 *    criada sem orçamento. Se a gravação do orçamento falhar depois (banco), o erro diz que a obra
 *    foi criada e como completar ("Atualizar dados").
 *  - Cada versão do orçamento = orçamento do SharePoint + de-para (IP por Item) + indireto aberto
 *    da obra, quando importado (composeVersion). Reimportar cria uma nova versão vigente; versões
 *    anteriores e QCs ficam intactos.
 */
import type {
  BudgetImportInput,
  CreateWorkFromUauData,
  IndirectImportInput,
  RefreshSheetBudgetInput,
  WorkDTO,
  WorkIndirectDTO,
  WorkSetupCompanyDTO,
  WorkSetupOptionsDTO,
} from '../../../shared/contracts'
import { compareItemCodes, type BudgetSheetEntry, type BudgetSheetKey, type SheetBudget } from '../../../shared/domain/budget/budget-sheet'
import { IndirectMismatchError, openIndirect, type IndirectBudget } from '../../../shared/domain/budget/indirect-import'
import { applyItemPlanning, mappingResolver } from '../../../shared/domain/budget/mappings'
import { Decimal } from '../../../shared/domain/decimal'
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
/** Empresas → obras → orçamentos do SharePoint, com os nomes da UAU e as obras já cadastradas no QC. */
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
      `A obra ${existing.code} — ${existing.name} já existe no QC. Para trazer o orçamento de novo, use "Atualizar dados" nela.`,
      409,
      { workId: existing.id },
    )
  }

  // SharePoint primeiro: só cria a obra com o orçamento já lido e conferido
  const budget = await readSheet(() => sheet.loadBudget(key))
  const version = await composeVersion(repos, budget, sheet.sheetName, key, null)
  assertConsistentBudget(version.input)

  const uau = await uauNames(erp)
  const name = uau.work(key.company, key.work) ?? `Obra ${key.work}`
  const warnings = [...(uau.warning ? [uau.warning] : []), ...version.warnings]

  const id = await repos.catalog.createWork(
    { code: key.work, name, clientName: input.clientName ?? null, status: input.status },
    ctx.actor.id,
    { erpId: `${key.company}:${key.work}`, uau: { ...key } },
  )
  try {
    const saved = await saveBudgetVersion(repos, ctx, id, version.input, { provider: 'sharepoint', integrationId: keyId(key), sheet: key })
    return { id, budget: saved, warnings }
  } catch (err) {
    const reason = err instanceof AppError ? err.message : 'erro ao gravar no banco'
    throw new AppError(
      'WORK_CREATED_WITHOUT_BUDGET',
      `A obra ${key.work} foi criada, mas o orçamento não foi gravado (${reason}). Abra a obra e use "Atualizar dados".`,
      502,
      { workId: id },
    )
  }
}

/**
 * Reimporta o orçamento do SharePoint (o mesmo nº guardado na obra, ou outro da mesma empresa +
 * obra), com o de-para e o indireto aberto da obra.
 */
export async function refreshSheetBudget(
  repos: Repositories,
  sheet: BudgetSheetSource,
  ctx: RequestContext,
  workId: string,
  input: RefreshSheetBudgetInput,
): Promise<SheetBudgetImportResult> {
  const { work, key } = await sheetWork(repos, ctx, workId, input.budget)
  const [loaded, indirect] = await Promise.all([readSheet(() => sheet.loadBudget(key)), repos.indirect.get(work.id)])
  const version = await composeVersion(repos, loaded, sheet.sheetName, key, indirect?.budget ?? null)
  const saved = await saveBudgetVersion(repos, ctx, workId, version.input, { provider: 'sharepoint', integrationId: keyId(key), sheet: key })
  return { id: workId, budget: saved, warnings: version.warnings }
}

// ----------------------------------------------------------------------------- indireto aberto
/**
 * Importa o indireto aberto da obra (arquivo de custo indireto lido no navegador) e grava uma nova
 * versão do orçamento do SharePoint com ele. O indireto fica guardado e é reaplicado a cada
 * "Atualizar dados", até a API trazer o indireto aberto.
 */
export async function importIndirect(
  repos: Repositories,
  sheet: BudgetSheetSource,
  ctx: RequestContext,
  workId: string,
  input: IndirectImportInput,
): Promise<SheetBudgetImportResult> {
  const { work, key } = await sheetWork(repos, ctx, workId)
  const indirect = checkedIndirect(input)
  const loaded = await readSheet(() => sheet.loadBudget(key))
  const version = await composeVersion(repos, loaded, sheet.sheetName, key, indirect, { strict: true })
  const saved = await saveBudgetVersion(repos, ctx, work.id, version.input, { provider: 'sharepoint', integrationId: keyId(key), sheet: key })
  await repos.indirect.save(work.id, { fileName: input.fileName, budget: indirect }, ctx.actor.id)
  return { id: work.id, budget: saved, warnings: [...indirect.warnings, ...version.warnings] }
}

/** Indireto em uso na obra (`indirect: null` se nunca foi importado) */
export async function getWorkIndirect(repos: Repositories, ctx: RequestContext, workId: string): Promise<{ indirect: WorkIndirectDTO | null }> {
  requirePermission(ctx, 'budget.read', workId)
  const stored = await repos.indirect.get(workId)
  if (!stored) return { indirect: null }
  const { fileName, importedAt, importedByName, budget } = stored
  return {
    indirect: {
      fileName, importedAt, importedByName, total: budget.total,
      items: budget.items.map((i) => ({ wbs: i.wbs, description: i.description, total: i.total, lines: i.lines.length })),
    },
  }
}

/** Os totais vêm do navegador: refeitos aqui a partir dos insumos */
function checkedIndirect(input: IndirectImportInput): IndirectBudget {
  const items = input.items.map((i) => ({ ...i, total: Decimal.sum(i.lines.map((l) => l.total)).toDb() }))
  if (!items.some((i) => i.lines.length)) throw new AppError('INDIRECT_EMPTY', 'O arquivo de indireto não tem insumos com valor.', 422)
  return { items, total: Decimal.sum(items.map((i) => i.total)).toDb(), warnings: input.warnings }
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

/** Obra com orçamento do SharePoint: chave da UAU e nº do orçamento (o informado ou o da obra). */
async function sheetWork(repos: Repositories, ctx: RequestContext, workId: string, budget?: string) {
  requirePermission(ctx, 'budget.import', workId)
  const work = await repos.catalog.getWork(workId)
  if (!work) throw notFound('Obra')
  if (!work.uau) throw new AppError('SHEET_BUDGET_REQUIRED', 'Esta obra não tem o orçamento do SharePoint (falta a empresa e a obra da UAU).', 422)
  const number = budget ?? work.uau.budget
  if (!number) throw new AppError('SHEET_BUDGET_REQUIRED', 'Escolha o nº do orçamento do SharePoint para esta obra.', 422)
  return { work, key: sheetKey(work.uau.company, work.uau.work, number) }
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

/**
 * Versão do orçamento a gravar: o orçamento do SharePoint com o indireto aberto da obra (quando
 * houver) e o IP das linhas pelo de-para dos Itens (se o SharePoint não trouxer o Vínculo PL).
 * `strict`: indireto que não é desta obra é recusado (na reimportação, só avisa e fica fora).
 */
async function composeVersion(
  repos: Repositories,
  budget: SheetBudget,
  sheetName: string,
  key: BudgetSheetKey,
  indirect: IndirectBudget | null,
  opts: { strict?: boolean } = {},
): Promise<{ input: BudgetImportInput; warnings: string[] }> {
  const resolver = mappingResolver(await repos.budgetMappings.list())
  const warnings = [...budget.warnings]
  let parts: Pick<BudgetImportInput, 'groups' | 'activities' | 'lines' | 'materials'> = budget
  let opened: string[] = []

  if (indirect) {
    try {
      const r = openIndirect(parts, indirect, resolver)
      parts = r.budget
      opened = indirect.items.filter((i) => i.lines.length).map((i) => i.wbs)
      warnings.push(...r.warnings)
    } catch (err) {
      if (!(err instanceof IndirectMismatchError)) throw err
      if (opts.strict) throw new AppError('INDIRECT_MISMATCH', err.message, 422)
      warnings.push(`Indireto aberto não aplicado: ${err.message}`)
    }
  }

  if (!budget.planningFromSheet) {
    // Linhas do indireto aberto já receberam o IP pelo de-para do indireto
    const isOpened = (wbs: string) => opened.some((o) => wbs === o || wbs.startsWith(`${o}.`))
    const r = applyItemPlanning(parts.lines, resolver, (l) => isOpened(l.activityWbs))
    parts = { ...parts, lines: r.lines }
    if (r.unmapped) warnings.push(`${r.unmapped} linha(s) sem IP no de-para dos Itens: ficam vinculadas ao próprio item do orçamento até o planejamento escolher o IP.`)
  }

  return {
    input: {
      fileName: `SharePoint · ${sheetName} · empresa ${key.company} · obra ${key.work} · orçamento ${key.budget}${indirect ? ' · indireto aberto' : ''}`,
      sheetName,
      ...parts,
    },
    warnings,
  }
}
