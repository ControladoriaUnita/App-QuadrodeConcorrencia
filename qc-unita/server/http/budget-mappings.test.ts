/**
 * De-para do orçamento e indireto aberto (modo memória: obra 2070 criada pelo SharePoint de
 * exemplo, que traz o indireto fechado nos itens 16.01 e 16.05).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { BudgetLineUsageDTO, BudgetMappingsDTO, BudgetStructureDTO, IndirectImportInput, WorkDTO, WorkIndirectDTO } from '../../shared/contracts'
import { parseIndirectWorkbook } from '../../shared/domain/budget/indirect-import'
import { WORKBOOK } from '../../shared/domain/budget/__fixtures__/indirect-workbook'
import type { SheetBudgetImportResult } from '../application/use-cases/work-setup'
import { DEMO_USERS } from '../infrastructure/memory/seed'
import { handle } from './router'

const [ADMIN, PROC, , MANAGER] = DEMO_USERS.map((u) => u.id)

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
type ErrorBody = { error: { code: string; message: string } }

const indirectFile = (): IndirectImportInput => ({ fileName: 'INDIRETO - 2070.xlsx', ...parseIndirectWorkbook(WORKBOOK) })
const lines = async (workId: string) => (await call<BudgetLineUsageDTO[]>('GET', `/works/${workId}/budget-lines`)).data
let beta: WorkDTO

beforeAll(async () => {
  process.env.DATA_SOURCE = 'memory'
  const r = await call<SheetBudgetImportResult>('POST', '/works/from-uau', { company: '2', work: '2070', budget: '3' })
  beta = (await call<WorkDTO[]>('GET', '/works')).data.find((w) => w.id === r.data.id)!
})

describe('de-para dos Itens', () => {
  it('o nome do de-para troca o "Item 02" genérico; o nome dado na obra vale sobre ele', async () => {
    const names = async () => (await call<BudgetStructureDTO>('GET', `/works/${beta.id}/budget-structure`)).data.groups.map((g) => [g.wbs, g.description])
    // 02.01 não está no de-para: fica o nome genérico
    expect(await names()).toEqual([['01', 'SERVIÇOS PRELIMINARES'], ['02', 'INFRAESTRUTURA'], ['02.01', 'Item 02.01'], ['02.02', 'TERRAPLENAGEM'], ['16', 'INDIRETO']])
    await call('PUT', `/works/${beta.id}/budget-groups`, { wbs: '02.02', description: 'Pintura interna' })
    expect((await names())[3]).toEqual(['02.02', 'Pintura interna'])
    await call('PUT', `/works/${beta.id}/budget-groups`, { wbs: '02.02', description: null })
    expect((await names())[3]).toEqual(['02.02', 'TERRAPLENAGEM'])
  })

  it('lista o de-para com os Itens das obras e a sugestão de nome; só quem mantém o catálogo', async () => {
    await call('PUT', `/works/${beta.id}/budget-groups`, { wbs: '01', description: 'Serviços iniciais' })
    const { data } = await call<BudgetMappingsDTO>('GET', '/budget-mappings')
    expect(data.items.find((i) => i.wbs === '01')).toMatchObject({ description: 'SERVIÇOS PRELIMINARES', mapped: true, suggestion: 'Serviços iniciais' })
    // Item que só existe nas obras (fora do de-para) também aparece, para completar
    expect(data.items.find((i) => i.wbs === '16.01')).toBeUndefined()
    expect(data.items.find((i) => !i.mapped)).toMatchObject({ description: null, planning: null })
    expect(data.items.find((i) => i.wbs === '02')!.works).toBeGreaterThan(1)
    expect(data.planningCodes.map((p) => p.code)).toContain('IP00104')
    expect((await call('GET', '/budget-mappings', undefined, PROC)).status).toBe(403)
    expect((await call('PUT', '/budget-mappings/items', { wbs: '02', description: 'X', planningCode: null }, PROC)).status).toBe(403)
    expect((await call('PUT', '/budget-mappings/items', { wbs: '02.a', description: 'X', planningCode: null })).status).toBe(422)
  })

  it('o IP do Item vai para as linhas abaixo dele na próxima versão; o IP escolhido na linha vale sobre ele', async () => {
    await call('PUT', '/budget-mappings/items', { wbs: '02', description: 'INFRAESTRUTURA', planningCode: 'IP00349', planningDescription: 'Oficial (com encargos)' })
    await call('PUT', '/budget-mappings/items', { wbs: '02.02', description: 'TERRAPLENAGEM', planningCode: 'IP00302', planningDescription: 'Servente' })
    const before = await lines(beta.id)
    const manual = before.find((l) => l.activityWbs === '02.01.01')!
    await call('PUT', `/works/${beta.id}/budget-lines/planning`, { lineKey: manual.lineKey, code: 'IP00104', description: 'Terraplenagem' })

    const r = await call<SheetBudgetImportResult>('POST', `/works/${beta.id}/budget-sheet/refresh`, {})
    expect(r.data.warnings).toContain('9 linha(s) sem IP no de-para dos Itens: ficam sem IP até o planejamento escolher.')
    const after = await lines(beta.id)
    const ip = (wbs: string) => [...new Set(after.filter((l) => l.activityWbs === wbs).map((l) => l.packageCode))]
    expect([ip('02.01.02'), ip('02.02.01'), ip('01.01')]).toEqual([['IP00349'], ['IP00302'], [null]])
    expect(after.find((l) => l.lineKey === manual.lineKey)).toMatchObject({ packageCode: 'IP00104', packageManual: true })
    // Tirar do de-para (sem nome e sem IP)
    expect((await call('PUT', '/budget-mappings/items', { wbs: '02.02', description: null, planningCode: null })).status).toBe(200)
    expect((await call<BudgetMappingsDTO>('GET', '/budget-mappings')).data.items.find((i) => i.wbs === '02.02')).toMatchObject({ mapped: false, description: null, planning: null })
  })
})

describe('indireto aberto', () => {
  it('abre o indireto fechado do SharePoint insumo a insumo, com o IP do de-para do indireto', async () => {
    // Antes de importar: nenhum indireto em uso (resposta explícita, não um "ok")
    expect((await call('GET', `/works/${beta.id}/indirect`)).data).toEqual({ indirect: null })
    await call('PUT', '/budget-mappings/indirect', { description: 'ALMOXARIFE', planningCode: 'IP00302', planningDescription: 'Servente' })
    const r = await call<SheetBudgetImportResult>('POST', `/works/${beta.id}/indirect`, indirectFile())
    expect(r.status).toBe(201)
    expect(r.data.warnings).toContain('Item 16.06 MÃO DE OBRA INDIRETA - PJ não existia no orçamento: entrou com o indireto.')

    const all = await lines(beta.id)
    const indirect = all.filter((l) => l.activityWbs.startsWith('16.'))
    expect(indirect.some((l) => l.code === 'IS00800' || l.code === 'IS00805')).toBe(false)
    expect(indirect.filter((l) => l.activityWbs === '16.01').map((l) => [l.description, l.quantity, l.total])).toEqual([
      ['Carrinho de mão - 80l', '2.0000', '1300.0000'],
      ['Locação de pick-up', '1.0000', '150.0000'],
    ])
    expect(indirect.find((l) => l.description === 'Almoxarife')!.packageCode).toBe('IP00302')
    expect(indirect.find((l) => l.description === 'Engenheiro Pleno')!.packageCode).toBeNull()

    const stored = (await call<{ indirect: WorkIndirectDTO }>('GET', `/works/${beta.id}/indirect`)).data.indirect
    expect(stored).toMatchObject({ fileName: 'INDIRETO - 2070.xlsx', total: '31050.0000' })
    expect(stored.items.map((i) => i.wbs)).toEqual(['16.01', '16.05', '16.06', '16.09'])
  })

  it('"Atualizar dados" reaplica o indireto guardado; o de-para novo do indireto já vale', async () => {
    await call('PUT', '/budget-mappings/indirect', { description: 'Engenheiro Pleno', planningCode: 'IP00349', planningDescription: 'Oficial' })
    await call('POST', `/works/${beta.id}/budget-sheet/refresh`, {})
    const all = await lines(beta.id)
    expect(all.some((l) => l.code === 'IS00805')).toBe(false)
    expect(all.find((l) => l.description === 'Engenheiro Pleno')!.packageCode).toBe('IP00349')
    const { data } = await call<BudgetMappingsDTO>('GET', '/budget-mappings')
    expect(data.indirect.find((i) => i.description === 'Carrinho de mão - 80l')).toMatchObject({ planning: null, items: ['16.01 EQUIPAMENTOS'], works: 1 })
  })

  it('recusa arquivo de outra obra, obra sem SharePoint e usuário sem permissão', async () => {
    const other = indirectFile()
    other.items = other.items.map((i) => ({ ...i, wbs: i.wbs.replace(/^16/, '19') }))
    const r = await call<ErrorBody>('POST', `/works/${beta.id}/indirect`, other)
    expect([r.status, r.data.error.code]).toEqual([422, 'INDIRECT_MISMATCH'])

    const alpha = (await call<WorkDTO[]>('GET', '/works')).data.find((w) => w.code === '2041')!
    expect((await call<ErrorBody>('POST', `/works/${alpha.id}/indirect`, indirectFile())).data.error.code).toBe('SHEET_BUDGET_REQUIRED')
    // Gerente de obra vê o orçamento, mas não importa
    expect((await call('POST', `/works/${beta.id}/indirect`, indirectFile(), MANAGER)).status).toBe(403)
  })
})

describe('concorrência só com o orçamento 100% completo', () => {
  type Created = { competitionId: string }
  const create = async (user = ADMIN) => {
    const line = (await lines(beta.id))[0]!
    return call<Created & ErrorBody & { error: { details: { linesWithoutPlanning: number; unnamedItems: string[] } } }>(
      'POST', '/competitions', { workId: beta.id, title: 'Teste de bloqueio', lineIds: [line.id] }, user,
    )
  }

  it('com linhas sem IP ou Itens sem nome, recusa e diz o que falta', async () => {
    const r = await create()
    expect([r.status, r.data.error.code]).toEqual([409, 'BUDGET_INCOMPLETE'])
    // 02.01 nunca esteve no de-para; 02.02 saiu dele no teste acima
    expect(r.data.error.details.unnamedItems).toEqual(['02.01', '02.02'])
    expect(r.data.error.details.linesWithoutPlanning).toBeGreaterThan(0)
    expect(r.data.error.message).toContain('2 Item(ns) sem nome (02.01, 02.02)')
  })

  it('completando nome e IPs pelo de-para e atualizando os dados, cria', async () => {
    await call('PUT', '/budget-mappings/items', { wbs: '01', description: 'SERVIÇOS PRELIMINARES', planningCode: 'IP00104', planningDescription: 'Terraplenagem' })
    await call('PUT', '/budget-mappings/items', { wbs: '02.01', description: 'PISOS', planningCode: null })
    await call('PUT', '/budget-mappings/items', { wbs: '02.02', description: 'TERRAPLENAGEM', planningCode: null })
    await call('PUT', '/budget-mappings/items', { wbs: '16', description: 'INDIRETO', planningCode: 'IP00349', planningDescription: 'Oficial' })
    await call('POST', `/works/${beta.id}/budget-sheet/refresh`, {})
    expect((await lines(beta.id)).filter((l) => !l.packageCode?.startsWith('IP'))).toEqual([])
    const r = await create()
    expect(r.status).toBe(201)
    expect(r.data.competitionId).toBeTruthy()
  })
})
