import { describe, expect, it } from 'vitest'
import { budgetReadiness, isPlanningCode, missingSummary } from './readiness'

describe('orçamento pronto para concorrência', () => {
  it('IP válido é o código do cadastro de IPs, não o código do item do orçamento', () => {
    expect([isPlanningCode('IP00104'), isPlanningCode(' ip00104 '), isPlanningCode('02.06.01'), isPlanningCode('16.05'), isPlanningCode(null), isPlanningCode('')]).toEqual([
      true, true, false, false, false, false,
    ])
  })

  it('pronto só com toda linha com IP e todo Item com nome', () => {
    const groups = [{ wbs: '02', description: 'INFRAESTRUTURA' }]
    expect(budgetReadiness(groups, [{ packageCode: 'IP00104' }, { packageCode: 'IP00302' }])).toEqual({ ready: true, linesWithoutPlanning: 0, unnamedItems: [] })
  })

  it('conta as linhas sem IP (vazias ou com o código do item) e os Itens sem nome', () => {
    const r = budgetReadiness(
      [{ wbs: '02', description: 'INFRAESTRUTURA' }, { wbs: '02.06', description: 'Item 02.06' }, { wbs: '16', description: '  ' }],
      [{ packageCode: 'IP00104' }, { packageCode: null }, { packageCode: '02.06.01' }],
    )
    expect(r).toEqual({ ready: false, linesWithoutPlanning: 2, unnamedItems: ['02.06', '16'] })
    expect(missingSummary(r)).toBe('2 linha(s) sem vínculo de planejamento (IP) e 2 Item(ns) sem nome (02.06, 16)')
    expect(missingSummary(budgetReadiness([], [{ packageCode: null }]))).toBe('1 linha(s) sem vínculo de planejamento (IP)')
  })
})
