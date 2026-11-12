/**
 * Custos fora de escopo em memória (modo demonstração). Mesmo comportamento da tabela
 * out_of_scope_costs (migration 025): número sequencial por obra e auditoria campo a campo.
 */
import type { OutOfScopeCostDTO } from '../../../shared/contracts'
import { outOfScopeTotal } from '../../../shared/domain/budget/out-of-scope'
import type { OutOfScopeRepository, OutOfScopeWrite } from '../../application/ports'
import type { AuditCtx, MemoryDb, Row } from './memory-db'

const TABLE = 'out_of_scope_costs'

export function createMemoryOutOfScope(db: MemoryDb, audit: AuditCtx): OutOfScopeRepository {
  const toDto = (r: Row): OutOfScopeCostDTO & { workId: string } => ({
    id: r.id,
    workId: r.workId as string,
    number: r.number as number,
    code: (r.code as string) ?? null,
    description: r.description as string,
    unit: r.unit as string,
    quantity: r.quantity as string,
    unitCost: r.unitCost as string,
    total: outOfScopeTotal(r.quantity as string, r.unitCost as string).toDb(),
    wbs: (r.wbs as string) ?? null,
    wbsDescription: (r.wbsDescription as string) ?? null,
    planningCode: (r.planningCode as string) ?? null,
    planningDescription: (r.planningDescription as string) ?? null,
    category: r.category as OutOfScopeCostDTO['category'],
    justification: r.justification as string,
    requestedBy: (r.requestedBy as string) ?? null,
    occurredOn: r.occurredOn as string,
    createdByName: typeof r.createdBy === 'string' ? ((db.get('profiles', r.createdBy)?.fullName as string) ?? null) : null,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  })
  const content = (d: OutOfScopeWrite) => ({ ...d })

  return {
    async list(workId) {
      return db
        .find(TABLE, (r) => r.workId === workId)
        .sort((a, b) => (a.number as number) - (b.number as number))
        .map(toDto)
    },
    async get(id) {
      const r = db.get(TABLE, id)
      return r ? toDto(r) : null
    },
    async create(workId, data, actorId) {
      const number = db.find(TABLE, (r) => r.workId === workId).reduce((m, r) => Math.max(m, r.number as number), 0) + 1
      const row = db.insert(TABLE, { workId, number, ...content(data), createdBy: actorId, updatedBy: actorId }, audit, { workId })
      return { id: row.id, number }
    },
    async update(id, data, actorId) {
      const r = db.get(TABLE, id)
      if (!r) return
      db.update(TABLE, id, { ...content(data), updatedBy: actorId }, audit, { workId: r.workId as string })
    },
    async delete(id) {
      const r = db.get(TABLE, id)
      if (r) db.remove(TABLE, id, audit, { workId: r.workId as string })
    },
  }
}
