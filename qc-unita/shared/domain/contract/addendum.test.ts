import { describe, expect, it } from 'vitest'
import { Decimal } from '../decimal'
import { computeAddendum, currentAllocations, currentEndOn, signedQuantity, suggestAllocations, validateAddendum, type AddendumLine } from './addendum'

const D = Decimal.from

const contract = [
  { id: 'a', quantity: D('100'), totalPrice: D('1000'), allocations: [{ packageCode: 'IP01', quantity: D('60') }, { packageCode: 'IP02', quantity: D('40') }] },
  { id: 'b', quantity: D('10'), totalPrice: D('500'), allocations: [{ packageCode: 'IP03', quantity: D('10') }] },
]
const line = (contractItemId: string | null, code: string, q: string, price: string, allocations: [string, string][]): AddendumLine => ({
  contractItemId,
  code,
  quantityDelta: D(q),
  unitPrice: D(price),
  allocations: allocations.map(([packageCode, x]) => ({ packageCode, quantity: D(x) })),
})
const args = (kind: 'addendum' | 'termination') => ({ kind, reason: 'Ajuste de escopo', newEndOn: null, contractStartOn: '2026-10-01', currentEndOn: '2026-12-31' })
const ctx = (previous: AddendumLine[] = []) => ({ contractItems: contract, previous })
const messages = (issues: { message: string }[]) => issues.map((i) => i.message).join(' | ')

describe('Aditivos e distratos', () => {
  it('o sinal vem do tipo', () => {
    expect(signedQuantity('addendum', D('5')).toDb()).toBe('5.0000')
    expect(signedQuantity('termination', D('5')).toDb()).toBe('-5.0000')
    expect(signedQuantity('termination', D('-5')).toDb()).toBe('-5.0000')
  })

  it('o total é a soma dos itens, acumulando lançamentos aprovados', () => {
    const previous = [line('a', 'A', '20', '10', [['IP01', '20']])]
    const s = computeAddendum(contract, previous, [line('a', 'A', '-30', '10', [['IP01', '-30']]), line(null, 'NOVO', '2.5', '40.10', [['IP09', '2.5']])])
    expect(s.initialTotal.toDb()).toBe('1500.0000')
    expect(s.previousTotal.toDb()).toBe('200.0000')
    expect(s.totalDelta.toDb()).toBe('-199.7500') // −300 + 100,25
    expect(s.newTotal.toDb()).toBe('1500.2500')
    expect(s.lines[0]!.quantityAfter.toDb()).toBe('90.0000')
  })

  it('aditivo válido: itens positivos com vínculos que fecham', () => {
    const s = computeAddendum(contract, [], [line('a', 'A', '10', '10', [['IP01', '6'], ['IP02', '4']]), line(null, 'NOVO', '1', '5', [['IP09', '1']])])
    expect(validateAddendum(args('addendum'), s, ctx())).toEqual([])
  })

  it('exige vínculo de planejamento e soma correta', () => {
    const s = computeAddendum(contract, [], [line('a', 'A', '10', '10', []), line('b', 'B', '2', '50', [['IP03', '1']])])
    const msgs = messages(validateAddendum(args('addendum'), s, ctx()))
    expect(msgs).toContain('Vincule ao planejamento (IP) os itens A')
    expect(msgs).toContain('não fecha com a quantidade em B')
  })

  it('distrato: só itens do contrato, sem passar da quantidade nem do IP vigente', () => {
    const ok = computeAddendum(contract, [], [line('a', 'A', '-50', '10', [['IP01', '-30'], ['IP02', '-20']])])
    expect(validateAddendum(args('termination'), ok, ctx())).toEqual([])
    const overIp = computeAddendum(contract, [], [line('a', 'A', '-50', '10', [['IP02', '-50']])])
    expect(messages(validateAddendum(args('termination'), overIp, ctx()))).toContain('quantidade vigente do IP em A')
    const overItem = computeAddendum(contract, [], [line('b', 'B', '-11', '50', [['IP03', '-11']])])
    expect(messages(validateAddendum(args('termination'), overItem, ctx()))).toContain('passa da quantidade contratada em B')
    const newItem = computeAddendum(contract, [], [line(null, 'X', '-1', '1', [['IP01', '-1']])])
    expect(messages(validateAddendum(args('termination'), newItem, ctx()))).toContain('só reduz itens do contrato')
  })

  it('distrato considera aditivos aprovados no IP', () => {
    const previous = [line('b', 'B', '5', '50', [['IP04', '5']])]
    expect([...currentAllocations(contract[1]!, previous)].map(([k, q]) => `${k}=${q.toDb()}`)).toEqual(['IP03=10.0000', 'IP04=5.0000'])
    const s = computeAddendum(contract, previous, [line('b', 'B', '-12', '50', [['IP03', '-10'], ['IP04', '-2']])])
    expect(validateAddendum(args('termination'), s, ctx(previous))).toEqual([])
  })

  it('sugere vínculos proporcionais ao IP vigente, fechando a soma', () => {
    const s = suggestAllocations(currentAllocations(contract[0]!, []), D('10'))
    expect(s.map((x) => `${x.packageCode}=${x.quantity.toDb()}`)).toEqual(['IP01=6.0000', 'IP02=4.0000'])
    const odd = suggestAllocations(new Map([['IP01', D('1')], ['IP02', D('2')]]), D('1'))
    expect(Decimal.sum(odd.map((x) => x.quantity)).toDb()).toBe('1.0000')
    expect(suggestAllocations(new Map(), D('1'))).toEqual([])
  })

  it('exige conteúdo e valida a nova data', () => {
    const empty = computeAddendum(contract, [], [])
    expect(validateAddendum(args('addendum'), empty, ctx()).map((i) => i.field)).toEqual(['items'])
    expect(validateAddendum({ ...args('addendum'), newEndOn: '2027-02-01' }, empty, ctx())).toEqual([])
    expect(validateAddendum({ ...args('addendum'), newEndOn: '2026-12-31' }, empty, ctx()).map((i) => i.field)).toEqual(['newEndOn'])
    expect(validateAddendum(args('termination'), empty, ctx()).map((i) => i.field)).toEqual(['items'])
  })

  it('término vigente vem do último lançamento aprovado com nova data', () => {
    expect(currentEndOn('2026-12-31', [])).toBe('2026-12-31')
    expect(currentEndOn('2026-12-31', [{ number: 1, newEndOn: '2027-01-31' }, { number: 2, newEndOn: null }, { number: 3, newEndOn: '2027-03-31' }])).toBe('2027-03-31')
    expect(
      currentEndOn('2026-12-31', [
        { number: 2, kind: 'addendum', newEndOn: '2027-05-31', decidedAt: '2026-11-01T10:00:00Z' },
        { number: 1, kind: 'termination', newEndOn: '2027-01-31', decidedAt: '2026-12-01T10:00:00Z' },
      ]),
    ).toBe('2027-01-31')
  })
})
