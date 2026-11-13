import { describe, expect, it } from 'vitest'
import { buildQcMap, type QcMapSource } from './qc-map'
import { computeScope, outOfScopeQuantityOf } from './scope'

function source(): QcMapSource {
  const item = (id: string, code: string, quantity: string, pctMaterial = '0') => ({
    id, sortOrder: 1, materialId: `m-${id}`, code, description: `Insumo ${code}`, unit: 'm³',
    quantity, scopeDescription: `Escopo ${code}`, contractNotes: null, pctMaterial, pctEquipment: '0', pctRetention: '0.05',
    origin: 'reference' as const, planningCode: null, planningDescription: null, referenceIds: id === 'i1' ? ['r1'] : [], chosenSupplierId: null, outOfScopeQuantity: null,
  })
  const sup = (id: string, supplierId: string) => ({
    id, supplierId, sortOrder: 1, status: 'responded' as const, legalName: supplierId, tradeName: null, taxId: '1', contactName: null, phone: null,
    email: null, cndValidUntil: null, deliveryTerms: null, paymentTerms: null, readjustmentTerms: null, notes: null, strengths: null,
    weaknesses: null, proposalRef: null, proposalReceivedOn: null, proposalValidUntil: null, isPlaceholder: false,
  })
  return {
    competition: {
      id: 'c', code: 'QC-1', title: 'T', description: null, status: 'approved', packageCode: null, requestedOn: '2026-09-01', workId: 'w',
      workCode: '1', workName: 'W', budgetId: 'b', engineeringOwner: null, procurementOwner: null, engineeringOwnerName: null, procurementOwnerName: null,
      requestKind: null, origin: null, directorId: null, directorName: null,
    },
    revision: {
      id: 'r', number: 0, status: 'approved', reason: null, serviceStartOn: '2026-10-01', serviceEndOn: '2026-12-31', budgetAmount: '3000.0000',
      budgetUsedAmount: '0', budgetAdjustmentAmount: '0', engineeringNotes: null, procurementNotes: null, contractTypeId: 't',
      winnerSupplierId: 'S1', winnerJustification: 'x', submittedAt: null, decidedAt: null, frozenAt: null, snapshotHash: null, createdAt: '',
    },
    revisions: [],
    items: [item('i1', 'IM1', '100.0000', '1'), item('i2', 'IS2', '50.0000'), item('i3', 'IS3', '0.0000'), item('i4', 'IM4', '10.0000')],
    references: [{ id: 'r1', sortOrder: 1, materialId: 'm-i1', code: 'IM1', description: 'Insumo IM1', unit: 'm³' }],
    suppliers: [sup('cs1', 'S1'), sup('cs2', 'S2')],
    prices: [
      { competitionSupplierId: 'cs1', itemId: 'i1', unitPrice: '9.5000', notes: null },
      { competitionSupplierId: 'cs1', itemId: 'i2', unitPrice: '12.0000', notes: null },
      { competitionSupplierId: 'cs2', itemId: 'i4', unitPrice: '8.0000', notes: null },
    ],
    overrides: [],
    approvals: [],
    links: [
      { id: 'l1', referenceId: 'r1', activityItemId: 'a1', lineKey: 'k1', materialId: 'm-i1', packageCode: 'IP02', packageDescription: null, quantity: '60.0000', share: '1', budgetValue: '600', budgetUnitCost: '10', awardedUnitPrice: null, awardedTotal: null },
      { id: 'l2', referenceId: 'r1', activityItemId: 'a2', lineKey: 'k2', materialId: 'm-i1', packageCode: 'IP01', packageDescription: null, quantity: '40.0000', share: '1', budgetValue: '400', budgetUnitCost: '10', awardedUnitPrice: null, awardedTotal: null },
      { id: 'l3', referenceId: 'r1', activityItemId: 'a3', lineKey: 'k3', materialId: 'm-i1', packageCode: 'IP02', packageDescription: null, quantity: '0.0000', share: '0', budgetValue: '0', budgetUnitCost: '10', awardedUnitPrice: null, awardedTotal: null },
    ],
    contractTypes: [],
    people: [],
  }
}

const scopeOf = (src: QcMapSource) => computeScope(src, buildQcMap(src))
const patch = (src: QcMapSource, id: string, p: Partial<QcMapSource['items'][number]>) => ({ ...src, items: src.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })

describe('Fora de escopo e desvio no mapa', () => {
  it('insumo sem referência do orçamento é 100% fora de escopo; com referência, zero', () => {
    const s = scopeOf(source())
    const fe = (id: string) => s.byItem.get(id)!
    expect([fe('i1').outOfScopeQuantity.toDb(), fe('i2').outOfScopeQuantity.toDb(), fe('i4').outOfScopeQuantity.toDb()]).toEqual(['0.0000', '50.0000', '10.0000'])
    expect(fe('i2').automatic).toBe(true)
    // Unit. FE = preço contratado: vencedora S1 em i2 (12), melhor condição em i4 (8, S1 não cotou)
    expect([fe('i2').outOfScopeTotal.toDb(), fe('i4').outOfScopeTotal.toDb()]).toEqual(['600.0000', '80.0000'])
    expect(s.outOfScopeTotal.toDb()).toBe('680.0000')
    expect([s.bySupplier.get('cs1')!.toDb(), s.bySupplier.get('cs2')!.toDb(), s.best.toDb()]).toEqual(['600.0000', '80.0000', '680.0000'])
    expect(s.outOfScopeItems).toBe(2)
    expect(s.deviationItems).toBe(0)
  })

  it('quantidade fora de escopo informada vale para insumo orçado e não passa da quantidade', () => {
    const s = scopeOf(patch(source(), 'i1', { quantity: '120.0000', outOfScopeQuantity: '20' }))
    const l = s.byItem.get('i1')!
    expect([l.outOfScopeQuantity.toDb(), l.inScopeQuantity.toDb(), l.outOfScopeTotal.toDb(), l.automatic]).toEqual(['20.0000', '100.0000', '190.0000', false])
    expect(l.quantityDeviation).toBe(false) // os 20 a mais são escopo novo, não desvio
    expect(outOfScopeQuantityOf({ quantity: '5', referenceIds: [], outOfScopeQuantity: '9' }).quantity.toDb()).toBe('5.0000')
    expect(outOfScopeQuantityOf({ quantity: '5', referenceIds: [], outOfScopeQuantity: '0' }).quantity.toDb()).toBe('0.0000')
  })

  it('desvio é por linha: quantidade acima da orçada e preço acima do unitário orçado', () => {
    const qty = scopeOf(patch(source(), 'i1', { quantity: '120.0000' })).byItem.get('i1')!
    expect([qty.quantityDeviation, qty.priceDeviation, qty.budgetQuantity?.toDb()]).toEqual([true, false, '100.0000'])
    const src = source()
    const price = scopeOf({ ...src, prices: src.prices.map((p) => (p.itemId === 'i1' ? { ...p, unitPrice: '11.0000' } : p)) }).byItem.get('i1')!
    expect([price.priceDeviation, price.quantityDeviation, price.budgetUnit?.toDb()]).toEqual([true, false, '10.0000'])
  })

  it('quantidade orçada só é comparada na mesma unidade', () => {
    const src = source()
    const other = { ...src, references: src.references.map((r) => ({ ...r, unit: 'm²' })) }
    const l = scopeOf(patch(other, 'i1', { quantity: '120.0000' })).byItem.get('i1')!
    expect([l.budgetQuantity, l.quantityDeviation]).toEqual([null, false])
  })
})
