/**
 * Microsoft Graph simulado para testes: token, usedRange e range(address=...) sobre uma matriz.
 */
import { columnName, parseArea, type CellValue } from './graph-client'

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers })

/** Graph simulado: uma aba com os valores dados (linha 1 = A1). Registra os endereços pedidos. */
export function fakeGraph(values: CellValue[][], opts: { sheet?: string; onRange?: (address: string) => Response | null } = {}) {
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
      return json(200, { address: `${opts.sheet ?? 'BD_Orcamentos'}!A1:${lastCol}${values.length}` })
    }
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
