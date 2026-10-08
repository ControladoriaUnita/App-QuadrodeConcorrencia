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
    expect(comp.kind === 'activity' && [comp.total.toDb(), comp.linesTotal.toDb(), comp.lines]).toEqual(['300.0000', '300.0001', 2])
    // composição ausente da estrutura é criada a partir das linhas, na raiz
    expect(tree.find((r) => r.key === 'a:03.01')!.parentKey).toBeNull()
  })
})
