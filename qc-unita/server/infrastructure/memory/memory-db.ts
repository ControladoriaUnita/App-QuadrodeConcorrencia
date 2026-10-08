/**
 * Banco em memória para desenvolvimento local e demonstração (DATA_SOURCE=memory).
 * Reproduz as garantias do Postgres que importam ao domínio:
 *   - revisão congelada é imutável (equivalente ao trigger guard_frozen_revision*)
 *   - auditoria campo a campo (equivalente ao trigger audit_row_changes)
 */
import type { AuditLogDTO, IntegrationLogDTO, RevisionStatus } from '../../../shared/contracts'

export const uid = () => globalThis.crypto.randomUUID()

export interface Row {
  id: string
  [k: string]: unknown
}

export interface AuditCtx {
  actorId: string | null
  origin: string
  correlationId: string | null
}

export class MemoryDb {
  tables = new Map<string, Map<string, Row>>()
  auditLogs: AuditLogDTO[] = []
  integrationLogs: IntegrationLogDTO[] = []
  private auditSeq = 1
  seeded = false

  t(name: string): Map<string, Row> {
    let m = this.tables.get(name)
    if (!m) this.tables.set(name, (m = new Map()))
    return m
  }

  all<T = Row>(name: string): T[] {
    return [...this.t(name).values()] as T[]
  }

  get<T = Row>(name: string, id: string): T | undefined {
    return this.t(name).get(id) as T | undefined
  }

  find<T = Row>(name: string, pred: (r: T) => boolean): T[] {
    return this.all<T>(name).filter(pred)
  }

  // --------------------------------------------------------------------- escrita com guardas
  private revisionOf(table: string, row: Row): string | null {
    if (table === 'competition_revisions') return row.id
    if (typeof row.revisionId === 'string') return row.revisionId
    return null
  }

  private assertNotFrozen(table: string, row: Row, isRevisionUpdate = false, patch?: Record<string, unknown>) {
    const revId = this.revisionOf(table, row)
    if (!revId) return
    const rev = this.get('competition_revisions', revId)
    if (!rev?.frozenAt) return
    if (isRevisionUpdate) {
      const keys = Object.keys(patch ?? {}).filter((k) => k !== 'updatedAt')
      if (rev.status === 'approved' && keys.length === 1 && keys[0] === 'status' && patch!.status === 'superseded') return
    }
    throw new Error(`QC_REVISION_FROZEN: revisão ${revId} congelada`)
  }

  insert(table: string, row: Omit<Row, 'id'> & { id?: string }, audit: AuditCtx, scope?: { revisionId?: string | null; workId?: string | null }): Row {
    const now = new Date().toISOString()
    const full: Row = { createdAt: now, updatedAt: now, ...row, id: row.id ?? uid() }
    this.assertNotFrozen(table, full)
    this.t(table).set(full.id, full)
    this.log(audit, table, full.id, 'insert', null, null, full, scope?.revisionId ?? this.revisionOf(table, full), scope?.workId ?? null)
    return full
  }

  update(table: string, id: string, patch: Record<string, unknown>, audit: AuditCtx, scope?: { workId?: string | null }): Row {
    const current = this.get(table, id)
    if (!current) throw new Error(`${table} ${id} não encontrado`)
    this.assertNotFrozen(table, current, table === 'competition_revisions', patch)
    const next: Row = { ...current, ...patch, updatedAt: new Date().toISOString() }
    this.t(table).set(id, next)
    for (const [k, v] of Object.entries(patch)) {
      if (['updatedAt', 'createdAt'].includes(k)) continue
      if (JSON.stringify(current[k] ?? null) !== JSON.stringify(v ?? null)) {
        this.log(audit, table, id, 'update', k, current[k] ?? null, v ?? null, this.revisionOf(table, next), scope?.workId ?? null)
      }
    }
    return next
  }

  remove(table: string, id: string, audit: AuditCtx, scope?: { workId?: string | null }) {
    const current = this.get(table, id)
    if (!current) return
    this.assertNotFrozen(table, current)
    this.t(table).delete(id)
    this.log(audit, table, id, 'delete', null, current, null, this.revisionOf(table, current), scope?.workId ?? null)
  }

  /** Escrita sem auditoria (dados de referência / ERP em lote). */
  put(table: string, row: Row) {
    this.t(table).set(row.id, row)
  }

  log(audit: AuditCtx, entity: string, entityId: string | null, action: 'insert' | 'update' | 'delete', field: string | null, oldValue: unknown, newValue: unknown, revisionId: string | null, workId: string | null) {
    this.auditLogs.push({
      id: this.auditSeq++,
      occurredAt: new Date().toISOString(),
      userId: audit.actorId,
      userName: null,
      entity,
      entityId,
      action,
      field,
      oldValue,
      newValue,
      revisionId,
      origin: audit.origin,
      correlationId: audit.correlationId,
      // workId mantido em campo auxiliar para filtro
      ...(workId ? { workId } : {}),
    } as AuditLogDTO)
  }

  revisionStatus(id: string): RevisionStatus | undefined {
    return this.get('competition_revisions', id)?.status as RevisionStatus | undefined
  }
}

const g = globalThis as unknown as { __qcMemoryDb?: MemoryDb }
export function getMemoryDb(): MemoryDb {
  return (g.__qcMemoryDb ??= new MemoryDb())
}
