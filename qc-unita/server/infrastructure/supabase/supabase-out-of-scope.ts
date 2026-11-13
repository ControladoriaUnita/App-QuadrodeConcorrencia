/**
 * Custos fora de escopo no Supabase (migration 025). Client do usuário: o RLS reaplica
 * budget.read (leitura) e out_of_scope.manage (gravação); número e auditoria pelos triggers.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OutOfScopeCostDTO } from '../../../shared/contracts'
import type { OutOfScopeRepository, OutOfScopeWrite } from '../../application/ports'
import { allPages } from './pages'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must<T = any>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

const COLS = `id, work_id, number, code, description, unit, quantity::text, unit_cost::text, total_cost::text, wbs_code, wbs_description,
  planning_code, planning_description, category, justification, requested_by_name, occurred_on, created_by, created_at, updated_at,
  competition_id, competitions!competition_id(id, code, title)`

interface Row {
  id: string
  work_id: string
  number: number
  code: string | null
  description: string
  unit: string
  quantity: string
  unit_cost: string
  total_cost: string
  wbs_code: string | null
  wbs_description: string | null
  planning_code: string | null
  planning_description: string | null
  category: OutOfScopeCostDTO['category']
  justification: string
  requested_by_name: string | null
  occurred_on: string
  competition_id: string | null
  competitions: { id: string; code: string; title: string } | null
  created_by: string | null
  created_at: string
  updated_at: string
}

const toRow = (d: OutOfScopeWrite) => ({
  code: d.code, description: d.description, unit: d.unit, quantity: d.quantity, unit_cost: d.unitCost, wbs_code: d.wbs,
  wbs_description: d.wbsDescription, planning_code: d.planningCode, planning_description: d.planningDescription,
  category: d.category, justification: d.justification, requested_by_name: d.requestedBy, occurred_on: d.occurredOn,
  competition_id: d.competitionId,
})

export function createSupabaseOutOfScope(db: SupabaseClient): OutOfScopeRepository {
  const names = async (ids: (string | null)[]): Promise<Map<string, string>> => {
    const list = [...new Set(ids.filter((x): x is string => !!x))]
    if (!list.length) return new Map()
    const rows = must(await db.from('profiles').select('id, full_name').in('id', list)) as { id: string; full_name: string }[]
    return new Map(rows.map((r) => [r.id, r.full_name]))
  }
  const toDto = (r: Row, who: Map<string, string>): OutOfScopeCostDTO & { workId: string } => ({
    id: r.id,
    workId: r.work_id,
    number: r.number,
    code: r.code,
    description: r.description,
    unit: r.unit,
    quantity: r.quantity,
    unitCost: r.unit_cost,
    total: r.total_cost,
    wbs: r.wbs_code,
    wbsDescription: r.wbs_description,
    planningCode: r.planning_code,
    planningDescription: r.planning_description,
    category: r.category,
    justification: r.justification,
    requestedBy: r.requested_by_name,
    occurredOn: r.occurred_on,
    competition: r.competitions ? { id: r.competitions.id, code: r.competitions.code, title: r.competitions.title } : null,
    createdByName: (r.created_by && who.get(r.created_by)) ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })

  return {
    async list(workId) {
      const rows = await allPages<Row>((a, b) => db.from('out_of_scope_costs').select(COLS).eq('work_id', workId).order('number').range(a, b))
      const who = await names(rows.map((r) => r.created_by))
      return rows.map((r) => toDto(r, who))
    },
    async get(id) {
      const r = must(await db.from('out_of_scope_costs').select(COLS).eq('id', id).maybeSingle()) as Row | null
      return r ? toDto(r, await names([r.created_by])) : null
    },
    async create(workId, data, actorId) {
      const r = must(await db.from('out_of_scope_costs').insert({ work_id: workId, ...toRow(data), created_by: actorId, updated_by: actorId }).select('id, number').single()) as { id: string; number: number }
      return r
    },
    async update(id, data, actorId) {
      must(await db.from('out_of_scope_costs').update({ ...toRow(data), updated_by: actorId }).eq('id', id))
    },
    async delete(id) {
      must(await db.from('out_of_scope_costs').delete().eq('id', id))
    },
  }
}
