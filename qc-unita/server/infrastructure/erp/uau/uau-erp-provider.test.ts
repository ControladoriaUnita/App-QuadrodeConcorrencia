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
    expect([...p.supports]).toEqual(['suppliers', 'materials'])
    await expect(p.getWorks()).rejects.toThrow('ainda não implementado para a UAU')
  })
})

describe('UauERPProvider.getMaterials', () => {
  it('lê o cadastro inteiro numa chamada (descrição "%"), com situação e sem repetir código', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/Autenticador/AutenticarUsuario')) return json(200, 'tok')
      expect(url).toContain('/InsumosGeral/ConsultarInsumosGeralPorDescricao')
      bodies.push(JSON.parse(String(init.body)))
      return json(200, [
        { Cod_ins: 'ip00001', Descr_ins: 'Aluguel de escritório', Unid_ins: 'VB', AtInat_ins: 0 },
        { Cod_ins: 'IM00012', Descr_ins: 'Cimento CP II-32', Unid_ins: 'kg', AtInat_ins: 1 },
        { Cod_ins: 'IM00012', Descr_ins: 'Cimento repetido', Unid_ins: 'kg', AtInat_ins: 0 },
        { Cod_ins: '', Descr_ins: 'sem código', Unid_ins: 'un', AtInat_ins: 0 },
      ])
    }))
    const materials = await new UauERPProvider(config).getMaterials()
    expect(bodies).toEqual([{ Descricao: '%' }])
    expect(materials).toEqual([
      { code: 'IP00001', description: 'Aluguel de escritório', unit: 'VB', active: true },
      { code: 'IM00012', description: 'Cimento CP II-32', unit: 'kg', active: false },
    ])
  })
})

describe('UauERPProvider: listas para a nova obra', () => {
  it('empresas e obras ativas, ordenadas, sem repetição e guardadas por alguns minutos', async () => {
    const routes: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/Autenticador/AutenticarUsuario')) return json(200, 'tok')
      routes.push(url.split('/api/v1.0/')[1]!)
      expect(JSON.parse(String(init.body))).toEqual({})
      if (url.endsWith('/Empresa/ObterEmpresasAtivas')) {
        return json(200, [{ Codigo_emp: 71, Desc_emp: 'SPE 71 ' }, { Codigo_emp: 1, Desc_emp: 'Unità' }, { Codigo_emp: null, Desc_emp: 'x' }])
      }
      return json(200, [
        { Cod_obr: 'p071c', Empresa_obr: 1, Descr_obr: 'Residencial P071', Status_obr: 0, TipoObra_obr: 1 },
        { Cod_obr: 'A100', Empresa_obr: 71, Descr_obr: 'Obra A', Status_obr: 0, TipoObra_obr: 4 },
        { Cod_obr: 'A001', Empresa_obr: 1, Descr_obr: null, Status_obr: 0, TipoObra_obr: 2 },
        { Cod_obr: 'P071C', Empresa_obr: 1, Descr_obr: 'Residencial P071', Status_obr: 0, TipoObra_obr: 1 },
      ])
    }))
    const p = new UauERPProvider(config)
    expect(await p.listCompanies()).toEqual([{ code: '1', name: 'Unità' }, { code: '71', name: 'SPE 71' }])
    expect(await p.listWorkOptions()).toEqual([
      { company: '1', code: 'A001', name: 'A001' },
      { company: '1', code: 'P071C', name: 'Residencial P071' },
      { company: '71', code: 'A100', name: 'Obra A' },
    ])
    await p.listWorkOptions()
    expect(routes).toEqual(['Empresa/ObterEmpresasAtivas', 'Obras/ObterObrasAtivas'])
  })

  it('erro da UAU na lista → mensagem clara e nada em cache', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/Autenticador/AutenticarUsuario')) return json(200, 'tok')
      return fail ? json(500, { Descricao: 'Falha interna' }) : json(200, [{ Codigo_emp: 1, Desc_emp: 'Unità' }])
    }))
    const p = new UauERPProvider(config)
    await expect(p.listCompanies()).rejects.toThrow('A UAU respondeu HTTP 500 ao listar empresas. Falha interna')
    fail = false
    expect(await p.listCompanies()).toHaveLength(1)
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
