import { describe, expect, it } from 'vitest'
import { MockBudgetSheetSource } from '../../infrastructure/budget-sheet'
import { MockERPProvider } from '../../infrastructure/erp'
import { MemoryDb } from '../../infrastructure/memory/memory-db'
import { createMemoryRepositories } from '../../infrastructure/memory/memory-repositories'
import { AppError, type RequestContext } from '../context'
import { createWorkFromUau, listWorkSetupOptions } from './work-setup'

function setup() {
  const db = new MemoryDb()
  const repos = createMemoryRepositories(db, { actorId: 'u1', origin: 'ui', correlationId: 'c1' })
  const ctx: RequestContext = {
    correlationId: 'c1', origin: 'ui', now: () => new Date(),
    actor: { id: 'u1', fullName: 'Admin', email: null, roles: [], permissions: ['work.manage', 'budget.import'].map((key) => ({ key, workId: null })) },
  }
  return { db, repos, ctx }
}

const input = { company: '2', work: '2070', budget: '3', status: 'active' as const }

describe('listWorkSetupOptions', () => {
  it('empresas e obras vêm da planilha; os nomes, da UAU', async () => {
    const { repos, ctx } = setup()
    const { companies, warnings } = await listWorkSetupOptions(repos, new MockERPProvider(), new MockBudgetSheetSource(), ctx)
    expect(warnings).toEqual([])
    expect(companies.map((c) => [c.code, c.name, c.works.map((w) => `${w.code}:${w.budgets.map((b) => b.budget).join('+')}`)])).toEqual([
      ['1', 'Unità Engenharia (exemplo)', ['2041:1+2', '2055:1']],
      ['2', 'Unità Incorporações (exemplo)', ['1980:1', '2070:3']],
    ])
    expect(companies[1]!.works[1]!.name).toBe('Residencial Beta')
  })

  it('UAU fora do ar: lista mesmo assim, só com os códigos', async () => {
    const { repos, ctx } = setup()
    const erp = new MockERPProvider()
    erp.listCompanies = () => Promise.reject(new Error('sem conexão'))
    const { companies, warnings } = await listWorkSetupOptions(repos, erp, new MockBudgetSheetSource(), ctx)
    expect(companies[0]!.name).toBeNull()
    expect(warnings[0]).toMatch(/Nomes da UAU indisponíveis \(sem conexão\)/)
  })
})

describe('createWorkFromUau', () => {
  it('a chave é empresa + obra da planilha: outra empresa não acha o orçamento', async () => {
    const { repos, ctx } = setup()
    const err = (await createWorkFromUau(repos, new MockERPProvider(), new MockBudgetSheetSource(), ctx, { ...input, company: '1' }).catch((e: unknown) => e)) as AppError
    expect([err.code, err.status]).toEqual(['SHEET_BUDGET_NOT_FOUND', 404])
    expect(await repos.catalog.listWorks()).toEqual([])
  })

  it('falha ao gravar o orçamento depois de criar a obra → erro que diz o que fazer, com o id da obra', async () => {
    const { repos, ctx } = setup()
    repos.budgetWriter.importBudget = () => Promise.reject(new AppError('DB', 'conexão perdida', 500))
    const err = (await createWorkFromUau(repos, new MockERPProvider(), new MockBudgetSheetSource(), ctx, input).catch((e: unknown) => e)) as AppError
    expect(err.code).toBe('WORK_CREATED_WITHOUT_BUDGET')
    expect(err.message).toBe('A obra 2070 foi criada, mas o orçamento não foi gravado (conexão perdida). Abra a obra e use "Atualizar dados".')
    const [work] = await repos.catalog.listWorks()
    expect(err.details).toEqual({ workId: work!.id })
    expect(work!.uau).toEqual({ company: '2', work: '2070', budget: '3' })
    expect((await repos.integrationLogs.list())[0]).toMatchObject({ provider: 'sharepoint', status: 'error', message: 'conexão perdida' })
  })
})
