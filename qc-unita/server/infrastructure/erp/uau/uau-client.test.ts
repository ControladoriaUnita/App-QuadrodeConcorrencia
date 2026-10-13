import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeNetworkError, extractRows, isReadRoute, normalize, redact, UauClient } from './uau-client'

const config = { baseUrl: 'https://uau.example/uauAPI/', integrationToken: 'int', login: 'user', password: 'pass' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

afterEach(() => vi.unstubAllGlobals())

describe('normalização das respostas da UAU', () => {
  it('desembrulha DataSet, descarta a linha de tipos e troca "null" por null', () => {
    const dataSet = [{ MyTable: [{ Codigo: 'System.Int32, mscorlib', Nome: 'System.String, mscorlib' }, { Codigo: 1, Nome: 'null' }] }]
    expect(normalize(dataSet)).toEqual([{ Codigo: 1, Nome: null }])
    expect(normalize({ a: 1 })).toEqual({ a: 1 })
  })

  it('extractRows acha a lista em lista direta, DataSet ou objeto que embrulha', () => {
    expect(extractRows([{ a: 1 }, { a: 2 }])).toHaveLength(2)
    expect(extractRows([{ MyTable: [{ a: 'System.String, mscorlib' }, { a: 'x' }] }])).toEqual([{ a: 'x' }])
    expect(extractRows({ total: 2, itens: [{ a: 1 }, { a: 2 }] })).toHaveLength(2)
    expect(extractRows('erro')).toEqual([])
    expect(extractRows([])).toEqual([])
  })

  it('redact remove senha, token e login da pessoa, inclusive em listas aninhadas', () => {
    const out = redact([{ NomePessoa: 'X', SenhaLoginPessoa: 's', LoginPessoa: 'l', Lista: [{ token: 't', ok: 1 }] }]) as Record<string, unknown>[]
    expect(out[0]).toEqual({ NomePessoa: 'X', SenhaLoginPessoa: '(omitido)', LoginPessoa: '(omitido)', Lista: [{ token: '(omitido)', ok: 1 }] })
  })
})

describe('UauClient', () => {
  it('só permite rotas de consulta', async () => {
    expect(isReadRoute('Pessoas/ConsultarPessoasPorCondicao')).toBe(true)
    expect(isReadRoute('Pessoas/GravarPessoa')).toBe(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(new UauClient(config).call('Pessoas/GravarPessoa', {})).rejects.toThrow('gravação não é permitida')
    await expect(new UauClient(config).call('Autenticador/AutenticarUsuario', {})).rejects.toThrow('Rota UAU inválida')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('faz login uma vez para chamadas simultâneas e renova o token em 401', async () => {
    let logins = 0
    let rejectedOnce = false
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>
      expect(headers['X-INTEGRATION-Authorization']).toBe('int')
      if (url.endsWith('/api/v1.0/Autenticador/AutenticarUsuario')) return json(200, `tok${++logins}`)
      expect(url).toBe('https://uau.example/uauAPI/api/v1.0/Obras/ConsultarObras')
      if (headers.Authorization === 'tok1' && !rejectedOnce) {
        rejectedOnce = true
        return json(401, { Descricao: 'expirado' })
      }
      return json(200, [{ Codigo: 1 }])
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new UauClient(config)
    const [a, b] = await Promise.all([client.call('Obras/ConsultarObras', {}), client.call('Obras/ConsultarObras', {})])
    expect(a.ok && b.ok).toBe(true)
    expect(logins).toBe(2) // login inicial compartilhado + renovação após o 401
  })

  it('login recusado não repassa a resposta e sugere conferir as variáveis', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { Descricao: 'Usuário inválido' })))
    await expect(new UauClient(config).call('Obras/ConsultarObras', {})).rejects.toThrow(/HTTP 401.*Usuário inválido.*UAU_LOGIN/)
  })
})

describe('falhas de rede com a UAU', () => {
  const fetchFailed = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } })
  it('traduz tempo esgotado, DNS, conexão recusada e possível bloqueio de IP', () => {
    expect(describeNetworkError(Object.assign(new Error('x'), { name: 'TimeoutError' }), 45_000)).toContain('não respondeu em 45 s')
    expect(describeNetworkError(fetchFailed('ENOTFOUND'), 1)).toContain('UAU_BASE_URL')
    expect(describeNetworkError(fetchFailed('ECONNREFUSED'), 1)).toContain('recusou a conexão')
    expect(describeNetworkError(fetchFailed('UND_ERR_CONNECT_TIMEOUT'), 1)).toContain('bloqueio por IP')
    expect(describeNetworkError(undefined, 1)).toContain('erro desconhecido')
  })
})
