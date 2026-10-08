import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBudgetSheet, type Cell } from './excel-import'

const H = ['X', 'Item', 'Serviço', 'Código', 'Descrição', null, 'Unid', 'Quantidade', 'Custo Unit.', 'Custo Total', 'Vínculo PL', 'Classificação']
const rows: Cell[][] = [
  [],
  H,
  ['01', '01', 'Serviços Iniciais', 'Item', 'Serviços Iniciais'],
  ['01.01', '01.01', 'SERVIÇOS TOPOGRÁFICOS', 'CPU00002', 'SERVIÇOS TOPOGRÁFICOS', null, 'dia', 8, 1580, 12640],
  [null, '01.01', 'SERVIÇOS TOPOGRÁFICOS', 'IS00002', 'Serviços topográficos', null, 'dia', 8, 1580, 12640, 'IP00102', 'Topografia'],
  ['02.03.02', '02.03.02', 'PISO INTERTRAVADO', 'CPU01389', 'PISO INTERTRAVADO', null, 'm²', 145.79, 300.1505, 43758.94],
  [null, '02.03.02', 'PISO INTERTRAVADO', 'IM08135', 'Piso intertravado', null, 'un', 7653.975, 1.84, 14083.31, 'IP00105', 'Pavimentação'],
  [null, '02.03.02', 'PISO INTERTRAVADO', 'IM08135', 'Piso intertravado', null, 'un', 10, 1.84, 18.4, 'IP00105', 'Pavimentação'],
  [null, '02.03.02', 'PISO INTERTRAVADO', 'IP00302', 'Servente', null, 'h', 408.212, 22.31, 9107.21, null, null],
]

describe('importação do orçamento (Excel)', () => {
  it('reconhece EAP, composições e linhas com chave estável', () => {
    const r = parseBudgetSheet(rows)
    expect(r.groups).toEqual([{ wbs: '01', description: 'Serviços Iniciais' }])
    expect(r.activities.map((a) => a.code)).toEqual(['CPU00002', 'CPU01389'])
    expect(r.lines).toHaveLength(4)
    expect(r.lines[1]!.lineKey).toBe('02.03.02|IM08135|IP00105')
    expect(r.lines[2]!.lineKey).toBe('02.03.02|IM08135|IP00105|2')
    expect(r.lines[1]!.quantity).toBe('7653.9750')
    expect(r.packages.find((p) => p.packageCode === 'IP00105')!.lines).toBe(2)
    expect(r.warnings.join()).toMatch(/sem Vínculo PL/)
    expect(r.total).toBe('35848.9200') // soma da coluna Custo Total
    expect(r.lines[1]!.unitCost).toBe('1.8400')
  })

  it('lê o orçamento analítico (ORC ANL): ITEM_PLA liga o insumo à composição; sem Vínculo PL', () => {
    const orc: Cell[][] = [
      ['*OCULTAR*', '*OCULTAR*'],
      [null, null, null, null, null, null, null, 'CUSTO RASO:', 33353.0506],
      [],
      ['NÍVEL', 'ITEM_PLA', 'ITEM', 'SERVIÇO', 'DESCRIÇÕES', 'UNID.', 'QNT', 'CUSTO UNITÁRIO', 'CUSTO TOTAL'],
      [0, '00', '00', 'Item', 'INFORMAÇÕES E PARÂMETROS', null, null, null, 0],
      [1, '00.02', '00.02', 'ORC00001', 'UNIDADES HABITACIONAIS', 'un', 172, null, 0],
      [0, '01', '01', 'Item', 'SERVIÇOS INICIAIS', null, null, null, 33353.0506],
      [1, '01.01', '01.01', 'CPU00002', 'SERVIÇOS TOPOGRÁFICOS', 'dia', 12, 1650, 19800],
      [1, '01.01', null, 'IS00002', 'Serviços topográficos', 'dia', 12, 1650, 19800],
      [1, '01.02', '01.02', 'CPU00001', 'FABRICAÇÃO DE GABARITO', 'm', 146.3, 92.6388, 13553.0506],
      [1, '01.02', null, 'CPU00312', 'CONCRETO NÃO ESTRUTURAL', 'm³', 3.723335, 672.9175, 2505.4972],
      [1, '01.02', null, 'IM00001', 'Sarrafo Pinus 2,5x7cm', 'm', 182.387821, 1.9, 346.5369],
      // insumo fora de ordem: ITEM_PLA manda na composição-pai
      [1, '01.01', null, 'IM00002', 'Tinta acrílica', 'l', 1, 10701.0165, 10701.0165],
    ]
    const r = parseBudgetSheet(orc)
    expect(r.layout).toBe('orc-analitico')
    expect(r.sheetHeaderRow).toBe(4)
    expect(r.groups.map((g) => g.wbs)).toEqual(['00', '01'])
    expect(r.activities.map((a) => [a.wbs, a.code])).toEqual([['00.02', 'ORC00001'], ['01.01', 'CPU00002'], ['01.02', 'CPU00001']])
    expect(r.lines.map((l) => `${l.activityWbs}|${l.materialCode}`)).toEqual(['01.01|IS00002', '01.02|CPU00312', '01.02|IM00001', '01.01|IM00002'])
    expect(r.lines.every((l) => l.packageCode === null)).toBe(true)
    expect(r.lines[1]!.total).toBe('2505.4972')
    expect(r.declaredTotal).toBe('33353.0506')
    expect(r.compositionsTotal).toBe('33353.0506')
    expect(r.total).toBe('33353.0506')
    expect(r.warnings.join()).toMatch(/não tem a coluna Vínculo PL/)
    expect(r.packages).toEqual([])
  })

  it('avisa quando a soma dos insumos não fecha com o custo raso', () => {
    const orc: Cell[][] = [
      ['CUSTO RASO:', 999],
      ['ITEM_PLA', 'ITEM', 'SERVIÇO', 'DESCRIÇÕES', 'UNID.', 'QNT', 'CUSTO UNITÁRIO', 'CUSTO TOTAL'],
      ['01.01', '01.01', 'CPU1', 'Comp', 'un', 1, 100, 100],
      ['01.01', null, 'IS1', 'Insumo', 'un', 1, 100, 100],
    ]
    expect(parseBudgetSheet(orc).warnings.join()).toMatch(/difere do custo raso/)
  })

  const pazza = process.env.QC_ORC_XLSX
  it.runIf(pazza && existsSync(pazza))('importa o orçamento analítico real (Pazza Ipanema)', async () => {
    const { default: read } = await import('read-excel-file/node')
    const sheets = (await read(pazza!)) as unknown as { sheet: string; data: Cell[][] }[]
    const r = parseBudgetSheet(sheets[0]!.data)
    expect([r.groups.length, r.activities.length, r.lines.length]).toEqual([237, 872, 2563])
    expect(r.declaredTotal).toBe('23344490.4720')
    expect(Number(r.total)).toBeCloseTo(23344490.56, 1)
  })

  it('falha sem cabeçalho', () => {
    expect(() => parseBudgetSheet([['a', 'b']])).toThrow(/Cabeçalho/)
  })

  const real = process.env.QC_XLSX
  it.runIf(real && existsSync(real))('importa a planilha real de exemplo', async () => {
    const { readSheet } = await import('read-excel-file/node')
    const data = (await readSheet(real!, 'Orçamento')) as Cell[][]
    const r = parseBudgetSheet(data)
    expect(r.lines.length).toBeGreaterThan(3000)
    expect(Number(r.total)).toBeCloseTo(51752715.62, 0) // Σ Custo Total das linhas de insumo
    console.log('linhas', r.lines.length, 'atividades', r.activities.length, 'grupos', r.groups.length, 'IPs', r.packages.length, 'total', r.total, r.warnings)
  })
})
