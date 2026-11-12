/**
 * Custos fora de escopo pela API (modo memória).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { OutOfScopeListDTO, WorkDTO } from '../../shared/contracts'
import { DEMO_USERS } from '../infrastructure/memory/seed'
import { handle } from './router'

const [ADMIN, PROC, ENG, MGR] = DEMO_USERS.map((u) => u.id)

async function call<T = unknown>(method: string, path: string, body?: unknown, user = PROC): Promise<{ status: number; data: T }> {
  const res = await handle(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-demo-user': user! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, data: (await res.json()) as T }
}

let alpha: string
let other: string
const base = {
  code: 'IM00012', description: 'Cimento para reforço de muro de divisa', unit: 'kg', quantity: '1200', unitCost: '0.85',
  category: 'budget_omission', justification: 'Muro de divisa precisou de reforço que não constava no orçamento.', occurredOn: '2026-11-10',
}

beforeAll(async () => {
  process.env.DATA_SOURCE = 'memory'
  const works = (await call<WorkDTO[]>('GET', '/works', undefined, ADMIN)).data
  alpha = works.find((w) => w.code === '2041')!.id
  other = works.find((w) => w.code !== '2041')!.id
})

describe('custos fora de escopo', () => {
  it('lista os lançamentos da obra com o orçamento vigente e quem pode lançar', async () => {
    const { status, data } = await call<OutOfScopeListDTO>('GET', `/works/${alpha}/out-of-scope`)
    expect(status).toBe(200)
    expect(data.items.map((i) => i.number)).toEqual([1, 2])
    expect(data.items[0]).toMatchObject({ wbs: '02.02', wbsDescription: 'TERRAPLENAGEM', planningCode: 'IP00104', total: '4584.0000' })
    expect(Number(data.budgetTotal)).toBeGreaterThan(0)
    expect(data.canManage).toBe(true)
    // Gerente vê, mas não lança
    const mgr = await call<OutOfScopeListDTO>('GET', `/works/${alpha}/out-of-scope`, undefined, MGR)
    expect([mgr.status, mgr.data.canManage]).toEqual([200, false])
  })

  it('lança com número sequencial, total calculado e Item da EAP com o nome do orçamento', async () => {
    const r = await call<{ id: string; number: number }>('POST', `/works/${alpha}/out-of-scope`, { ...base, wbs: '02.03' }, ENG)
    expect([r.status, r.data.number]).toEqual([201, 3])
    const item = (await call<OutOfScopeListDTO>('GET', `/works/${alpha}/out-of-scope`)).data.items.find((i) => i.id === r.data.id)!
    expect(item).toMatchObject({ total: '1020.0000', wbsDescription: 'PAVIMENTAÇÃO', createdByName: 'Marina Costa', planningCode: null })
    // Numeração é por obra
    const o = await call<{ number: number }>('POST', `/works/${other}/out-of-scope`, base, ADMIN)
    expect(o.data.number).toBe(1)
  })

  it('recusa quantidade zero, custo negativo, justificativa curta, Item inexistente e quem não lança', async () => {
    const post = (b: object, user = PROC) => call<{ error: { code: string } }>('POST', `/works/${alpha}/out-of-scope`, { ...base, ...b }, user)
    expect((await post({ quantity: '0' })).status).toBe(422)
    expect((await post({ unitCost: '-1' })).status).toBe(422)
    expect((await post({ justification: 'ok' })).status).toBe(422)
    expect((await post({ category: 'outra' })).status).toBe(422)
    const wbs = await post({ wbs: '99.99' })
    expect([wbs.status, wbs.data.error.code]).toEqual([422, 'OUT_OF_SCOPE_WBS'])
    expect((await post({}, MGR)).status).toBe(403)
  })

  it('edita e exclui; id de outra obra é tratado como inexistente', async () => {
    const { data } = await call<OutOfScopeListDTO>('GET', `/works/${alpha}/out-of-scope`)
    const target = data.items.find((i) => i.number === 2)!
    const put = await call('PUT', `/works/${alpha}/out-of-scope/${target.id}`, { ...base, quantity: '2', unitCost: '4200', description: target.description, category: 'regulatory' })
    expect(put.status).toBe(200)
    const after = (await call<OutOfScopeListDTO>('GET', `/works/${alpha}/out-of-scope`)).data.items.find((i) => i.id === target.id)!
    expect([after.total, after.number, after.category]).toEqual(['8400.0000', 2, 'regulatory'])

    expect((await call('PUT', `/works/${other}/out-of-scope/${target.id}`, base, ADMIN)).status).toBe(404)
    expect((await call('DELETE', `/works/${other}/out-of-scope/${target.id}`, undefined, ADMIN)).status).toBe(404)
    expect((await call('DELETE', `/works/${alpha}/out-of-scope/${target.id}`, undefined, MGR)).status).toBe(403)
    expect((await call('DELETE', `/works/${alpha}/out-of-scope/${target.id}`)).status).toBe(200)
    expect((await call<OutOfScopeListDTO>('GET', `/works/${alpha}/out-of-scope`)).data.items.some((i) => i.id === target.id)).toBe(false)
  })
})
