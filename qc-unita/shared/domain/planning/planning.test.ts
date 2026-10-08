import { describe, expect, it } from 'vitest'
import { D } from '../decimal'
import type { BudgetLineDTO, WorkCompetitionDTO } from '../../contracts'
import { consolidate, groupBudgetLines, lineBalances, lineBudgetValue, linkBalanceByItem, linkFromQuantity, linkFromShare, rebalance, validateLinks } from './links'
import { buildWorkOverview, UNLINKED } from '../work/overview'

const line = (id: string, materialId: string, code: string, pkg: string, quantity: string, total: string): BudgetLineDTO => ({
  id, lineKey: `k-${id}`, activityWbs: '01.01', activityCode: 'CPU1', activityDescription: 'Comp', materialId, code,
  description: code, unit: 'un', packageCode: pkg, packageDescription: pkg === 'IP1' ? 'Pavimentação' : 'Passeio',
  quantity, unitCost: (Number(total) / Number(quantity)).toFixed(4), total,
})
const inputs: BudgetLineDTO[] = [
  line('a', 'm1', 'IM1', 'IP1', '100', '75'),
  line('b', 'm1', 'IM1', 'IP2', '50', '40'),
  line('c', 'm2', 'IS2', 'IP1', '10', '600'),
]

describe('vínculos de planejamento', () => {
  it('agrupa linhas do orçamento em itens (um por insumo) com um vínculo por linha', () => {
    const g = groupBudgetLines(inputs)
    const cimento = g.find((x) => x.code === 'IM1')!
    expect(cimento.quantity.toFixed()).toBe('150.0000')
    expect(cimento.budget.toFixed()).toBe('115.0000')
    expect(cimento.unitCost.toFixed()).toBe('0.7667')
    expect(cimento.links.map((l) => l.packageCode)).toEqual(['IP1', 'IP2'])
  })

  it('considera apenas o percentual não comprometido de cada linha', () => {
    const bal = lineBalances(inputs, [
      { lineKey: 'k-a', quantity: '60', share: '0.6', budgetValue: '45' },
      { lineKey: 'k-c', quantity: '10', share: '1', budgetValue: '600' },
    ])
    expect(bal.get('k-a')!.balanceShare.toFixed(6)).toBe('0.400000')
    expect(bal.get('k-a')!.committedValue.toFixed()).toBe('45')
    const g = groupBudgetLines(inputs, { available: new Map([...bal].map(([k, v]) => [k, v.balanceShare])) })
    expect(g).toHaveLength(1) // bota-fora totalmente comprometido
    expect(g[0]!.links.map((l) => l.quantity.toFixed())).toEqual(['40.0000', '50.0000'])
    expect(g[0]!.budget.toFixed()).toBe('70.0000') // 75×40/100 + 40
  })

  it('percentual escolhido por linha define verba e quantidade', () => {
    const half = linkFromShare(inputs[0]!, D('0.5'))
    expect(half.quantity.toFixed()).toBe('50.0000')
    expect(half.budgetValue.toFixed()).toBe('37.5000')
    const full = linkFromShare(inputs[0]!, D(1))
    expect(full.budgetValue.toFixed()).toBe('75.0000') // 100% = custo total exato
    const g = groupBudgetLines(inputs, { shares: new Map([['a', D('0.25')]]), available: new Map([['k-b', D('0.1')]]) })
    const cimento = g.find((x) => x.code === 'IM1')!
    expect(cimento.links.map((l) => l.share.toFixed(2))).toEqual(['0.25', '0.10'])
    expect(cimento.budget.toFixed()).toBe('22.7500') // 75×25% + 40×10%
    const byQty = linkFromQuantity(inputs[0]!, D(20))
    expect(byQty.share.toFixed(6)).toBe('0.200000')
    expect(byQty.budgetValue.toFixed()).toBe('15.0000')
  })

  it('valor orçado proporcional ao custo total da linha', () => {
    expect(lineBudgetValue(inputs[0]!, D(100)).toFixed()).toBe('75')
    expect(lineBudgetValue(inputs[0]!, D(33)).toFixed()).toBe('24.7500')
  })

  it('exige quantidade vinculada igual à do item', () => {
    const items = [{ id: 'i1', quantity: D(150) }, { id: 'i2', quantity: D(10) }] as never
    const links = [{ itemId: 'i1', materialId: 'm1', packageCode: 'IP1', quantity: D(100), budgetUnitCost: D('0.75') }]
    expect(linkBalanceByItem(items, links).get('i1')!.diff.toFixed()).toBe('50')
    const msgs = validateLinks(items, links).map((i) => i.message)
    expect(msgs.join()).toMatch(/sem vínculo/)
    expect(msgs.join()).toMatch(/diferente/)
  })

  it('redistribui proporcionalmente fechando o total', () => {
    const r = rebalance([D(100), D(50)], D(160))
    expect(r.map((x) => x.toFixed())).toEqual(['106.6667', '53.3333'])
    expect(rebalance([D(0), D(0), D(0)], D(10)).reduce((a, b) => a.plus(b)).toFixed(4)).toBe('10.0000')
  })

  it('consolida orçado × outros QCs × este QC por vínculo e por insumo', () => {
    const c = consolidate(
      inputs,
      [{ itemId: 'i1', materialId: 'm1', packageCode: 'IP1', quantity: D(80), budgetUnitCost: D('0.75'), awardedTotal: D(56) }],
      [{ competitionId: 'x', category: 'contracted', packageCode: 'IP1', materialId: 'm2', lineKey: 'k-c', quantity: '10', share: '1', budgetValue: '600', amount: '580' }],
    )
    const ip1 = c.byPackage[0]!
    expect(ip1.budgetTotal.toFixed()).toBe('675')
    expect(ip1.balance.toFixed()).toBe('39')
    expect(ip1.consumption!.toFixed()).toBe('0.942222')
    const m1 = c.byMaterial[0]!
    expect(m1.budgetQuantity.toFixed()).toBe('150')
    expect(m1.balanceQuantity.toFixed()).toBe('70')
  })
})

describe('visão da obra', () => {
  const comp = (id: string, pkg: string | null, category: WorkCompetitionDTO['category'], total: string) =>
    ({ id, packageCode: pkg, category, committedTotal: total }) as WorkCompetitionDTO
  it('consumo do orçamento por tipo de serviço, incluindo parcela sem vínculo', () => {
    const o = buildWorkOverview({
      budgetTotal: '1000',
      packages: [
        { packageCode: 'IP1', description: 'Pavimentação', total: '675', inputs: 2 },
        { packageCode: 'IP2', description: 'Passeio', total: '325', inputs: 1 },
      ],
      competitions: [comp('a', 'IP1', 'contracted', '500'), comp('b', 'IP2', 'quoting', '100')],
      links: [{ competitionId: 'a', category: 'contracted', packageCode: 'IP1', materialId: 'm1', lineKey: 'k-a', quantity: '1', share: '0.01', budgetValue: '0.75', amount: '450' }],
    })
    expect(o.totals.contracted.toFixed()).toBe('500')
    expect(o.totals.committedRatio!.toFixed()).toBe('0.500000')
    expect(o.totals.projectedRatio!.toFixed()).toBe('0.600000')
    expect(o.groups.find((g) => g.packageCode === 'IP1')!.contracted.toFixed()).toBe('450')
    const sem = o.groups.find((g) => g.packageCode === UNLINKED)!
    expect(sem.contracted.toFixed()).toBe('50')
    expect(sem.quoting.toFixed()).toBe('100')
    expect(o.uncovered).toBe(0)
  })
})
