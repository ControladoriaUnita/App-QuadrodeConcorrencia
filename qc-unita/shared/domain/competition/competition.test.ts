import { describe, expect, it } from 'vitest'
import { D } from '../decimal'
import { bestMixTotal, computeBestConditions, computeSupplierSummaries } from './best-condition'
import { availableBudget, compareWithBudget } from './budget-comparison'
import { approvalAmount, canCreateRevision, nextRevisionNumber, validateForSubmission, assertEditable } from './revision'
import { computeChosenQuotation } from './chosen-quotation'
import { buildSnapshot, canonicalJson } from './snapshot'
import type { QcItem, QcPrice, QcSupplier } from './types'

const item = (id: string, order: number, qty: string, unit: string): QcItem => ({
  id, sortOrder: order, code: `IS${id}`, description: id, unit: 'm³',
  budgetTotal: D(qty).times(unit).round(4), quantity: D(qty),
  pctMaterial: D(0), pctEquipment: D(0), pctRetention: D(0),
})
const sup = (id: string, order: number, status: QcSupplier['status'] = 'responded'): QcSupplier => ({
  id, supplierId: `s-${id}`, sortOrder: order, status, legalName: id, cndValidUntil: null,
})
const price = (s: string, i: string, v: string | null): QcPrice => ({ competitionSupplierId: s, itemId: i, unitPrice: v === null ? null : D(v) })

const items = [item('a', 1, '351', '60'), item('b', 2, '7.656', '1500')]
const suppliers = [sup('A', 1), sup('B', 2), sup('C', 3, 'declined')]
const prices = [
  price('A', 'a', '58'), price('B', 'a', '55'), price('C', 'a', '10'),
  price('A', 'b', '1450'), price('B', 'b', '0'), // zero = não cotado
]

describe('melhor condição', () => {
  const best = computeBestConditions(items, suppliers, prices)
  it('escolhe o menor unitário ignorando zero e fornecedor desclassificado', () => {
    expect(best[0]!.competitionSupplierId).toBe('B')
    expect(best[0]!.totalPrice!.toFixed()).toBe('19305.0000')
    expect(best[1]!.competitionSupplierId).toBe('A')
    expect(best[1]!.totalPrice!.toFixed()).toBe('11101.2000')
  })
  it('calcula variação contra o orçado', () => {
    expect(best[0]!.budgetTotal.toFixed()).toBe('21060.0000')
    expect(best[0]!.varianceAmount!.toFixed()).toBe('1755.0000')
    expect(best[0]!.varianceRatio!.toFixed()).toBe('0.083333')
  })
  it('empate fica com a coluna mais à esquerda', () => {
    const b = computeBestConditions([items[0]!], suppliers, [price('B', 'a', '50'), price('A', 'a', '50')])
    expect(b[0]!.competitionSupplierId).toBe('A')
  })
  it('override exige justificativa e preço', () => {
    expect(() => computeBestConditions(items, suppliers, prices, [{ itemId: 'a', competitionSupplierId: 'A', reason: ' ' }])).toThrow()
    const o = computeBestConditions(items, suppliers, prices, [{ itemId: 'a', competitionSupplierId: 'A', reason: 'Prazo' }])
    expect(o[0]!.competitionSupplierId).toBe('A')
    expect(o[0]!.isOverride).toBe(true)
  })
  it('item sem cotação fica sem vencedor', () => {
    const b = computeBestConditions([item('z', 1, '1', '1')], suppliers, [])
    expect(b[0]!.competitionSupplierId).toBeNull()
  })
  it('mix total', () => {
    expect(bestMixTotal(best).toFixed()).toBe('30406.2000')
  })
})

describe('consolidação por fornecedor e orçamento', () => {
  const envelope = { budgetAmount: D('32544'), usedAmount: D('1000'), adjustmentAmount: D('500') }
  it('verba disponível = orçado − utilizado + ajustes', () => {
    expect(availableBudget(envelope).toFixed()).toBe('32044')
  })
  it('totais, completude e ranking', () => {
    const s = computeSupplierSummaries(items, suppliers, prices, envelope)
    const A = s.find((x) => x.competitionSupplierId === 'A')!
    const B = s.find((x) => x.competitionSupplierId === 'B')!
    expect(A.total.toFixed()).toBe('31459.2000')
    expect(A.complete).toBe(true)
    expect(A.rank).toBe(1)
    expect(B.complete).toBe(false)
    expect(B.rank).toBeNull()
    expect(A.result.toFixed()).toBe('584.8000')
  })
  it('status contra orçamento', () => {
    expect(compareWithBudget(envelope, D('40000')).status).toBe('over')
    expect(compareWithBudget(envelope, D('31000')).status).toBe('attention')
    expect(compareWithBudget(envelope, D('20000')).status).toBe('within')
  })
})

describe('revisões', () => {
  it('numeração e abertura', () => {
    expect(nextRevisionNumber([{ number: 0 }, { number: 1 }])).toBe(2)
    expect(canCreateRevision([{ status: 'draft' }]).ok).toBe(false)
    expect(canCreateRevision([{ status: 'approved' }]).ok).toBe(true)
    expect(canCreateRevision([{ status: 'approved' }, { status: 'in_approval' }]).ok).toBe(false)
  })
  it('revisão aprovada não é editável', () => {
    expect(() => assertEditable({ status: 'approved', frozenAt: '2026-01-01', number: 0 })).toThrow(/não pode ser alterada/)
  })
  it('valida campos obrigatórios para envio', () => {
    const issues = validateForSubmission({
      revision: {
        id: 'r', number: 0, status: 'draft', frozenAt: null, requestedOn: '2026-10-01',
        serviceStartOn: '2026-11-01', serviceEndOn: '2026-10-01', engineeringOwnerName: null,
        procurementOwnerName: 'Adriano', contractTypeId: null, winnerSupplierId: 's-A', winnerJustification: '',
      },
      items, suppliers, best: computeBestConditions(items, suppliers, prices),
    })
    const fields = issues.map((i) => i.field)
    expect(fields).toEqual(expect.arrayContaining(['serviceEndOn', 'engineeringOwnerName', 'contractTypeId', 'winnerJustification']))
    // Sem mínimo de fornecedores: um participante basta
    expect(fields).not.toContain('suppliers')
    const none = validateForSubmission({
      revision: { id: 'r', number: 0, status: 'draft', frozenAt: null, requestedOn: null, serviceStartOn: null, serviceEndOn: null, engineeringOwnerName: null, procurementOwnerName: null, contractTypeId: null, winnerSupplierId: null, winnerJustification: null },
      items, suppliers: [], best: [],
    })
    expect(none.map((i) => i.field)).toContain('suppliers')
  })
})

describe('envio com cotação escolhida', () => {
  const revision = {
    id: 'r', number: 0, status: 'draft' as const, frozenAt: null, requestedOn: '2026-10-01', serviceStartOn: '2026-11-01',
    serviceEndOn: '2026-12-01', engineeringOwnerName: 'Eng', procurementOwnerName: 'Sup', contractTypeId: 't',
    winnerSupplierId: null, winnerJustification: 'Divisão por menor preço em cada insumo',
  }
  const env = { budgetAmount: D('0'), usedAmount: D('0'), adjustmentAmount: D('0') }
  const validate = (choices: [string, string][], sups = suppliers) =>
    validateForSubmission({
      revision, items, suppliers: sups, best: computeBestConditions(items, sups, prices),
      chosen: computeChosenQuotation(items, prices, new Map(choices), env), today: '2026-11-03',
    })

  it('dispensa a vencedora única, mas exige empresa (que cotou) em todo insumo com quantidade', () => {
    expect(validate([['a', 'B'], ['b', 'A']])).toEqual([])
    expect(validate([['a', 'B']])).toEqual([{ field: 'chosen', message: 'Cotação escolhida: 1 insumo(s) com quantidade sem empresa escolhida.' }])
    // B não cotou o insumo b (preço zero)
    expect(validate([['a', 'A'], ['b', 'B']])).toEqual([{ field: 'chosen', message: 'Cotação escolhida: 1 insumo(s) escolhido(s) com empresa que não cotou o preço.' }])
    // Sem escolha nenhuma: continua exigindo a vencedora
    expect(validate([]).map((i) => i.field)).toContain('winnerSupplierId')
  })

  it('confere a CND de cada empresa escolhida', () => {
    const vencida = suppliers.map((s) => (s.id === 'B' ? { ...s, cndValidUntil: '2026-10-31' } : s))
    expect(validate([['a', 'B'], ['b', 'A']], vencida)).toEqual([{ field: 'chosen', message: 'CND de B (cotação escolhida) vencida em 2026-10-31.' }])
  })

  it('alçada pelo total escolhido, antes da vencedora e da melhor condição', () => {
    expect(approvalAmount(D('100'), D('90'), D('120')).toFixed()).toBe('120')
    expect(approvalAmount(D('100'), D('90')).toFixed()).toBe('100')
    expect(approvalAmount(null, D('90')).toFixed()).toBe('90')
  })
})

describe('snapshot', () => {
  it('JSON canônico independe da ordem das chaves e serializa Decimal', async () => {
    expect(canonicalJson({ b: 1, a: { d: D('1.50'), c: 2 } })).toBe('{"a":{"c":2,"d":"1.50"},"b":1}')
    const a = await buildSnapshot({ x: 1, y: 2 })
    const b = await buildSnapshot({ y: 2, x: 1 })
    expect(a.hash).toBe(b.hash)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
