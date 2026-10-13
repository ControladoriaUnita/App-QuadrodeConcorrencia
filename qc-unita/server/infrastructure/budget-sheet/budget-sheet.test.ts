import { describe, expect, it } from 'vitest'
import { AppError } from '../../application/context'
import { fakeGraph } from '../microsoft-graph/fake-graph'
import { GraphClient, type CellValue } from '../microsoft-graph/graph-client'
import { createBudgetSheetSource, GraphBudgetSheetSource, MockBudgetSheetSource } from '.'
import { mockSheetRows } from './mock-budget-sheet'

const ref = { driveId: 'b!drive', itemId: 'ITEM', sheet: 'BD_Orcamentos' }
const credentials = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret' }

function graphSource(values = mockSheetRows() as CellValue[][]) {
  const g = fakeGraph(values)
  const source = new GraphBudgetSheetSource(new GraphClient(credentials, { fetch: g.fetch }), ref, { maxCells: 400 })
  return { g, source, values }
}

describe('MockBudgetSheetSource', () => {
  it('lista os orçamentos de exemplo por empresa + obra + nº', async () => {
    const list = await new MockBudgetSheetSource().listBudgets()
    expect(list.map((b) => [b.company, b.work, b.budget, b.services])).toEqual([
      ['2', '1980', '1', 5],
      ['1', '2041', '1', 5],
      ['1', '2041', '2', 5],
      ['1', '2055', '1', 5],
      ['2', '2070', '3', 5],
    ])
  })

  it('abre a composição auxiliar: um insumo por linha, com a auxiliar de origem', async () => {
    const b = await new MockBudgetSheetSource().loadBudget({ company: '1', work: '2041', budget: '1' })
    const aux = b.lines.filter((l) => l.aux)
    expect(aux.map((l) => l.lineKey)).toEqual(['01.02|CPU00312>IM00012', '01.02|CPU00312>IM00013', '01.02|CPU00312>IM00014', '01.02|CPU00312>IP00302'])
    expect(aux[0]!.aux).toMatchObject({ code: 'CPU00312', description: 'CONCRETO NÃO ESTRUTURAL', unit: 'm³', coefficient: '0.02545' })
    expect(b.groups.map((g) => g.wbs)).toEqual(['01', '02', '02.01', '02.02'])
  })
})

describe('GraphBudgetSheetSource', () => {
  it('lista pelo índice: só colunas de chave e total, em blocos, com cache', async () => {
    const { g, source } = graphSource()
    const list = await source.listBudgets()
    expect(list).toEqual(await new MockBudgetSheetSource().listBudgets())
    // Cabeçalho inteiro + colunas A:H (Empresa…QtdPai) e M:N (PrecoItem, PrecoFinal); nunca a linha inteira
    expect(g.calls[0]).toBe('usedRange')
    expect(g.calls[1]).toBe('A1:V1')
    const blocks = g.calls.slice(2)
    expect(blocks.every((a) => /^A\d+:H\d+$|^M\d+:N\d+$/.test(a))).toBe(true)
    expect(blocks.length).toBeGreaterThan(2)
    // Cache: a segunda consulta não chama o Graph
    const before = g.calls.length
    await source.listBudgets()
    expect(g.calls.length).toBe(before)
  })

  it('carrega o orçamento lendo só as linhas dele, com a linha real da aba', async () => {
    const { g, source, values } = graphSource()
    await source.listBudgets()
    g.calls.length = 0
    const key = { company: '1', work: '2041', budget: '2' }
    const b = await source.loadBudget(key)
    const expected = await new MockBudgetSheetSource().loadBudget(key)
    expect(b.lines.map(({ sourceRow: _s, ...l }) => l)).toEqual(expected.lines.map(({ sourceRow: _s, ...l }) => l))
    expect(b.total).toBe(expected.total)
    // Linhas inteiras (A:V) só da faixa do orçamento
    const rowsOfBudget = values.flatMap((r, i) => (r[1] === '2041' && r[2] === 2 ? [i + 1] : []))
    expect(g.calls.every((a) => /^A\d+:V\d+$/.test(a))).toBe(true)
    const perBlock = Math.floor(400 / 22)
    const first = rowsOfBudget[0]!
    expect(g.calls[0]).toBe(`A${first}:V${Math.min(rowsOfBudget.at(-1)!, first + perBlock - 1)}`)
    for (const l of b.lines) expect(values[l.sourceRow - 1]![14]).toBe(l.materialCode)
  })

  it('planilha mudou depois do índice → refaz o índice uma vez', async () => {
    const { source, values } = graphSource()
    await source.listBudgets()
    // Linha nova no topo: tudo desce uma linha
    values.splice(1, 0, [...values[1]!.slice(0, 1), 'P999Z', ...values[1]!.slice(2)])
    const b = await source.loadBudget({ company: '2', work: '1980', budget: '1' })
    expect(b.lines.length).toBeGreaterThan(0)
    expect(b.lines.every((l) => values[l.sourceRow - 1]![1] === '1980')).toBe(true)
  })

  it('orçamento inexistente → 404 claro', async () => {
    const err = await graphSource().source.loadBudget({ company: '1', work: '2041', budget: '9' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppError)
    expect([(err as AppError).status, (err as AppError).message]).toEqual([404, 'Orçamento 9 da obra 2041 (empresa 1) não encontrado na planilha.'])
  })
})

describe('createBudgetSheetSource', () => {
  it('escolhe a fonte pelo ambiente', () => {
    expect(createBudgetSheetSource({ DATA_SOURCE: 'memory' })).toBeInstanceOf(MockBudgetSheetSource)
    expect(createBudgetSheetSource({ MS_GRAPH_TENANT_ID: 't', MS_GRAPH_CLIENT_ID: 'c', MS_GRAPH_CLIENT_SECRET: 's' })).toBeInstanceOf(GraphBudgetSheetSource)
    // Na Vercel basta tenant + client (credencial federada)
    expect(createBudgetSheetSource({ DATA_SOURCE: 'supabase', VERCEL: '1', MS_GRAPH_TENANT_ID: 't', MS_GRAPH_CLIENT_ID: 'c' }).sheetName).toBe('BD_Orcamentos')
  })

  it('produção sem credenciais → lista as variáveis que faltam, sem valores', () => {
    expect(() => createBudgetSheetSource({ DATA_SOURCE: 'supabase', MS_GRAPH_TENANT_ID: 'segredo-do-tenant' })).toThrow(
      'Faltam: MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET (ou credencial federada da Vercel).',
    )
  })
})
