/**
 * Solicitações de contrato e aditivos no Supabase (client do usuário → RLS contract.read/contract.manage).
 * Travas de rascunho e auditoria ficam nos triggers (013_contract_requests.sql, 005_audit.sql).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AddendumDTO, ContractItemDTO, ContractListItemDTO, ContractPartyDTO, ContractProjectDTO } from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import { lineTotal } from '../../../shared/domain/competition/best-condition'
import type { AddendumContent, ContractData, ContractRepository } from '../../application/ports'

type Json = Record<string, unknown>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must<T = any>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toSnake = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [snake(k), v]))

const PARTY = 'id, legal_name, trade_name, tax_id, contact_name, phone, email, cnd_valid_until, erp_id'
const HEADER = `id, code, status, start_on, end_on, total_amount::text, pct_material::text, pct_equipment::text, pct_service::text,
  budget_amount::text, available_amount::text, erp_contract_id, projects, scope_definitions, direct_billing_materials,
  measurement_criteria, notes, submitted_at, submitted_by, sent_to_erp_at, signed_on, cancel_reason, created_at, created_by,
  competitions(id, code, title, requested_on, procurement_owner_id, works(id, code, name, erp_id)),
  competition_revisions(id, number, frozen_at, snapshot_hash),
  contract_types(id, code, name, direct_billing),
  supplier:suppliers!supplier_id(${PARTY}),
  second:suppliers!second_supplier_id(${PARTY})`
const ITEM = `id, competition_item_id, material_id, code, description, specification, unit, quantity::text, unit_price::text,
  pct_retention::text, pct_material::text, pct_equipment::text, sort_order,
  contract_item_allocations(package_code, location_code, quantity::text)`
const ADDENDUM = `id, number, reason, requested_on, new_end_on, status, total_delta::text, submitted_at, decided_at, decided_by,
  decision_comment, created_at,
  contract_addendum_items(id, contract_request_item_id, code, description, unit, quantity_delta::text, unit_price::text, sort_order)`

const party = (s: Json | null): ContractPartyDTO | null =>
  s
    ? {
        id: s.id as string, legalName: s.legal_name as string, tradeName: (s.trade_name as string) ?? null, taxId: s.tax_id as string,
        contactName: (s.contact_name as string) ?? null, phone: (s.phone as string) ?? null, email: (s.email as string) ?? null,
        cndValidUntil: (s.cnd_valid_until as string) ?? null, erpId: (s.erp_id as string) ?? null,
      }
    : null

export function createSupabaseContracts(db: SupabaseClient): ContractRepository {
  const names = async (ids: unknown[]): Promise<Map<string, string>> => {
    const list = [...new Set(ids.filter((x): x is string => typeof x === 'string'))]
    if (!list.length) return new Map()
    const rows = must(await db.from('profiles').select('id, full_name').in('id', list)) as { id: string; full_name: string }[]
    return new Map(rows.map((r) => [r.id, r.full_name]))
  }

  const writeAddendumItems = async (addendumId: string, content: AddendumContent) => {
    must(await db.from('contract_addendum_items').delete().eq('addendum_id', addendumId))
    if (!content.items.length) return
    must(await db.from('contract_addendum_items').insert(
      content.items.map((i, idx) => ({
        addendum_id: addendumId, contract_request_item_id: i.contractItemId, material_id: i.materialId, code: i.code,
        description: i.description, unit: i.unit, quantity_delta: i.quantityDelta, unit_price: i.unitPrice, sort_order: idx,
      })),
    ))
  }

  const addendumHead = (c: AddendumContent) => ({
    reason: c.reason, requested_on: c.requestedOn, new_end_on: c.newEndOn, total_delta: c.totalDelta,
  })

  return {
    async list(filter) {
      let q = db
        .from('contract_requests')
        .select(`id, code, status, start_on, end_on, total_amount::text, erp_contract_id, updated_at,
          competitions!inner(id, code, title, work_id), competition_revisions(number),
          supplier:suppliers!supplier_id(legal_name, trade_name), contract_addenda(status, total_delta::text)`)
        .order('updated_at', { ascending: false })
      if (filter.workId) q = q.eq('competitions.work_id', filter.workId)
      if (filter.competitionId) q = q.eq('competition_id', filter.competitionId)
      const rows = must(await q) as Json[]
      return rows.map<ContractListItemDTO>((r) => {
        const comp = r.competitions as Json
        const sup = r.supplier as Json | null
        const add = (r.contract_addenda as { status: string; total_delta: string }[]) ?? []
        return {
          id: r.id as string,
          code: r.code as string,
          status: r.status as ContractListItemDTO['status'],
          workId: comp.work_id as string,
          competitionId: comp.id as string,
          competitionCode: comp.code as string,
          competitionTitle: comp.title as string,
          revisionNumber: ((r.competition_revisions as Json | null)?.number as number) ?? 0,
          supplierName: (sup?.trade_name as string) || (sup?.legal_name as string) || '—',
          totalAmount: r.total_amount as string,
          addendaTotal: Decimal.sum(add.filter((a) => a.status === 'approved').map((a) => a.total_delta)).toDb(),
          startOn: r.start_on as string,
          endOn: r.end_on as string,
          erpContractId: (r.erp_contract_id as string) ?? null,
          updatedAt: r.updated_at as string,
        }
      })
    },

    async get(id): Promise<ContractData | null> {
      const cr = must(await db.from('contract_requests').select(HEADER).eq('id', id).maybeSingle()) as Json | null
      if (!cr) return null
      const [itemRows, addRows] = await Promise.all([
        db.from('contract_request_items').select(ITEM).eq('contract_request_id', id).order('sort_order'),
        db.from('contract_addenda').select(ADDENDUM).eq('contract_request_id', id).order('number'),
      ])
      const comp = cr.competitions as Json
      const work = comp.works as Json
      const rev = cr.competition_revisions as Json
      const type = cr.contract_types as Json
      const adds = must(addRows) as Json[]
      const who = await names([cr.created_by, cr.submitted_by, comp.procurement_owner_id, ...adds.map((a) => a.decided_by)])

      const items = (must(itemRows) as Json[]).map<ContractItemDTO>((i) => {
        const unitPrice = Decimal.from(i.unit_price as string)
        return {
          id: i.id as string,
          competitionItemId: (i.competition_item_id as string) ?? null,
          materialId: (i.material_id as string) ?? null,
          code: i.code as string,
          description: i.description as string,
          specification: (i.specification as string) ?? null,
          unit: i.unit as string,
          quantity: i.quantity as string,
          unitPrice: i.unit_price as string,
          totalPrice: lineTotal(unitPrice, Decimal.from(i.quantity as string)).toDb(),
          pctRetention: i.pct_retention as string,
          pctMaterial: i.pct_material as string,
          pctEquipment: i.pct_equipment as string,
          allocations: ((i.contract_item_allocations as Json[]) ?? []).map((a) => ({
            packageCode: (a.package_code as string) ?? null,
            locationCode: (a.location_code as string) ?? null,
            quantity: a.quantity as string,
            amount: lineTotal(unitPrice, Decimal.from(a.quantity as string)).toDb(),
          })),
        }
      })

      const addenda = adds.map<AddendumDTO>((a) => ({
        id: a.id as string,
        number: a.number as number,
        reason: a.reason as string,
        requestedOn: a.requested_on as string,
        newEndOn: (a.new_end_on as string) ?? null,
        status: a.status as AddendumDTO['status'],
        totalDelta: a.total_delta as string,
        submittedAt: (a.submitted_at as string) ?? null,
        decidedAt: (a.decided_at as string) ?? null,
        decidedByName: who.get(a.decided_by as string) ?? null,
        decisionComment: (a.decision_comment as string) ?? null,
        createdAt: a.created_at as string,
        items: ((a.contract_addendum_items as Json[]) ?? [])
          .sort((x, y) => (x.sort_order as number) - (y.sort_order as number))
          .map((x) => ({
            id: x.id as string,
            contractItemId: (x.contract_request_item_id as string) ?? null,
            code: x.code as string,
            description: x.description as string,
            unit: x.unit as string,
            quantityDelta: x.quantity_delta as string,
            unitPrice: x.unit_price as string,
            totalDelta: lineTotal(Decimal.from(x.unit_price as string), Decimal.from(x.quantity_delta as string)).toDb(),
          })),
      }))

      return {
        id: cr.id as string,
        code: cr.code as string,
        status: cr.status as ContractData['status'],
        work: { id: work.id as string, code: work.code as string, name: work.name as string, erpId: (work.erp_id as string) ?? null },
        competition: {
          id: comp.id as string, code: comp.code as string, title: comp.title as string, requestedOn: comp.requested_on as string,
          procurementOwnerName: who.get(comp.procurement_owner_id as string) ?? null,
        },
        revision: { id: rev.id as string, number: rev.number as number, frozenAt: (rev.frozen_at as string) ?? null, snapshotHash: (rev.snapshot_hash as string) ?? null },
        supplier: party(cr.supplier as Json)!,
        secondSupplier: party(cr.second as Json | null),
        contractType: { id: type.id as string, code: type.code as string, name: type.name as string, directBilling: type.direct_billing === true },
        startOn: cr.start_on as string,
        endOn: cr.end_on as string,
        totalAmount: cr.total_amount as string,
        pctMaterial: cr.pct_material as string,
        pctEquipment: cr.pct_equipment as string,
        pctService: cr.pct_service as string,
        budgetAmount: cr.budget_amount as string,
        availableAmount: cr.available_amount as string,
        erpContractId: (cr.erp_contract_id as string) ?? null,
        projects: (cr.projects as ContractProjectDTO[]) ?? [],
        scopeDefinitions: (cr.scope_definitions as string) ?? null,
        directBillingMaterials: (cr.direct_billing_materials as string) ?? null,
        measurementCriteria: (cr.measurement_criteria as string) ?? null,
        notes: (cr.notes as string) ?? null,
        submittedAt: (cr.submitted_at as string) ?? null,
        submittedByName: who.get(cr.submitted_by as string) ?? null,
        sentToErpAt: (cr.sent_to_erp_at as string) ?? null,
        signedOn: (cr.signed_on as string) ?? null,
        cancelReason: (cr.cancel_reason as string) ?? null,
        createdAt: cr.created_at as string,
        createdByName: who.get(cr.created_by as string) ?? null,
        items,
        addenda,
      }
    },

    async nextCode(workId, workCode) {
      const rows = must(await db.from('contract_requests').select('id, competitions!inner(work_id)').eq('competitions.work_id', workId)) as unknown[]
      return `SC-${workCode}-${String(rows.length + 1).padStart(3, '0')}`
    },

    async create(d, actorId) {
      const cr = must(await db.from('contract_requests').insert({
        competition_id: d.competitionId, revision_id: d.revisionId, supplier_id: d.supplierId, contract_type_id: d.contractTypeId,
        code: d.code, start_on: d.startOn, end_on: d.endOn, total_amount: d.totalAmount, pct_material: d.pctMaterial,
        pct_equipment: d.pctEquipment, pct_service: d.pctService, budget_amount: d.budgetAmount, available_amount: d.availableAmount,
        scope_definitions: d.scopeDefinitions, notes: d.notes, created_by: actorId,
      }).select('id').single()) as { id: string }
      if (d.items.length) {
        const inserted = must(await db.from('contract_request_items').insert(
          d.items.map((i, idx) => ({
            contract_request_id: cr.id, competition_item_id: i.competitionItemId, material_id: i.materialId, code: i.code,
            description: i.description, specification: i.specification, unit: i.unit, quantity: i.quantity, unit_price: i.unitPrice,
            pct_retention: i.pctRetention, pct_material: i.pctMaterial, pct_equipment: i.pctEquipment, sort_order: idx,
          })),
        ).select('id, sort_order')) as { id: string; sort_order: number }[]
        const allocations = d.items.flatMap((i, idx) => {
          const itemId = inserted.find((x) => x.sort_order === idx)!.id
          return i.allocations.map((a) => ({ contract_request_item_id: itemId, package_code: a.packageCode, quantity: a.quantity }))
        })
        if (allocations.length) must(await db.from('contract_item_allocations').insert(allocations))
      }
      return cr.id
    },

    async update(id, patch) {
      const row = toSnake(patch)
      if (Object.keys(row).length) must(await db.from('contract_requests').update(row).eq('id', id))
    },

    async updateItem(contractId, itemId, patch) {
      const row = toSnake(patch)
      if (Object.keys(row).length) must(await db.from('contract_request_items').update(row).eq('id', itemId).eq('contract_request_id', contractId))
    },

    async createAddendum(contractId, number, content, actorId) {
      const a = must(await db.from('contract_addenda').insert({
        contract_request_id: contractId, number, created_by: actorId, ...addendumHead(content),
      }).select('id').single()) as { id: string }
      await writeAddendumItems(a.id, content)
      return a.id
    },

    async saveAddendum(addendumId, content) {
      must(await db.from('contract_addenda').update(addendumHead(content)).eq('id', addendumId))
      await writeAddendumItems(addendumId, content)
    },

    async updateAddendum(addendumId, patch) {
      must(await db.from('contract_addenda').update(toSnake(patch)).eq('id', addendumId))
    },

    async deleteAddendum(addendumId) {
      must(await db.from('contract_addenda').delete().eq('id', addendumId))
    },

    async getAddendumRef(addendumId) {
      const a = must(await db.from('contract_addenda').select('contract_request_id, status').eq('id', addendumId).maybeSingle()) as Json | null
      return a ? { contractId: a.contract_request_id as string, status: a.status as AddendumDTO['status'] } : null
    },

    async approvedAddendaTotals(workId) {
      const rows = must(await db.rpc('qc_work_addenda_totals', { p_work_id: workId })) as { competition_id: string; total: string }[]
      return rows.map((r) => ({ competitionId: r.competition_id, total: r.total }))
    },
  }
}
