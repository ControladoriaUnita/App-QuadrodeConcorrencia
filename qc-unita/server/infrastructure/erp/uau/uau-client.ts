/**
 * Cliente HTTP da API UAU (Globaltec/Senior). Roda só no servidor: credenciais e token
 * nunca vão ao navegador, nem para o banco, nem para os logs.
 *
 *  - Autenticação: Autenticador/AutenticarUsuario → token em cache por 59 minutos;
 *    chamadas simultâneas compartilham o mesmo login; HTTP 401 renova o token uma vez.
 *  - Toda rota é POST em <base>/api/v1.0/<Controller>/<Metodo> com X-INTEGRATION-Authorization.
 *  - Somente leitura: rotas que gravam no UAU são sempre bloqueadas aqui.
 */
import { AppError } from '../../../application/context'

export interface UauConfig {
  baseUrl: string
  integrationToken: string
  login: string
  password: string
}

export interface UauResponse {
  route: string
  status: number
  ok: boolean
  ms: number
  /** Resposta já normalizada (ver normalize), sem campos de senha/token */
  data: unknown
}

export const uauError = (message: string) => new AppError('ERP_UAU', message, 502)

// Rotas de consulta começam com estes verbos; qualquer outra altera dados reais do UAU.
const READ_PREFIXES = ['Consultar', 'Obter', 'Buscar', 'Exportar', 'Retornar', 'Listar']

export function isReadRoute(route: string): boolean {
  const action = route.split('/').pop() ?? ''
  return READ_PREFIXES.some((p) => action.startsWith(p))
}

const TOKEN_TTL_MS = 59 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 45_000

export class UauClient {
  private token: string | null = null
  private tokenExpiresAt = 0
  private pendingLogin: Promise<string> | null = null

  constructor(private readonly config: UauConfig) {}

  /** Chama uma rota de consulta autenticado. Devolve status e dados normalizados. */
  async call(route: string, body: unknown, opts: { timeoutMs?: number } = {}): Promise<UauResponse> {
    if (!/^[A-Za-z]+\/[A-Za-z0-9]+$/.test(route) || /^Autenticador\//i.test(route)) {
      throw uauError(`Rota UAU inválida: ${route}`)
    }
    if (!isReadRoute(route)) throw uauError(`"${route}" grava no UAU; gravação não é permitida por este app.`)
    const started = Date.now()
    let res = await this.post(route, body, await this.getToken(), opts.timeoutMs)
    if (res.status === 401) {
      // O token pode ter sido invalidado no servidor antes dos 59 minutos
      this.token = null
      res = await this.post(route, body, await this.getToken(), opts.timeoutMs)
    }
    const ms = Date.now() - started
    log(`${route} → HTTP ${res.status} em ${ms} ms`)
    return { route, status: res.status, ok: res.status >= 200 && res.status < 300, ms, data: redact(normalize(res.data)) }
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token
    this.pendingLogin ??= this.authenticate().finally(() => {
      this.pendingLogin = null
    })
    return this.pendingLogin
  }

  private async authenticate(): Promise<string> {
    const res = await this.post('Autenticador/AutenticarUsuario', { Login: this.config.login, Senha: this.config.password })
    log(`login → HTTP ${res.status}`)
    if (res.status !== 200 || typeof res.data !== 'string' || !res.data.trim()) {
      // Não repassa a resposta inteira: em sucesso parcial poderia conter o token
      const reason = res.data && typeof res.data === 'object' ? String((res.data as Record<string, unknown>).Descricao ?? '') : ''
      const hint =
        res.status === 401 || res.status === 400
          ? ' Confira UAU_LOGIN, UAU_PASSWORD e UAU_INTEGRATION_TOKEN (na Vercel, cole os valores sem aspas).'
          : ''
      throw uauError(`O UAU recusou o login (HTTP ${res.status}). ${reason}${hint}`.replace(/\s+/g, ' ').trim())
    }
    this.token = res.data.trim()
    this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS
    return this.token
  }

  private async post(route: string, body: unknown, token?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ status: number; data: unknown }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-INTEGRATION-Authorization': this.config.integrationToken,
    }
    if (token) headers.Authorization = token
    try {
      const res = await fetch(`${this.config.baseUrl.replace(/\/+$/, '')}/api/v1.0/${route}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const text = await res.text()
      try {
        return { status: res.status, data: JSON.parse(text) }
      } catch {
        return { status: res.status, data: text }
      }
    } catch (err) {
      // A requisição nem teve resposta: traduz a causa técnica para algo acionável
      const message = describeNetworkError(err, timeoutMs)
      log(`${route} → falhou: ${message}`, 'warn')
      throw uauError(message)
    }
  }
}

// ----------------------------------------------------------------------------- erros e registro

/** Uma linha por chamada nos logs do servidor (Vercel → Logs). Nunca inclui corpo ou credenciais. */
function log(message: string, level: 'info' | 'warn' = 'info') {
  if (process.env.VITEST) return
  console[level](`[uau] ${message}`)
}

/** Falhas em que o UAU não chegou a responder. O código vem em `err.cause.code` (fetch do Node/undici). */
export function describeNetworkError(err: unknown, timeoutMs: number): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  const code = e?.cause?.code ?? ''
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return `O UAU não respondeu em ${Math.round(timeoutMs / 1000)} s. Ele pode estar lento ou sobrecarregado; tente de novo.`
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Endereço do UAU não encontrado. Confira UAU_BASE_URL.'
  if (code === 'ECONNREFUSED') return 'O servidor do UAU recusou a conexão (porta fechada ou bloqueio de firewall).'
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
    return 'Sem conexão com o UAU (tempo de conexão esgotado). Possível bloqueio por IP: o servidor publicado acessa por IPs diferentes do seu computador.'
  }
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'O UAU encerrou a conexão no meio (possível bloqueio por IP ou instabilidade).'
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return `Certificado HTTPS do UAU recusado (${code}).`
  return `Falha de rede ao chamar o UAU: ${code || e?.cause?.message || e?.message || 'erro desconhecido'}.`
}

// ----------------------------------------------------------------------------- normalização

/*
 * O UAU responde em dois formatos:
 *  1. lista simples de objetos;
 *  2. "DataSet": [{ MyTable: [linhaDeTipos, ...linhas] }] ou [linhaDeTipos, ...linhas], em que a
 *     linha de tipos tem valores "System.String, mscorlib, ..." e nulos vêm como a string "null".
 */
const isTypeRow = (row: unknown) =>
  !!row && typeof row === 'object' && Object.values(row).some((v) => typeof v === 'string' && v.includes(', mscorlib'))

export function normalize(data: unknown): unknown {
  if (!Array.isArray(data)) return data
  let rows: unknown[] = data
  const first = rows[0]
  if (rows.length === 1 && first && typeof first === 'object' && !Array.isArray(first)) {
    const values = Object.values(first)
    if (values.length === 1 && Array.isArray(values[0])) rows = values[0]
  }
  if (isTypeRow(rows[0])) rows = rows.slice(1)
  return rows.map((row) =>
    row && typeof row === 'object' ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === 'null' ? null : v])) : row,
  )
}

/** Acha a lista de registros em qualquer resposta (lista direta ou objeto que embrulha a lista). */
export function extractRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    const rows = normalize(data) as unknown[]
    if (rows.length === 1 && rows[0] && typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
      const inner = extractRows(rows[0])
      if (inner.length) return inner
    }
    return rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
  }
  if (!data || typeof data !== 'object') return []
  let best: Record<string, unknown>[] = []
  for (const v of Object.values(data)) {
    if (!Array.isArray(v)) continue
    const inner = extractRows(v)
    if (inner.length > best.length) best = inner
  }
  return best
}

/** Remove campos de senha/token (ex.: SenhaLoginPessoa) e o login da pessoa no portal (LoginPessoa). */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /senha|password|token|^loginpessoa$/i.test(k) ? '(omitido)' : redact(v)]))
  }
  return value
}
