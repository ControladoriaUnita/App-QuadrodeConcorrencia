/**
 * O PostgREST devolve no máximo 1.000 linhas por resposta. O mapa (insumos e preços) e o
 * comprometido da obra eram lidos de uma vez: acima disso os preços sumiam calados e o recálculo
 * gravava totais errados (mesma classe do bug do orçamento da v05).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { createSupabaseRepositories } from './supabase-repositories'

type Row = Record<string, unknown>
const MAX_ROWS = 1000

/** Tabelas/RPCs como o PostgREST: sem range, só as 1.000 primeiras; com range, a fatia pedida (até 1.000) */
function fakeDb(tables: Record<string, Row[]>, rpcs: Record<string, Row[]> = {}) {
  const builder = (rows: Row[]) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'is', 'neq']) b[m] = () => b
    b.range = (from: number, to: number) => Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null })
    b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: rows.slice(0, MAX_ROWS), error: null }).then(ok, ko)
    return b
  }
  return { from: (t: string) => builder(tables[t] ?? []), rpc: (n: string) => builder(rpcs[n] ?? []) } as unknown as SupabaseClient
}

describe('mapa e comprometido no Supabase acima de 1.000 linhas', () => {
  it('lê todos os insumos e preços do mapa', async () => {
    const items = Array.from({ length: 1100 }, (_, i) => ({ id: `i${i}`, code: `IM${i}`, sortOrder: i, competition_item_references: [] }))
    const sups = [0, 1].map((n) => ({ id: `cs${n}`, supplierId: `s${n}`, sortOrder: n, supplier_proposals: [{ id: `p${n}` }], suppliers: { is_placeholder: false } }))
    const prices = sups.flatMap((s) => items.map((i) => ({ itemId: i.id, unitPrice: '1.0000', notes: null, supplier_proposals: { competition_supplier_id: s.id } })))
    const db = fakeDb({
      competitions: [{ id: 'c', code: 'QC-1', title: 'T', status: 'open', workId: 'w', budgetId: 'b', currentRevisionId: 'r', works: { code: '1', name: 'W' } }],
      competition_revisions: [{ id: 'r', number: 0, status: 'draft', competitionId: 'c' }],
      competition_items: items,
      competition_suppliers: sups,
      supplier_proposal_items: prices,
    })
    const data = await createSupabaseRepositories(db, {} as SupabaseClient).competitions.getData('c', 'r')
    expect(data!.items).toHaveLength(1100)
    expect(data!.prices).toHaveLength(2200)
    expect(data!.prices.filter((p) => p.competitionSupplierId === 'cs1')).toHaveLength(1100)
  })

  it('lê todos os vínculos comprometidos da obra', async () => {
    const links = Array.from({ length: 1500 }, (_, i) => ({ competition_id: 'c', category: 'contracted', package_code: 'IP1', material_id: `m${i}`, line_key: `k${i}`, quantity: '1', share: '1', budget_value: '1', amount: '1' }))
    const db = fakeDb({}, { qc_effective_revisions: [], qc_work_link_commitments: links })
    const r = await createSupabaseRepositories(db, {} as SupabaseClient).competitions.workCommitments('w')
    expect(r.links).toHaveLength(1500)
  })
})
