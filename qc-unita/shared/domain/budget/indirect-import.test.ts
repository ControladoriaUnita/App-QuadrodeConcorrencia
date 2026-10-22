import { fileURLToPath } from 'node:url'
import readXlsxFile from 'read-excel-file/node'
import { describe, expect, it } from 'vitest'
import type { BudgetImportInput } from '../../contracts'
import { indirectKind, indirectMaterialCode, IndirectMismatchError, openIndirect, parseIndirectWorkbook, type WorkbookSheet } from './indirect-import'
import { EMPTY_MAPPINGS, mappingResolver } from './mappings'
import { EQUIPAMENTOS, SUMMARY, WORKBOOK } from './__fixtures__/indirect-workbook'

describe('leitura do arquivo de indireto', () => {
  const r = parseIndirectWorkbook(WORKBOOK)

  it('cada item do resumo vem da sua aba, com o código do orçamento', () => {
    expect(r.items.map((i) => [i.wbs, i.description, i.total, i.lines.length])).toEqual([
      ['16.01', 'EQUIPAMENTOS', '1450.0000', 2],
      ['16.05', 'MÃO DE OBRA INDIRETA - CLT', '9000.0000', 2],
      ['16.06', 'MÃO DE OBRA INDIRETA - PJ', '20000.0000', 1],
      ['16.09', 'LIGAÇÕES', '600.0000', 2],
    ])
    expect(r.total).toBe('31050.0000')
  })

  it('o insumo soma as fases, ganha o complemento e os de total zero ficam fora', () => {
    expect(r.items[0]!.lines).toEqual([
      { description: 'Carrinho de mão - 80l', unit: 'un', quantity: '2.0000', total: '1300.0000', sheet: 'Equipamentos', row: 8 },
      // Complemento igual à descrição não se repete
      { description: 'Locação de pick-up', unit: 'vb', quantity: '1.0000', total: '150.0000', sheet: 'Equipamentos', row: 11 },
    ])
  })

  it('M.O.I. separa CLT e PJ pela primeira coluna; erro do Excel (#REF!) vale zero', () => {
    expect(r.items[1]!.lines.map((l) => [l.description, l.total])).toEqual([['Almoxarife', '8000.0000'], ['Vale refeição (ADM)', '1000.0000']])
    expect(r.items[2]!.lines.map((l) => l.description)).toEqual(['Engenheiro Pleno'])
  })

  it('avisa quando a aba não bate com o resumo ou não existe', () => {
    expect(r.warnings).toEqual([
      'Item 16.09 LIGAÇÕES: os insumos da aba "Ligações e Habite-se" somam R$ 600,00, mas o resumo diz R$ 500,00.',
    ])
    const sem = parseIndirectWorkbook([SUMMARY, EQUIPAMENTOS])
    expect(sem.warnings).toContain('Item 16.05 MÃO DE OBRA INDIRETA - CLT: aba não encontrada no arquivo — fica como está no orçamento.')
  })

  it('o .xlsx de exemplo (testes de tela) lido pelo leitor de Excel dá o mesmo resultado', async () => {
    const file = fileURLToPath(new URL('../../../e2e/fixtures/indireto-exemplo.xlsx', import.meta.url))
    const sheets = (await readXlsxFile(file)) as WorkbookSheet[]
    expect(parseIndirectWorkbook(sheets)).toEqual(r)
  })

  it('sem a aba de resumo, ou sem insumos, explica o que falta', () => {
    expect(() => parseIndirectWorkbook([EQUIPAMENTOS])).toThrow('O arquivo não tem a aba "Total Indiretos"')
    expect(() => parseIndirectWorkbook([SUMMARY])).toThrow('Nenhum insumo com valor')
  })
})

describe('código dos insumos do indireto', () => {
  it('é o mesmo para a mesma descrição e unidade em qualquer obra (sem diferenciar acento e caixa)', () => {
    expect(indirectMaterialCode('Almoxarife', 'mês')).toBe(indirectMaterialCode('ALMOXARIFE ', 'MES'))
    expect(indirectMaterialCode('Almoxarife', 'mês')).toMatch(/^IND[0-9A-Z]{7}$/)
    expect(indirectMaterialCode('Almoxarife', 'mês')).not.toBe(indirectMaterialCode('Almoxarife', 'vb'))
  })
})

describe('abrir o indireto no orçamento', () => {
  const closed = (wbs: string, total: string, code = 'IS99999') => ({
    lineKey: `${wbs}|${code}`, sourceRow: 1, activityWbs: wbs, materialCode: code, quantity: '1.0000', unitCost: total, total,
    packageCode: wbs, packageDescription: wbs, aux: null,
  })
  const budget = (): Pick<BudgetImportInput, 'groups' | 'activities' | 'lines' | 'materials'> => ({
    groups: [{ wbs: '01', description: 'Item 01' }, { wbs: '16', description: 'Item 16' }],
    activities: [
      { wbs: '01.01', code: null, description: 'LOCAÇÃO', unit: 'm²', quantity: '10.0000', unitCost: '5.0000' },
      { wbs: '16.01', code: null, description: 'EQUIPAMENTOS', unit: 'vb', quantity: '1.0000', unitCost: '1450.0000' },
      { wbs: '16.05', code: null, description: 'MÃO DE OBRA INDIRETA', unit: 'vb', quantity: '1.0000', unitCost: '5000.0000' },
    ],
    lines: [closed('01.01', '50.0000', 'IM00001'), closed('16.01', '1450.0000'), closed('16.05', '5000.0000')],
    materials: [{ code: 'IM00001', description: 'Cimento', unit: 'kg' }, { code: 'IS99999', description: 'Indireto fechado', unit: 'vb' }],
  })
  const indirect = parseIndirectWorkbook(WORKBOOK)

  it('troca as linhas fechadas pelos insumos abertos e mantém o restante do orçamento', () => {
    const { budget: out, warnings } = openIndirect(budget(), indirect, mappingResolver(EMPTY_MAPPINGS))
    expect(out.lines.filter((l) => l.activityWbs === '01.01')).toEqual([closed('01.01', '50.0000', 'IM00001')])
    expect(out.lines.filter((l) => l.activityWbs === '16.01').map((l) => [l.materialCode.startsWith('IND'), l.quantity, l.unitCost, l.total])).toEqual([
      [true, '2.0000', '650.0000', '1300.0000'],
      [true, '1.0000', '150.0000', '150.0000'],
    ])
    expect(out.lines.some((l) => l.materialCode === 'IS99999')).toBe(false)
    expect(out.activities.map((a) => a.wbs)).toEqual(['01.01', '16.01', '16.05', '16.06', '16.09'])
    expect(out.activities.find((a) => a.wbs === '16.05')).toMatchObject({ description: 'MÃO DE OBRA INDIRETA', unitCost: '9000.0000' })
    expect(out.materials.find((m) => m.description === 'Almoxarife')).toMatchObject({ unit: 'mês' })
    expect(warnings).toEqual([
      'Item 16.05 MÃO DE OBRA INDIRETA - CLT: o indireto aberto soma R$ 9.000,00; o orçamento fechado trazia R$ 5.000,00.',
      'Item 16.06 MÃO DE OBRA INDIRETA - PJ não existia no orçamento: entrou com o indireto.',
      'Item 16.09 LIGAÇÕES não existia no orçamento: entrou com o indireto.',
      '7 insumo(s) do indireto sem IP no de-para: ficam vinculados ao próprio item até o planejamento escolher o IP.',
    ])
  })

  it('IP do insumo: de-para do indireto, depois o do Item; sem nenhum, o próprio item', () => {
    const resolver = mappingResolver({
      items: [{ wbs: '16', description: null, planning: { code: 'IP00500', description: 'Indiretos' } }],
      indirect: [{ description: 'ALMOXARIFE', planning: { code: 'IP00510', description: 'Almoxarifado' } }],
    })
    const { budget: out } = openIndirect(budget(), indirect, resolver)
    const ip = (description: string) => {
      const code = out.materials.find((m) => m.description === description)!.code
      return out.lines.find((l) => l.materialCode === code)!.packageCode
    }
    expect([ip('Almoxarife'), ip('Engenheiro Pleno')]).toEqual(['IP00510', 'IP00500'])
    expect(openIndirect(budget(), indirect, mappingResolver(EMPTY_MAPPINGS)).budget.lines.find((l) => l.activityWbs === '16.06')!.packageCode).toBe('16.06')
  })

  it('o item que era grupo com serviços abaixo vira uma composição só com o indireto', () => {
    const b = budget()
    b.groups.push({ wbs: '16.01', description: 'Item 16.01' })
    b.activities = b.activities.map((a) => (a.wbs === '16.01' ? { ...a, wbs: '16.01.01' } : a))
    b.lines = b.lines.map((l) => (l.activityWbs === '16.01' ? { ...l, activityWbs: '16.01.01' } : l))
    const { budget: out } = openIndirect(b, indirect, mappingResolver(EMPTY_MAPPINGS))
    expect(out.groups.map((g) => g.wbs)).toEqual(['01', '16'])
    expect(out.activities.some((a) => a.wbs === '16.01.01')).toBe(false)
    expect(out.lines.filter((l) => l.activityWbs.startsWith('16.01')).every((l) => l.activityWbs === '16.01')).toBe(true)
  })

  it('tipo de custo pela descrição da UAU e do arquivo', () => {
    const uau = ['EQUIPAMENTOS - (INDIRETO)', 'INSTALAÇÕES DA OBRA - (INDIRETO)', 'SERVIÇOS TERCEIRIZADOS - (INDIRETO)', 'CONSUMOS PERMANENTES - (INDIRETO)',
      'M.O.I (PJ) - (INDIRETO)', 'M.O.I (CLT) - (INDIRETO)', 'M.O.D - (INDIRETO)', 'TARIFAS - (INDIRETO)', 'LIGAÇÕES E HABITE-SE - (INDIRETO)']
    const arquivo = ['EQUIPAMENTOS', 'INSTALAÇÃO DA OBRA', 'SERVIÇOS TERCEIRIZADOS', 'CONSUMOS PERMANENTES', 'MÃO DE OBRA INDIRETA - PJ',
      'MÃO DE OBRA INDIRETA - CLT', 'MÃO DE OBRA DIRETA', 'TARIFAS', 'LIGAÇÕES ']
    const kinds = ['equipamentos', 'instalacao', 'terceirizados', 'consumos', 'moi-pj', 'moi-clt', 'mod', 'tarifas', 'ligacoes']
    expect(uau.map(indirectKind)).toEqual(kinds)
    expect(arquivo.map(indirectKind)).toEqual(kinds)
  })

  it('bug de produção: na UAU o 16.05 é M.O.I (PJ) e o 16.06 é M.O.I (CLT) — cada aba vai para o item do mesmo tipo', () => {
    const b = budget()
    b.activities = [
      ...b.activities.filter((a) => a.wbs !== '16.05'),
      { wbs: '16.05', code: 'CPL00231', description: 'M.O.I (PJ) - (INDIRETO)', unit: 'VB', quantity: '1.0000', unitCost: '20000.0000' },
      { wbs: '16.06', code: 'CPL00232', description: 'M.O.I (CLT) - (INDIRETO)', unit: 'VB', quantity: '1.0000', unitCost: '9000.0000' },
    ]
    b.lines = [...b.lines.filter((l) => l.activityWbs !== '16.05'), closed('16.05', '20000.0000', 'IP00490'), closed('16.06', '9000.0000', 'IP00491')]
    const { budget: out, warnings } = openIndirect(b, indirect, mappingResolver(EMPTY_MAPPINGS))
    const descr = (wbs: string) => out.lines.filter((l) => l.activityWbs === wbs).map((l) => out.materials.find((m) => m.code === l.materialCode)!.description)
    expect(descr('16.05')).toEqual(['Engenheiro Pleno'])
    expect(descr('16.06')).toEqual(['Almoxarife', 'Vale refeição (ADM)'])
    expect(warnings.some((w) => /16\.0[56]/.test(w))).toBe(false)
    expect(out.lines.some((l) => l.materialCode.startsWith('IP004'))).toBe(false)
  })

  it('arquivo de outra obra (nenhum item no orçamento) é recusado', () => {
    const other = { ...budget(), groups: [{ wbs: '01', description: 'Item 01' }], activities: budget().activities.slice(0, 1), lines: budget().lines.slice(0, 1) }
    expect(() => openIndirect(other, indirect, mappingResolver(EMPTY_MAPPINGS))).toThrow(IndirectMismatchError)
  })
})
