import { describe, expect, it } from 'vitest'
import { globalMaterials } from './global-materials'

describe('Materiais globais da solicitação', () => {
  it('soma, linha a linha, o total × % material; o total do contrato não muda', () => {
    const g = globalMaterials([
      { id: 'a', totalPrice: '1000.0000', pctMaterial: '0.3', quantity: '10', allocations: [{ packageCode: 'IP01', quantity: '6' }, { packageCode: 'IP02', quantity: '4' }] },
      { id: 'b', totalPrice: '500.0000', pctMaterial: '0.5', quantity: '5', allocations: [{ packageCode: 'IP02', quantity: '5' }] },
      { id: 'c', totalPrice: '200.0000', pctMaterial: '0', quantity: '1', allocations: [] },
    ])
    expect(g.total.toDb()).toBe('550.0000')
    expect(g.service.toDb()).toBe('1150.0000')
    expect([...g.byItem.keys()]).toEqual(['a', 'b'])
    expect(g.byItem.get('a')!.toDb()).toBe('300.0000')
    // IP01 = 300 × 6/10; IP02 = 300 × 4/10 + 250
    expect(g.byPackage.map((p) => [p.packageCode, p.amount.toDb()])).toEqual([['IP02', '370.0000'], ['IP01', '180.0000']])
  })

  it('sem % de material não há linha (total zero)', () => {
    const g = globalMaterials([{ id: 'a', totalPrice: '100', pctMaterial: '0', quantity: '1', allocations: [] }])
    expect(g.total.isZero()).toBe(true)
    expect(g.byPackage).toEqual([])
  })

  it('item sem vínculo entra como "sem IP" e o rateio fecha no valor do item', () => {
    const g = globalMaterials([
      { id: 'a', totalPrice: '100.0000', pctMaterial: '1', quantity: '3', allocations: [{ packageCode: 'IP01', quantity: '1' }, { packageCode: 'IP02', quantity: '1' }, { packageCode: 'IP03', quantity: '1' }] },
      { id: 'b', totalPrice: '10.0000', pctMaterial: '0.1', quantity: '1', allocations: [] },
    ])
    const sum = g.byPackage.reduce((s, p) => s + Number(p.amount.toDb()), 0)
    expect(sum).toBeCloseTo(101, 4)
    expect(g.byPackage.find((p) => p.packageCode === null)!.amount.toDb()).toBe('1.0000')
  })
})
