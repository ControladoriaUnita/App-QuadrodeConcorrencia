import { describe, expect, it } from 'vitest'
import { fakeGraph, json } from './fake-graph'
import { columnIndex, columnName, columnRuns, GraphClient, parseArea, rowSpans, type CellValue, type SheetRef } from './graph-client'

const ref: SheetRef = { driveId: 'b!drive', itemId: 'ITEM', sheet: 'BD_Orcamento' }
const credentials = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret' }

describe('endereços de planilha', () => {
  it('converte colunas e áreas', () => {
    expect([columnName(0), columnName(21), columnName(26), columnName(701)]).toEqual(['A', 'V', 'AA', 'ZZ'])
    expect([columnIndex('A'), columnIndex('V'), columnIndex('AA')]).toEqual([0, 21, 26])
    expect(parseArea("'BD Orçamentos'!B3:V250000")).toMatchObject({ firstColumn: 1, firstRow: 3, lastColumn: 21, lastRow: 250000 })
    expect(parseArea('Aba!C7')).toMatchObject({ firstColumn: 2, lastColumn: 2, firstRow: 7, lastRow: 7 })
  })

  it('agrupa colunas próximas e linhas contíguas', () => {
    expect(columnRuns([0, 1, 2, 4, 7, 12, 13])).toEqual([{ from: 0, to: 7 }, { from: 12, to: 13 }])
    expect(rowSpans([2, 3, 4, 9, 10, 15])).toEqual([[2, 4], [9, 10], [15, 15]])
  })
})

describe('GraphClient', () => {
  const sheet: CellValue[][] = [
    ['A', 'B', 'C', 'D', 'E'],
    ...Array.from({ length: 10 }, (_, i) => [i + 2, `b${i + 2}`, '', `d${i + 2}`, (i + 2) * 10]),
  ]

  it('lê a área usada e faixas em blocos, só as colunas pedidas', async () => {
    const g = fakeGraph(sheet)
    const client = new GraphClient(credentials, { fetch: g.fetch })
    expect(await client.usedRange(ref)).toMatchObject({ firstRow: 1, lastRow: 11, firstColumn: 0, lastColumn: 4 })
    // Colunas A, B e E: lidas juntas (A:E, buraco pequeno), mas só elas preenchidas; 15 células → 3 linhas por bloco
    const rows = await client.readRows(ref, { columns: [0, 1, 4], rows: [[2, 6], [9, 11]], maxCells: 15, concurrency: 2 })
    expect(rows).toHaveLength(8)
    expect(rows[0]).toEqual([2, 'b2', null, null, 20])
    expect(rows[5]).toEqual([9, 'b9', null, null, 90])
    expect(rows[7]).toEqual([11, 'b11', null, null, 110])
    expect(g.calls.filter((c) => c !== 'usedRange')).toEqual(['A2:E4', 'A5:E6', 'A9:E11'])
    // Colunas distantes: uma faixa por coluna
    g.calls.length = 0
    const sparse = await client.readRows(ref, { columns: [0, 4], rows: [[2, 11]], maxCells: 6 })
    expect(sparse.map((r) => r[4])).toEqual([20, 30, 40, 50, 60, 70, 80, 90, 100, 110])
    expect(g.calls.sort()).toEqual(['A2:A7', 'A8:A11', 'E2:E7', 'E8:E11'])
    // Um único login para todas as chamadas
    expect(g.tokens()).toBe(1)
  })

  it('espera e repete quando o Graph limita as requisições (429)', async () => {
    let throttled = 0
    const g = fakeGraph(sheet, { onRange: () => (throttled++ < 1 ? json(429, {}, { 'retry-after': '0' }) : null) })
    const rows = await new GraphClient(credentials, { fetch: g.fetch }).readRows(ref, { columns: [0], rows: [[2, 3]] })
    expect(rows.map((r) => r[0])).toEqual([2, 3])
    expect(throttled).toBe(2)
  })

  it('sem permissão no arquivo → explica o consentimento que falta', async () => {
    const g = fakeGraph(sheet, { onRange: () => json(403, { error: { message: 'Access denied' } }) })
    await expect(new GraphClient(credentials, { fetch: g.fetch }).rangeValues(ref, 'A1:A2')).rejects.toThrow(/Sites\.Read\.All/)
  })

  it('arquivo inacessível → aponta tenant, consentimento e as variáveis da planilha', async () => {
    const g = fakeGraph(sheet, { onRange: () => json(404, { error: { message: 'ItemNotFound' } }) })
    await expect(new GraphClient(credentials, { fetch: g.fetch }).rangeValues(ref, 'A1:A2')).rejects.toThrow(/ItemNotFound.*MS_GRAPH_TENANT_ID.*BUDGET_SHEET_ITEM_ID/)
  })

  it('arquivo existe mas sem a aba → lista as abas existentes', async () => {
    const file = { name: 'Orçamentos.xlsx', sheets: ['BD_Físico por atividade', 'BD_Orçamentos'] }
    const g = fakeGraph(sheet, { file, onRange: () => json(404, { error: { message: 'ItemNotFound' } }) })
    const err = (await new GraphClient(credentials, { fetch: g.fetch }).rangeValues(ref, 'A1:A2').catch((e: unknown) => e)) as Error
    expect(err.message).toContain('"Orçamentos.xlsx" foi encontrado, mas não tem a aba "BD_Orcamento"')
    expect(err.message).toContain('Abas existentes: BD_Físico por atividade, BD_Orçamentos.')
  })

  it('login recusado → mensagem do Entra sem o segredo', async () => {
    const fetch = (async () => json(401, { error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x' })) as typeof globalThis.fetch
    const err = (await new GraphClient(credentials, { fetch }).usedRange(ref).catch((e: unknown) => e)) as Error
    expect(err.message).toBe('Falha na autenticação com a Microsoft: AADSTS7000215: Invalid client secret provided.')
    expect(err.message).not.toContain('secret provided.\r')
  })

  it('credencial federada tem prioridade; recusada, cai no segredo', async () => {
    const proofs: string[] = []
    const fetch = (async (_url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init.body))
      if (body.get('client_assertion')) {
        proofs.push('federated')
        return json(400, { error_description: 'AADSTS70021: No matching federated identity record found.' })
      }
      if (body.get('client_secret')) {
        proofs.push('secret')
        return json(200, { access_token: 't', expires_in: 3600 })
      }
      return json(200, { address: 'BD_Orcamento!A1:B2' })
    }) as unknown as typeof globalThis.fetch
    const client = new GraphClient({ ...credentials, federatedAssertion: () => 'oidc' }, { fetch })
    await client.usedRange(ref)
    expect([proofs, client.lastMethod]).toEqual([['federated', 'secret'], 'secret'])
  })

  it('tempo esgotado → mensagem clara', async () => {
    const fetch = (async (_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))))) as unknown as typeof globalThis.fetch
    await expect(new GraphClient(credentials, { fetch, timeoutMs: 10 }).usedRange(ref)).rejects.toThrow('não respondeu em 0 s')
  })
})
