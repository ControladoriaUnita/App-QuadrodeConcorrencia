import { describe, expect, it } from 'vitest'
import { applyItemPlanning, descriptionKey, mappingResolver, nameGroups } from './mappings'

const resolver = mappingResolver({
  items: [
    { wbs: '02', description: 'INFRAESTRUTURA', planning: { code: 'IP00100', description: 'Infra' } },
    { wbs: '02.06', description: 'FUNDAÇÕES', planning: { code: 'IP00106', description: 'Fundações' } },
    { wbs: '03', description: 'SUPERESTRUTURA', planning: null },
  ],
  indirect: [{ description: 'Almoxarife', planning: { code: 'IP00510', description: null } }],
})

describe('de-para dos Itens', () => {
  it('o IP do Item vale para tudo abaixo dele; o Item mais próximo ganha', () => {
    expect(resolver.planningForItem('02.06.01.03')?.code).toBe('IP00106')
    expect(resolver.planningForItem('02.01.01')?.code).toBe('IP00100')
    expect(resolver.planningForItem('02')?.code).toBe('IP00100')
    // Item com nome e sem IP não vincula
    expect(resolver.planningForItem('03.01')).toBeNull()
    expect(resolver.planningForItem('020.01')).toBeNull()
  })

  it('aplica o IP nas linhas e conta as que ficam sem de-para', () => {
    const line = (activityWbs: string) => ({ activityWbs, packageCode: activityWbs, packageDescription: 'SERVIÇO' })
    const { lines, unmapped } = applyItemPlanning([line('02.06.01'), line('05.01')], resolver)
    expect(lines).toEqual([
      { activityWbs: '02.06.01', packageCode: 'IP00106', packageDescription: 'Fundações' },
      { activityWbs: '05.01', packageCode: '05.01', packageDescription: 'SERVIÇO' },
    ])
    expect(unmapped).toBe(1)
  })

  it('o nome do de-para só troca o nome genérico; o nome dado na obra vale sobre ele', () => {
    const groups = [
      { wbs: '02', description: 'Item 02' },
      { wbs: '02.06', description: 'Fundação profunda', renamed: true },
      { wbs: '03', description: 'Superestrutura (Excel)' },
      { wbs: '04', description: 'Item 04' },
    ]
    expect(nameGroups(groups, resolver).map((g) => g.description)).toEqual(['INFRAESTRUTURA', 'Fundação profunda', 'Superestrutura (Excel)', 'Item 04'])
  })
})

describe('de-para do indireto', () => {
  it('acha o insumo pela descrição sem diferenciar acento, caixa e espaços; sem ele, vale o Item', () => {
    expect(descriptionKey('  ALMOXARIFE  Noturno ')).toBe('almoxarife noturno')
    expect(resolver.planningForIndirect('ALMOXARIFE ', '16.05')?.code).toBe('IP00510')
    expect(resolver.planningForIndirect('Engenheiro', '02.99')?.code).toBe('IP00100')
    expect(resolver.planningForIndirect('Engenheiro', '16.05')).toBeNull()
  })
})
