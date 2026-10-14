/**
 * Microsoft Graph simulado para testes: token, usedRange e range(address=...) sobre uma matriz,
 * mais metadados do arquivo e lista de abas.
 */
import { columnName, parseArea, type CellValue } from './graph-client'

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers })

/** Graph simulado: uma aba com os valores dados (linha 1 = A1). Registra os endereços pedidos. */
export function fakeGraph(values: CellValue[][], opts: { sheet?: string; onRange?: (address: string) => Response | null; file?: { name: string; sheets: string[] } } = {}) {
  const calls: string[] = []
  let tokens = 0
  const lastCol = columnName(Math.max(...values.map((r) => r.length)) - 1)
  const fetch = async (input: string | URL | Request) => {
    const url = decodeURIComponent(String(input))
    if (url.includes('login.microsoftonline.com')) {
      tokens++
      return json(200, { access_token: `tok${tokens}`, expires_in: 3600 })
    }
    if (url.includes('/usedRange(')) {
      calls.push('usedRange')
      return json(200, { address: `${opts.sheet ?? 'BD_Orcamento'}!A1:${lastCol}${values.length}` })
    }
    // Metadados do arquivo e lista de abas (diagnóstico do 404); sem `file`, o arquivo não existe
    if (/\/items\/[^/?]+(\?|$)/.test(url)) return opts.file ? json(200, { name: opts.file.name }) : json(404, { error: { message: 'itemNotFound' } })
    if (/\/workbook\/worksheets(\?|$)/.test(url)) return json(200, { value: (opts.file?.sheets ?? []).map((name) => ({ name })) })
    const address = /range\(address='([^']+)'\)/.exec(url)?.[1]
    if (!address) return json(400, { error: { message: `URL inesperada: ${url}` } })
    calls.push(address)
    const custom = opts.onRange?.(address)
    if (custom) return custom
    const a = parseArea(address)
    const rows = values.slice(a.firstRow - 1, a.lastRow).map((r) => Array.from({ length: a.lastColumn - a.firstColumn + 1 }, (_, j) => r[a.firstColumn + j] ?? ''))
    return json(200, { values: rows })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls, tokens: () => tokens }
}
