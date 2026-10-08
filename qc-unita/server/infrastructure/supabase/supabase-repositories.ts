/**
 * Repositórios Supabase (PostgreSQL).
 *
 * - Toda leitura/escrita de negócio usa o client do usuário (RLS ativo).
 * - Colunas numeric são lidas com cast ::text para não passarem por float.
 * - A auditoria campo a campo é feita pelo trigger audit_row_changes() no banco.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ApprovalDTO,
  BudgetLineDTO,
  CommitmentCategory,
  QcLinkDTO,
  AuditLogDTO,
  CompetitionListItemDTO,
  IntegrationLogDTO,
  QcItemDTO,
  QcSupplierDTO,
  RevisionDTO,
  SupplierDTO,
  WorkDTO,
} from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import type { Actor } from '../../application/context'
import type { CompetitionData, NewLink, Repositories } from '../../application/ports'
import { assignLineKeys } from '../../../shared/domain/budget/excel-import'
import { createSupabaseContracts } from './supabase-contracts'

type Json = Record<string, unknown>

// Sem tipos gerados do banco (supabase gen types) o retorno é tratado como `any` e tipado nos pontos de uso.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must<T = any>(res: { data: unknown; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

const WORK_COLS =
  `id, code, name, clientName:client_name, city, state, status, erpId:erp_id, erpSyncedAt:erp_synced_at,
   budgets(id, version, source, totalAmount:total_amount::text, isCurrent:is_current, importFileName:import_file_name,
           importedAt:imported_at, erpSyncedAt:erp_synced_at, linesCount:lines_count)`
const SUPPLIER_COLS =
  'id, legalName:legal_name, tradeName:trade_name, taxId:tax_id, contactName:contact_name, phone, email, cndValidUntil:cnd_valid_until, city, state, erpId:erp_id'
const REVISION_COLS = `id, number, status, reason, serviceStartOn:service_start_on, serviceEndOn:service_end_on,
  budgetAmount:budget_amount::text, budgetUsedAmount:budget_used_amount::text, budgetAdjustmentAmount:budget_adjustment_amount::text,
  engineeringNotes:engineering_notes, procurementNotes:procurement_notes, contractTypeId:contract_type_id,
  winnerSupplierId:winner_supplier_id, winnerJustification:winner_justification, submittedAt:submitted_at,
  decidedAt:decided_at, frozenAt:frozen_at, snapshotHash:snapshot_hash, createdAt:created_at, competitionId:competition_id`
const ITEM_COLS = `id, sortOrder:sort_order, materialId:material_id, code, description, unit,
  budgetQuantity:budget_quantity::text, budgetUnitCost:budget_unit_cost::text, quantity:quantity::text,
  scopeDescription:scope_description, contractNotes:contract_notes, pctMaterial:pct_material::text,
  pctEquipment:pct_equipment::text, pctRetention:pct_retention::text`
const CS_COLS = `id, supplierId:supplier_id, sortOrder:sort_order, status, legalName:legal_name, tradeName:trade_name, taxId:tax_id,
  contactName:contact_name, phone, email, cndValidUntil:cnd_valid_until, deliveryTerms:delivery_terms,
  paymentTerms:payment_terms, readjustmentTerms:readjustment_terms, notes, strengths, weaknesses,
  supplier_proposals(id, proposalRef:proposal_ref, receivedOn:received_on, validUntil:valid_until)`

const LINK_COLS = `id, itemId:competition_item_id, activityItemId:activity_item_id, lineKey:line_key, materialId:material_id, packageCode:package_code, packageDescription:package_description,
  quantity:quantity::text, share:budget_share::text, budgetValue:budget_value::text, budgetUnitCost:budget_unit_cost::text, awardedUnitPrice:awarded_unit_price::text, awardedTotal:awarded_total::text`

const linkRow = (revisionId: string, itemId: string, l: NewLink, sortOrder: number) => ({
  revision_id: revisionId, competition_item_id: itemId, activity_item_id: l.activityItemId, line_key: l.lineKey,
  material_id: l.materialId, package_code: l.packageCode, package_description: l.packageDescription,
  quantity: l.quantity, budget_share: l.share, budget_value: l.budgetValue, budget_unit_cost: l.budgetUnitCost, sort_order: sortOrder,
})

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toSnake = (o: Json) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [snake(k), v]))

function toWork(w: Json): WorkDTO {
  const budgets = (w.budgets as Json[]) ?? []
  const current = budgets.find((b) => b.isCurrent) as Json | undefined
  const { budgets: _b, ...rest } = w
  return {
    ...(rest as unknown as WorkDTO),
    currentBudgetId: (current?.id as string) ?? null,
    currentBudgetTotal: (current?.totalAmount as string) ?? null,
    currentBudget: current
      ? {
          id: current.id as string,
          version: current.version as number,
          source: current.source as 'manual' | 'erp' | 'excel',
          fileName: (current.importFileName as string) ?? null,
          importedAt: (current.importedAt as string) ?? (current.erpSyncedAt as string) ?? null,
          importedByName: null,
          lines: (current.linesCount as number) ?? 0,
          total: current.totalAmount as string,
        }
      : null,
  }
}

const LINE_SELECT = `id, lineKey:line_key, quantity:quantity::text, unitCost:unit_cost::text, total:total_cost::text,
  packageCode:package_code, packageDescription:package_description, sortOrder:sort_order,
  activities(wbs_code, composition_code, description), materials(id, code, description, unit)`

function toLine(r: Json): BudgetLineDTO {
  const a = r.activities as { wbs_code: string; composition_code: string | null; description: string } | null
  const m = r.materials as { id: string; code: string; description: string; unit: string }
  return {
    id: r.id as string,
    lineKey: r.lineKey as string,
    activityWbs: a?.wbs_code ?? '',
    activityCode: a?.composition_code ?? null,
    activityDescription: a?.description ?? '',
    materialId: m.id,
    code: m.code,
    description: m.description,
    unit: m.unit,
    packageCode: (r.packageCode as string) ?? null,
    packageDescription: (r.packageDescription as string) ?? null,
    quantity: r.quantity as string,
    unitCost: r.unitCost as string,
    total: r.total as string,
  }
}

const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

/**
 * Grava EAP/composições/linhas de uma versão do orçamento (service_role), preservando ids pela
 * chave da linha. Linhas já vinculadas a QCs nunca são apagadas.
 */
async function writeBudgetLines(
  service: SupabaseClient,
  budgetId: string,
  b: {
    groups: { wbs: string; description: string }[]
    activities: { wbs: string; code: string | null; description: string; unit: string | null; quantity: string; unitCost: string }[]
    items: { activityWbs: string; materialCode: string; quantity: string; unitCost: string; total?: string; packageCode: string | null; packageDescription: string | null; lineKey?: string; sourceRow?: number }[]
  },
): Promise<{ total: Decimal; count: number }> {
  const groups: { id: string; wbs_code: string }[] = []
  for (const part of chunk(b.groups.map((g, i) => ({ budget_id: budgetId, wbs_code: g.wbs, description: g.description, sort_order: i })), 1000)) {
    groups.push(...(must(await service.from('budget_items').upsert(part, { onConflict: 'budget_id,wbs_code' }).select('id, wbs_code')) as { id: string; wbs_code: string }[]))
  }
  const groupId = new Map(groups.map((g) => [g.wbs_code, g.id]))
  const groupOf = (wbs: string) => {
    const parts = wbs.split('.')
    for (let n = parts.length - 1; n > 0; n--) {
      const g = groupId.get(parts.slice(0, n).join('.'))
      if (g) return g
    }
    return null
  }
  const acts: { id: string; wbs_code: string }[] = []
  for (const part of chunk(b.activities.map((a, i) => ({
    budget_id: budgetId, budget_item_id: groupOf(a.wbs), wbs_code: a.wbs, composition_code: a.code, description: a.description,
    unit: a.unit, quantity: a.quantity, unit_cost: a.unitCost, sort_order: i,
  })), 1000)) {
    acts.push(...(must(await service.from('activities').upsert(part, { onConflict: 'budget_id,wbs_code' }).select('id, wbs_code')) as { id: string; wbs_code: string }[]))
  }
  const actId = new Map(acts.map((a) => [a.wbs_code, a.id]))

  const codes = [...new Set(b.items.map((i) => i.materialCode))]
  const matId = new Map<string, string>()
  for (const part of chunk(codes, 300)) {
    for (const m of must(await service.from('materials').select('id, code').in('code', part)) as { id: string; code: string }[]) matId.set(m.code, m.id)
  }

  let total = Decimal.ZERO
  const rows = assignLineKeys(b.items)
    .filter((i) => matId.has(i.materialCode) && actId.has(i.activityWbs))
    .map((i, idx) => {
      const t = i.total ? Decimal.from(i.total) : Decimal.from(i.quantity).times(i.unitCost).round(4)
      total = total.plus(t)
      return {
        budget_id: budgetId, activity_id: actId.get(i.activityWbs), material_id: matId.get(i.materialCode), quantity: i.quantity,
        unit_cost: i.unitCost, total_cost: t.toDb(), package_code: i.packageCode, package_description: i.packageDescription,
        line_key: i.lineKey, source_row: i.sourceRow ?? null, sort_order: idx,
      }
    })
  for (const part of chunk(rows, 1000)) must(await service.from('activity_items').upsert(part, { onConflict: 'budget_id,line_key' }))

  // Remove linhas que saíram do orçamento — exceto as vinculadas a QCs
  const keep = new Set(rows.map((r) => r.line_key))
  const existing = must(await service.from('activity_items').select('id, line_key').eq('budget_id', budgetId)) as { id: string; line_key: string }[]
  const removed = existing.filter((e) => !keep.has(e.line_key)).map((e) => e.id)
  for (const part of chunk(removed, 200)) {
    const used = new Set((must(await service.from('competition_item_links').select('activity_item_id').in('activity_item_id', part)) as { activity_item_id: string }[]).map((x) => x.activity_item_id))
    const free = part.filter((id) => !used.has(id))
    if (free.length) must(await service.from('activity_items').delete().in('id', free))
  }
  return { total, count: rows.length }
}

export function createSupabaseRepositories(db: SupabaseClient, service: SupabaseClient): Repositories {
  const proposalIdFor = async (competitionSupplierId: string): Promise<string> => {
    const r = must(await db.from('supplier_proposals').select('id').eq('competition_supplier_id', competitionSupplierId).maybeSingle()) as { id: string } | null
    if (r) return r.id
    const cs = must(await db.from('competition_suppliers').select('revision_id').eq('id', competitionSupplierId).single()) as { revision_id: string }
    const created = must(await db.from('supplier_proposals').insert({ revision_id: cs.revision_id, competition_supplier_id: competitionSupplierId }).select('id').single())
    return (created as { id: string }).id
  }

  const approvalsFor = async (revisionId: string): Promise<ApprovalDTO[]> => {
    const rows = must(
      await db
        .from('approvals')
        .select('stepOrder:step_order, stepName:step_name, roleId:role_id, status, decidedById:decided_by, decidedAt:decided_at, comment, roles(name)')
        .eq('revision_id', revisionId)
        .order('step_order'),
    ) as unknown as (ApprovalDTO & { roles: { name: string } | null })[]
    const ids = rows.map((r) => r.decidedById).filter(Boolean) as string[]
    const names = ids.length ? (must(await db.from('profiles').select('id, full_name').in('id', ids)) as { id: string; full_name: string }[]) : []
    return rows.map(({ roles, ...a }) => ({ ...a, roleName: roles?.name ?? '', decidedByName: names.find((n) => n.id === a.decidedById)?.full_name ?? null }))
  }

  return {
    contracts: createSupabaseContracts(db),

    // ------------------------------------------------------------------ identidade
    identity: {
      async loadActor(userId): Promise<Actor | null> {
        const profile = must(await db.from('profiles').select('id, full_name, email, active').eq('id', userId).maybeSingle()) as Json | null
        if (!profile || profile.active === false) return null
        const roles = must(await db.from('user_roles').select('role_id, work_id, roles(key, name)').eq('user_id', userId)) as unknown as {
          role_id: string
          work_id: string | null
          roles: { key: string; name: string }
        }[]
        const perms = must(await db.rpc('auth_my_permissions')) as { permission: string; work_id: string | null }[]
        return {
          id: userId,
          fullName: (profile.full_name as string) || (profile.email as string) || 'Usuário',
          email: (profile.email as string) ?? null,
          roles: roles.map((r) => ({ roleId: r.role_id, roleKey: r.roles.key, roleName: r.roles.name, workId: r.work_id })),
          permissions: perms.map((p) => ({ key: p.permission, workId: p.work_id })),
        }
      },
      async listPeople() {
        const rows = must(await db.from('profiles').select('id, fullName:full_name').eq('active', true).order('full_name')) as unknown as { id: string; fullName: string }[]
        return rows
      },
    },

    // ------------------------------------------------------------------ cadastros
    catalog: {
      async listWorks() {
        return (must(await db.from('works').select(WORK_COLS).order('code')) as unknown as Json[]).map(toWork)
      },
      async createWork(input, actorId) {
        const row = must(await db.from('works').insert({
          code: input.code, name: input.name, client_name: input.clientName ?? null, city: input.city ?? null, state: input.state ?? null,
          cost_center: input.costCenter ?? null, status: input.status, started_on: input.startedOn ?? null, finished_on: input.finishedOn ?? null,
          source: 'manual', created_by: actorId,
        }).select('id').single()) as { id: string }
        return row.id
      },
      async getWork(id) {
        const w = must(await db.from('works').select(WORK_COLS).eq('id', id).maybeSingle()) as unknown as Json | null
        return w ? toWork(w) : null
      },
      async listSuppliers(search) {
        let q = db.from('suppliers').select(SUPPLIER_COLS).eq('active', true).order('legal_name').limit(500)
        if (search?.trim()) {
          const s = search.trim().replace(/[%,()]/g, ' ')
          q = q.or(`legal_name.ilike.%${s}%,trade_name.ilike.%${s}%,tax_id.ilike.%${s}%`)
        }
        return must(await q) as unknown as SupplierDTO[]
      },
      async getSupplier(id) {
        return must(await db.from('suppliers').select(SUPPLIER_COLS).eq('id', id).maybeSingle()) as unknown as SupplierDTO | null
      },
      async listContractTypes() {
        return must(await db.from('contract_types').select('id, code, name, directBilling:direct_billing').eq('active', true).order('code')) as { id: string; code: string; name: string; directBilling: boolean }[]
      },
      async listPackages(budgetId) {
        const rows = must(await db.rpc('qc_budget_packages', { p_budget_id: budgetId })) as { package_code: string; description: string; total: string; inputs: number }[]
        return rows.map((r) => ({ packageCode: r.package_code, description: r.description, total: r.total, inputs: r.inputs }))
      },
      async listBudgetLines(budgetId, packages) {
        const rows = must(await db.rpc('qc_budget_lines', { p_budget_id: budgetId, p_packages: packages?.length ? packages : null })) as Json[]
        return rows.map((r) => ({
          id: r.id as string, lineKey: r.line_key as string, activityWbs: r.activity_wbs as string, activityCode: (r.activity_code as string) ?? null,
          activityDescription: r.activity_description as string, materialId: r.material_id as string, code: r.code as string,
          description: r.description as string, unit: r.unit as string, packageCode: (r.package_code as string) ?? null,
          packageDescription: (r.package_description as string) ?? null, quantity: r.quantity as string, unitCost: r.unit_cost as string, total: r.total as string,
        }))
      },
      async getBudgetStructure(budgetId) {
        // PostgREST limita cada resposta (padrão 1.000 linhas): lê em páginas
        const all = async (table: string, cols: string) => {
          const out: Json[] = []
          for (let from = 0; ; from += 1000) {
            const page = must(await db.from(table).select(cols).eq('budget_id', budgetId).order('sort_order').range(from, from + 999)) as Json[]
            out.push(...page)
            if (page.length < 1000) return out
          }
        }
        const [groups, acts] = await Promise.all([
          all('budget_items', 'wbs_code, description, sort_order'),
          all('activities', 'wbs_code, composition_code, description, unit, quantity::text, unit_cost::text, total_cost::text, sort_order'),
        ])
        return {
          budgetId,
          groups: groups.map((g) => ({ wbs: g.wbs_code as string, description: g.description as string })),
          activities: acts.map((a) => ({
            wbs: a.wbs_code as string, code: (a.composition_code as string) ?? null, description: a.description as string,
            unit: (a.unit as string) ?? null, quantity: a.quantity as string, unitCost: a.unit_cost as string, total: a.total_cost as string,
          })),
        }
      },
      async getBudgetLines(ids) {
        const out: BudgetLineDTO[] = []
        for (const part of chunk(ids, 150)) out.push(...(must(await db.from('activity_items').select(LINE_SELECT).in('id', part)) as Json[]).map(toLine))
        return out
      },
    },

    // ------------------------------------------------------------------ concorrências
    competitions: {
      async list(filter) {
        let q = db
          .from('qc_competition_list')
          .select(`id, code, title, workId:work_id, workCode:work_code, workName:work_name, status, packageCode:package_code,
            requestedOn:requested_on, revisionNumber:revision_number, revisionStatus:revision_status, budgetAmount:budget_amount,
            winnerTotal:winner_total, bestMixTotal:best_mix_total, suppliersCount:suppliers_count, updatedAt:updated_at`)
          .order('updated_at', { ascending: false })
        if (filter.workId) q = q.eq('work_id', filter.workId)
        if (filter.status) q = q.eq('status', filter.status)
        return must(await q) as unknown as CompetitionListItemDTO[]
      },

      async nextCode(workId) {
        const { count, error } = await db.from('competitions').select('id', { count: 'exact', head: true }).eq('work_id', workId)
        if (error) throw new Error(error.message)
        return `QC-${String((count ?? 0) + 1).padStart(4, '0')}`
      },

      async create(data, actorId) {
        const competitionId = globalThis.crypto.randomUUID()
        const revisionId = globalThis.crypto.randomUUID()
        must(await db.from('competitions').insert({
          id: competitionId, work_id: data.workId, budget_id: data.budgetId, code: data.code, title: data.title,
          description: data.description, package_code: data.packageCode, requested_on: data.requestedOn,
          procurement_owner_id: data.procurementOwnerId, created_by: actorId,
        }))
        must(await db.from('competition_revisions').insert({
          id: revisionId, competition_id: competitionId, number: 0, budget_amount: data.budgetAmount, created_by: actorId,
        }))
        must(await db.from('competitions').update({ current_revision_id: revisionId }).eq('id', competitionId))
        if (data.items.length) {
          const inserted = must(await db.from('competition_items').insert(
            data.items.map((i, idx) => ({
              revision_id: revisionId, material_id: i.materialId, sort_order: idx + 1, code: i.code, description: i.description,
              unit: i.unit, budget_quantity: i.quantity, budget_unit_cost: i.unitCost, quantity: i.quantity,
            })),
          ).select('id, sort_order')) as { id: string; sort_order: number }[]
          const links = data.items.flatMap((i, idx) => {
            const itemId = inserted.find((x) => x.sort_order === idx + 1)!.id
            return i.links.map((l, li) => linkRow(revisionId, itemId, l, li))
          })
          if (links.length) must(await db.from('competition_item_links').insert(links))
        }
        return { competitionId, revisionId }
      },

      async getData(competitionId, revisionId): Promise<CompetitionData | null> {
        const c = must(
          await db
            .from('competitions')
            .select(`id, code, title, description, status, packageCode:package_code, requestedOn:requested_on, workId:work_id,
              budgetId:budget_id, currentRevisionId:current_revision_id, engineeringOwnerId:engineering_owner_id,
              procurementOwnerId:procurement_owner_id, works(code, name)`)
            .eq('id', competitionId)
            .maybeSingle(),
        ) as unknown as (Json & { works: { code: string; name: string } }) | null
        if (!c) return null
        const revId = revisionId ?? (c.currentRevisionId as string)

        const [rev, revisions, items, sups, best, approvals, contractTypes, people, links] = await Promise.all([
          db.from('competition_revisions').select(REVISION_COLS).eq('id', revId).eq('competition_id', competitionId).maybeSingle(),
          db.from('competition_revisions').select('id, number, status, decidedAt:decided_at, createdAt:created_at, reason').eq('competition_id', competitionId).order('number'),
          db.from('competition_items').select(ITEM_COLS).eq('revision_id', revId).order('sort_order'),
          db.from('competition_suppliers').select(CS_COLS).eq('revision_id', revId).order('sort_order'),
          db.from('best_conditions').select('itemId:competition_item_id, competitionSupplierId:competition_supplier_id, reason:override_reason').eq('revision_id', revId).eq('is_override', true),
          approvalsFor(revId),
          db.from('contract_types').select('id, code, name').eq('active', true).order('code'),
          db.from('profiles').select('id, fullName:full_name').eq('active', true).order('full_name'),
          db.from('competition_item_links').select(LINK_COLS).eq('revision_id', revId).order('sort_order'),
        ])
        const revision = must(rev) as unknown as (RevisionDTO & { competitionId: string }) | null
        if (!revision) return null

        const supRows = must(sups) as unknown as (Json & { supplier_proposals: Json[] | Json | null })[]
        const proposalIds: string[] = []
        const suppliers: QcSupplierDTO[] = supRows.map(({ supplier_proposals, ...s }) => {
          const p = (Array.isArray(supplier_proposals) ? supplier_proposals[0] : supplier_proposals) ?? null
          if (p) proposalIds.push(p.id as string)
          return {
            ...(s as unknown as QcSupplierDTO),
            proposalRef: (p?.proposalRef as string) ?? null,
            proposalReceivedOn: (p?.receivedOn as string) ?? null,
            proposalValidUntil: (p?.validUntil as string) ?? null,
          }
        })
        const priceRows = proposalIds.length
          ? (must(
              await db
                .from('supplier_proposal_items')
                .select('itemId:competition_item_id, unitPrice:unit_price::text, notes, supplier_proposals(competition_supplier_id)')
                .in('proposal_id', proposalIds),
            ) as unknown as { itemId: string; unitPrice: string | null; notes: string | null; supplier_proposals: { competition_supplier_id: string } }[])
          : []

        const people_ = must(people) as unknown as { id: string; fullName: string }[]
        const ref = (id: unknown) => people_.find((p) => p.id === id) ?? null
        const { competitionId: _cid, ...revisionDto } = revision

        return {
          competition: {
            id: c.id as string,
            code: c.code as string,
            title: c.title as string,
            description: (c.description as string) ?? null,
            status: c.status as CompetitionData['competition']['status'],
            packageCode: (c.packageCode as string) ?? null,
            requestedOn: c.requestedOn as string,
            workId: c.workId as string,
            workCode: c.works.code,
            workName: c.works.name,
            budgetId: c.budgetId as string,
            engineeringOwner: ref(c.engineeringOwnerId),
            procurementOwner: ref(c.procurementOwnerId),
          },
          revision: revisionDto,
          revisions: must(revisions) as unknown as CompetitionData['revisions'],
          items: must(items) as unknown as QcItemDTO[],
          suppliers,
          prices: priceRows.map((p) => ({
            competitionSupplierId: p.supplier_proposals.competition_supplier_id,
            itemId: p.itemId,
            unitPrice: p.unitPrice,
            notes: p.notes,
          })),
          overrides: must(best) as unknown as CompetitionData['overrides'],
          approvals,
          links: must(links) as unknown as QcLinkDTO[],
          contractTypes: must(contractTypes) as { id: string; code: string; name: string }[],
          people: people_,
        }
      },

      async getRevisionRef(revisionId) {
        const r = must(
          await db
            .from('competition_revisions')
            .select('competition_id, status, number, frozen_at, competitions!competition_id(work_id)')
            .eq('id', revisionId)
            .maybeSingle(),
        ) as unknown as { competition_id: string; status: RevisionDTO['status']; number: number; frozen_at: string | null; competitions: { work_id: string } } | null
        return r ? { competitionId: r.competition_id, workId: r.competitions.work_id, status: r.status, number: r.number, frozenAt: r.frozen_at } : null
      },

      async updateCompetition(id, patch) {
        const row = toSnake(patch as Json)
        if (Object.keys(row).length) must(await db.from('competitions').update(row).eq('id', id))
      },

      async updateRevision(revisionId, patch) {
        must(await db.from('competition_revisions').update(toSnake(patch)).eq('id', revisionId))
      },

      async updateItem(itemId, patch) {
        must(await db.from('competition_items').update(toSnake(patch as Json)).eq('id', itemId))
      },

      async addSupplier(revisionId, s, sortOrder) {
        const cs = must(
          await db
            .from('competition_suppliers')
            .insert({
              revision_id: revisionId, supplier_id: s.id, sort_order: sortOrder, legal_name: s.legalName, trade_name: s.tradeName,
              tax_id: s.taxId, contact_name: s.contactName, phone: s.phone, email: s.email, cnd_valid_until: s.cndValidUntil,
            })
            .select('id')
            .single(),
        ) as { id: string }
        must(await db.from('supplier_proposals').insert({ revision_id: revisionId, competition_supplier_id: cs.id }))
        return cs.id
      },

      async updateSupplier(id, patch) {
        const { proposalRef, proposalReceivedOn, proposalValidUntil, ...terms } = patch
        const csRow = toSnake(terms as Json)
        if (Object.keys(csRow).length) must(await db.from('competition_suppliers').update(csRow).eq('id', id))
        const pRow = toSnake({ proposalRef, receivedOn: proposalReceivedOn, validUntil: proposalValidUntil })
        if (Object.keys(pRow).length) {
          const proposalId = await proposalIdFor(id)
          must(await db.from('supplier_proposals').update(pRow).eq('id', proposalId))
        }
      },

      async removeSupplier(id) {
        must(await db.from('competition_suppliers').delete().eq('id', id))
      },

      async upsertPrices(_revisionId, prices) {
        const byProposal = new Map<string, string>()
        const rows = []
        for (const p of prices) {
          let proposalId = byProposal.get(p.competitionSupplierId)
          if (!proposalId) byProposal.set(p.competitionSupplierId, (proposalId = await proposalIdFor(p.competitionSupplierId)))
          rows.push({ proposal_id: proposalId, competition_item_id: p.itemId, unit_price: p.unitPrice, ...(p.notes !== undefined ? { notes: p.notes } : {}) })
        }
        must(await db.from('supplier_proposal_items').upsert(rows, { onConflict: 'proposal_id,competition_item_id' }))
      },

      async persistComputed(revisionId, computed) {
        const proposals = must(
          await db.from('supplier_proposals').select('id, competition_supplier_id').eq('revision_id', revisionId),
        ) as { id: string; competition_supplier_id: string }[]
        const pid = new Map(proposals.map((p) => [p.competition_supplier_id, p.id]))

        for (const t of computed.proposalTotals) {
          const id = pid.get(t.competitionSupplierId)
          if (id) must(await db.from('supplier_proposals').update({ total_amount: t.total }).eq('id', id))
        }
        if (computed.priceTotals.length) {
          // Upsert parcial: só atualiza total_price (unit_price permanece)
          for (const t of computed.priceTotals) {
            const id = pid.get(t.competitionSupplierId)
            if (!id) continue
            must(await db.from('supplier_proposal_items').update({ total_price: t.totalPrice }).eq('proposal_id', id).eq('competition_item_id', t.itemId))
          }
        }
        if (computed.awardedTotal !== undefined) {
          must(await db.from('competition_revisions').update({ awarded_total: computed.awardedTotal }).eq('id', revisionId))
        }
        for (const v of computed.linkValues ?? []) {
          must(await db.from('competition_item_links').update({ awarded_unit_price: v.awardedUnitPrice, awarded_total: v.awardedTotal }).eq('id', v.linkId))
        }
        must(await db.from('best_conditions').delete().eq('revision_id', revisionId))
        if (computed.best.length) {
          must(await db.from('best_conditions').insert(
            computed.best.map((b) => ({
              revision_id: revisionId, competition_item_id: b.itemId, competition_supplier_id: b.competitionSupplierId,
              unit_price: b.unitPrice, total_price: b.totalPrice, budget_total: b.budgetTotal, variance_amount: b.varianceAmount,
              variance_ratio: b.varianceRatio, is_override: b.isOverride, override_reason: b.overrideReason,
            })),
          ))
        }
      },

      async addItems(revisionId, items) {
        const current = must(await db.from('competition_items').select('sort_order').eq('revision_id', revisionId).order('sort_order', { ascending: false }).limit(1)) as { sort_order: number }[]
        let order = current[0]?.sort_order ?? 0
        const ids: string[] = []
        for (const i of items) {
          const row = must(await db.from('competition_items').insert({
            revision_id: revisionId, material_id: i.materialId, sort_order: ++order, code: i.code, description: i.description,
            unit: i.unit, budget_quantity: i.quantity, budget_unit_cost: i.unitCost, quantity: i.quantity,
          }).select('id').single()) as { id: string }
          if (i.links.length) must(await db.from('competition_item_links').insert(i.links.map((l, li) => linkRow(revisionId, row.id, l, li))))
          ids.push(row.id)
        }
        return ids
      },

      async removeItem(itemId) {
        must(await db.from('competition_items').delete().eq('id', itemId))
      },

      async setItemLinks(revisionId, itemId, links) {
        must(await db.from('competition_item_links').delete().eq('competition_item_id', itemId))
        if (links.length) {
          must(await db.from('competition_item_links').insert(links.map((l, i) => linkRow(revisionId, itemId, l, i))))
        }
      },

      async workCommitments(workId) {
        const [comps, links] = await Promise.all([
          db.rpc('qc_effective_revisions', { p_work_id: workId }),
          db.rpc('qc_work_link_commitments', { p_work_id: workId }),
        ])
        return {
          competitions: (must(comps) as { competition_id: string; revision_id: string; revision_number: number; category: CommitmentCategory; awarded_total: string }[]).map((r) => ({
            competitionId: r.competition_id, revisionId: r.revision_id, revisionNumber: r.revision_number, category: r.category, awardedTotal: r.awarded_total,
          })),
          links: (must(links) as { competition_id: string; category: CommitmentCategory; package_code: string | null; material_id: string; line_key: string | null; quantity: string; share: string; budget_value: string; amount: string }[]).map((r) => ({
            competitionId: r.competition_id, category: r.category, packageCode: r.package_code, materialId: r.material_id, lineKey: r.line_key,
            quantity: r.quantity, share: r.share, budgetValue: r.budget_value, amount: r.amount,
          })),
        }
      },

      async cloneRevision(revisionId, reason) {
        return must(await db.rpc('qc_clone_revision', { p_revision_id: revisionId, p_reason: reason })) as string
      },

      async setRevisionStatus(revisionId, change) {
        must(await db.from('competition_revisions').update(toSnake(change as unknown as Json)).eq('id', revisionId))
      },
    },

    // ------------------------------------------------------------------ aprovações
    approvals: {
      async listSteps() {
        const rows = must(await db.from('approval_steps').select('step_order, name, role_id, min_amount::text, active').order('step_order')) as {
          step_order: number; name: string; role_id: string; min_amount: string | null; active: boolean
        }[]
        return rows.map((s) => ({ stepOrder: s.step_order, name: s.name, roleId: s.role_id, minAmount: s.min_amount ? Decimal.from(s.min_amount) : null, active: s.active }))
      },
      listForRevision: approvalsFor,
      async createPlan(revisionId, plan) {
        must(await db.from('approvals').delete().eq('revision_id', revisionId).eq('status', 'pending'))
        must(await db.from('approvals').insert(plan.map((p) => ({ revision_id: revisionId, step_order: p.stepOrder, step_name: p.stepName, role_id: p.roleId, status: p.status }))))
      },
      async saveDecision(revisionId, step) {
        must(
          await db
            .from('approvals')
            .update({ status: step.status, decided_by: step.decidedBy, decided_at: step.decidedAt, comment: step.comment })
            .eq('revision_id', revisionId)
            .eq('step_order', step.stepOrder),
        )
      },
    },

    // ------------------------------------------------------------------ auditoria
    audit: {
      async listForCompetition(competitionId, limit = 300) {
        const rows = must(await db.rpc('qc_competition_audit', { p_competition_id: competitionId, p_limit: limit })) as Json[]
        return rows.map<AuditLogDTO>((r) => ({
          id: Number(r.id), occurredAt: r.occurred_at as string, userId: (r.user_id as string) ?? null, userName: (r.user_name as string) ?? null,
          entity: r.entity as string, entityId: (r.entity_id as string) ?? null, action: r.action as AuditLogDTO['action'],
          field: (r.field as string) ?? null, oldValue: r.old_value, newValue: r.new_value, revisionId: (r.revision_id as string) ?? null,
          origin: r.origin as string, correlationId: (r.correlation_id as string) ?? null,
        }))
      },
      async recordEvent() {
        // Eventos já são capturados pelos triggers do banco (status, decisões, snapshot).
      },
    },

    // ------------------------------------------------------------------ integração (service_role)
    integrationLogs: {
      async start(entry) {
        const r = must(
          await service
            .from('integration_logs')
            .insert({ correlation_id: entry.correlationId, provider: entry.provider, operation: entry.operation, direction: entry.direction, triggered_by: entry.triggeredBy, integration_id: entry.integrationId ?? null })
            .select('id')
            .single(),
        ) as { id: string }
        return r.id
      },
      async finish(id, r) {
        must(
          await service
            .from('integration_logs')
            .update({
              status: r.status, records_processed: r.recordsProcessed, records_failed: r.recordsFailed, message: r.message ?? null,
              error_detail: r.errorDetail ?? null, payload_summary: r.payloadSummary ?? null, finished_at: new Date().toISOString(),
            })
            .eq('id', id),
        )
      },
      async list(limit = 100) {
        const rows = must(
          await db
            .from('integration_logs')
            .select(`id, correlationId:correlation_id, provider, operation, direction, integrationId:integration_id, status,
              startedAt:started_at, finishedAt:finished_at, recordsProcessed:records_processed, recordsFailed:records_failed, message`)
            .order('started_at', { ascending: false })
            .limit(limit),
        )
        return rows as unknown as IntegrationLogDTO[]
      },
    },

    // ------------------------------------------------------------------ ERP → base (service_role)
    erpWriter: {
      async upsertWorks(works) {
        const now = new Date().toISOString()
        must(await service.from('works').upsert(
          works.map((w) => ({ erp_id: w.erpId, code: w.code, name: w.name, client_name: w.clientName, city: w.city, state: w.state, status: w.status, cost_center: w.costCenter, source: 'erp', erp_synced_at: now })),
          { onConflict: 'erp_id' },
        ))
        return works.length
      },
      async upsertSuppliers(suppliers) {
        const now = new Date().toISOString()
        must(await service.from('suppliers').upsert(
          suppliers.map((s) => ({
            erp_id: s.erpId, legal_name: s.legalName, trade_name: s.tradeName, tax_id: s.taxId, tax_id_kind: s.taxId.length === 11 ? 'cpf' : 'cnpj',
            contact_name: s.contactName, phone: s.phone, email: s.email, cnd_valid_until: s.cndValidUntil, city: s.city, state: s.state,
            active: s.active, source: 'erp', erp_synced_at: now,
          })),
          { onConflict: 'tax_id' },
        ))
        return suppliers.length
      },
      async upsertMaterials(materials) {
        const now = new Date().toISOString()
        for (let i = 0; i < materials.length; i += 500) {
          must(await service.from('materials').upsert(
            materials.slice(i, i + 500).map((m) => ({ erp_id: m.erpId ?? null, code: m.code, description: m.description, unit: m.unit, source: 'erp', erp_synced_at: now })),
            { onConflict: 'code' },
          ))
        }
        return materials.length
      },
      async upsertBudget(b) {
        const work = must(await service.from('works').select('id').eq('erp_id', b.workErpId).single()) as { id: string }
        const existing = must(await service.from('budgets').select('id').eq('work_id', work.id).eq('version', b.version).maybeSingle()) as { id: string } | null

        let budgetId = existing?.id
        if (!budgetId) {
          must(await service.from('budgets').update({ is_current: false, status: 'superseded' }).eq('work_id', work.id).eq('is_current', true))
          budgetId = (must(await service.from('budgets').insert({ work_id: work.id, version: b.version, erp_id: b.erpId, source: 'erp' }).select('id').single()) as { id: string }).id
        }
        // Linhas preservadas pela chave (QCs vinculados continuam apontando para a mesma linha)
        const { total, count } = await writeBudgetLines(service, budgetId!, b)
        must(await service.from('budgets').update({ is_current: true, status: 'active', description: b.description, base_date: b.baseDate, total_amount: total.toDb(), lines_count: count, erp_synced_at: new Date().toISOString() }).eq('id', budgetId))
        return { budgetId: budgetId!, lines: count }
      },
    },

    // ------------------------------------------------------------------ importação (Excel) — service_role
    budgetWriter: {
      async importBudget(workId, input, meta) {
        for (const part of chunk(input.materials, 500)) {
          must(await service.from('materials').upsert(
            part.map((m) => ({ code: m.code, description: m.description, unit: m.unit })),
            { onConflict: 'code', ignoreDuplicates: false },
          ))
        }
        const last = must(await service.from('budgets').select('version').eq('work_id', workId).order('version', { ascending: false }).limit(1)) as { version: number }[]
        const version = (last[0]?.version ?? 0) + 1
        const budget = must(await service.from('budgets').insert({
          work_id: workId, version, description: `Importado de ${input.fileName}`, status: 'draft', is_current: false, source: 'excel',
          import_file_name: input.fileName, imported_at: new Date().toISOString(), imported_by: meta.actorId,
        }).select('id').single()) as { id: string }
        const { total, count } = await writeBudgetLines(service, budget.id, { groups: input.groups, activities: input.activities, items: input.lines })
        must(await service.from('budgets').update({ is_current: false, status: 'superseded' }).eq('work_id', workId).eq('is_current', true))
        must(await service.from('budgets').update({ is_current: true, status: 'active', total_amount: total.toDb(), lines_count: count }).eq('id', budget.id))
        return { budgetId: budget.id, version, lines: count }
      },
    },
  }
}
