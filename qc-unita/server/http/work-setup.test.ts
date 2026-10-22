/**
 * Nova obra pela planilha BD_Orcamento + nomes da UAU (modo memória: MockERPProvider e
 * MockBudgetSheetSource).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { BudgetLineUsageDTO, IntegrationLogDTO, WorkDTO, WorkSetupOptionsDTO } from '../../shared/contracts'
import type { SheetBudgetImportResult } from '../application/use-cases/work-setup'
import { DEMO_USERS } from '../infrastructure/memory/seed'
import { handle } from './router'

const [ADMIN, PROC] = DEMO_USERS.map((u) => u.id)

async function call<T = unknown>(method: string, path: string, body?: unknown, user = ADMIN): Promise<{ status: number; data: T }> {
  const res = await handle(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-demo-user': user! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, data: (await res.json()) as T }
}
type ErrorBody = { error: { code: string; message: string; details?: { workId?: string } } }

const works = async () => (await call<WorkDTO[]>('GET', '/works')).data

beforeAll(() => {
  process.env.DATA_SOURCE = 'memory'
})

describe('opções para a nova obra', () => {
  it('empresas → obras → orçamentos da planilha, com nomes da UAU e obras já cadastradas', async () => {
    const { data } = await call<WorkSetupOptionsDTO>('GET', '/work-setup/options')
    expect(data.companies.map((c) => [c.code, c.works.map((w) => w.code)])).toEqual([['1', ['2041', '2055']], ['2', ['1980', '2070']]])
    const beta = data.companies[1]!.works.find((w) => w.code === '2070')!
    expect(beta).toMatchObject({ name: 'Residencial Beta', existingWorkId: null, budgets: [expect.objectContaining({ budget: '3', services: 7 })] })
    const alpha = (await works()).find((w) => w.code === '2041')!
    expect(data.companies[0]!.works[0]!.existingWorkId).toBe(alpha.id)
  })

  it('exige permissão de cadastrar obras', async () => {
    expect((await call('GET', '/work-setup/options', undefined, PROC)).status).toBe(403)
  })
})

describe('criar obra pela planilha', () => {
  const body = { company: '2', work: '2070', budget: '3', clientName: 'SPE Beta' }

  it('orçamento inexistente → erro claro e nenhuma obra criada', async () => {
    const before = (await works()).length
    const r = await call<ErrorBody>('POST', '/works/from-uau', { ...body, budget: '9' })
    expect([r.status, r.data.error.code]).toEqual([404, 'SHEET_BUDGET_NOT_FOUND'])
    expect(r.data.error.message).toContain('Orçamento 9 da obra 2070 (empresa 2) não encontrado')
    expect((await works()).length).toBe(before)
  })

  it('cria a obra com a chave da UAU e o orçamento da planilha, auxiliares abertas', async () => {
    const r = await call<SheetBudgetImportResult>('POST', '/works/from-uau', body)
    expect(r.status).toBe(201)
    expect(r.data.budget).toMatchObject({ version: 1, lines: 16 })
    expect(r.data.warnings.join()).toContain('sem IP no de-para')

    const w = (await works()).find((x) => x.id === r.data.id)!
    expect([w.code, w.name, w.clientName, w.status, w.erpId]).toEqual(['2070', 'Residencial Beta', 'SPE Beta', 'active', '2:2070'])
    expect(w.uau).toEqual({ company: '2', work: '2070', budget: '3' })
    expect(w.currentBudget).toMatchObject({ source: 'sharepoint', fileName: 'SharePoint · BD_Orcamento · empresa 2 · obra 2070 · orçamento 3', lines: 16 })

    const lines = (await call<BudgetLineUsageDTO[]>('GET', `/works/${w.id}/budget-lines`)).data
    expect(lines.map((l) => l.activityWbs)).toEqual([...lines.map((l) => l.activityWbs)].sort())
    const aux = lines.filter((l) => l.aux)
    expect(aux.map((l) => l.code)).toEqual(['IM00012', 'IM00013', 'IM00014', 'IP00302'])
    expect(aux[0]!.aux).toEqual({ code: 'CPU00312', description: 'CONCRETO NÃO ESTRUTURAL', unit: 'm³', coefficient: '0.02545', unitCost: '405.3060' })
    expect(lines.find((l) => l.code === 'IS00012')!.aux).toBeNull()

    const logs = (await call<IntegrationLogDTO[]>('GET', '/integration/logs')).data
    expect(logs.find((l) => l.provider === 'sharepoint')).toMatchObject({ operation: 'importBudget', status: 'success', integrationId: '2|2070|3' })
    const options = (await call<WorkSetupOptionsDTO>('GET', '/work-setup/options')).data
    expect(options.companies[1]!.works.find((o) => o.code === '2070')!.existingWorkId).toBe(w.id)
  })

  it('recusa obra repetida, dados inválidos e usuário sem permissão', async () => {
    const dup = await call<ErrorBody>('POST', '/works/from-uau', body)
    expect([dup.status, dup.data.error.code]).toEqual([409, 'WORK_EXISTS'])
    expect(dup.data.error.details?.workId).toBeTruthy()
    // Mesmo código já cadastrado (obra sincronizada, sem chave UAU)
    expect((await call<ErrorBody>('POST', '/works/from-uau', { company: '1', work: '2041', budget: '1' })).data.error.code).toBe('WORK_EXISTS')
    expect((await call('POST', '/works/from-uau', { company: '2' })).status).toBe(422)
    expect((await call('POST', '/works/from-uau', body, PROC)).status).toBe(403)
  })
})

describe('atualizar orçamento pela planilha', () => {
  it('reimporta o mesmo orçamento como nova versão', async () => {
    const w = (await works()).find((x) => x.code === '2070')!
    const r = await call<SheetBudgetImportResult>('POST', `/works/${w.id}/budget-sheet/refresh`, {}, PROC)
    expect([r.status, r.data.id, r.data.budget.version]).toEqual([200, w.id, 2])
  })

  it('obra que não veio da planilha: explica que falta a chave da UAU', async () => {
    const w = (await works()).find((x) => x.code === '2055')!
    expect(w.uau).toBeNull()
    const r = await call<ErrorBody>('POST', `/works/${w.id}/budget-sheet/refresh`, { budget: '1' })
    expect([r.status, r.data.error.code]).toEqual([422, 'SHEET_BUDGET_REQUIRED'])
  })
})
