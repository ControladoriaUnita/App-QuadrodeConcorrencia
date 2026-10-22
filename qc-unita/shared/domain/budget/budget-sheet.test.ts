import { describe, expect, it } from 'vitest'
import { buildSheetBudget, compareItemCodes, listSheetBudgets, readSheetColumns } from './budget-sheet'
import type { Cell } from './excel-import'

const HEADER = [
  'Empresa_pla', 'Obra_pla', 'NumOrca_pla', 'NumOrca_pla2', 'Item_pla', 'Descr_pla', 'unid_pla', 'QtdPai', 'ItemPreco', 'ItemCoef', 'SubItemPreco',
  'SubItemCoef', 'PrecoItem', 'PrecoFinal', 'Insumo', 'TIns_cio', 'TipoInsumo', 'Cod_comp', 'Descr_comp', 'Unid_comp', 'Descr_ins', 'CodUn_UnIns',
]
// Linhas reais da aba (obra P071C, orçamento 1), fora de ordem de propósito
const row = (item: string, descr: string, unit: string, qtd: number, preco: number, coef: number, sub: [number, number] | null, precoItem: number, insumo: string, aux: [string, string, string] | null, descrIns: string, unIns: string, obra = 'P071C', orc = 1): Cell[] => [
  71, obra, orc, orc, item, descr, unit, qtd, preco, coef, sub?.[0] ?? null, sub?.[1] ?? null, precoItem, qtd * precoItem, insumo, aux ? 1 : 0,
  aux ? 'Composição Auxiliar' : 'Insumo', aux?.[0] ?? null, aux?.[1] ?? null, aux?.[2] ?? null, descrIns, unIns,
]
const ROWS: Cell[][] = [
  HEADER,
  row('01.02', 'FABRICAÇÃO DE GABARITO', 'm', 509.52, 664.1175, 0.02545, [0.58, 220], 3.24742, 'IM00012', ['CPU00312', 'CONCRETO NÃO ESTRUTURAL', 'm³'], 'Cimento CP II-32', 'kg'),
  row('01.02', 'FABRICAÇÃO DE GABARITO', 'm', 509.52, 14.35, 0.15, null, 2.1525, 'IM00002', null, 'Tinta acrílica fosco', 'l'),
  row('01.01', 'SERVIÇOS TOPOGRÁFICOS', 'dia', 20, 1650, 1, null, 1650, 'IS00002', null, 'Serviços topográficos', 'dia'),
  row('01.02', 'FABRICAÇÃO DE GABARITO', 'm', 509.52, 664.1175, 0.02545, [345, 0.677], 5.944229, 'IM00013', ['CPU00312', 'CONCRETO NÃO ESTRUTURAL', 'm³'], 'Areia média', 'm³'),
  row('02.06.01.10', 'LAJE', 'm²', 10, 2, 1, null, 2, 'IM00099', null, 'Item dez', 'un'),
  row('02.06.01.02', 'CONCRETO', 'm³', 10, 3, 1, null, 3, 'IM00098', null, 'Item dois', 'un'),
  row('01.01', 'OUTRA OBRA', 'dia', 1, 1, 1, null, 1, 'IS00002', null, 'x', 'dia', 'P099A', 2),
]

describe('Orçamentos da aba BD_Orcamento', () => {
  it('exige as colunas do orçamento da UAU', () => {
    expect(() => readSheetColumns(['Empresa_pla', 'Obra_pla'])).toThrow(/NumOrca_pla.*item_pla/i)
  })

  it('lista os orçamentos por empresa, obra e número', () => {
    const list = listSheetBudgets(ROWS)
    expect(list.map((b) => [b.company, b.work, b.budget, b.services, b.lines])).toEqual([
      ['71', 'P071C', '1', 4, 6],
      ['71', 'P099A', '2', 1, 1],
    ])
  })

  it('ordena itens numericamente por segmento', () => {
    expect(['02.06.01.10', '01.02', '02.06.01.02', '01.01', '02'].sort(compareItemCodes)).toEqual(['01.01', '01.02', '02', '02.06.01.02', '02.06.01.10'])
  })

  it('monta grupos, serviços e insumos em ordem, com a auxiliar aberta', () => {
    const b = buildSheetBudget(ROWS, { company: '71', work: 'P071C', budget: '1' })
    expect(b.groups.map((g) => g.wbs)).toEqual(['01', '02', '02.06', '02.06.01'])
    expect(b.activities.map((a) => a.wbs)).toEqual(['01.01', '01.02', '02.06.01.02', '02.06.01.10'])
    expect(b.lines.map((l) => l.lineKey)).toEqual([
      '01.01|IS00002',
      '01.02|CPU00312>IM00012',
      '01.02|CPU00312>IM00013',
      '01.02|IM00002',
      '02.06.01.02|IM00098',
      '02.06.01.10|IM00099',
    ])
    const cimento = b.lines[1]!
    // 509,52 × 0,02545 × 220 kg a R$ 0,58; total = QtdPai × PrecoItem
    expect([cimento.quantity, cimento.unitCost, cimento.total]).toEqual(['2852.8025', '0.5800', '1654.6254'])
    expect(cimento.aux).toEqual({ code: 'CPU00312', description: 'CONCRETO NÃO ESTRUTURAL', unit: 'm³', coefficient: '0.02545', unitCost: '664.1175' })
    expect(b.lines[3]!.aux).toBeNull()
    // Sem coluna de Vínculo PL: a linha fica sem IP (o código do item não é IP)
    expect([cimento.packageCode, cimento.packageDescription]).toEqual([null, null])
    expect(b.planningFromSheet).toBe(false)
  })

  it('custo do serviço = soma das linhas por unidade', () => {
    const b = buildSheetBudget(ROWS, { company: '71', work: 'P071C', budget: '1' })
    const gabarito = b.activities.find((a) => a.wbs === '01.02')!
    // 3,24742 + 2,1525 + 5,944229 = 11,344149 por metro
    expect([gabarito.quantity, gabarito.unitCost]).toEqual(['509.5200', '11.3441'])
    // 33.000 + 509,52 × 11,344149 + 20 + 30
    expect(b.total).toBe('38830.0708')
  })

  it('PrecoItem vazio ou zerado não zera a linha: usa PrecoFinal ou quantidade × unitário', () => {
    const cols = readSheetColumns(HEADER)
    const semPrecoItem = row('01.01', 'SERVIÇOS', 'dia', 20, 1650, 1, null, 0, 'IS00002', null, 'Topografia', 'dia')
    semPrecoItem[cols.total] = null
    const b = buildSheetBudget([HEADER, semPrecoItem], { company: '71', work: 'P071C', budget: '1' })
    expect(b.lines[0]!.total).toBe('33000.0000') // 20 × 1 × 1.650
    const comPrecoFinal = row('01.01', 'SERVIÇOS', 'dia', 20, 1650, 1, null, 0, 'IS00002', null, 'Topografia', 'dia')
    comPrecoFinal[cols.total] = 32000
    expect(buildSheetBudget([HEADER, comPrecoFinal], { company: '71', work: 'P071C', budget: '1' }).lines[0]!.total).toBe('32000.0000')
    // Preço zerado na própria UAU: a linha fica com zero e o aviso diz qual é
    const zerada = row('01.01', 'SERVIÇOS', 'dia', 20, 0, 1, null, 0, 'IS00002', null, 'Topografia', 'dia')
    expect(buildSheetBudget([HEADER, zerada], { company: '71', work: 'P071C', budget: '1' }).warnings.join()).toMatch(/1 linha\(s\) vieram com valor zero.*Linhas da aba: 2/)
  })

  it('avisa quando o orçamento não existe', () => {
    expect(() => buildSheetBudget(ROWS, { company: '1', work: 'P071C', budget: '1' })).toThrow(/não encontrado/)
  })
})
