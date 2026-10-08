import { describe, expect, it } from 'vitest'
import { Decimal } from '../decimal'
import { buildQcMap, type QcMapSource } from '../competition/qc-map'
import { buildContractDraft, computeAddendum, currentEndOn, validateAddendum, validateContractRequest } from './contract-request'

const D = Decimal.from

function source(): QcMapSource {
  const item = (id: string, code: string, quantity: string, pctMaterial = '0') => ({
    id, sortOrder: 1, materialId: `m-${id}`, code, description: `Insumo ${code}`, unit: 'm³', budgetQuantity: quantity,
    budgetUnitCost: '10.0000', quantity, scopeDescription: `Escopo ${code}`, contractNotes: null, pctMaterial, pctEquipment: '0', pctRetention: '0.05',
  })
  const sup = (id: string, supplierId: string) => ({
    id, supplierId, sortOrder: 1, status: 'responded' as const, legalName: supplierId, tradeName: null, taxId: '1', contactName: null, phone: null,
    email: null, cndValidUntil: null, deliveryTerms: null, paymentTerms: null, readjustmentTerms: null, notes: null, strengths: null,
    weaknesses: null, proposalRef: null, proposalReceivedOn: null, proposalValidUntil: null,
  })
  return {
    competition: {
      id: 'c', code: 'QC-1', title: 'T', description: null, status: 'approved', packageCode: null, requestedOn: '2026-09-01', workId: 'w',
      workCode: '1', workName: 'W', budgetId: 'b', engineeringOwner: null, procurementOwner: null,
    },
    revision: {
      id: 'r', number: 0, status: 'approved', reason: null, serviceStartOn: '2026-10-01', serviceEndOn: '2026-12-31', budgetAmount: '3000.0000',
      budgetUsedAmount: '0', budgetAdjustmentAmount: '0', engineeringNotes: null, procurementNotes: null, contractTypeId: 't',
      winnerSupplierId: 'S1', winnerJustification: 'x', submittedAt: null, decidedAt: null, frozenAt: null, snapshotHash: null, createdAt: '',
    },
    revisions: [],
    items: [item('i1', 'IM1', '100.0000', '1'), item('i2', 'IS2', '50.0000'), item('i3', 'IS3', '0.0000'), item('i4', 'IM4', '10.0000')],
    suppliers: [sup('cs1', 'S1'), sup('cs2', 'S2')],
    prices: [
      { competitionSupplierId: 'cs1', itemId: 'i1', unitPrice: '9.5000', notes: null },
      { competitionSupplierId: 'cs1', itemId: 'i2', unitPrice: '12.0000', notes: null },
      { competitionSupplierId: 'cs2', itemId: 'i4', unitPrice: '8.0000', notes: null },
    ],
    overrides: [],
    approvals: [],
    links: [
      { id: 'l1', itemId: 'i1', activityItemId: 'a1', lineKey: 'k1', materialId: 'm-i1', packageCode: 'IP02', packageDescription: null, quantity: '60.0000', share: '1', budgetValue: '600', budgetUnitCost: '10', awardedUnitPrice: null, awardedTotal: null },
      { id: 'l2', itemId: 'i1', activityItemId: 'a2', lineKey: 'k2', materialId: 'm-i1', packageCode: 'IP01', packageDescription: null, quantity: '40.0000', share: '1', budgetValue: '400', budgetUnitCost: '10', awardedUnitPrice: null, awardedTotal: null },
      { id: 'l3', itemId: 'i1', activityItemId: 'a3', lineKey: 'k3', materialId: 'm-i1', packageCode: 'IP02', packageDescription: null, quantity: '0.0000', share: '0', budgetValue: '0', budgetUnitCost: '10', awardedUnitPrice: null, awardedTotal: null },
    ],
    contractTypes: [],
    people: [],
  }
}

describe('Solicitação de contrato', () => {
  it('usa só os itens cotados pela vencedora, ao preço dela, com vínculos agrupados por IP', () => {
    const src = source()
    const draft = buildContractDraft(src, buildQcMap(src))
    expect(draft.items.map((i) => i.code)).toEqual(['IM1', 'IS2'])
    expect(draft.excluded.map((e) => e.code)).toEqual(['IM4'])
    expect(draft.total.toDb()).toBe('1550.0000') // 100 × 9,50 + 50 × 12,00
    const im1 = draft.items[0]!
    expect(im1.specification).toBe('Escopo IM1')
    expect(im1.allocations.map((a) => [a.packageCode, a.quantity.toDb()])).toEqual([['IP01', '40.0000'], ['IP02', '60.0000']])
    // Distribuição ponderada pelo valor contratado: 950 de material em 1.550
    expect(draft.distribution.pctMaterial.toFixed(6)).toBe('0.612903')
    expect(draft.distribution.pctService.toFixed(6)).toBe('0.387097')
  })

  it('exige vencedora participante', () => {
    const src = source()
    src.revision.winnerSupplierId = 'X'
    expect(() => buildContractDraft(src, buildQcMap(src))).toThrow()
  })

  it('pendências: tipo, datas, critérios de medição e materiais com faturamento direto', () => {
    const base = {
      contractTypeId: 't', startOn: '2026-10-01', endOn: '2026-12-31', supplierId: 's', secondSupplierId: null,
      directBilling: false, directBillingMaterials: null, measurementCriteria: 'Mensal', supplierCndValidUntil: '2027-01-01',
    }
    expect(validateContractRequest(base, [{ quantity: D(1) }], '2026-10-06')).toEqual([])
    const issues = validateContractRequest(
      { ...base, endOn: '2026-09-01', directBilling: true, measurementCriteria: ' ', secondSupplierId: 's', supplierCndValidUntil: '2026-10-01' },
      [{ quantity: D(1) }],
      '2026-10-06',
    ).map((i) => i.field)
    expect(issues).toEqual(['endOn', 'secondSupplierId', 'directBillingMaterials', 'measurementCriteria', 'supplier'])
  })
})

describe('Aditivos', () => {
  const contract = [
    { id: 'a', quantity: D('100'), totalPrice: D('1000') },
    { id: 'b', quantity: D('10'), totalPrice: D('500') },
  ]

  it('acumula quantidades e totais com aditivos aprovados anteriores', () => {
    const previous = [{ contractItemId: 'a', code: 'A', quantityDelta: D('20'), unitPrice: D('10') }]
    const s = computeAddendum(contract, previous, [
      { contractItemId: 'a', code: 'A', quantityDelta: D('-30'), unitPrice: D('10') },
      { contractItemId: null, code: 'NOVO', quantityDelta: D('2.5'), unitPrice: D('40.10') },
    ])
    expect(s.initialTotal.toDb()).toBe('1500.0000')
    expect(s.previousTotal.toDb()).toBe('200.0000')
    expect(s.totalDelta.toDb()).toBe('-199.7500') // −300 + 100,25
    expect(s.newTotal.toDb()).toBe('1500.2500')
    expect(s.lines[0]!.quantityAfter.toDb()).toBe('90.0000')
  })

  it('não deixa a quantidade acumulada ficar negativa e exige conteúdo', () => {
    const neg = computeAddendum(contract, [], [{ contractItemId: 'b', code: 'B', quantityDelta: D('-11'), unitPrice: D('50') }])
    const args = { reason: 'Redução de escopo', newEndOn: null, contractStartOn: '2026-10-01', currentEndOn: '2026-12-31' }
    expect(validateAddendum(args, neg).map((i) => i.message).join()).toContain('negativa em B')
    const empty = computeAddendum(contract, [], [])
    expect(validateAddendum(args, empty).map((i) => i.field)).toEqual(['items'])
    expect(validateAddendum({ ...args, newEndOn: '2027-02-01' }, empty)).toEqual([])
    expect(validateAddendum({ ...args, newEndOn: '2026-12-31' }, empty).map((i) => i.field)).toEqual(['newEndOn'])
  })

  it('término vigente vem do último aditivo aprovado com nova data', () => {
    expect(currentEndOn('2026-12-31', [])).toBe('2026-12-31')
    expect(currentEndOn('2026-12-31', [{ number: 1, newEndOn: '2027-01-31' }, { number: 2, newEndOn: null }, { number: 3, newEndOn: '2027-03-31' }])).toBe('2027-03-31')
  })
})
