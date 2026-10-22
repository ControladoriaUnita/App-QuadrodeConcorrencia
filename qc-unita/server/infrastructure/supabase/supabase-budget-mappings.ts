/**
 * De-para do orçamento e indireto aberto por obra no Supabase (migration 022). Tudo com o client de
 * serviço: os casos de uso conferem a permissão antes, e o de-para é lido também ao gravar o
 * orçamento de obras de quem não mantém o catálogo.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { IndirectBudget } from '../../../shared/domain/budget/indirect-import'
import { descriptionKey } from '../../../shared/domain/budget/mappings'
import type { BudgetMappingRepository, IndirectRepository } from '../../application/ports'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must<T = any>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

/** PostgREST limita cada resposta (padrão 1.000 linhas): lê em páginas */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const rows = must<T[]>(await page(from, from + 999))
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

export function createSupabaseBudgetMappings(service: SupabaseClient): BudgetMappingRepository {
  return {
    async list() {
      type ItemRow = { wbs_code: string; description: string | null; planning_code: string | null; planning_description: string | null }
      type IndirectRow = { description: string; planning_code: string; planning_description: string | null }
      const [items, indirect] = await Promise.all([
        allPages<ItemRow>((a, b) => service.from('budget_item_mappings').select('wbs_code, description, planning_code, planning_description').order('wbs_code').range(a, b)),
        allPages<IndirectRow>((a, b) => service.from('indirect_planning_mappings').select('description, planning_code, planning_description').order('description_key').range(a, b)),
      ])
      return {
        items: items.map((r) => ({
          wbs: r.wbs_code,
          description: r.description,
          planning: r.planning_code ? { code: r.planning_code, description: r.planning_description } : null,
        })),
        indirect: indirect.map((r) => ({ description: r.description, planning: { code: r.planning_code, description: r.planning_description } })),
      }
    },
    async setItem(wbs, { description, planning }, actorId) {
      if (!description && !planning) {
        must(await service.from('budget_item_mappings').delete().eq('wbs_code', wbs))
        return
      }
      must(await service.from('budget_item_mappings').upsert(
        {
          wbs_code: wbs, description, planning_code: planning?.code ?? null, planning_description: planning?.description ?? null,
          updated_by: actorId, updated_at: new Date().toISOString(),
        },
        { onConflict: 'wbs_code' },
      ))
    },
    async setIndirect(description, planning, actorId) {
      const key = descriptionKey(description)
      if (!planning) {
        must(await service.from('indirect_planning_mappings').delete().eq('description_key', key))
        return
      }
      must(await service.from('indirect_planning_mappings').upsert(
        {
          description_key: key, description: description.trim(), planning_code: planning.code, planning_description: planning.description,
          updated_by: actorId, updated_at: new Date().toISOString(),
        },
        { onConflict: 'description_key' },
      ))
    },
    async listWorkItems() {
      const budgets = must(await service.from('budgets').select('id, work_id, works!inner(archived_at)').eq('is_current', true).is('works.archived_at', null)) as
        { id: string; work_id: string }[]
      if (!budgets.length) return []
      const workOf = new Map(budgets.map((b) => [b.id, b.work_id]))
      const [groups, names] = await Promise.all([
        allPages<{ budget_id: string; wbs_code: string }>((a, b) =>
          service.from('budget_items').select('budget_id, wbs_code').in('budget_id', [...workOf.keys()]).order('id').range(a, b)),
        allPages<{ work_id: string; wbs_code: string; description: string }>((a, b) =>
          service.from('budget_group_names').select('work_id, wbs_code, description').order('work_id').range(a, b)),
      ])
      const nameOf = new Map(names.map((n) => [`${n.work_id}|${n.wbs_code}`, n.description]))
      return groups.map((g) => {
        const workId = workOf.get(g.budget_id)!
        return { workId, wbs: g.wbs_code, name: nameOf.get(`${workId}|${g.wbs_code}`) ?? null }
      })
    },
  }
}

export function createSupabaseIndirect(service: SupabaseClient): IndirectRepository {
  return {
    async get(workId) {
      const r = must(await service.from('work_indirect_costs').select('file_name, payload, imported_at, imported_by').eq('work_id', workId).maybeSingle()) as
        { file_name: string; payload: IndirectBudget; imported_at: string; imported_by: string | null } | null
      if (!r) return null
      const by = r.imported_by
        ? (must(await service.from('profiles').select('full_name').eq('id', r.imported_by).maybeSingle()) as { full_name: string } | null)
        : null
      return { fileName: r.file_name, importedAt: r.imported_at, importedByName: by?.full_name ?? null, budget: r.payload }
    },
    async save(workId, { fileName, budget }, actorId) {
      must(await service.from('work_indirect_costs').upsert(
        { work_id: workId, file_name: fileName, payload: budget, imported_by: actorId, imported_at: new Date().toISOString() },
        { onConflict: 'work_id' },
      ))
    },
    async listAll() {
      const rows = await allPages<{ work_id: string; payload: IndirectBudget }>((a, b) =>
        service.from('work_indirect_costs').select('work_id, payload').order('work_id').range(a, b))
      return rows.map((r) => ({ workId: r.work_id, budget: r.payload }))
    },
  }
}
