/**
 * Nova obra pela UAU + orçamento da planilha BD_Orcamentos (modo memória: MockERPProvider e
 * MockBudgetSheetSource).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { BudgetLineUsageDTO, IntegrationLogDTO, SheetBudgetDTO, UauCompanyDTO, UauWorkOptionDTO, WorkDTO } from '../../shared/contracts'
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

describe('listas para a nova obra', () => {
  it('empresas e obras da UAU, marcando as que já estão no QC', async () => {
    expect((await call<UauCompanyDTO[]>('GET', '/uau/companies')).data.map((c) => c.code)).toEqual(['1', '2'])
    const options = (await call<UauWorkOptionDTO[]>('GET', '/uau/works')).data
    expect(options.map((o) => [o.company, o.code])).toEqual([['1', '2041'], ['1', '2055'], ['2', '1980'], ['2', '2070']])
    const alpha = (await works()).find((w) => w.code === '2041')!
    expect(options.find((o) => o.code === '2041')!.existingWorkId).toBe(alpha.id)
    expect(options.find((o) => o.code === '2070')!.existingWorkId).toBeNull()
  })

  it('orçamentos da planilha pelo código da obra (todas as empresas)', async () => {
    const r = await call<SheetBudgetDTO[]>('GET', '/budget-sheet/budgets?work=2070')
    expect(r.data).toEqual([expect.objectContaining({ company: '72', work: '2070', budget: '3', services: 5 })])
    expect((await call<SheetBudgetDTO[]>('GET', '/budget-sheet/budgets?work=2041')).data.map((b) => b.budget)).toEqual(['1', '2'])
    expect((await call('GET', '/budget-sheet/budgets')).status).toBe(422)
  })

  it('exige permissão de cadastrar obras (a lista de orçamentos também serve a quem reimporta)', async () => {
    expect((await call('GET', '/uau/works', undefined, PROC)).status).toBe(403)
    expect((await call('GET', '/uau/companies', undefined, PROC)).status).toBe(403)
    expect((await call('GET', '/budget-sheet/budgets?work=2041', undefined, PROC)).status).toBe(200)
  })
})

describe('criar obra pela UAU', () => {
  const body = { company: '2', work: '2070', budget: '3', sheetCompany: '72', clientName: 'SPE Beta' }

  it('orçamento inexistente → erro claro e nenhuma obra criada', async () => {
    const before = (await works()).length
    const r = await call<ErrorBody>('POST', '/works/from-uau', { ...body, budget: '9' })
    expect([r.status, r.data.error.code]).toEqual([404, 'SHEET_BUDGET_NOT_FOUND'])
    expect(r.data.error.message).toContain('Orçamento 9 da obra 2070 (empresa 72) não encontrado')
    expect((await works()).length).toBe(before)
  })

  it('cria a obra com a chave da UAU e o orçamento da planilha, auxiliares abertas', async () => {
    const r = await call<SheetBudgetImportResult>('POST', '/works/from-uau', body)
    expect(r.status).toBe(201)
    expect(r.data.budget).toMatchObject({ version: 1, lines: 14 })
    expect(r.data.warnings.join()).toContain('Vínculo PL')

    const w = (await works()).find((x) => x.id === r.data.id)!
    expect([w.code, w.name, w.clientName, w.status, w.erpId]).toEqual(['2070', 'Residencial Beta', 'SPE Beta', 'active', '2:2070'])
    expect(w.uau).toEqual({ company: '2', work: '2070', budget: '3', sheetCompany: '72' })
    expect(w.currentBudget).toMatchObject({ source: 'sharepoint', fileName: 'SharePoint · BD_Orcamentos · orçamento 3', lines: 14 })

    const lines = (await call<BudgetLineUsageDTO[]>('GET', `/works/${w.id}/budget-lines`)).data
    expect(lines.map((l) => l.activityWbs)).toEqual([...lines.map((l) => l.activityWbs)].sort())
    const aux = lines.filter((l) => l.aux)
    expect(aux.map((l) => l.code)).toEqual(['IM00012', 'IM00013', 'IM00014', 'IP00302'])
    expect(aux[0]!.aux).toEqual({ code: 'CPU00312', description: 'CONCRETO NÃO ESTRUTURAL', unit: 'm³', coefficient: '0.02545', unitCost: '405.3060' })
    expect(lines.find((l) => l.code === 'IS00012')!.aux).toBeNull()

    const logs = (await call<IntegrationLogDTO[]>('GET', '/integration/logs')).data
    expect(logs.find((l) => l.provider === 'sharepoint')).toMatchObject({ operation: 'importBudget', status: 'success', integrationId: '72|2070|3' })
    expect((await call<UauWorkOptionDTO[]>('GET', '/uau/works')).data.find((o) => o.code === '2070')!.existingWorkId).toBe(w.id)
  })

  it('recusa obra repetida, obra fora da UAU, dados inválidos e usuário sem permissão', async () => {
    const dup = await call<ErrorBody>('POST', '/works/from-uau', body)
    expect([dup.status, dup.data.error.code]).toEqual([409, 'WORK_EXISTS'])
    expect(dup.data.error.details?.workId).toBeTruthy()
    // Mesmo código já cadastrado (obra sincronizada, sem chave UAU)
    expect((await call<ErrorBody>('POST', '/works/from-uau', { company: '1', work: '2041', budget: '1' })).data.error.code).toBe('WORK_EXISTS')
    expect((await call<ErrorBody>('POST', '/works/from-uau', { ...body, work: 'X999' })).data.error.code).toBe('UAU_WORK_NOT_FOUND')
    expect((await call('POST', '/works/from-uau', { company: '2' })).status).toBe(422)
    expect((await call('POST', '/works/from-uau', body, PROC)).status).toBe(403)
  })
})

describe('atualizar orçamento pela planilha', () => {
  it('reimporta o mesmo orçamento como nova versão', async () => {
    const w = (await works()).find((x) => x.code === '2070')!
    const r = await call<SheetBudgetImportResult>('POST', `/works/${w.id}/budget-sheet/refresh`, {})
    expect([r.status, r.data.id, r.data.budget.version]).toEqual([200, w.id, 2])
  })

  it('obra sem orçamento da planilha: pede o nº e guarda o escolhido', async () => {
    const w = (await works()).find((x) => x.code === '2055')!
    expect(w.uau).toBeNull()
    const missing = await call<ErrorBody>('POST', `/works/${w.id}/budget-sheet/refresh`, {})
    expect([missing.status, missing.data.error.code]).toEqual([422, 'SHEET_BUDGET_REQUIRED'])

    const r = await call<SheetBudgetImportResult>('POST', `/works/${w.id}/budget-sheet/refresh`, { budget: '1', sheetCompany: '1' }, PROC)
    expect(r.status).toBe(200)
    const after = (await works()).find((x) => x.id === w.id)!
    expect(after.uau).toEqual({ company: '1', work: '2055', budget: '1', sheetCompany: '1' })
    expect(after.currentBudget).toMatchObject({ source: 'sharepoint', version: r.data.budget.version })
  })
})
