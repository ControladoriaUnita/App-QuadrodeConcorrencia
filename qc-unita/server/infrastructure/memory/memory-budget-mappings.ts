/**
 * De-para do orçamento e indireto aberto por obra em memória (modo demonstração).
 * Mesmo comportamento das tabelas budget_item_mappings, indirect_planning_mappings e
 * work_indirect_costs (migration 022).
 */
import type { IndirectBudget } from '../../../shared/domain/budget/indirect-import'
import { descriptionKey } from '../../../shared/domain/budget/mappings'
import type { BudgetMappingRepository, IndirectRepository } from '../../application/ports'
import type { MemoryDb } from './memory-db'

export function createMemoryBudgetMappings(db: MemoryDb): BudgetMappingRepository {
  return {
    async list() {
      return {
        items: db.all('budget_item_mappings').map((m) => ({
          wbs: m.id,
          description: (m.description as string) ?? null,
          planning: m.planningCode ? { code: m.planningCode as string, description: (m.planningDescription as string) ?? null } : null,
        })),
        indirect: db.all('indirect_planning_mappings').map((m) => ({
          description: m.description as string,
          planning: { code: m.planningCode as string, description: (m.planningDescription as string) ?? null },
        })),
      }
    },
    async setItem(wbs, { description, planning }, actorId) {
      if (!description && !planning) return void db.t('budget_item_mappings').delete(wbs)
      db.put('budget_item_mappings', {
        id: wbs, description, planningCode: planning?.code ?? null, planningDescription: planning?.description ?? null,
        updatedBy: actorId, updatedAt: new Date().toISOString(),
      })
    },
    async setIndirect(description, planning, actorId) {
      const id = descriptionKey(description)
      if (!planning) return void db.t('indirect_planning_mappings').delete(id)
      db.put('indirect_planning_mappings', {
        id, description: description.trim(), planningCode: planning.code, planningDescription: planning.description,
        updatedBy: actorId, updatedAt: new Date().toISOString(),
      })
    },
    async listWorkItems() {
      const active = new Set(db.find('works', (w) => !w.archivedAt).map((w) => w.id))
      return db
        .find('budgets', (b) => b.isCurrent === true && active.has(b.workId as string))
        .flatMap((b) => {
          const workId = b.workId as string
          return db.find('budget_items', (g) => g.budgetId === b.id).map((g) => ({
            workId,
            wbs: g.wbs as string,
            name: (db.get('budget_group_names', `${workId}|${g.wbs}`)?.description as string) ?? null,
          }))
        })
    },
  }
}

export function createMemoryIndirect(db: MemoryDb): IndirectRepository {
  return {
    async get(workId) {
      const r = db.get('work_indirect_costs', workId)
      if (!r) return null
      const by = r.importedBy ? db.get('profiles', r.importedBy as string) : undefined
      return {
        fileName: r.fileName as string,
        importedAt: r.importedAt as string,
        importedByName: (by?.fullName as string) ?? null,
        budget: r.budget as IndirectBudget,
      }
    },
    async save(workId, { fileName, budget }, actorId) {
      db.put('work_indirect_costs', { id: workId, fileName, budget, importedBy: actorId, importedAt: new Date().toISOString() })
    },
    async listAll() {
      return db.all('work_indirect_costs').map((r) => ({ workId: r.id, budget: r.budget as IndirectBudget }))
    },
  }
}
