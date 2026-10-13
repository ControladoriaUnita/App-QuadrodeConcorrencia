import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUauProvider } from '..'
import { UauERPProvider } from './uau-erp-provider'

const config = { baseUrl: 'https://uau.example', integrationToken: 'int', login: 'user', password: 'pass' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const pj = (code: number) => ({
  CodigoPessoa: code, NomePessoa: `Fornecedor ${code}`, TipoPessoa: 1, CpfPessoa: String(code).padStart(14, '0'), AtivoInativo: 0,
  ListaDadosPessoaEndereco: [], ListaDadosPessoaJuridica: [],
})

afterEach(() => vi.unstubAllGlobals())

/** UAU simulada: pessoas com os códigos dados, respondendo à condição "cod_pes > a and cod_pes <= b". */
function fakeUau(codes: number[], fail?: { from: number; status: number }) {
  const conditions: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/Autenticador/AutenticarUsuario')) return json(200, 'tok')
    const cond = (JSON.parse(String(init.body)) as { condicaoConsultarPessoa: string }).condicaoConsultarPessoa
    conditions.push(cond)
    const [, a, b] = /cod_pes > (\d+) and cod_pes <= (\d+)/.exec(cond)!.map(Number) as [number, number, number]
    if (fail && fail.from === a) return json(fail.status, { Descricao: 'Verifique os parâmetros da requisição.' })
    return json(200, codes.filter((c) => c > a && c <= b).map(pj))
  }))
  return conditions
}

describe('UauERPProvider.getSuppliers', () => {
  it('lê em faixas sequenciais até um trecho longo sem ninguém, atravessando buracos', async () => {
    const conditions = fakeUau([1, 50, 250, 420])
    const suppliers = await new UauERPProvider(config, { rangeSize: 100, stopAfterEmptyCodes: 200 }).getSuppliers()
    expect(suppliers.map((s) => s.erpId)).toEqual(['1', '50', '250', '420'])
    // 0–100, 100–200 (vazia), 200–300, 300–400 (vazia), 400–500, 500–600 e 600–700 (vazias) → para
    expect(conditions).toHaveLength(7)
    expect(conditions[0]).toBe('cod_pes > 0 and cod_pes <= 100')
  })

  it('respeita o teto de segurança', async () => {
    const conditions = fakeUau(Array.from({ length: 50 }, (_, i) => i + 1))
    await new UauERPProvider(config, { rangeSize: 10, maxCode: 30, stopAfterEmptyCodes: 20 }).getSuppliers()
    expect(conditions).toHaveLength(3)
  })

  it('passou do tempo total → erro claro antes do limite da Vercel', async () => {
    fakeUau([1])
    await expect(new UauERPProvider(config, { deadlineMs: 0 }).getSuppliers()).rejects.toThrow('passou de 0 s')
  })

  it('erro numa faixa falha a leitura inteira (sem lista parcial)', async () => {
    fakeUau([1, 150], { from: 100, status: 400 })
    await expect(new UauERPProvider(config, { rangeSize: 100 }).getSuppliers()).rejects.toThrow(/HTTP 400.*faixa 101–200.*Verifique/)
  })

  it('operações ainda não implementadas dão erro claro e ficam fora do "Tudo"', async () => {
    const p = new UauERPProvider(config)
    expect([...p.supports]).toEqual(['suppliers'])
    await expect(p.getWorks()).rejects.toThrow('ainda não implementado para a UAU')
  })
})

describe('createUauProvider', () => {
  it('lista as variáveis ausentes sem mostrar valores', () => {
    expect(() => createUauProvider({ UAU_BASE_URL: ' "https://uau.example" ', UAU_LOGIN: 'segredo-login' })).toThrow(
      /faltam .*UAU_INTEGRATION_TOKEN, UAU_PASSWORD\.$/,
    )
    try {
      createUauProvider({ UAU_LOGIN: 'segredo-login' })
    } catch (err) {
      expect((err as Error).message).not.toContain('segredo')
    }
    expect(createUauProvider({ UAU_BASE_URL: 'x', UAU_INTEGRATION_TOKEN: 'y', UAU_LOGIN: 'z', UAU_PASSWORD: "'w'" })).toBeInstanceOf(UauERPProvider)
  })
})
