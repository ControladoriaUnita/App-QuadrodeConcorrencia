/**
 * Simulado de todos os estágios e exclusão de obra pela API (modo memória, obra 2055 dos exemplos).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { CompetitionDetailDTO, CompetitionListItemDTO, ContractListItemDTO, ContractRequestDTO, SimulationScenarioDTO } from '../../shared/contracts'
import { DEMO_USERS } from '../infrastructure/memory/seed'
import { handle } from './router'

const [ADMIN, PROC] = DEMO_USERS.map((u) => u.id)

async function call<T = unknown>(method: string, path: string, body?: unknown, user = ADMIN): Promise<{ status: number; data: T }> {
  const res = await handle(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-demo-user': user! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, data: (await res.json()) as T }
}

let works: { id: string; code: string }[]
const workOf = (code: string) => works.find((w) => w.code === code)!.id
const qcsOf = async (workId: string) => (await call<CompetitionListItemDTO[]>('GET', `/competitions?workId=${workId}`)).data

beforeAll(async () => {
  process.env.DATA_SOURCE = 'memory'
  works = (await call<{ id: string; code: string }[]>('GET', '/works')).data
})

describe('simulado de todos os estágios', () => {
  it('só o administrador; confirma pelo número da obra', async () => {
    const id = workOf('2055')
    expect((await call('GET', `/works/${id}/simulation`, undefined, PROC)).status).toBe(403)
    expect((await call('POST', `/works/${id}/simulation/run`, { scenario: 'convite' }, PROC)).status).toBe(403)
    expect((await call('POST', `/works/${id}/simulation/reset`, { confirmCode: '9999' })).status).toBe(422)
  })

  it('gera uma concorrência em cada estágio, do convite ao distrato', async () => {
    const id = workOf('2055')
    const { data: scenarios } = await call<SimulationScenarioDTO[]>('GET', `/works/${id}/simulation`)
    // Um "em aprovação" por alçada ativa (Suprimentos, Engenharia, Gerência, Diretoria)
    expect(scenarios.filter((s) => s.key.startsWith('aprovacao-'))).toHaveLength(4)
    expect((await call('POST', `/works/${id}/simulation/reset`, { confirmCode: '2055' })).status).toBe(200)

    const results: Record<string, { competitionId: string; code: string }> = {}
    for (const s of scenarios) {
      const r = await call<{ competitionId: string; code: string; error?: { message: string } }>('POST', `/works/${id}/simulation/run`, { scenario: s.key })
      expect(r.status, `${s.key}: ${JSON.stringify(r.data)}`).toBe(201)
      results[s.key] = r.data
    }
    const detail = async (key: string) => (await call<CompetitionDetailDTO>('GET', `/competitions/${results[key]!.competitionId}`)).data
    const pending = (d: CompetitionDetailDTO) => d.approvals.find((a) => a.status === 'pending')?.stepOrder

    expect((await detail('convite')).prices).toEqual([])
    const quoting = await detail('propostas')
    expect(quoting.revision.status).toBe('draft')
    expect(new Set(quoting.items.map((i) => i.chosenSupplierId).filter(Boolean)).size).toBe(2)
    for (const step of [1, 2, 3, 4]) {
      const d = await detail(`aprovacao-${step}`)
      expect([d.revision.status, pending(d)]).toEqual(['in_approval', step])
    }
    expect((await detail('reprovado')).revision.status).toBe('rejected')
    expect((await detail('aprovado')).revision.status).toBe('approved')

    const byQc = async (key: string) =>
      (await call<ContractListItemDTO[]>('GET', `/contracts?competitionId=${results[key]!.competitionId}`)).data
    const split = await byQc('cotacao-escolhida')
    expect(split.map((c) => c.status)).toEqual(['draft', 'draft'])
    expect(new Set(split.map((c) => c.supplierId)).size).toBe(2)
    expect((await byQc('contrato-concluido')).map((c) => c.status)).toEqual(['submitted'])
    expect((await byQc('contrato-cancelado')).map((c) => c.status)).toEqual(['cancelled'])
    const addendumOf = async (key: string) => (await call<ContractRequestDTO>('GET', `/contracts/${(await byQc(key))[0]!.id}`)).data.addenda
    expect((await addendumOf('aditivo-aguardando')).map((a) => [a.kind, a.status])).toEqual([['addendum', 'submitted']])
    expect((await addendumOf('aditivo-aprovado')).map((a) => [a.kind, a.status])).toEqual([['addendum', 'approved']])
    expect((await addendumOf('distrato')).map((a) => [a.kind, a.status])).toEqual([['termination', 'approved']])
    const revised = await detail('nova-revisao')
    expect([revised.revision.number, revised.revision.status]).toEqual([1, 'draft'])

    // Gerar de novo começa limpo: o reset apaga o simulado anterior
    const before = (await qcsOf(id)).length
    expect(before).toBe(scenarios.length)
    expect((await call<{ competitions: number }>('POST', `/works/${id}/simulation/reset`, { confirmCode: '2055' })).data.competitions).toBe(before)
    expect(await qcsOf(id)).toEqual([])
    // Outras obras não são tocadas
    expect((await qcsOf(workOf('2041'))).length).toBe(4)
  })
})

describe('excluir obra', () => {
  it('só o administrador, digitando o número; apaga a obra com QCs e contratos e não toca nas outras', async () => {
    const id = workOf('2041')
    expect((await call('DELETE', `/works/${id}`, { confirmCode: '2041' }, PROC)).status).toBe(403)
    const wrong = await call<{ error: { code: string } }>('DELETE', `/works/${id}`, { confirmCode: '2055' })
    expect([wrong.status, wrong.data.error.code]).toEqual([422, 'CONFIRM_CODE'])

    // A 2041 tem contrato enviado, aditivo e revisão congelada: as travas não impedem a exclusão
    expect((await call<ContractListItemDTO[]>('GET', `/contracts?workId=${id}`)).data.length).toBeGreaterThan(0)
    const del = await call<{ competitions: number; contracts: number }>('DELETE', `/works/${id}`, { confirmCode: '2041' })
    expect(del.status).toBe(200)
    expect(del.data.competitions).toBe(4)
    expect(del.data.contracts).toBeGreaterThan(0)

    const after = (await call<{ code: string }[]>('GET', '/works')).data.map((w) => w.code)
    expect(after).not.toContain('2041')
    expect(after).toContain('2055')
    expect((await call('GET', `/competitions?workId=${id}`)).data).toEqual([])
    expect((await call('GET', `/contracts?workId=${id}`)).data).toEqual([])
    expect((await call('GET', `/works/${id}/budget-lines`)).status).toBe(404)
  })
})
