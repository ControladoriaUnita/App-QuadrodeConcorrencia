import { describe, expect, it } from 'vitest'
import { MockBudgetSheetSource } from '../../infrastructure/budget-sheet'
import { MockERPProvider } from '../../infrastructure/erp'
import { MemoryDb } from '../../infrastructure/memory/memory-db'
import { createMemoryRepositories } from '../../infrastructure/memory/memory-repositories'
import { AppError, type RequestContext } from '../context'
import { createWorkFromUau } from './work-setup'

function setup() {
  const db = new MemoryDb()
  const repos = createMemoryRepositories(db, { actorId: 'u1', origin: 'ui', correlationId: 'c1' })
  const ctx: RequestContext = {
    correlationId: 'c1', origin: 'ui', now: () => new Date(),
    actor: { id: 'u1', fullName: 'Admin', email: null, roles: [], permissions: ['work.manage', 'budget.import'].map((key) => ({ key, workId: null })) },
  }
  return { db, repos, ctx }
}

const input = { company: '2', work: '2070', budget: '3', sheetCompany: '72', status: 'active' as const }

describe('createWorkFromUau', () => {
  it('sem empresa da planilha usa a empresa da UAU', async () => {
    const { repos, ctx } = setup()
    const err = (await createWorkFromUau(repos, new MockERPProvider(), new MockBudgetSheetSource(), ctx, { ...input, sheetCompany: undefined }).catch((e: unknown) => e)) as AppError
    // Na planilha de exemplo a obra 2070 está na empresa 72, não na 2
    expect([err.code, err.status]).toEqual(['SHEET_BUDGET_NOT_FOUND', 404])
    expect(await repos.catalog.listWorks()).toEqual([])
  })

  it('falha ao gravar o orçamento depois de criar a obra → erro que diz o que fazer, com o id da obra', async () => {
    const { repos, ctx } = setup()
    repos.budgetWriter.importBudget = () => Promise.reject(new AppError('DB', 'conexão perdida', 500))
    const err = (await createWorkFromUau(repos, new MockERPProvider(), new MockBudgetSheetSource(), ctx, input).catch((e: unknown) => e)) as AppError
    expect(err.code).toBe('WORK_CREATED_WITHOUT_BUDGET')
    expect(err.message).toBe('A obra 2070 foi criada, mas o orçamento não foi gravado (conexão perdida). Abra a obra e use "Atualizar orçamento".')
    const [work] = await repos.catalog.listWorks()
    expect(err.details).toEqual({ workId: work!.id })
    expect(work!.uau).toEqual({ company: '2', work: '2070', budget: '3', sheetCompany: '72' })
    expect((await repos.integrationLogs.list())[0]).toMatchObject({ provider: 'sharepoint', status: 'error', message: 'conexão perdida' })
  })
})
