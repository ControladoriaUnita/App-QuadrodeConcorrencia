/**
 * Desempenho do mapa: cada valor digitado regravava, um pedido por vez, o total de TODOS os preços
 * (insumos × fornecedores) e apagava/reinseria todas as melhores condições. Num mapa real eram
 * centenas de idas ao Supabase por gravação (segundos de espera) e duas gravações seguidas colidiam
 * na chave única de best_conditions. Agora só o que mudou é gravado.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { ComputedPersistence } from '../../application/ports'
import { allPages } from './pages'
import { createSupabaseRepositories } from './supabase-repositories'

type Row = Record<string, unknown>
type Op = { table: string; op: 'update' | 'upsert' | 'delete' | 'insert'; payload?: unknown; filters: [string, unknown][] }

function fakeDb(tables: Record<string, Row[]>) {
  const ops: Op[] = []
  const builder = (table: string) => {
    let rows = tables[table] ?? []
    let op: Op | null = null
    const filters: [string, unknown][] = []
    const result = () => {
      if (op) ops.push({ ...op, filters })
      return { data: op ? null : rows, error: null }
    }
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.order = () => b
    b.eq = (col: string, v: unknown) => {
      filters.push([col, v])
      if (!op) rows = rows.filter((r) => r[col] === undefined || r[col] === v)
      return b
    }
    b.in = (col: string, vs: unknown[]) => {
      filters.push([col, vs])
      if (!op) rows = rows.filter((r) => r[col] === undefined || vs.includes(r[col]))
      return b
    }
    for (const kind of ['update', 'upsert', 'delete', 'insert'] as const) {
      b[kind] = (payload?: unknown) => {
        op = { table, op: kind, payload, filters: [] }
        return b
      }
    }
    b.range = (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null })
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko)
    return b
  }
  return { db: { from: builder } as unknown as SupabaseClient, ops }
}

const ITEMS = 30
const SUPS = 4
const itemIds = Array.from({ length: ITEMS }, (_, i) => `i${i}`)
const supIds = Array.from({ length: SUPS }, (_, s) => `cs${s}`)

/** Estado gravado: preço 10 × quantidade 1 em todos; melhor condição = cs0 */
function stored() {
  return {
    supplier_proposals: supIds.map((cs, s) => ({ id: `p${s}`, competition_supplier_id: cs, total_amount: `${ITEMS * 10}.0000`, revision_id: 'r' })),
    supplier_proposal_items: supIds.flatMap((_, s) => itemIds.map((it) => ({ proposal_id: `p${s}`, competition_item_id: it, total_price: '10.0000' }))),
    best_conditions: itemIds.map((it) => ({
      revision_id: 'r', competition_item_id: it, competition_supplier_id: 'cs0', unit_price: '10.0000', total_price: '10.0000', budget_total: '12.0000',
      variance_amount: '2.0000', variance_ratio: '0.166667', is_override: false, override_reason: null,
    })),
  }
}

/** O mesmo resultado, recalculado pelo domínio (strings sem zeros à direita) */
function computedSame(): ComputedPersistence {
  return {
    priceTotals: supIds.flatMap((cs) => itemIds.map((it) => ({ competitionSupplierId: cs, itemId: it, totalPrice: '10' }))),
    proposalTotals: supIds.map((cs) => ({ competitionSupplierId: cs, total: String(ITEMS * 10) })),
    awardedTotal: String(ITEMS * 10),
    linkValues: [],
    best: itemIds.map((it) => ({
      itemId: it, competitionSupplierId: 'cs0', unitPrice: '10', totalPrice: '10', budgetTotal: '12', varianceAmount: '2', varianceRatio: '0.166667',
      isOverride: false, overrideReason: null,
    })),
  }
}

describe('persistComputed grava só o que mudou', () => {
  it('nada mudou: nenhum preço, proposta ou melhor condição é regravado', async () => {
    const { db, ops } = fakeDb(stored())
    await createSupabaseRepositories(db, {} as SupabaseClient).competitions.persistComputed('r', computedSame())
    expect(ops.filter((o) => o.table !== 'competition_revisions')).toEqual([])
  })

  it('um preço digitado: grava só aquele total, o total da proposta e a melhor condição do insumo', async () => {
    const { db, ops } = fakeDb(stored())
    const c = computedSame()
    // cs1 baixou o preço do i7 para 8 → passa a ser a melhor condição desse insumo
    c.priceTotals.find((p) => p.competitionSupplierId === 'cs1' && p.itemId === 'i7')!.totalPrice = '8'
    c.proposalTotals[1]!.total = String(ITEMS * 10 - 2)
    Object.assign(c.best[7]!, { competitionSupplierId: 'cs1', unitPrice: '8', totalPrice: '8', varianceAmount: '4', varianceRatio: '0.333333' })
    await createSupabaseRepositories(db, {} as SupabaseClient).competitions.persistComputed('r', c)

    const prices = ops.filter((o) => o.table === 'supplier_proposal_items')
    expect(prices).toHaveLength(1)
    expect(prices[0]).toMatchObject({ op: 'update', payload: { total_price: '8' }, filters: [['proposal_id', 'p1'], ['competition_item_id', 'i7']] })
    expect(ops.filter((o) => o.table === 'supplier_proposals')).toMatchObject([{ op: 'update', payload: { total_amount: String(ITEMS * 10 - 2) } }])
    const best = ops.filter((o) => o.table === 'best_conditions')
    // Sem apagar e reinserir tudo: só o upsert da linha que mudou
    expect(best).toHaveLength(1)
    expect(best[0]!.op).toBe('upsert')
    expect(best[0]!.payload).toMatchObject([{ competition_item_id: 'i7', competition_supplier_id: 'cs1' }])
  })

  it('insumo removido do mapa: apaga só a melhor condição dele', async () => {
    const { db, ops } = fakeDb(stored())
    const c = computedSame()
    c.best = c.best.filter((b) => b.itemId !== 'i3')
    c.priceTotals = c.priceTotals.filter((p) => p.itemId !== 'i3')
    await createSupabaseRepositories(db, {} as SupabaseClient).competitions.persistComputed('r', c)
    const best = ops.filter((o) => o.table === 'best_conditions')
    expect(best).toMatchObject([{ op: 'delete', filters: [['revision_id', 'r'], ['competition_item_id', ['i3']]] }])
  })
})

describe('allPages', () => {
  it('lê páginas seguintes em paralelo e devolve na ordem', async () => {
    const all = Array.from({ length: 3530 }, (_, i) => i)
    const asked: number[] = []
    const rows = await allPages<number>(async (from, to) => {
      asked.push(from)
      // Respostas fora de ordem não podem embaralhar o resultado
      await new Promise((r) => setTimeout(r, (5000 - from) / 1000))
      return { data: all.slice(from, to + 1), error: null }
    })
    expect(rows).toEqual(all)
    expect(asked.slice(0, 5)).toEqual([0, 1000, 2000, 3000, 4000])
  })

  it('uma página só quando cabe', async () => {
    let calls = 0
    const rows = await allPages<number>(async () => {
      calls++
      return { data: [1, 2, 3], error: null }
    })
    expect(rows).toEqual([1, 2, 3])
    expect(calls).toBe(1)
  })
})
