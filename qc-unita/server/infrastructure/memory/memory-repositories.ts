/**
 * Implementação em memória de todas as portas (mesma semântica dos repositórios Supabase).
 */
import type {
  ApprovalDTO,
  BudgetLineDTO,
  CommitmentCategory,
  QcLinkDTO,
  BudgetPackageDTO,
  CompetitionListItemDTO,
  QcItemDTO,
  QcPriceDTO,
  QcSupplierDTO,
  RevisionDTO,
  SupplierDTO,
  WorkDTO,
} from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import type { Actor } from '../../application/context'
import type { CompetitionData, Repositories, WorkCommitments } from '../../application/ports'
import { uid, type AuditCtx, type MemoryDb, type Row } from './memory-db'
import { assignLineKeys } from '../../../shared/domain/budget/excel-import'
import { createMemoryContracts } from './memory-contracts'

type R<T> = T & Row

export function createMemoryRepositories(db: MemoryDb, audit: AuditCtx): Repositories {
  const workOfRevision = (revisionId: string): string | null => {
    const rev = db.get('competition_revisions', revisionId)
    const comp = rev ? db.get('competitions', rev.competitionId as string) : undefined
    return (comp?.workId as string) ?? null
  }

  const toWork = (w: Row): WorkDTO => {
    const budget = db.find('budgets', (b) => b.workId === w.id && b.isCurrent === true)[0]
    return {
      id: w.id,
      code: w.code as string,
      name: w.name as string,
      clientName: (w.clientName as string) ?? null,
      city: (w.city as string) ?? null,
      state: (w.state as string) ?? null,
      status: w.status as WorkDTO['status'],
      erpId: (w.erpId as string) ?? null,
      erpSyncedAt: (w.erpSyncedAt as string) ?? null,
      currentBudgetId: budget?.id ?? null,
      currentBudgetTotal: (budget?.totalAmount as string) ?? null,
      currentBudget: budget
        ? {
            id: budget.id,
            version: budget.version as number,
            source: ((budget.source as string) ?? 'erp') as 'manual' | 'erp' | 'excel',
            fileName: (budget.importFileName as string) ?? null,
            importedAt: (budget.importedAt as string) ?? (budget.erpSyncedAt as string) ?? null,
            importedByName: profileRef(budget.importedBy)?.fullName ?? null,
            lines: (budget.linesCount as number) ?? 0,
            total: (budget.totalAmount as string) ?? '0.0000',
          }
        : null,
    }
  }

  const toLine = (l: Row): BudgetLineDTO => {
    const m = db.get('materials', l.materialId as string)!
    const a = db.get('activities', l.activityId as string)
    return {
      id: l.id,
      lineKey: l.lineKey as string,
      activityWbs: (a?.wbs as string) ?? '',
      activityCode: (a?.code as string) ?? null,
      activityDescription: (a?.description as string) ?? '',
      materialId: m.id,
      code: m.code as string,
      description: m.description as string,
      unit: m.unit as string,
      packageCode: (l.packageCode as string) ?? null,
      packageDescription: (l.packageDescription as string) ?? null,
      quantity: l.quantity as string,
      unitCost: l.unitCost as string,
      total: l.totalCost as string,
    }
  }

  /**
   * Grava EAP/composições/linhas de uma versão do orçamento preservando ids por chave
   * (linhas já vinculadas a QCs nunca são apagadas).
   */
  const writeBudget = (
    budgetId: string,
    groups: { wbs: string; description: string }[],
    activities: { wbs: string; code: string | null; description: string; unit: string | null; quantity: string; unitCost: string }[],
    items: { activityWbs: string; materialCode: string; quantity: string; unitCost: string; total?: string; packageCode: string | null; packageDescription: string | null; lineKey?: string; sourceRow?: number }[],
  ) => {
    const oldGroups = new Map(db.find('budget_items', (x) => x.budgetId === budgetId).map((g) => [g.wbs as string, g.id]))
    const seenGroups = new Set<string>()
    groups.forEach((g, i) => {
      const id = oldGroups.get(g.wbs) ?? uid()
      seenGroups.add(id)
      db.put('budget_items', { id, budgetId, wbs: g.wbs, description: g.description, sortOrder: i })
    })
    for (const [, id] of oldGroups) if (!seenGroups.has(id)) db.t('budget_items').delete(id)
    const oldActs = new Map(db.find('activities', (x) => x.budgetId === budgetId).map((a) => [a.wbs as string, a.id]))
    const actByWbs = new Map<string, string>()
    activities.forEach((a, i) => {
      const id = oldActs.get(a.wbs) ?? uid()
      actByWbs.set(a.wbs, id)
      db.put('activities', { id, budgetId, ...a, sortOrder: i })
    })
    const oldLines = new Map(db.find('activity_items', (x) => x.budgetId === budgetId).map((l) => [l.lineKey as string, l.id]))
    const referenced = new Set(db.all('competition_item_links').map((l) => l.activityItemId as string))
    const seen = new Set<string>()
    let total = Decimal.ZERO
    let count = 0
    assignLineKeys(items).forEach((it, i) => {
      const m = db.find('materials', (x) => x.code === it.materialCode)[0]
      if (!m) return
      const lineTotal = it.total ? Decimal.from(it.total) : Decimal.from(it.quantity).times(it.unitCost).round(4)
      total = total.plus(lineTotal)
      const id = oldLines.get(it.lineKey) ?? uid()
      seen.add(id)
      count++
      db.put('activity_items', {
        id, budgetId, activityId: actByWbs.get(it.activityWbs), materialId: m.id, quantity: it.quantity, unitCost: it.unitCost,
        totalCost: lineTotal.toDb(), packageCode: it.packageCode, packageDescription: it.packageDescription, lineKey: it.lineKey,
        sourceRow: it.sourceRow ?? null, sortOrder: i,
      })
    })
    for (const [, id] of oldLines) if (!seen.has(id) && !referenced.has(id)) db.t('activity_items').delete(id)
    return { total, count }
  }

  const toSupplier = (s: Row): SupplierDTO => ({
    id: s.id,
    legalName: s.legalName as string,
    tradeName: (s.tradeName as string) ?? null,
    taxId: s.taxId as string,
    contactName: (s.contactName as string) ?? null,
    phone: (s.phone as string) ?? null,
    email: (s.email as string) ?? null,
    cndValidUntil: (s.cndValidUntil as string) ?? null,
    city: (s.city as string) ?? null,
    state: (s.state as string) ?? null,
    erpId: (s.erpId as string) ?? null,
  })

  const profileRef = (id: unknown) => {
    if (typeof id !== 'string') return null
    const p = db.get('profiles', id)
    return p ? { id: p.id, fullName: p.fullName as string } : null
  }

  const approvalsFor = (revisionId: string): ApprovalDTO[] =>
    db
      .find('approvals', (a) => a.revisionId === revisionId)
      .sort((a, b) => (a.stepOrder as number) - (b.stepOrder as number))
      .map((a) => ({
        stepOrder: a.stepOrder as number,
        stepName: a.stepName as string,
        roleId: a.roleId as string,
        roleName: (db.get('roles', a.roleId as string)?.name as string) ?? '',
        status: a.status as ApprovalDTO['status'],
        decidedById: (a.decidedBy as string) ?? null,
        decidedByName: profileRef(a.decidedBy)?.fullName ?? null,
        decidedAt: (a.decidedAt as string) ?? null,
        comment: (a.comment as string) ?? null,
      }))

  return {
    contracts: createMemoryContracts(db, audit),

    // ------------------------------------------------------------------ identidade
    identity: {
      async loadActor(userId): Promise<Actor | null> {
        const p = db.get('profiles', userId)
        if (!p || p.active === false) return null
        const userRoles = db.find('user_roles', (ur) => ur.userId === userId)
        const roles = userRoles.map((ur) => {
          const role = db.get('roles', ur.roleId as string)!
          return { roleId: role.id, roleKey: role.key as string, roleName: role.name as string, workId: (ur.workId as string) ?? null }
        })
        const permissions = userRoles.flatMap((ur) =>
          db
            .find('role_permissions', (rp) => rp.roleId === ur.roleId)
            .map((rp) => ({ key: db.get('permissions', rp.permissionId as string)!.key as string, workId: (ur.workId as string) ?? null })),
        )
        return { id: p.id, fullName: p.fullName as string, email: (p.email as string) ?? null, roles, permissions }
      },
      async listPeople() {
        return db.all('profiles').map((p) => ({ id: p.id, fullName: p.fullName as string })).sort((a, b) => a.fullName.localeCompare(b.fullName))
      },
    },

    // ------------------------------------------------------------------ cadastros
    catalog: {
      async listWorks() {
        return db.all('works').map(toWork).sort((a, b) => a.code.localeCompare(b.code))
      },
      async createWork(input, actorId) {
        if (db.find('works', (w) => w.code === input.code).length) throw new Error('duplicate key value violates unique constraint "works_code_key"')
        const row = db.insert('works', {
          erpId: null, code: input.code, name: input.name, clientName: input.clientName ?? null, city: input.city ?? null,
          state: input.state ?? null, costCenter: input.costCenter ?? null, status: input.status, startedOn: input.startedOn ?? null,
          finishedOn: input.finishedOn ?? null, source: 'manual', erpSyncedAt: null, createdBy: actorId,
        }, audit)
        return row.id
      },
      async getWork(id) {
        const w = db.get('works', id)
        return w ? toWork(w) : null
      },
      async listSuppliers(search) {
        const q = search?.toLowerCase().trim()
        return db
          .all('suppliers')
          .filter((s) => s.active !== false)
          .map(toSupplier)
          .filter((s) => !q || `${s.legalName} ${s.tradeName ?? ''} ${s.taxId}`.toLowerCase().includes(q))
          .sort((a, b) => a.legalName.localeCompare(b.legalName))
      },
      async getSupplier(id) {
        const s = db.get('suppliers', id)
        return s ? toSupplier(s) : null
      },
      async listContractTypes() {
        return db.all('contract_types').map((c) => ({ id: c.id, code: c.code as string, name: c.name as string, directBilling: c.directBilling === true })).sort((a, b) => a.code.localeCompare(b.code))
      },
      async listPackages(budgetId) {
        const map = new Map<string, BudgetPackageDTO & { _t: Decimal }>()
        for (const ai of db.find('activity_items', (a) => a.budgetId === budgetId && !!a.packageCode)) {
          const k = ai.packageCode as string
          const e = map.get(k) ?? { packageCode: k, description: (ai.packageDescription as string) ?? k, total: '0', inputs: 0, _t: Decimal.ZERO }
          e._t = e._t.plus(ai.totalCost as string)
          e.inputs++
          map.set(k, e)
        }
        return [...map.values()]
          .map(({ _t, ...p }) => ({ ...p, total: _t.toDb() }))
          .sort((a, b) => a.packageCode.localeCompare(b.packageCode))
      },
      async listBudgetLines(budgetId, packages) {
        return db
          .find('activity_items', (a) => a.budgetId === budgetId && (!packages || packages.includes(a.packageCode as string)))
          .sort((a, b) => ((a.sortOrder as number) ?? 0) - ((b.sortOrder as number) ?? 0))
          .map(toLine)
      },
      async getBudgetStructure(budgetId) {
        const bySort = (a: Row, b: Row) => ((a.sortOrder as number) ?? 0) - ((b.sortOrder as number) ?? 0)
        return {
          budgetId,
          groups: db.find('budget_items', (g) => g.budgetId === budgetId).sort(bySort).map((g) => ({ wbs: g.wbs as string, description: g.description as string })),
          activities: db
            .find('activities', (a) => a.budgetId === budgetId)
            .sort(bySort)
            .map((a) => ({
              wbs: a.wbs as string,
              code: (a.code as string) ?? null,
              description: a.description as string,
              unit: (a.unit as string) ?? null,
              quantity: Decimal.from(a.quantity as string).toDb(),
              unitCost: Decimal.from(a.unitCost as string).toDb(),
              total: Decimal.from(a.quantity as string).times(a.unitCost as string).round(4).toDb(),
            })),
        }
      },
      async getBudgetLines(ids) {
        return ids.map((id) => db.get('activity_items', id)).filter((x): x is Row => !!x).map(toLine)
      },
    },

    // ------------------------------------------------------------------ concorrências
    competitions: {
      async list(filter) {
        return db
          .all('competitions')
          .filter((c) => (!filter.workId || c.workId === filter.workId) && (!filter.status || c.status === filter.status))
          .map<CompetitionListItemDTO>((c) => {
            const rev = db.get('competition_revisions', c.currentRevisionId as string)!
            const work = db.get('works', c.workId as string)!
            const sups = db.find('competition_suppliers', (s) => s.revisionId === rev.id)
            const winner = sups.find((s) => s.supplierId === rev.winnerSupplierId)
            const best = db.find('best_conditions', (b) => b.revisionId === rev.id)
            return {
              id: c.id,
              code: c.code as string,
              title: c.title as string,
              workId: work.id,
              workCode: work.code as string,
              workName: work.name as string,
              status: c.status as CompetitionListItemDTO['status'],
              packageCode: (c.packageCode as string) ?? null,
              requestedOn: c.requestedOn as string,
              revisionNumber: rev.number as number,
              revisionStatus: rev.status as CompetitionListItemDTO['revisionStatus'],
              budgetAmount: rev.budgetAmount as string,
              winnerTotal: (winner?.proposalTotal as string) ?? null,
              bestMixTotal: best.length ? Decimal.sum(best.map((b) => (b.totalPrice as string) ?? '0')).toDb() : null,
              suppliersCount: sups.length,
              updatedAt: (rev.updatedAt as string) > (c.updatedAt as string) ? (rev.updatedAt as string) : (c.updatedAt as string),
            }
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      },

      async nextCode(workId) {
        const n = db.find('competitions', (c) => c.workId === workId).length + 1
        return `QC-${String(n).padStart(4, '0')}`
      },

      async create(data, actorId) {
        const competitionId = uid()
        const revisionId = uid()
        const scope = { workId: data.workId }
        db.insert('competitions', {
          id: competitionId, workId: data.workId, budgetId: data.budgetId, code: data.code, title: data.title,
          description: data.description, status: 'open', packageCode: data.packageCode, requestedOn: data.requestedOn,
          currentRevisionId: revisionId, engineeringOwnerId: null, procurementOwnerId: data.procurementOwnerId, createdBy: actorId,
        }, audit, scope)
        db.insert('competition_revisions', {
          id: revisionId, competitionId, number: 0, status: 'draft', reason: null, serviceStartOn: null, serviceEndOn: null,
          budgetAmount: data.budgetAmount, budgetUsedAmount: '0.0000', budgetAdjustmentAmount: '0.0000',
          engineeringNotes: null, procurementNotes: null, contractTypeId: null, winnerSupplierId: null, winnerJustification: null,
          submittedAt: null, decidedAt: null, frozenAt: null, snapshot: null, snapshotHash: null, createdBy: actorId,
        }, audit, scope)
        data.items.forEach((i, idx) => {
          const item = db.insert('competition_items', {
            revisionId, materialId: i.materialId, sortOrder: idx + 1, code: i.code, description: i.description, unit: i.unit,
            budgetQuantity: i.quantity, budgetUnitCost: i.unitCost, quantity: i.quantity, scopeDescription: null,
            contractNotes: null, pctMaterial: '0', pctEquipment: '0', pctRetention: '0',
          }, audit, scope)
          i.links.forEach((l, li) =>
            db.insert('competition_item_links', { revisionId, itemId: item.id, ...l, awardedUnitPrice: null, awardedTotal: null, sortOrder: li }, audit, scope),
          )
        })
        return { competitionId, revisionId }
      },

      async getData(competitionId, revisionId): Promise<CompetitionData | null> {
        const c = db.get('competitions', competitionId)
        if (!c) return null
        const revId = revisionId ?? (c.currentRevisionId as string)
        const rev = db.get<R<RevisionDTO & { competitionId: string }>>('competition_revisions', revId)
        if (!rev || rev.competitionId !== competitionId) return null
        const work = db.get('works', c.workId as string)!
        const items = db
          .find<R<QcItemDTO & { revisionId: string }>>('competition_items', (i) => i.revisionId === revId)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(({ revisionId: _r, createdAt: _c, updatedAt: _u, ...i }) => i as QcItemDTO)
        const suppliers = db
          .find<R<QcSupplierDTO & { revisionId: string }>>('competition_suppliers', (s) => s.revisionId === revId)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(({ revisionId: _r, createdAt: _c, updatedAt: _u, proposalTotal: _p, ...s }) => s as QcSupplierDTO)
        const prices = db
          .find('prices', (p) => p.revisionId === revId)
          .map<QcPriceDTO>((p) => ({
            competitionSupplierId: p.competitionSupplierId as string,
            itemId: p.itemId as string,
            unitPrice: (p.unitPrice as string) ?? null,
            notes: (p.notes as string) ?? null,
          }))
        const overrides = db
          .find('best_conditions', (b) => b.revisionId === revId && b.isOverride === true)
          .map((b) => ({ itemId: b.itemId as string, competitionSupplierId: b.competitionSupplierId as string, reason: b.overrideReason as string }))
        const revisions = db
          .find<R<RevisionDTO & { competitionId: string }>>('competition_revisions', (r) => r.competitionId === competitionId)
          .sort((a, b) => a.number - b.number)
          .map((r) => ({ id: r.id, number: r.number, status: r.status, decidedAt: r.decidedAt, createdAt: r.createdAt as string, reason: r.reason }))

        const { competitionId: _cid, snapshot: _s, updatedAt: _u, createdBy: _cb, ...revision } = rev as Row & RevisionDTO
        return {
          competition: {
            id: c.id,
            code: c.code as string,
            title: c.title as string,
            description: (c.description as string) ?? null,
            status: c.status as CompetitionData['competition']['status'],
            packageCode: (c.packageCode as string) ?? null,
            requestedOn: c.requestedOn as string,
            workId: work.id,
            workCode: work.code as string,
            workName: work.name as string,
            budgetId: c.budgetId as string,
            engineeringOwner: profileRef(c.engineeringOwnerId),
            procurementOwner: profileRef(c.procurementOwnerId),
          },
          revision: revision as unknown as RevisionDTO,
          revisions,
          items,
          suppliers,
          prices,
          overrides,
          approvals: approvalsFor(revId),
          links: db
            .find('competition_item_links', (l) => l.revisionId === revId)
            .sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number))
            .map<QcLinkDTO>((l) => ({
              id: l.id,
              itemId: l.itemId as string,
              activityItemId: (l.activityItemId as string) ?? null,
              lineKey: (l.lineKey as string) ?? null,
              materialId: l.materialId as string,
              packageCode: (l.packageCode as string) ?? null,
              packageDescription: (l.packageDescription as string) ?? null,
              quantity: l.quantity as string,
              share: (l.share as string) ?? '1.000000',
              budgetValue: (l.budgetValue as string) ?? Decimal.from(l.quantity as string).times(l.budgetUnitCost as string).round(4).toDb(),
              budgetUnitCost: l.budgetUnitCost as string,
              awardedUnitPrice: (l.awardedUnitPrice as string) ?? null,
              awardedTotal: (l.awardedTotal as string) ?? null,
            })),
          contractTypes: db.all('contract_types').map((t) => ({ id: t.id, code: t.code as string, name: t.name as string })).sort((a, b) => a.code.localeCompare(b.code)),
          people: db.all('profiles').map((p) => ({ id: p.id, fullName: p.fullName as string })),
        }
      },

      async getRevisionRef(revisionId) {
        const r = db.get('competition_revisions', revisionId)
        if (!r) return null
        return {
          competitionId: r.competitionId as string,
          workId: workOfRevision(revisionId)!,
          status: r.status as RevisionDTO['status'],
          number: r.number as number,
          frozenAt: (r.frozenAt as string) ?? null,
        }
      },

      async updateCompetition(id, patch) {
        const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
        if (Object.keys(clean).length) db.update('competitions', id, clean, audit, { workId: db.get('competitions', id)?.workId as string })
      },

      async updateRevision(revisionId, patch) {
        db.update('competition_revisions', revisionId, patch, audit, { workId: workOfRevision(revisionId) })
      },

      async updateItem(itemId, patch) {
        const item = db.get('competition_items', itemId)
        if (!item) throw new Error('Item não encontrado')
        db.update('competition_items', itemId, patch, audit, { workId: workOfRevision(item.revisionId as string) })
      },

      async addSupplier(revisionId, s, sortOrder) {
        const row = db.insert('competition_suppliers', {
          revisionId, supplierId: s.id, sortOrder, status: 'invited', legalName: s.legalName, tradeName: s.tradeName,
          taxId: s.taxId, contactName: s.contactName, phone: s.phone, email: s.email, cndValidUntil: s.cndValidUntil,
          deliveryTerms: null, paymentTerms: null, readjustmentTerms: null, notes: null, strengths: null, weaknesses: null,
          proposalRef: null, proposalReceivedOn: null, proposalValidUntil: null, proposalTotal: '0.0000',
        }, audit, { workId: workOfRevision(revisionId) })
        return row.id
      },

      async updateSupplier(id, patch) {
        const s = db.get('competition_suppliers', id)!
        db.update('competition_suppliers', id, patch, audit, { workId: workOfRevision(s.revisionId as string) })
      },

      async removeSupplier(id) {
        const s = db.get('competition_suppliers', id)
        if (!s) return
        const workId = workOfRevision(s.revisionId as string)
        for (const p of db.find('prices', (p) => p.competitionSupplierId === id)) db.remove('prices', p.id, audit, { workId })
        db.remove('competition_suppliers', id, audit, { workId })
      },

      async upsertPrices(revisionId, prices) {
        const workId = workOfRevision(revisionId)
        for (const p of prices) {
          const existing = db.find('prices', (x) => x.competitionSupplierId === p.competitionSupplierId && x.itemId === p.itemId)[0]
          const patch: Record<string, unknown> = { unitPrice: p.unitPrice }
          if (p.notes !== undefined) patch.notes = p.notes
          if (existing) db.update('prices', existing.id, patch, audit, { workId })
          else db.insert('prices', { revisionId, competitionSupplierId: p.competitionSupplierId, itemId: p.itemId, unitPrice: p.unitPrice, totalPrice: null, notes: p.notes ?? null }, audit, { workId })
        }
      },

      async persistComputed(revisionId, computed) {
        // Valores derivados: gravados sem trilha campo a campo para não poluir a auditoria
        if (db.get('competition_revisions', revisionId)?.frozenAt) throw new Error('QC_REVISION_FROZEN')
        for (const t of computed.priceTotals) {
          const p = db.find('prices', (x) => x.competitionSupplierId === t.competitionSupplierId && x.itemId === t.itemId)[0]
          if (p) db.put('prices', { ...p, totalPrice: t.totalPrice })
        }
        for (const t of computed.proposalTotals) {
          const s = db.get('competition_suppliers', t.competitionSupplierId)
          if (s) db.put('competition_suppliers', { ...s, proposalTotal: t.total })
        }
        for (const b of db.find('best_conditions', (x) => x.revisionId === revisionId)) db.t('best_conditions').delete(b.id)
        for (const b of computed.best) db.put('best_conditions', { id: uid(), revisionId, ...b, computedAt: new Date().toISOString() })
        if (computed.awardedTotal !== undefined) {
          db.put('competition_revisions', { ...db.get('competition_revisions', revisionId)!, awardedTotal: computed.awardedTotal })
        }
        for (const v of computed.linkValues ?? []) {
          const l = db.get('competition_item_links', v.linkId)
          if (l) db.put('competition_item_links', { ...l, awardedUnitPrice: v.awardedUnitPrice, awardedTotal: v.awardedTotal })
        }
      },

      async addItems(revisionId, items) {
        const workId = workOfRevision(revisionId)
        let order = db.find('competition_items', (x) => x.revisionId === revisionId).reduce((m, i) => Math.max(m, i.sortOrder as number), 0)
        return items.map((i) => {
          const item = db.insert('competition_items', {
            revisionId, materialId: i.materialId, sortOrder: ++order, code: i.code, description: i.description, unit: i.unit,
            budgetQuantity: i.quantity, budgetUnitCost: i.unitCost, quantity: i.quantity, scopeDescription: null,
            contractNotes: null, pctMaterial: '0', pctEquipment: '0', pctRetention: '0',
          }, audit, { workId })
          i.links.forEach((l, li) =>
            db.insert('competition_item_links', { revisionId, itemId: item.id, ...l, awardedUnitPrice: null, awardedTotal: null, sortOrder: li }, audit, { workId }),
          )
          return item.id
        })
      },

      async removeItem(itemId) {
        const item = db.get('competition_items', itemId)
        if (!item) return
        const workId = workOfRevision(item.revisionId as string)
        for (const p of db.find('prices', (x) => x.itemId === itemId)) db.remove('prices', p.id, audit, { workId })
        for (const l of db.find('competition_item_links', (x) => x.itemId === itemId)) db.remove('competition_item_links', l.id, audit, { workId })
        db.remove('competition_items', itemId, audit, { workId })
      },

      async setItemLinks(revisionId, itemId, links) {
        const workId = workOfRevision(revisionId)
        for (const l of db.find('competition_item_links', (x) => x.itemId === itemId)) db.remove('competition_item_links', l.id, audit, { workId })
        links.forEach((l, i) =>
          db.insert('competition_item_links', { revisionId, itemId, ...l, awardedUnitPrice: null, awardedTotal: null, sortOrder: i }, audit, { workId }),
        )
      },

      async workCommitments(workId): Promise<WorkCommitments> {
        const result: WorkCommitments = { competitions: [], links: [] }
        for (const c of db.find('competitions', (x) => x.workId === workId && x.status !== 'cancelled')) {
          const revs = db.find('competition_revisions', (r) => r.competitionId === c.id)
          const approved = revs
            .filter((r) => (r.status === 'approved' || r.status === 'superseded') && r.frozenAt)
            .sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved') || (b.number as number) - (a.number as number))[0]
          const eff = approved ?? db.get('competition_revisions', c.currentRevisionId as string)!
          const category: CommitmentCategory =
            eff.status === 'approved' || eff.status === 'superseded' ? 'contracted' : eff.status === 'in_approval' ? 'in_approval' : 'quoting'
          result.competitions.push({
            competitionId: c.id, revisionId: eff.id, revisionNumber: eff.number as number, category,
            awardedTotal: (eff.awardedTotal as string) ?? '0.0000',
          })
          const agg = new Map<string, { q: Decimal; a: Decimal; s: Decimal; v: Decimal; packageCode: string | null; materialId: string; lineKey: string | null }>()
          for (const l of db.find('competition_item_links', (x) => x.revisionId === eff.id)) {
            const k = `${l.packageCode}::${l.materialId}::${l.lineKey}`
            const e = agg.get(k) ?? { q: Decimal.ZERO, a: Decimal.ZERO, s: Decimal.ZERO, v: Decimal.ZERO, packageCode: (l.packageCode as string) ?? null, materialId: l.materialId as string, lineKey: (l.lineKey as string) ?? null }
            e.q = e.q.plus(l.quantity as string)
            e.a = e.a.plus((l.awardedTotal as string) ?? '0')
            e.s = e.s.plus((l.share as string) ?? '1')
            e.v = e.v.plus((l.budgetValue as string) ?? Decimal.from(l.quantity as string).times(l.budgetUnitCost as string).round(4))
            agg.set(k, e)
          }
          for (const e of agg.values()) {
            result.links.push({ competitionId: c.id, category, packageCode: e.packageCode, materialId: e.materialId, lineKey: e.lineKey, quantity: e.q.toDb(), share: e.s.toFixed(6), budgetValue: e.v.toDb(), amount: e.a.toDb() })
          }
        }
        return result
      },

      async cloneRevision(revisionId, reason) {
        const src = db.get('competition_revisions', revisionId)!
        const competitionId = src.competitionId as string
        const workId = workOfRevision(revisionId)
        const number = Math.max(...db.find('competition_revisions', (r) => r.competitionId === competitionId).map((r) => r.number as number)) + 1
        const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = src
        const newRev = db.insert('competition_revisions', {
          ...rest, number, status: 'draft', reason, submittedAt: null, decidedAt: null, frozenAt: null, snapshot: null,
          snapshotHash: null, basedOnRevisionId: revisionId, createdBy: audit.actorId,
        }, audit, { workId })
        const itemMap = new Map<string, string>()
        for (const i of db.find('competition_items', (x) => x.revisionId === revisionId)) {
          const { id, createdAt: _a, updatedAt: _b, ...r } = i
          itemMap.set(id, db.insert('competition_items', { ...r, revisionId: newRev.id }, audit, { workId }).id)
        }
        const supMap = new Map<string, string>()
        for (const s of db.find('competition_suppliers', (x) => x.revisionId === revisionId)) {
          const { id, createdAt: _a, updatedAt: _b, ...r } = s
          supMap.set(id, db.insert('competition_suppliers', { ...r, revisionId: newRev.id }, audit, { workId }).id)
        }
        for (const p of db.find('prices', (x) => x.revisionId === revisionId)) {
          const { id: _id, createdAt: _a, updatedAt: _b, ...r } = p
          db.insert('prices', { ...r, revisionId: newRev.id, itemId: itemMap.get(p.itemId as string), competitionSupplierId: supMap.get(p.competitionSupplierId as string) }, audit, { workId })
        }
        for (const l of db.find('competition_item_links', (x) => x.revisionId === revisionId)) {
          const { id: _id, createdAt: _a, updatedAt: _b, ...r } = l
          db.insert('competition_item_links', { ...r, revisionId: newRev.id, itemId: itemMap.get(l.itemId as string) }, audit, { workId })
        }
        db.update('competitions', competitionId, { currentRevisionId: newRev.id, status: 'open' }, audit, { workId })
        return newRev.id
      },

      async setRevisionStatus(revisionId, change) {
        const patch = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined))
        db.update('competition_revisions', revisionId, patch, audit, { workId: workOfRevision(revisionId) })
      },
    },

    // ------------------------------------------------------------------ aprovações
    approvals: {
      async listSteps() {
        return db
          .all('approval_steps')
          .map((s) => ({
            stepOrder: s.stepOrder as number,
            name: s.name as string,
            roleId: s.roleId as string,
            minAmount: s.minAmount ? Decimal.from(s.minAmount as string) : null,
            active: s.active !== false,
          }))
          .sort((a, b) => a.stepOrder - b.stepOrder)
      },
      async listForRevision(revisionId) {
        return approvalsFor(revisionId)
      },
      async createPlan(revisionId, plan) {
        const workId = workOfRevision(revisionId)
        for (const a of db.find('approvals', (x) => x.revisionId === revisionId)) db.remove('approvals', a.id, audit, { workId })
        for (const step of plan) db.insert('approvals', { revisionId, ...step }, audit, { workId })
      },
      async saveDecision(revisionId, step) {
        const row = db.find('approvals', (a) => a.revisionId === revisionId && a.stepOrder === step.stepOrder)[0]!
        db.update('approvals', row.id, { status: step.status, decidedBy: step.decidedBy, decidedAt: step.decidedAt, comment: step.comment }, audit, { workId: workOfRevision(revisionId) })
      },
    },

    // ------------------------------------------------------------------ auditoria
    audit: {
      async listForCompetition(competitionId, limit = 300) {
        const revs = new Set(db.find('competition_revisions', (r) => r.competitionId === competitionId).map((r) => r.id))
        const supIds = new Set(db.find('competition_suppliers', (s) => revs.has(s.revisionId as string)).map((s) => s.id))
        return db.auditLogs
          .filter((l) => (l.revisionId && revs.has(l.revisionId)) || l.entityId === competitionId || (l.entityId && supIds.has(l.entityId)))
          .slice(-limit)
          .reverse()
          .map((l) => ({ ...l, userName: profileRef(l.userId)?.fullName ?? null }))
      },
      async recordEvent(e) {
        db.log(audit, e.entity, e.entityId, 'update', e.field, e.oldValue, e.newValue, e.revisionId ?? null, e.workId ?? null)
      },
    },

    // ------------------------------------------------------------------ integração
    integrationLogs: {
      async start(entry) {
        const id = uid()
        db.integrationLogs.unshift({
          id, correlationId: entry.correlationId, provider: entry.provider, operation: entry.operation, direction: entry.direction,
          integrationId: entry.integrationId ?? null, status: 'started', startedAt: new Date().toISOString(), finishedAt: null,
          recordsProcessed: 0, recordsFailed: 0, message: null,
        })
        return id
      },
      async finish(id, r) {
        const log = db.integrationLogs.find((l) => l.id === id)
        if (log) Object.assign(log, { status: r.status, recordsProcessed: r.recordsProcessed, recordsFailed: r.recordsFailed, message: r.message ?? null, finishedAt: new Date().toISOString() })
      },
      async list(limit = 100) {
        return db.integrationLogs.slice(0, limit)
      },
    },

    // ------------------------------------------------------------------ ERP (lote)
    erpWriter: {
      async upsertWorks(works) {
        const now = new Date().toISOString()
        for (const w of works) {
          const existing = db.find('works', (x) => x.erpId === w.erpId)[0]
          db.put('works', { ...(existing ?? { id: uid(), createdAt: now }), ...w, source: 'erp', erpSyncedAt: now, updatedAt: now })
        }
        return works.length
      },
      async upsertSuppliers(suppliers) {
        const now = new Date().toISOString()
        for (const s of suppliers) {
          const existing = db.find('suppliers', (x) => x.erpId === s.erpId || x.taxId === s.taxId)[0]
          db.put('suppliers', { ...(existing ?? { id: uid(), createdAt: now }), ...s, source: 'erp', erpSyncedAt: now, updatedAt: now })
        }
        return suppliers.length
      },
      async upsertMaterials(materials) {
        const now = new Date().toISOString()
        for (const m of materials) {
          const existing = db.find('materials', (x) => x.code === m.code)[0]
          db.put('materials', { ...(existing ?? { id: uid(), createdAt: now }), ...m, kind: kindFromCode(m.code), erpSyncedAt: now, updatedAt: now })
        }
        return materials.length
      },
      async upsertBudget(b) {
        const work = db.find('works', (w) => w.erpId === b.workErpId)[0]
        if (!work) throw new Error(`Obra ${b.workErpId} não sincronizada`)
        const now = new Date().toISOString()
        let budget = db.find('budgets', (x) => x.workId === work.id && x.version === b.version)[0]
        if (!budget) {
          for (const old of db.find('budgets', (x) => x.workId === work.id && x.isCurrent === true)) db.put('budgets', { ...old, isCurrent: false, status: 'superseded' })
          budget = { id: uid(), workId: work.id, version: b.version, createdAt: now }
        }
        const { total, count } = writeBudget(budget.id, b.groups, b.activities, b.items)
        db.put('budgets', { ...budget, erpId: b.erpId, description: b.description, baseDate: b.baseDate, status: 'active', isCurrent: true, source: 'erp', totalAmount: total.toDb(), linesCount: count, erpSyncedAt: now, updatedAt: now })
        return { budgetId: budget.id, lines: count }
      },
    },

    // ------------------------------------------------------------------ importação (Excel)
    budgetWriter: {
      async importBudget(workId, input, meta) {
        const now = new Date().toISOString()
        for (const m of input.materials) {
          const existing = db.find('materials', (x) => x.code === m.code)[0]
          db.put('materials', { ...(existing ?? { id: uid(), createdAt: now, kind: kindFromCode(m.code) }), ...m, updatedAt: now })
        }
        const version = db.find('budgets', (b) => b.workId === workId).reduce((m, b) => Math.max(m, b.version as number), 0) + 1
        for (const old of db.find('budgets', (x) => x.workId === workId && x.isCurrent === true)) db.put('budgets', { ...old, isCurrent: false, status: 'superseded' })
        const budget = db.insert('budgets', {
          workId, version, description: `Importado de ${input.fileName}`, status: 'active', isCurrent: false, source: 'excel',
          importFileName: input.fileName, importedAt: now, importedBy: meta.actorId, totalAmount: '0', linesCount: 0,
        }, audit, { workId })
        const { total, count } = writeBudget(budget.id, input.groups, input.activities, input.lines)
        db.put('budgets', { ...db.get('budgets', budget.id)!, isCurrent: true, totalAmount: total.toDb(), linesCount: count })
        return { budgetId: budget.id, version, lines: count }
      },
    },
  }
}

function kindFromCode(code: string) {
  if (code.startsWith('IM')) return 'material'
  if (code.startsWith('IS')) return 'service'
  if (code.startsWith('IP')) return 'labor'
  if (code.startsWith('XE')) return 'equipment'
  return 'other'
}
