/**
 * Bug de produção (v04, obra U050C com 3.530 linhas): o PostgREST devolve no máximo 1.000 linhas
 * por resposta, e as linhas além disso (o item 16, o indireto aberto) sumiam do orçamento.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { createSupabaseRepositories } from './supabase-repositories'

const MAX_ROWS = 1000
const row = (i: number) => ({
  id: `l${i}`, line_key: `k${i}`, activity_wbs: i < 3000 ? '15.01' : '16.01', activity_code: null, activity_description: 'X',
  material_id: `m${i}`, code: `IM${i}`, description: 'x', unit: 'un', package_code: null, package_description: null, package_manual: false,
  quantity: '1.0000', unit_cost: '1.0000', total: '1.0000', sort_order: i,
})

/** RPC como o PostgREST: sem range, só as primeiras 1.000 linhas; com range, a fatia pedida (até 1.000) */
function fakeDb(total: number) {
  const rows = Array.from({ length: total }, (_, i) => row(i))
  const slice = (from: number, to: number) => ({ data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null })
  return {
    rpc: () => ({
      range: (from: number, to: number) => Promise.resolve(slice(from, to)),
      then: (resolve: (v: unknown) => unknown) => resolve(slice(0, MAX_ROWS - 1)),
    }),
  } as unknown as SupabaseClient
}

describe('linhas do orçamento no Supabase', () => {
  it('lê todas as linhas, mesmo acima do limite de 1.000 por resposta', async () => {
    const repos = createSupabaseRepositories(fakeDb(3530), {} as SupabaseClient)
    const lines = await repos.catalog.listBudgetLines('b1')
    expect(lines).toHaveLength(3530)
    expect(lines.filter((l) => l.activityWbs === '16.01')).toHaveLength(530)
    expect(new Set(lines.map((l) => l.id)).size).toBe(3530)
  })

  it('orçamento pequeno: uma leitura só', async () => {
    const repos = createSupabaseRepositories(fakeDb(12), {} as SupabaseClient)
    expect(await repos.catalog.listBudgetLines('b1')).toHaveLength(12)
  })
})
