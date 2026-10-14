import { describe, expect, it } from 'vitest'
import type { BudgetLineUsageDTO } from '@shared/contracts'
import { buildBudgetTree } from '@shared/domain/budget/structure'
import { Decimal } from '@shared/domain/decimal'
import { withAuxCompositions } from './budgetAux'
import { cellValue, EMPTY_VALUE, filterOptions, itemOfRows, passesFilters, type BudgetFilters } from './budgetFilters'

const line = (id: string, activityWbs: string, code: string, packageCode: string | null, total: string) =>
  ({
    id, activityWbs, activityCode: `CPU-${activityWbs}`, activityDescription: `Serviço ${activityWbs}`,
    code, description: `Insumo ${code}`, unit: 'm³', quantity: '1', unitCost: total, total,
    packageCode, packageDescription: packageCode && `Pacote ${packageCode}`, committedValue: '0', usage: [], aux: null,
  }) as unknown as BudgetLineUsageDTO

// 01 → 01.01 (composição com insumos) e 01.02 (composição sem insumos: custo da planilha)
const structure = {
  groups: [{ wbs: '01', description: 'Infraestrutura' }],
  activities: [
    { wbs: '01.01', code: 'CPU-01.01', description: 'Concreto', unit: 'm³', quantity: '10', unitCost: '30', total: '300' },
    { wbs: '01.02', code: 'CPU-01.02', description: 'Forma', unit: 'm²', quantity: '5', unitCost: '20', total: '100' },
  ],
}
const tree = withAuxCompositions(buildBudgetTree(structure, [line('a', '01.01', 'IM-1', 'IP01', '200'), line('b', '01.01', 'IM-2', 'IP02', '100')]))
const itemOf = itemOfRows(tree)
const row = (key: string) => tree.find((r) => r.key === key)!
const values = (...v: string[]) => ({ kind: 'values' as const, values: new Set(v) })

describe('filtros do orçamento', () => {
  it('a coluna Item lista todos os níveis da EAP, em ordem e recuados', () => {
    expect(filterOptions(tree, itemOf).item).toEqual([
      { value: '01 — Infraestrutura', count: 2, depth: 0 },
      { value: '01.01 — Concreto', count: 2, depth: 1 },
      { value: '01.02 — Forma', count: 0, depth: 1 },
    ])
  })

  it('cada linha vale pelo nível da EAP mais próximo (insumo → composição)', () => {
    expect(itemOf.get('g:01')).toBe('01 — Infraestrutura')
    expect(itemOf.get('l:a')).toBe('01.01 — Concreto')
  })

  it('composição sem insumos entra nas listas e passa nos filtros', () => {
    const forma = row('a:01.02')
    expect(filterOptions(tree, itemOf).code.map((o) => o.value)).toContain('CPU-01.02')
    expect(passesFilters(forma, { item: values('01.02 — Forma') }, itemOf)).toBe(true)
    expect(passesFilters(forma, { code: values('CPU-01.02') }, itemOf)).toBe(true)
  })

  it('coluna que não se aplica ao tipo de linha não passa por conta própria', () => {
    const filters: BudgetFilters = { package: values('IP01') }
    expect(cellValue(row('g:01'), 'package', itemOf)).toBeNull()
    expect(passesFilters(row('g:01'), filters, itemOf)).toBe(false)
    expect(passesFilters(row('l:a'), filters, itemOf)).toBe(true)
    expect(passesFilters(row('l:b'), filters, itemOf)).toBe(false)
  })

  it('faixa numérica vale para composições e insumos', () => {
    // Só o Item 01 (300 + 100) passa de 350
    const filters: BudgetFilters = { total: { kind: 'range', min: Decimal.from('350'), max: null } }
    expect(tree.filter((r) => passesFilters(r, filters, itemOf)).map((r) => r.key)).toEqual(['g:01'])
  })

  it('valores vazios aparecem como (vazio)', () => {
    const t = withAuxCompositions(buildBudgetTree(structure, [line('c', '01.01', 'IM-3', null, '10')]))
    expect(filterOptions(t, itemOfRows(t)).package.map((o) => o.value)).toEqual([EMPTY_VALUE])
  })
})
