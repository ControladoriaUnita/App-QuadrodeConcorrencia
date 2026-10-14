import { describe, expect, it } from 'vitest'
import { D, Decimal } from '../decimal'
import type { QcItemDTO, QcLinkDTO } from '../../contracts'
import { buildQcMap, type QcMapSource } from '../competition/qc-map'
import { allocateGroupBudgets, comparisonGroups, itemPlanningAllocations, referenceBudgets, validateReferences } from './references'

const link = (id: string, referenceId: string, pkg: string, budgetValue: string): QcLinkDTO => ({
  id, referenceId, activityItemId: `a-${id}`, lineKey: `k-${id}`, materialId: `m-${referenceId}`, packageCode: pkg, packageDescription: null,
  quantity: '10.0000', share: '1', budgetValue, budgetUnitCost: '1', awardedUnitPrice: null, awardedTotal: null,
})
const item = (id: string, quantity: string, referenceIds: string[], extra: Partial<QcItemDTO> = {}): QcItemDTO => ({
  id, sortOrder: 1, materialId: null, code: id.toUpperCase(), description: id, unit: 'un', budgetQuantity: '0', budgetUnitCost: '0', quantity,
  scopeDescription: null, contractNotes: null, pctMaterial: '0', pctEquipment: '0', pctRetention: '0',
  origin: 'manual', planningCode: null, planningDescription: null, referenceIds, ...extra,
})

function source(items: QcItemDTO[], links: QcLinkDTO[], prices: [string, string][]): QcMapSource {
  return {
    competition: {
      id: 'c', code: 'QC-1', title: 'T', description: null, status: 'open', packageCode: null, requestedOn: '2026-10-01', workId: 'w',
      workCode: '1', workName: 'W', budgetId: 'b', engineeringOwner: null, procurementOwner: null,
    },
    revision: {
      id: 'r', number: 0, status: 'draft', reason: null, serviceStartOn: null, serviceEndOn: null, budgetAmount: '1000',
      budgetUsedAmount: '0', budgetAdjustmentAmount: '0', engineeringNotes: null, procurementNotes: null, contractTypeId: null,
      winnerSupplierId: null, winnerJustification: null, submittedAt: null, decidedAt: null, frozenAt: null, snapshotHash: null, createdAt: '',
    },
    revisions: [],
    items,
    references: [...new Set(links.map((l) => l.referenceId))].map((id, k) => ({ id, sortOrder: k + 1, materialId: `m-${id}`, code: id, description: id, unit: 'un' })),
    suppliers: [{
      id: 'cs1', supplierId: 's1', sortOrder: 1, status: 'responded', legalName: 'S1', tradeName: null, taxId: '1', contactName: null, phone: null,
      email: null, cndValidUntil: null, deliveryTerms: null, paymentTerms: null, readjustmentTerms: null, notes: null, strengths: null,
      weaknesses: null, proposalRef: null, proposalReceivedOn: null, proposalValidUntil: null,
    }],
    prices: prices.map(([itemId, unitPrice]) => ({ competitionSupplierId: 'cs1', itemId, unitPrice, notes: null })),
    overrides: [],
    approvals: [],
    links,
    contractTypes: [],
    people: [],
  }
}

describe('insumos do mapa × insumos referência', () => {
  it('agrupa por ligação e rateia a verba de uma referência entre vários insumos pelo valor contratado', () => {
    const budgets = referenceBudgets(['r1', 'r2', 'r3'], [
      { referenceId: 'r1', packageCode: 'IP1', budgetValue: D(600) },
      { referenceId: 'r1', packageCode: 'IP2', budgetValue: D(400) },
      { referenceId: 'r2', packageCode: 'IP1', budgetValue: D(300) },
    ])
    expect(budgets.get('r1')!.toFixed()).toBe('1000')
    expect(budgets.get('r3')!.toFixed()).toBe('0')
    const items = [
      { id: 'a', quantity: D(1), referenceIds: ['r1'] },
      { id: 'b', quantity: D(1), referenceIds: ['r1'] },
      { id: 'c', quantity: D(1), referenceIds: ['r2'] },
    ]
    const { groups, groupOfItem } = comparisonGroups(items, budgets)
    expect(groups.filter((g) => g.itemIds.length)).toHaveLength(2)
    expect(groupOfItem.get('a')).toBe(groupOfItem.get('b'))
    const alloc = allocateGroupBudgets(groups, new Map([['a', D(300)], ['b', D(100)], ['c', D(50)]]))
    expect(alloc.get('a')!.toFixed()).toBe('750.0000')
    expect(alloc.get('b')!.toFixed()).toBe('250.0000')
    expect(alloc.get('c')!.toFixed()).toBe('300')
    // Sem preços: partes iguais
    const equal = allocateGroupBudgets(groups, new Map())
    expect(equal.get('a')!.toFixed()).toBe('500.0000')
  })

  it('IP do insumo: herdado das linhas das referências pela verba, ou manual', () => {
    const links = [
      { referenceId: 'r1', packageCode: 'IP2', budgetValue: D(600) },
      { referenceId: 'r1', packageCode: 'IP1', budgetValue: D(400) },
    ]
    const inherited = itemPlanningAllocations({ id: 'a', quantity: D(10), referenceIds: ['r1'] }, links)
    expect(inherited.map((a) => [a.packageCode, a.quantity.toFixed(), a.share.toFixed(2)])).toEqual([['IP1', '4.0000', '0.40'], ['IP2', '6.0000', '0.60']])
    const manual = itemPlanningAllocations({ id: 'a', quantity: D(10), referenceIds: ['r1'], planningCode: 'IP9' }, links)
    expect(manual.map((a) => [a.packageCode, a.quantity.toFixed()])).toEqual([['IP9', '10']])
  })

  it('pendências: insumo sem referência nem IP manual e referência sem uso', () => {
    const msgs = validateReferences(
      [{ id: 'a', quantity: D(1), referenceIds: [] }, { id: 'b', quantity: D(1), referenceIds: [], planningCode: 'IP1' }],
      ['r1'],
    ).map((i) => i.message)
    expect(msgs).toEqual(['1 insumo(s) do mapa sem insumo referência (nem IP manual).', '1 insumo(s) referência não usado(s) no mapa de cotação.'])
  })

  it('no mapa: duas referências em um insumo (N:1) dão o orçado inteiro; valor das linhas segue a verba', () => {
    const src = source(
      [item('a', '10', ['r1', 'r2'])],
      [link('l1', 'r1', 'IP1', '600'), link('l2', 'r2', 'IP2', '400')],
      [['a', '90']],
    )
    const map = buildQcMap(src)
    const best = map.bestByItem.get('a')!
    expect(best.budgetTotal.toFixed()).toBe('1000')
    expect(best.totalPrice!.toFixed()).toBe('900.0000')
    expect(best.varianceAmount!.toFixed()).toBe('100.0000') // economia
    expect(map.links.map((l) => l.awardedTotal?.toFixed())).toEqual(['540.0000', '360.0000'])
    expect(map.allocationsByItem.get('a')!.map((x) => [x.packageCode, x.quantity.toFixed()])).toEqual([['IP1', '6.0000'], ['IP2', '4.0000']])
    expect(map.issues.some((i) => i.field === 'references')).toBe(false)
  })

  it('no mapa: uma referência em dois insumos (1:N) rateia pelo valor de cada um', () => {
    const src = source(
      [item('a', '10', ['r1']), item('b', '5', ['r1'])],
      [link('l1', 'r1', 'IP1', '1000')],
      [['a', '60'], ['b', '80']],
    )
    const map = buildQcMap(src)
    // contratado: a = 600, b = 400 → orçado 600 / 400
    expect(map.bestByItem.get('a')!.budgetTotal.toFixed()).toBe('600.0000')
    expect(map.bestByItem.get('b')!.budgetTotal.toFixed()).toBe('400.0000')
    expect(map.budgetTotal.toFixed()).toBe('1000.0000')
    expect(map.groupOfItem.get('a')!.itemIds).toEqual(['a', 'b'])
    expect(Decimal.sum(map.links.map((l) => l.awardedTotal ?? Decimal.ZERO)).toFixed()).toBe('1000.0000')
  })
})
