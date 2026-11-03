/**
 * A semente do modo demonstração não pode depender da data de hoje: com CNDs de data fixa,
 * em 01/11/2026 a vencedora do Contrapiso venceu, o envio à aprovação falhou e a semente inteira caiu.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'

describe('semente do modo demonstração', () => {
  afterAll(() => vi.useRealTimers())

  it('carrega com o relógio anos à frente', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2031-06-15T12:00:00Z'))
    vi.resetModules()
    process.env.DATA_SOURCE = 'memory'
    const { handle } = await import('./router')
    const { DEMO_USERS } = await import('../infrastructure/memory/seed')
    const res = await handle(new Request('http://localhost/api/competitions', { headers: { 'x-demo-user': DEMO_USERS[0]!.id } }))
    expect(res.status).toBe(200)
    const list = (await res.json()) as { title: string; status: string }[]
    expect(list.find((c) => c.title.startsWith('Contrapiso'))?.status).toBe('in_approval')
  })
})
