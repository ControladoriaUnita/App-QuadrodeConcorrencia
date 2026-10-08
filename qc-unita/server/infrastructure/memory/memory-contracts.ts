/**
 * Solicitações de contrato e aditivos em memória (mesma semântica do Supabase).
 * A revisão de origem é guardada como `qcRevisionId` — `revisionId` faria o banco em memória
 * tratar a linha como filha da revisão congelada.
 */
import type { AddendumDTO, ContractItemDTO, ContractListItemDTO, ContractPartyDTO, ContractProjectDTO } from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import { lineTotal } from '../../../shared/domain/competition/best-condition'
import type { AddendumContent, ContractData, ContractRepository } from '../../application/ports'
import type { AuditCtx, MemoryDb, Row } from './memory-db'

export function createMemoryContracts(db: MemoryDb, audit: AuditCtx): ContractRepository {
  const workOf = (contractId: string): string | null => {
    const cr = db.get('contract_requests', contractId)
    return (cr && (db.get('competitions', cr.competitionId as string)?.workId as string)) ?? null
  }
  const name = (id: unknown) => (typeof id === 'string' ? ((db.get('profiles', id)?.fullName as string) ?? null) : null)

  const party = (id: unknown): ContractPartyDTO | null => {
    const s = typeof id === 'string' ? db.get('suppliers', id) : undefined
    if (!s) return null
    return {
      id: s.id, legalName: s.legalName as string, tradeName: (s.tradeName as string) ?? null, taxId: s.taxId as string,
      contactName: (s.contactName as string) ?? null, phone: (s.phone as string) ?? null, email: (s.email as string) ?? null,
      cndValidUntil: (s.cndValidUntil as string) ?? null, erpId: (s.erpId as string) ?? null,
    }
  }

  const items = (contractId: string): ContractItemDTO[] =>
    db
      .find('contract_request_items', (i) => i.contractRequestId === contractId)
      .sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number))
      .map((i) => {
        const unitPrice = Decimal.from(i.unitPrice as string)
        return {
          id: i.id,
          competitionItemId: (i.competitionItemId as string) ?? null,
          materialId: (i.materialId as string) ?? null,
          code: i.code as string,
          description: i.description as string,
          specification: (i.specification as string) ?? null,
          unit: i.unit as string,
          quantity: i.quantity as string,
          unitPrice: i.unitPrice as string,
          totalPrice: lineTotal(unitPrice, Decimal.from(i.quantity as string)).toDb(),
          pctRetention: i.pctRetention as string,
          pctMaterial: i.pctMaterial as string,
          pctEquipment: i.pctEquipment as string,
          allocations: db
            .find('contract_item_allocations', (a) => a.contractRequestItemId === i.id)
            .map((a) => ({
              packageCode: (a.packageCode as string) ?? null,
              locationCode: (a.locationCode as string) ?? null,
              quantity: a.quantity as string,
              amount: lineTotal(unitPrice, Decimal.from(a.quantity as string)).toDb(),
            })),
        }
      })

  const addenda = (contractId: string): AddendumDTO[] =>
    db
      .find('contract_addenda', (a) => a.contractRequestId === contractId)
      .sort((a, b) => (a.number as number) - (b.number as number))
      .map((a) => ({
        id: a.id,
        number: a.number as number,
        reason: a.reason as string,
        requestedOn: a.requestedOn as string,
        newEndOn: (a.newEndOn as string) ?? null,
        status: a.status as AddendumDTO['status'],
        totalDelta: a.totalDelta as string,
        submittedAt: (a.submittedAt as string) ?? null,
        decidedAt: (a.decidedAt as string) ?? null,
        decidedByName: name(a.decidedBy),
        decisionComment: (a.decisionComment as string) ?? null,
        createdAt: a.createdAt as string,
        items: db
          .find('contract_addendum_items', (x) => x.addendumId === a.id)
          .sort((x, y) => (x.sortOrder as number) - (y.sortOrder as number))
          .map((x) => ({
            id: x.id,
            contractItemId: (x.contractRequestItemId as string) ?? null,
            code: x.code as string,
            description: x.description as string,
            unit: x.unit as string,
            quantityDelta: x.quantityDelta as string,
            unitPrice: x.unitPrice as string,
            totalDelta: lineTotal(Decimal.from(x.unitPrice as string), Decimal.from(x.quantityDelta as string)).toDb(),
          })),
      }))

  const approvedTotal = (contractId: string) =>
    Decimal.sum(db.find('contract_addenda', (a) => a.contractRequestId === contractId && a.status === 'approved').map((a) => a.totalDelta as string))

  const writeAddendumItems = (addendumId: string, content: AddendumContent, workId: string | null) => {
    for (const x of db.find('contract_addendum_items', (i) => i.addendumId === addendumId)) db.remove('contract_addendum_items', x.id, audit, { workId })
    content.items.forEach((i, idx) =>
      db.insert('contract_addendum_items', {
        addendumId, contractRequestItemId: i.contractItemId, materialId: i.materialId, code: i.code, description: i.description,
        unit: i.unit, quantityDelta: i.quantityDelta, unitPrice: i.unitPrice, sortOrder: idx,
      }, audit, { workId }),
    )
  }

  return {
    async list(filter) {
      return db
        .all('contract_requests')
        .filter((cr) => !filter.competitionId || cr.competitionId === filter.competitionId)
        .map((cr) => ({ cr, comp: db.get('competitions', cr.competitionId as string)! }))
        .filter(({ comp }) => !filter.workId || comp.workId === filter.workId)
        .map<ContractListItemDTO>(({ cr, comp }) => {
          const s = party(cr.supplierId)
          return {
            id: cr.id,
            code: cr.code as string,
            status: cr.status as ContractListItemDTO['status'],
            workId: comp.workId as string,
            competitionId: comp.id,
            competitionCode: comp.code as string,
            competitionTitle: comp.title as string,
            revisionNumber: (db.get('competition_revisions', cr.qcRevisionId as string)?.number as number) ?? 0,
            supplierName: s?.tradeName || s?.legalName || '—',
            totalAmount: cr.totalAmount as string,
            addendaTotal: approvedTotal(cr.id).toDb(),
            startOn: cr.startOn as string,
            endOn: cr.endOn as string,
            erpContractId: (cr.erpContractId as string) ?? null,
            updatedAt: cr.updatedAt as string,
          }
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    async get(id): Promise<ContractData | null> {
      const cr = db.get('contract_requests', id)
      if (!cr) return null
      const comp = db.get('competitions', cr.competitionId as string)!
      const work = db.get('works', comp.workId as string)!
      const rev = db.get('competition_revisions', cr.qcRevisionId as string)!
      const type = db.get('contract_types', cr.contractTypeId as string)!
      return {
        id: cr.id,
        code: cr.code as string,
        status: cr.status as ContractData['status'],
        work: { id: work.id, code: work.code as string, name: work.name as string, erpId: (work.erpId as string) ?? null },
        competition: {
          id: comp.id, code: comp.code as string, title: comp.title as string, requestedOn: comp.requestedOn as string,
          procurementOwnerName: name(comp.procurementOwnerId),
        },
        revision: { id: rev.id, number: rev.number as number, frozenAt: (rev.frozenAt as string) ?? null, snapshotHash: (rev.snapshotHash as string) ?? null },
        supplier: party(cr.supplierId)!,
        secondSupplier: party(cr.secondSupplierId),
        contractType: { id: type.id, code: type.code as string, name: type.name as string, directBilling: type.directBilling === true },
        startOn: cr.startOn as string,
        endOn: cr.endOn as string,
        totalAmount: cr.totalAmount as string,
        pctMaterial: cr.pctMaterial as string,
        pctEquipment: cr.pctEquipment as string,
        pctService: cr.pctService as string,
        budgetAmount: cr.budgetAmount as string,
        availableAmount: cr.availableAmount as string,
        erpContractId: (cr.erpContractId as string) ?? null,
        projects: (cr.projects as ContractProjectDTO[]) ?? [],
        scopeDefinitions: (cr.scopeDefinitions as string) ?? null,
        directBillingMaterials: (cr.directBillingMaterials as string) ?? null,
        measurementCriteria: (cr.measurementCriteria as string) ?? null,
        notes: (cr.notes as string) ?? null,
        submittedAt: (cr.submittedAt as string) ?? null,
        submittedByName: name(cr.submittedBy),
        sentToErpAt: (cr.sentToErpAt as string) ?? null,
        signedOn: (cr.signedOn as string) ?? null,
        cancelReason: (cr.cancelReason as string) ?? null,
        createdAt: cr.createdAt as string,
        createdByName: name(cr.createdBy),
        items: items(cr.id),
        addenda: addenda(cr.id),
      }
    },

    async nextCode(workId, workCode) {
      const n = db.all('contract_requests').filter((cr) => db.get('competitions', cr.competitionId as string)?.workId === workId).length + 1
      return `SC-${workCode}-${String(n).padStart(3, '0')}`
    },

    async create(d, actorId) {
      const workId = (db.get('competitions', d.competitionId)?.workId as string) ?? null
      const scope = { workId }
      const cr = db.insert('contract_requests', {
        competitionId: d.competitionId, qcRevisionId: d.revisionId, supplierId: d.supplierId, secondSupplierId: null,
        contractTypeId: d.contractTypeId, code: d.code, status: 'draft', startOn: d.startOn, endOn: d.endOn,
        totalAmount: d.totalAmount, pctMaterial: d.pctMaterial, pctEquipment: d.pctEquipment, pctService: d.pctService,
        budgetAmount: d.budgetAmount, availableAmount: d.availableAmount, erpContractId: null, projects: [],
        scopeDefinitions: d.scopeDefinitions, directBillingMaterials: null, measurementCriteria: null, notes: d.notes,
        createdBy: actorId,
      }, audit, scope)
      d.items.forEach((i, idx) => {
        const { allocations, ...rest } = i
        const row = db.insert('contract_request_items', { contractRequestId: cr.id, ...rest, sortOrder: idx }, audit, scope)
        for (const a of allocations) {
          db.insert('contract_item_allocations', { contractRequestItemId: row.id, packageCode: a.packageCode, locationCode: null, quantity: a.quantity }, audit, scope)
        }
      })
      return cr.id
    },

    async update(id, patch) {
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      if (Object.keys(clean).length) db.update('contract_requests', id, clean, audit, { workId: workOf(id) })
    },

    async updateItem(contractId, itemId, patch) {
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      if (Object.keys(clean).length) db.update('contract_request_items', itemId, clean, audit, { workId: workOf(contractId) })
    },

    async createAddendum(contractId, number, content, actorId) {
      const workId = workOf(contractId)
      const { items: _i, ...head } = content
      const row: Row = db.insert('contract_addenda', { contractRequestId: contractId, number, status: 'draft', ...head, createdBy: actorId }, audit, { workId })
      writeAddendumItems(row.id, content, workId)
      return row.id
    },

    async saveAddendum(addendumId, content) {
      const a = db.get('contract_addenda', addendumId)!
      const workId = workOf(a.contractRequestId as string)
      const { items: _i, ...head } = content
      db.update('contract_addenda', addendumId, head, audit, { workId })
      writeAddendumItems(addendumId, content, workId)
    },

    async updateAddendum(addendumId, patch) {
      const a = db.get('contract_addenda', addendumId)!
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      db.update('contract_addenda', addendumId, clean, audit, { workId: workOf(a.contractRequestId as string) })
    },

    async deleteAddendum(addendumId) {
      const a = db.get('contract_addenda', addendumId)
      if (!a) return
      const workId = workOf(a.contractRequestId as string)
      for (const x of db.find('contract_addendum_items', (i) => i.addendumId === addendumId)) db.remove('contract_addendum_items', x.id, audit, { workId })
      db.remove('contract_addenda', addendumId, audit, { workId })
    },

    async getAddendumRef(addendumId) {
      const a = db.get('contract_addenda', addendumId)
      return a ? { contractId: a.contractRequestId as string, status: a.status as AddendumDTO['status'] } : null
    },

    async approvedAddendaTotals(workId) {
      const totals = new Map<string, Decimal>()
      for (const cr of db.all('contract_requests')) {
        if (cr.status === 'cancelled') continue
        if (db.get('competitions', cr.competitionId as string)?.workId !== workId) continue
        const t = approvedTotal(cr.id)
        if (!t.isZero()) totals.set(cr.competitionId as string, (totals.get(cr.competitionId as string) ?? Decimal.ZERO).plus(t))
      }
      return [...totals].map(([competitionId, total]) => ({ competitionId, total: total.toDb() }))
    },
  }
}
