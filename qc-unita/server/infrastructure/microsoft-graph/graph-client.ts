/**
 * Cliente mínimo do Microsoft Graph (app-only / client credentials), sem SDK. Roda só no servidor.
 *
 *  - Identidade do app no Entra ID: credencial federada da Vercel (token OIDC da implantação como
 *    client_assertion, sem segredo) ou, na falta dela, MS_GRAPH_CLIENT_SECRET.
 *  - Token em cache até pouco antes de expirar.
 *  - Planilhas grandes são lidas em BLOCOS de linhas por endereço (range(address='A2:V5001')),
 *    nunca num usedRange gigante: cada resposta fica pequena e dentro do tempo da função.
 *  - `fetch` injetável para testes.
 */
import { AppError } from '../../application/context'

export interface GraphCredentials {
  tenantId: string
  clientId: string
  /** Opcional quando há asserção federada */
  clientSecret?: string | null
  /** Token OIDC da implantação (Vercel), ou null fora dela */
  federatedAssertion?: () => string | null
}

/** Planilha: arquivo no SharePoint/OneDrive + aba */
export interface SheetRef {
  driveId: string
  itemId: string
  sheet: string
}

/** Área usada da aba (linhas 1-based, colunas 0-based: A = 0) */
export interface SheetArea {
  address: string
  firstRow: number
  lastRow: number
  firstColumn: number
  lastColumn: number
}

export type CellValue = string | number | boolean | null

export interface ReadRowsOptions {
  /** Colunas a ler (0-based: A = 0). As demais ficam null na linha devolvida. */
  columns: number[]
  /** Faixas de linhas [de, até] (1-based, inclusivas), lidas na ordem dada */
  rows: [number, number][]
  /** Células por chamada (define o tamanho do bloco de linhas) */
  maxCells?: number
  /** Chamadas simultâneas */
  concurrency?: number
}

export class GraphError extends AppError {
  constructor(
    message: string,
    /** Status HTTP do Graph/Entra (0 = sem resposta) */
    readonly graphStatus: number,
  ) {
    super('SHAREPOINT', message, 502, { graphStatus })
    this.name = 'GraphError'
  }
}

type Fetch = typeof fetch

const GRAPH = 'https://graph.microsoft.com/v1.0'
const JWT_BEARER = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_RETRIES = 2

export class GraphClient {
  private token: { value: string; expiresAt: number } | null = null
  private pendingToken: Promise<string> | null = null
  private readonly fetchImpl: Fetch
  private readonly timeoutMs: number
  /** Como o último token foi obtido */
  lastMethod: 'federated' | 'secret' | null = null

  constructor(
    private readonly credentials: GraphCredentials,
    opts: { fetch?: Fetch; timeoutMs?: number } = {},
  ) {
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args))
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  // --------------------------------------------------------------------------- planilhas
  /** Endereço da área usada da aba (sem os valores). */
  async usedRange(ref: SheetRef): Promise<SheetArea> {
    const body = (await this.get(`${sheetUrl(ref)}/usedRange(valuesOnly=true)?$select=address`, ref)) as { address?: string }
    if (!body.address) throw new GraphError(`O Microsoft Graph não informou a área usada da aba "${ref.sheet}".`, 200)
    return parseArea(body.address)
  }

  /** Valores de uma faixa (ex.: "A2:V5001"). */
  async rangeValues(ref: SheetRef, address: string): Promise<CellValue[][]> {
    const url = `${sheetUrl(ref)}/range(address='${encodeURIComponent(address)}')?$select=values`
    const body = (await this.get(url, ref)) as { values?: CellValue[][] }
    return body.values ?? []
  }

  /**
   * Lê linhas em blocos: só as colunas pedidas (agrupadas em faixas contíguas) e só as faixas de
   * linhas pedidas. Devolve uma linha por linha pedida, na mesma ordem, indexada pela coluna.
   */
  async readRows(ref: SheetRef, opts: ReadRowsOptions): Promise<CellValue[][]> {
    const runs = columnRuns(opts.columns)
    const wanted = new Set(opts.columns)
    const width = Math.max(-1, ...opts.columns) + 1
    const total = opts.rows.reduce((n, [from, to]) => n + Math.max(0, to - from + 1), 0)
    const out: CellValue[][] = Array.from({ length: total }, () => new Array<CellValue>(width).fill(null))

    const tasks: (() => Promise<void>)[] = []
    let base = 0
    for (const [from, to] of opts.rows) {
      for (const run of runs) {
        const runWidth = run.to - run.from + 1
        const blockRows = Math.max(1, Math.floor((opts.maxCells ?? 100_000) / runWidth))
        for (let start = from; start <= to; start += blockRows) {
          const end = Math.min(to, start + blockRows - 1)
          const offset = base + (start - from)
          tasks.push(async () => {
            const values = await this.rangeValues(ref, `${columnName(run.from)}${start}:${columnName(run.to)}${end}`)
            values.forEach((row, i) => {
              const target = out[offset + i]
              if (!target) return
              row.forEach((v, j) => {
                if (wanted.has(run.from + j)) target[run.from + j] = v === '' ? null : v
              })
            })
          })
        }
      }
      base += Math.max(0, to - from + 1)
    }
    await runLimited(tasks, opts.concurrency ?? 4)
    return out
  }

  // --------------------------------------------------------------------------- HTTP
  private async get(url: string, ref: SheetRef): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.send(url, { headers: { authorization: `Bearer ${await this.accessToken()}` } })
      // Limite de requisições / indisponibilidade momentânea: espera e tenta de novo
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < MAX_RETRIES) {
        await sleep(Math.min(Number(res.headers.get('retry-after') ?? 1) || 0, 10) * 1000)
        continue
      }
      if (res.ok) return res.json()
      if (res.status === 401 || res.status === 403) {
        // O login funcionou (há token), mas o app não tem acesso ao arquivo
        this.token = null
        throw new GraphError(
          `O login na Microsoft funcionou, mas o aplicativo não tem permissão para ler a planilha de orçamentos (Graph ${res.status}). ` +
            'Falta o consentimento do administrador para Sites.Read.All (ou a liberação do site no Sites.Selected). ' +
            'Depois de concedido, aguarde alguns minutos e tente de novo.',
          res.status,
        )
      }
      const detail = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? res.statusText
      if (res.status === 404) throw new GraphError(await this.describeNotFound(ref, detail), 404)
      throw new GraphError(`O Microsoft Graph respondeu ${res.status} ao ler a aba "${ref.sheet}": ${detail}`, res.status)
    }
  }

  /** 404 na aba: separa "arquivo inacessível" de "aba com outro nome" (e lista as abas que existem). */
  private async describeNotFound(ref: SheetRef, detail: string): Promise<string> {
    const auth = { headers: { authorization: `Bearer ${await this.accessToken()}` } }
    const item = await this.send(`${itemUrl(ref)}?$select=name`, auth).catch(() => null)
    if (item?.ok) {
      const { name } = (await item.json().catch(() => ({}))) as { name?: string }
      const sheets = await this.send(`${itemUrl(ref)}/workbook/worksheets?$select=name`, auth).catch(() => null)
      const list = sheets?.ok ? (((await sheets.json().catch(() => ({}))) as { value?: { name?: string }[] }).value ?? []).map((s) => s.name) : []
      return (
        `O arquivo "${name ?? ref.itemId}" foi encontrado, mas não tem a aba "${ref.sheet}". ` +
        (list.length ? `Abas existentes: ${list.join(', ')}. ` : '') +
        'Renomeie a aba ou ajuste BUDGET_SHEET_NAME.'
      )
    }
    if (item?.status === 401 || item?.status === 403) {
      return 'O login na Microsoft funcionou, mas o aplicativo não tem permissão para abrir o arquivo da planilha de orçamentos. Confira o consentimento do administrador para Sites.Read.All.'
    }
    return (
      `O aplicativo não encontrou o arquivo da planilha de orçamentos no SharePoint (Graph 404: ${detail}). ` +
      'Confira se o app foi registrado no Entra ID do mesmo tenant do SharePoint (MS_GRAPH_TENANT_ID), ' +
      'se o consentimento para Sites.Read.All foi concedido e se BUDGET_SHEET_DRIVE_ID / BUDGET_SHEET_ITEM_ID apontam para o arquivo certo.'
    )
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (err) {
      const e = err as { name?: string; message?: string; cause?: { code?: string } }
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw new GraphError(`A Microsoft não respondeu em ${Math.round(this.timeoutMs / 1000)} s. Tente de novo em instantes.`, 0)
      }
      throw new GraphError(`Falha de rede ao chamar a Microsoft: ${e?.cause?.code ?? e?.message ?? 'erro desconhecido'}.`, 0)
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value
    // Blocos lidos em paralelo compartilham o mesmo login
    this.pendingToken ??= this.login().finally(() => (this.pendingToken = null))
    return this.pendingToken
  }

  private async login(): Promise<string> {
    const { clientSecret } = this.credentials
    const assertion = this.credentials.federatedAssertion?.() ?? null
    let res: Response | null = null
    if (assertion) {
      res = await this.requestToken({ client_assertion_type: JWT_BEARER, client_assertion: assertion })
      this.lastMethod = 'federated'
    }
    // Credencial federada ausente ou recusada → segredo, se houver
    if ((!res || !res.ok) && clientSecret) {
      res = await this.requestToken({ client_secret: clientSecret })
      this.lastMethod = 'secret'
    }
    if (!res) throw new GraphError('Sem credencial para a Microsoft: configure a credencial federada (Vercel) ou MS_GRAPH_CLIENT_SECRET.', 401)
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string }
    if (!res.ok || !body.access_token) {
      // A descrição do Entra não contém o segredo; pode ser mostrada
      throw new GraphError(`Falha na autenticação com a Microsoft: ${body.error_description?.split('\r\n')[0] ?? `HTTP ${res.status}`}`, res.status)
    }
    this.token = { value: body.access_token, expiresAt: Date.now() + Math.max((body.expires_in ?? 3600) - 120, 60) * 1000 }
    return this.token.value
  }

  private requestToken(proof: Record<string, string>): Promise<Response> {
    const { tenantId, clientId } = this.credentials
    return this.send(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, scope: 'https://graph.microsoft.com/.default', ...proof }),
    })
  }
}

// ----------------------------------------------------------------------------- endereços
const itemUrl = (ref: SheetRef) => `${GRAPH}/drives/${encodeURIComponent(ref.driveId)}/items/${encodeURIComponent(ref.itemId)}`

const sheetUrl = (ref: SheetRef) => `${itemUrl(ref)}/workbook/worksheets('${encodeURIComponent(ref.sheet.replace(/'/g, "''"))}')`

/** 0 → A, 25 → Z, 26 → AA */
export function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

/** A → 0, Z → 25, AA → 26 */
export function columnIndex(name: string): number {
  return [...name.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
}

/** "BD_Orcamento!A1:V250000" (ou "'Aba X'!B3") → área */
export function parseArea(address: string): SheetArea {
  const ref = address.slice(address.lastIndexOf('!') + 1)
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(ref)
  if (!m) throw new GraphError(`Endereço da área usada inesperado: ${address}`, 200)
  return {
    address,
    firstColumn: columnIndex(m[1]!),
    firstRow: Number(m[2]),
    lastColumn: columnIndex(m[3] ?? m[1]!),
    lastRow: Number(m[4] ?? m[2]),
  }
}

/** Agrupa colunas em faixas contíguas; buracos de até 2 colunas são lidos junto (menos chamadas). */
export function columnRuns(columns: number[], maxGap = 2): { from: number; to: number }[] {
  const sorted = [...new Set(columns)].filter((c) => c >= 0).sort((a, b) => a - b)
  const runs: { from: number; to: number }[] = []
  for (const c of sorted) {
    const last = runs.at(-1)
    if (last && c - last.to - 1 <= maxGap) last.to = c
    else runs.push({ from: c, to: c })
  }
  return runs
}

/** Agrupa números de linha (em ordem) em faixas contíguas [de, até]. */
export function rowSpans(rows: number[]): [number, number][] {
  const spans: [number, number][] = []
  for (const r of rows) {
    const last = spans.at(-1)
    if (last && r === last[1] + 1) last[1] = r
    else spans.push([r, r])
  }
  return spans
}

async function runLimited(tasks: (() => Promise<void>)[], limit: number) {
  let next = 0
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]!()
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), tasks.length) }, worker))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
