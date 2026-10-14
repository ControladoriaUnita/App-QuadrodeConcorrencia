/**
 * ERPProvider da UAU. Hoje implementa a leitura de fornecedores (sincronização) e as listas de
 * empresas e obras ativas (seletor de "Nova obra"); o resto lança ErpNotConfiguredError e fica
 * fora da sincronização "Tudo" (ver `supports`).
 */
import {
  byCompanyAndCode,
  ErpNotConfiguredError,
  type ERPProvider,
  type ErpCompany,
  type ErpOperation,
  type ErpSupplier,
  type ErpWorkMaterial,
  type ErpWorkOption,
} from '../erp-provider'
import { extractRows, uauError, UauClient, type UauConfig } from './uau-client'
import { selectUauSuppliers } from './uau-suppliers'

export interface UauProviderOptions {
  /**
   * Códigos de pessoa por chamada (cod_pes). 500 ≈ 0,7 s na UAU; faixas de 1.000–2.000
   * (respostas de 2–4 MB) às vezes levam 15–45 s, então faixas menores saem bem mais rápidas.
   */
  rangeSize?: number
  /** Para depois de tantos códigos seguidos sem ninguém (fim do cadastro; tolera buracos menores). */
  stopAfterEmptyCodes?: number
  /** Teto de segurança de cod_pes lidos, caso a parada por faixas vazias falhe. */
  maxCode?: number
  /** Tempo total da leitura; acima disso falha com mensagem clara antes do limite da Vercel (60 s). */
  deadlineMs?: number
}

const PEOPLE_ROUTE = 'Pessoas/ConsultarPessoasPorCondicao'
const COMPANIES_ROUTE = 'Empresa/ObterEmpresasAtivas'
const WORKS_ROUTE = 'Obras/ObterObrasAtivas'
const WORK_MATERIALS_ROUTE = 'Orcamento/ConsultarInsumosPorChave'
/** As listas mudam pouco: guardadas por alguns minutos na instância */
const LIST_TTL_MS = 5 * 60 * 1000

export class UauERPProvider implements ERPProvider {
  readonly name = 'uau' as const
  readonly supports: ReadonlySet<ErpOperation> = new Set<ErpOperation>(['suppliers'])
  private readonly client: UauClient
  private readonly rangeSize: number
  private readonly maxCode: number
  private readonly stopAfterEmptyCodes: number
  private readonly deadlineMs: number
  private readonly lists = new Map<string, { at: number; value: Promise<unknown> }>()

  constructor(config: UauConfig, opts: UauProviderOptions = {}) {
    this.client = new UauClient(config)
    this.rangeSize = opts.rangeSize ?? 500
    this.maxCode = opts.maxCode ?? 200_000
    this.stopAfterEmptyCodes = opts.stopAfterEmptyCodes ?? 4000
    this.deadlineMs = opts.deadlineMs ?? 45_000
  }

  /**
   * Lê o cadastro de pessoas em faixas de cod_pes, uma chamada por vez (para não
   * sobrecarregar a UAU), até `stopAfterEmptyCodes` códigos seguidos sem ninguém ou passar do teto.
   * Qualquer falha interrompe tudo: lista parcial não pode chegar à gravação (inativaria fornecedores).
   */
  async getSuppliers(): Promise<ErpSupplier[]> {
    const rows: Record<string, unknown>[] = []
    const deadline = Date.now() + this.deadlineMs
    let emptyCodes = 0
    for (let from = 0; from < this.maxCode && emptyCodes < this.stopAfterEmptyCodes; from += this.rangeSize) {
      const left = deadline - Date.now()
      if (left <= 0) throw uauError(`A leitura de pessoas da UAU passou de ${Math.round(this.deadlineMs / 1000)} s (parou no código ${from}). A UAU pode estar lenta; tente de novo.`)
      const res = await this.client.call(
        PEOPLE_ROUTE,
        { condicaoConsultarPessoa: `cod_pes > ${from} and cod_pes <= ${from + this.rangeSize}` },
        { timeoutMs: Math.min(left, 25_000) },
      )
      if (!res.ok) throw uauError(`A UAU respondeu HTTP ${res.status} ao consultar pessoas (faixa ${from + 1}–${from + this.rangeSize}).${describe(res.data)}`)
      const page = extractRows(res.data)
      emptyCodes = page.length ? 0 : emptyCodes + this.rangeSize
      rows.push(...page)
    }
    const { suppliers, stats } = selectUauSuppliers(rows)
    if (!process.env.VITEST) {
      console.info(`[uau] pessoas lidas ${stats.read}; fornecedores ${suppliers.length} (físicas ${stats.individual}, inativas ${stats.inactive}, inválidas ${stats.invalid}, CNPJ repetido ${stats.duplicates})`)
    }
    return suppliers
  }

  /** Empresas ativas (Codigo_emp · Desc_emp), por código */
  listCompanies(): Promise<ErpCompany[]> {
    return this.cachedList('companies', async () => {
      const rows = await this.readList(COMPANIES_ROUTE, 'empresas')
      return rows
        .map((r) => ({ code: str(r.Codigo_emp), name: str(r.Desc_emp) }))
        .filter((c) => c.code)
        .sort((a, b) => Number(a.code) - Number(b.code) || a.code.localeCompare(b.code))
    })
  }

  /** Obras ativas (Cod_obr · Empresa_obr · Descr_obr), todos os tipos de obra, por empresa e código */
  listWorkOptions(): Promise<ErpWorkOption[]> {
    return this.cachedList('works', async () => {
      const rows = await this.readList(WORKS_ROUTE, 'obras')
      const seen = new Set<string>()
      return rows
        .map((r) => ({ company: str(r.Empresa_obr), code: str(r.Cod_obr).toUpperCase(), name: str(r.Descr_obr) || str(r.Cod_obr) }))
        .filter((w) => w.company && w.code && !seen.has(`${w.company}|${w.code}`) && seen.add(`${w.company}|${w.code}`))
        .sort(byCompanyAndCode)
    })
  }

  /**
   * Insumos do orçamento da obra (Cod_ins · Descr_ins · CodUn_InsO), sem
   * quantidade nem preço. ~2 s para ~640 insumos; os IPs são os de código "IP…".
   */
  listWorkMaterials(key: { company: string; work: string; budget: string }): Promise<ErpWorkMaterial[]> {
    return this.cachedList(`materials|${key.company}|${key.work}|${key.budget}`, async () => {
      const body = { empresa: Number(key.company), obra: key.work, orcamento: Number(key.budget), composicao: '' }
      const res = await this.client.call(WORK_MATERIALS_ROUTE, body, { timeoutMs: 30_000 })
      if (!res.ok) throw uauError(`A UAU respondeu HTTP ${res.status} ao listar os insumos da obra ${key.work}.${describe(res.data)}`)
      const seen = new Set<string>()
      return extractRows(res.data)
        .map((r) => ({
          code: str(r.Cod_ins).toUpperCase(),
          description: str(r.Descr_ins),
          unit: str(r.CodUn_InsO) || str(r.CodUn_UnIns),
        }))
        .filter((m) => m.code && !seen.has(m.code) && seen.add(m.code))
        .sort((a, b) => a.code.localeCompare(b.code))
    })
  }

  private async readList(route: string, what: string): Promise<Record<string, unknown>[]> {
    const res = await this.client.call(route, {}, { timeoutMs: 20_000 })
    if (!res.ok) throw uauError(`A UAU respondeu HTTP ${res.status} ao listar ${what}.${describe(res.data)}`)
    return extractRows(res.data)
  }

  private cachedList<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.lists.get(key)
    if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.value as Promise<T>
    const value = load()
    this.lists.set(key, { at: Date.now(), value })
    // Falha não fica em cache
    value.catch(() => this.lists.delete(key))
    return value
  }

  getWorks(): Promise<never> { return this.pending('Obras') }
  getWork(): Promise<never> { return this.pending('Obras') }
  getBudget(): Promise<never> { return this.pending('Orçamentos') }
  getMaterials(): Promise<never> { return this.pending('Insumos') }
  pushContract(): Promise<never> { return this.pending('Envio de contrato') }

  private pending(what: string): Promise<never> {
    return Promise.reject(new ErpNotConfiguredError(this.name, `${what}: ainda não implementado para a UAU.`))
  }
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

/** Mensagem curta que a UAU manda nos erros (sem repassar a resposta inteira). */
function describe(data: unknown): string {
  if (typeof data === 'string') return data.trim() ? ` ${data.trim().slice(0, 200)}` : ''
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>
    const msg = d.Descricao ?? d.Message ?? d.message
    if (msg) return ` ${String(msg).slice(0, 200)}`
  }
  return ''
}
