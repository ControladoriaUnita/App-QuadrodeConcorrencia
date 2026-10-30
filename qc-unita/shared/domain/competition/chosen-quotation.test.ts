import { describe, expect, it } from 'vitest'
import { D } from '../decimal'
import { computeChosenQuotation } from './chosen-quotation'
import type { QcItem, QcPrice } from './types'

const item = (id: string, order: number, qty: string, budget: string): QcItem => ({
  id, sortOrder: order, code: `IS${id}`, description: id, unit: 'un',
  budgetTotal: D(budget), quantity: D(qty), pctMaterial: D(0), pctEquipment: D(0), pctRetention: D(0),
})
const price = (s: string, i: string, v: string | null): QcPrice => ({ competitionSupplierId: s, itemId: i, unitPrice: v === null ? null : D(v) })

const items = [item('a', 1, '10', '100'), item('b', 2, '2', '50'), item('c', 3, '5', '40'), item('z', 4, '0', '0')]
const prices = [price('A', 'a', '8'), price('B', 'a', '9'), price('A', 'b', '30'), price('B', 'b', '20'), price('B', 'c', '0')]
const envelope = { budgetAmount: D('190'), usedAmount: D('0'), adjustmentAmount: D('0') }

describe('cotação escolhida', () => {
  it('soma o preço do fornecedor escolhido em cada insumo (mais de uma vencedora)', () => {
    const c = computeChosenQuotation(items, prices, new Map([['a', 'A'], ['b', 'B']]), envelope, ['A', 'B'])
    expect(c.byItem.get('a')!.totalPrice!.toFixed()).toBe('80.0000')
    expect(c.byItem.get('b')!.totalPrice!.toFixed()).toBe('40.0000')
    expect(c.total.toFixed()).toBe('120.0000')
    expect(c.suppliers.map((s) => [s.competitionSupplierId, s.total.toFixed(), s.items])).toEqual([['A', '80.0000', 1], ['B', '40.0000', 1]])
    expect(c.chosenItems).toBe(2)
    expect(c.activeItems).toBe(3)
    expect(c.comparison.result.toFixed()).toBe('70.0000')
  })
  it('variação contra o orçado no mesmo sinal da melhor condição', () => {
    const c = computeChosenQuotation(items, prices, new Map([['b', 'A']]), envelope)
    // orçado 50, escolhido 60 → −20%
    expect(c.byItem.get('b')!.varianceRatio!.toFixed()).toBe('-0.200000')
  })
  it('escolha sem preço é sinalizada e não soma', () => {
    const c = computeChosenQuotation(items, prices, new Map([['c', 'B']]), envelope)
    expect(c.byItem.get('c')!.missingPrice).toBe(true)
    expect(c.byItem.get('c')!.totalPrice).toBeNull()
    expect(c.total.isZero()).toBe(true)
    expect(c.chosenItems).toBe(0)
  })
  it('sem escolha o insumo fica fora do cenário', () => {
    const c = computeChosenQuotation(items, prices, new Map(), envelope)
    expect(c.lines.every((l) => l.competitionSupplierId === null && !l.missingPrice)).toBe(true)
    expect(c.suppliers).toEqual([])
  })
})
