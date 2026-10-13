import { describe, expect, it } from 'vitest'
import { ErpNotConfiguredError, MockERPProvider, type ERPProvider, type ErpSupplier } from '../../infrastructure/erp'
import { MemoryDb } from '../../infrastructure/memory/memory-db'
import { createMemoryRepositories } from '../../infrastructure/memory/memory-repositories'
import type { RequestContext } from '../context'
import { syncFromErp } from './erp-sync'

function setup() {
  const db = new MemoryDb()
  const repos = createMemoryRepositories(db, { actorId: 'u1', origin: 'erp_sync', correlationId: 'c1' })
  const ctx: RequestContext = {
    correlationId: 'c1', origin: 'erp_sync', now: () => new Date(),
    actor: { id: 'u1', fullName: 'Admin', email: null, roles: [], permissions: [{ key: 'integration.run', workId: null }] },
  }
  return { db, repos, ctx }
}

const sup = (erpId: string, taxId: string, over: Partial<ErpSupplier> = {}): ErpSupplier => ({
  erpId, legalName: `Fornecedor ${erpId}`, taxId, phone: null, cndValidUntil: null, active: true, ...over,
})

/** Provider que, como a UAU hoje, só implementa fornecedores. */
function suppliersOnly(list: ErpSupplier[]): ERPProvider {
  const pending = () => Promise.reject(new ErpNotConfiguredError('uau', 'ainda não implementado para a UAU.'))
  return {
    name: 'uau', supports: new Set(['suppliers'] as const),
    getSuppliers: async () => list, getWorks: pending, getWork: pending, getBudget: pending, getMaterials: pending, pushContract: pending,
  }
}

describe('syncFromErp', () => {
  it('"Tudo" roda só o que o provider implementa e marca o resto como ignorado', async () => {
    const { repos, ctx } = setup()
    const r = await syncFromErp(repos, suppliersOnly([sup('1', '11111111000111')]), ctx, { scope: 'all' })
    expect(r.steps.map((s) => [s.operation, s.status])).toEqual([
      ['getWorks', 'skipped'], ['getSuppliers', 'success'], ['getMaterials', 'skipped'], ['getBudget', 'skipped'],
    ])
    expect((await repos.integrationLogs.list()).map((l) => l.operation)).toEqual(['getSuppliers'])
  })

  it('escopo específico não implementado → etapa com erro claro', async () => {
    const { repos, ctx } = setup()
    const r = await syncFromErp(repos, suppliersOnly([]), ctx, { scope: 'works' })
    expect(r.steps[0]).toMatchObject({ status: 'error', message: 'ainda não implementado para a UAU.' })
  })

  it('mock continua sincronizando tudo', async () => {
    const { repos, ctx } = setup()
    const r = await syncFromErp(repos, new MockERPProvider(), ctx, { scope: 'all' })
    expect(r.steps.every((s) => s.status === 'success')).toBe(true)
  })
})

describe('gravação de fornecedores do ERP (memória)', () => {
  it('adota cadastro manual pelo CNPJ, preserva CND/telefone e inativa quem sumiu do ERP', async () => {
    const { db, repos } = setup()
    db.put('suppliers', { id: 'm1', legalName: 'Manual', taxId: '22222222000122', phone: '(62) 9999-0000', cndValidUntil: '2027-01-31', source: 'manual', active: true, erpId: null })
    db.put('suppliers', { id: 'e1', legalName: 'Sumiu', taxId: '33333333000133', source: 'erp', active: true, erpId: '99' })
    db.put('suppliers', { id: 'm2', legalName: 'Só manual', taxId: '44444444000144', source: 'manual', active: true, erpId: null })

    const r = await repos.erpWriter.upsertSuppliers([sup('5', '22222222000122'), sup('6', '55555555000155')], { deactivateMissing: true })
    expect(r).toEqual({ upserted: 2, deactivated: 1 })

    const adopted = db.get<Record<string, unknown>>('suppliers', 'm1')!
    expect(adopted).toMatchObject({ erpId: '5', source: 'erp', phone: '(62) 9999-0000', cndValidUntil: '2027-01-31', legalName: 'Fornecedor 5' })
    expect(db.all('suppliers').filter((s) => s.taxId === '22222222000122')).toHaveLength(1)
    expect(db.get<Record<string, unknown>>('suppliers', 'e1')!.active).toBe(false)
    expect(db.get<Record<string, unknown>>('suppliers', 'm2')!.active).toBe(true)
  })

  it('lista vazia nunca inativa ninguém', async () => {
    const { db, repos } = setup()
    db.put('suppliers', { id: 'e1', legalName: 'X', taxId: '33333333000133', source: 'erp', active: true, erpId: '99' })
    expect(await repos.erpWriter.upsertSuppliers([], { deactivateMissing: true })).toEqual({ upserted: 0, deactivated: 0 })
    expect(db.get<Record<string, unknown>>('suppliers', 'e1')!.active).toBe(true)
  })
})
