/**
 * Cadastro manual de obra pela API (modo memória).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { WorkDTO } from '../../shared/contracts'
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

beforeAll(() => {
  process.env.DATA_SOURCE = 'memory'
})

describe('nova obra', () => {
  const body = { code: '2099', name: 'Residencial Teste', clientName: 'SPE Teste', city: 'Campinas', state: 'sp', status: 'not_started' }

  it('cria obra manual sem orçamento e lista na tela inicial', async () => {
    const r = await call<{ id: string }>('POST', '/works', body)
    expect(r.status).toBe(201)
    const w = (await call<WorkDTO[]>('GET', '/works')).data.find((x) => x.id === r.data.id)!
    expect([w.code, w.name, w.state, w.status, w.erpId, w.currentBudgetId]).toEqual(['2099', 'Residencial Teste', 'SP', 'not_started', null, null])
  })

  it('recusa nº repetido, dados inválidos e usuário sem permissão', async () => {
    const dup = await call<{ error: { code: string } }>('POST', '/works', body)
    expect([dup.status, dup.data.error.code]).toEqual([409, 'WORK_CODE_EXISTS'])
    expect((await call('POST', '/works', { ...body, code: '2100', name: 'X' })).status).toBe(422)
    expect((await call('POST', '/works', { ...body, code: '2101', startedOn: '2027-01-01', finishedOn: '2026-01-01' })).status).toBe(422)
    expect((await call('POST', '/works', { ...body, code: '2102' }, PROC)).status).toBe(403)
  })
})
