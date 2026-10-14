import { describe, expect, it } from 'vitest'
import { buildBudgetTree, compareWbs } from './structure'

const line = (id: string, activityWbs: string, total: string, committedValue = '0') => ({
  id, activityWbs, activityCode: null, activityDescription: `Comp ${activityWbs}`, total, committedValue,
})

describe('estrutura do orçamento', () => {
  it('ordena EAP naturalmente', () => {
    expect(['02.10', '02', '02.9', '01.01', '10'].sort(compareWbs)).toEqual(['01.01', '02', '02.9', '02.10', '10'])
  })

  it('monta Item → composição → insumo com subtotais e verba comprometida', () => {
    const tree = buildBudgetTree(
      {
        groups: [{ wbs: '02', description: 'INFRA' }, { wbs: '01', description: 'INICIAIS' }, { wbs: '02.02', description: 'TERRA' }],
        activities: [
          { wbs: '01.01', code: 'CPO1', description: 'Topografia', unit: 'VB', quantity: '1.0000', unitCost: '100.0000', total: '100.0000' },
          { wbs: '02.02.01', code: 'CPU2', description: 'Corte', unit: 'm³', quantity: '10.0000', unitCost: '30.0000', total: '300.0000' },
          { wbs: '02.01', code: 'CPU3', description: 'Limpeza', unit: 'm²', quantity: '2.0000', unitCost: '5.0000', total: '10.0000' },
        ],
      },
      [line('a', '01.01', '100'), line('b', '02.02.01', '200', '50'), line('c', '02.02.01', '100.0001'), line('d', '02.01', '10'), line('e', '03.01', '7')],
    )
    expect(tree.map((r) => `${'  '.repeat(r.level)}${r.kind === 'line' ? r.line.id : r.kind === 'group' ? r.wbs : `${r.wbs}*`}`)).toEqual([
      '01', '  01.01*', '    a',
      '02', '  02.01*', '    d', '  02.02', '    02.02.01*', '      b', '      c',
      '03.01*', '  e',
    ])
    const g02 = tree.find((r) => r.key === 'g:02')!
    expect(g02.total.toDb()).toBe('310.0001') // Σ insumos
    expect(g02.committed.toDb()).toBe('50.0000')
    const comp = tree.find((r) => r.key === 'a:02.02.01')!
    // Composição com insumos vale a soma deles; o custo da planilha fica para conferência
    expect(comp.kind === 'activity' && [comp.total.toDb(), comp.sheetTotal?.toDb(), comp.lines]).toEqual(['300.0001', '300.0000', 2])
    // composição ausente da estrutura é criada a partir das linhas, na raiz
    expect(tree.find((r) => r.key === 'a:03.01')!.parentKey).toBeNull()
  })

  it('todo nível com dependentes totaliza os de baixo, inclusive composição dentro de composição', () => {
    // 01 → 01.01 (composição sem insumos, zerada na planilha) → 01.01.01 e 01.01.02; 01.02 folha sem insumos
    const tree = buildBudgetTree(
      {
        groups: [{ wbs: '01', description: 'SERVIÇOS INICIAIS' }],
        activities: [
          { wbs: '01.01', code: null, description: 'Instalações', unit: null, quantity: '0', unitCost: '0', total: '0.0000' },
          { wbs: '01.01.01', code: 'CPU1', description: 'Tapume', unit: 'm', quantity: '10', unitCost: '50', total: '500.0000' },
          { wbs: '01.01.02', code: 'CPU2', description: 'Barracão', unit: 'vb', quantity: '1', unitCost: '1000', total: '1000.0000' },
          { wbs: '01.02', code: 'CPU3', description: 'Placa da obra', unit: 'un', quantity: '1', unitCost: '80', total: '80.0000' },
        ],
      },
      [line('a', '01.01.01', '500', '100'), line('b', '01.01.02', '600'), line('c', '01.01.02', '400')],
    )
    expect(tree.map((r) => `${'  '.repeat(r.level)}${r.kind === 'line' ? r.line.id : r.wbs}`)).toEqual([
      '01', '  01.01', '    01.01.01', '      a', '    01.01.02', '      b', '      c', '  01.02',
    ])
    const total = (key: string) => tree.find((r) => r.key === key)!.total.toDb()
    expect(total('a:01.01')).toBe('1500.0000') // Σ 01.01.01 + 01.01.02 (a planilha trazia zero)
    expect(total('a:01.02')).toBe('80.0000') // sem nada abaixo: custo da planilha
    expect(total('g:01')).toBe('1580.0000')
    expect(tree.find((r) => r.key === 'a:01.01')!.committed.toDb()).toBe('100.0000')
  })
})
