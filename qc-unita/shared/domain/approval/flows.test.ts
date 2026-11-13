import { describe, expect, it } from 'vitest'
import { Decimal } from '../decimal'
import { decide } from './approval-flow'
import { matchFlow, planFromFlows, type FlowLike } from './flows'

const step = (name: string, roleId: string, extra: Partial<FlowLike['steps'][number]> = {}) => ({ stepOrder: 0, name, roleId, director: false, minAmount: null, active: true, ...extra })
const flow = (id: string, kind: FlowLike['kind'], criteria: Partial<Pick<FlowLike, 'origin' | 'requestKind' | 'directorId'>>, steps: FlowLike['steps']): FlowLike => ({
  id, kind, name: id, origin: null, requestKind: null, directorId: null, active: true, ...criteria, steps: steps.map((s, k) => ({ ...s, stepOrder: k + 1 })),
})

const flows: FlowLike[] = [
  flow('padrao', 'competition', {}, [step('Suprimentos', 'proc'), step('Diretoria', 'dir', { minAmount: '500000' })]),
  flow('RT', 'competition', { directorId: 'rt' }, [step('Suprimentos', 'proc'), step('Diretor RT', 'dir', { director: true })]),
  flow('RT-obra-mo', 'competition', { directorId: 'rt', origin: 'work', requestKind: 'labor' }, [step('Engenharia', 'eng'), step('Diretor RT', 'dir', { director: true })]),
  flow('desvio', 'deviation', {}, [step('Diretor (desvio)', 'dir', { director: true })]),
  flow('aditivo', 'addendum', {}, [step('Gerente', 'mgr')]),
]
const ctx = (directorId: string | null, origin: 'work' | 'procurement' | null = null, requestKind: 'material' | 'labor' | null = null) => ({ directorId, origin, requestKind })

describe('Fluxos de aprovação configuráveis', () => {
  it('vence o fluxo mais específico que serve para o pedido', () => {
    expect(matchFlow(flows, 'competition', ctx(null))?.id).toBe('padrao')
    expect(matchFlow(flows, 'competition', ctx('rt'))?.id).toBe('RT')
    expect(matchFlow(flows, 'competition', ctx('rt', 'work', 'labor'))?.id).toBe('RT-obra-mo')
    expect(matchFlow(flows, 'competition', ctx('rt', 'procurement', 'labor'))?.id).toBe('RT')
    expect(matchFlow(flows, 'competition', ctx('sr'))?.id).toBe('padrao')
    expect(matchFlow(flows.map((f) => ({ ...f, active: f.id !== 'padrao' })), 'competition', ctx('sr'))).toBeNull()
  })

  it('plano: alçada filtra etapas, etapa de diretor fica com o diretor do pedido, renumerado', () => {
    const small = planFromFlows(flows, 'competition', ctx(null), Decimal.from('1000'))!
    expect(small.approvals.map((a) => a.stepName)).toEqual(['Suprimentos'])
    const big = planFromFlows(flows, 'competition', ctx(null), Decimal.from('600000'))!
    expect(big.approvals.map((a) => [a.stepOrder, a.stepName])).toEqual([[1, 'Suprimentos'], [2, 'Diretoria']])
    const rt = planFromFlows(flows, 'competition', ctx('rt'), Decimal.from('1000'))!
    expect(rt.approvals.map((a) => [a.stepName, a.directorId ?? null])).toEqual([['Suprimentos', null], ['Diretor RT', 'rt']])
  })

  it('com desvio no mapa, as etapas de desvio entram no fim', () => {
    const p = planFromFlows(flows, 'competition', ctx('rt'), Decimal.from('1000'), { deviation: true })!
    expect(p.deviationFlow?.id).toBe('desvio')
    expect(p.approvals.map((a) => [a.stepOrder, a.stepName, a.directorId ?? null])).toEqual([[1, 'Suprimentos', null], [2, 'Diretor RT', 'rt'], [3, 'Diretor (desvio)', 'rt']])
  })

  it('sem fluxo do tipo devolve null (vale a regra anterior)', () => {
    expect(planFromFlows(flows, 'deadline', ctx(null), Decimal.ZERO)).toBeNull()
    expect(planFromFlows(flows, 'addendum', ctx('rt'), Decimal.from('10'))!.approvals.map((a) => a.stepName)).toEqual(['Gerente'])
  })

  it('etapa do diretor com usuário ligado só é decidida por ele', () => {
    const plan = planFromFlows(flows, 'competition', ctx('rt'), Decimal.from('1000'))!.approvals.map((a, k) => (k === 0 ? { ...a, status: 'approved' as const } : a))
    const base = { stepOrder: 2, decision: 'approved' as const, actorRoleIds: ['dir'], now: '2026-11-13T00:00:00Z', directorUsers: new Map([['rt', 'helena']]) }
    expect(() => decide(plan, { ...base, actorId: 'outro-diretor' })).toThrow(/diretor responsável/)
    expect(decide(plan, { ...base, actorId: 'helena' }).outcome).toBe('approved')
    // Diretor sem usuário: qualquer um com o papel
    expect(decide(plan, { ...base, actorId: 'outro-diretor', directorUsers: new Map([['rt', null]]) }).outcome).toBe('approved')
  })
})
