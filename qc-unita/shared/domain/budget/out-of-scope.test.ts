import { describe, expect, it } from 'vitest'
import { outOfScopeCode, outOfScopeTotal, summarizeOutOfScope, type OutOfScopeLike } from './out-of-scope'

const item = (quantity: string, unitCost: string, category: OutOfScopeLike['category'], wbs: string | null = null, wbsDescription: string | null = null): OutOfScopeLike => ({
  quantity, unitCost, category, wbs, wbsDescription,
})

describe('custos fora de escopo', () => {
  it('total = quantidade × custo unitário (4 casas) e código FE-nnn', () => {
    expect(outOfScopeTotal('3.3333', '1.11').toDb()).toBe('3.7000')
    expect(outOfScopeCode(7)).toBe('FE-007')
    expect(outOfScopeCode(1234)).toBe('FE-1234')
  })

  it('resume por motivo, por Item de 1º nível e contra o orçamento vigente', () => {
    const s = summarizeOutOfScope(
      [
        item('10', '100', 'client_request', '02.05.01', 'CALÇADA'),
        item('1', '500', 'budget_omission', '02', 'INFRAESTRUTURA'),
        item('2', '50', 'client_request', '05.01'),
        item('1', '25', 'other'),
      ],
      '100000',
      (wbs) => ({ '02': 'INFRAESTRUTURA', '05': 'ALVENARIA' })[wbs] ?? null,
    )
    expect(s.total.toDb()).toBe('1625.0000')
    expect(s.count).toBe(4)
    expect(s.byCategory.map((c) => [c.label, c.total.toDb(), c.count])).toEqual([
      ['Solicitação do cliente', '1100.0000', 2],
      ['Omissão do orçamento', '500.0000', 1],
      ['Outros', '25.0000', 1],
    ])
    expect(s.byItem.map((i) => [i.wbs, i.description, i.total.toDb(), i.count])).toEqual([
      ['02', 'INFRAESTRUTURA', '1500.0000', 2],
      ['05', 'ALVENARIA', '100.0000', 1],
      [null, null, '25.0000', 1],
    ])
    expect(s.ratio!.toFixed(6)).toBe('0.016250')
    expect(s.budgetWithOutOfScope.toDb()).toBe('101625.0000')
  })

  it('sem orçamento não há razão; sem lançamentos tudo zera', () => {
    const s = summarizeOutOfScope([], null)
    expect([s.total.toDb(), s.count, s.ratio, s.byCategory, s.byItem]).toEqual(['0.0000', 0, null, [], []])
  })
})
