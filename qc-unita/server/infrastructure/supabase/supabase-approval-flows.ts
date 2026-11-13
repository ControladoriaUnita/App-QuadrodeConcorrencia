/**
 * Fluxos de aprovação, diretores e etapas dos aditivos no Supabase (migration 028). Client do
 * usuário: o RLS deixa todos lerem os fluxos e só o administrador gravar; as etapas dos aditivos
 * seguem contract.read / contract.manage / papel da etapa.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApprovalDirectorDTO, ApprovalDTO, ApprovalFlowDTO } from '../../../shared/contracts'
import type { ApprovalFlowRepository } from '../../application/ports'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must<T = any>(res: { data: unknown; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(res.error.code === '23505' ? `DIRECTOR_CODE_DUPLICATED: ${res.error.message}` : res.error.message)
  return res.data as T
}

interface FlowRow {
  id: string
  kind: ApprovalFlowDTO['kind']
  name: string
  origin: ApprovalFlowDTO['origin']
  request_kind: ApprovalFlowDTO['requestKind']
  director_id: string | null
  active: boolean
  approval_flow_steps: { step_order: number; name: string; role_id: string; director: boolean; min_amount: string | null; active: boolean; roles: { name: string } | null }[]
}

export function createSupabaseApprovalFlows(db: SupabaseClient): ApprovalFlowRepository {
  const names = async (ids: (string | null)[]) => {
    const list = [...new Set(ids.filter((x): x is string => !!x))]
    if (!list.length) return new Map<string, string>()
    const rows = must(await db.from('profiles').select('id, full_name').in('id', list)) as { id: string; full_name: string }[]
    return new Map(rows.map((r) => [r.id, r.full_name]))
  }

  return {
    async listFlows() {
      const rows = must(
        await db
          .from('approval_flows')
          .select('id, kind, name, origin, request_kind, director_id, active, approval_flow_steps(step_order, name, role_id, director, min_amount::text, active, roles(name))')
          .order('kind')
          .order('name'),
      ) as FlowRow[]
      return rows.map<ApprovalFlowDTO>((f) => ({
        id: f.id,
        kind: f.kind,
        name: f.name,
        origin: f.origin,
        requestKind: f.request_kind,
        directorId: f.director_id,
        active: f.active,
        steps: [...f.approval_flow_steps]
          .sort((a, b) => a.step_order - b.step_order)
          .map((s) => ({ stepOrder: s.step_order, name: s.name, roleId: s.role_id, roleName: s.roles?.name ?? '', director: s.director, minAmount: s.min_amount, active: s.active })),
      }))
    },
    async saveFlow(id, input) {
      const { steps, ...head } = input
      const row = { kind: head.kind, name: head.name, origin: head.origin, request_kind: head.requestKind, director_id: head.directorId, active: head.active }
      let flowId = id
      if (flowId) must(await db.from('approval_flows').update(row).eq('id', flowId))
      else flowId = (must(await db.from('approval_flows').insert(row).select('id').single()) as { id: string }).id
      must(await db.from('approval_flow_steps').delete().eq('flow_id', flowId))
      must(
        await db.from('approval_flow_steps').insert(
          steps.map((s, k) => ({ flow_id: flowId, step_order: k + 1, name: s.name, role_id: s.roleId, director: s.director, min_amount: s.minAmount, active: s.active })),
        ),
      )
      return flowId!
    },
    async deleteFlow(id) {
      must(await db.from('approval_flows').delete().eq('id', id))
    },
    async listDirectors() {
      const rows = must(await db.from('approval_directors').select('id, code, name, user_id, active').order('code')) as {
        id: string; code: string; name: string; user_id: string | null; active: boolean
      }[]
      const who = await names(rows.map((r) => r.user_id))
      return rows.map<ApprovalDirectorDTO>((r) => ({ id: r.id, code: r.code, name: r.name, userId: r.user_id, userName: (r.user_id && who.get(r.user_id)) ?? null, active: r.active }))
    },
    async saveDirector(id, input) {
      const row = { code: input.code, name: input.name, user_id: input.userId, active: input.active }
      if (id) {
        must(await db.from('approval_directors').update(row).eq('id', id))
        return id
      }
      return (must(await db.from('approval_directors').insert(row).select('id').single()) as { id: string }).id
    },
    async listRoles() {
      return must(await db.from('roles').select('id, key, name').order('name')) as { id: string; key: string; name: string }[]
    },
    async listPeople() {
      const rows = must(await db.from('profiles').select('id, full_name').eq('active', true).order('full_name')) as { id: string; full_name: string }[]
      return rows.map((r) => ({ id: r.id, fullName: r.full_name }))
    },
    async listForAddenda(addendumIds) {
      const out = new Map<string, ApprovalDTO[]>(addendumIds.map((id) => [id, []]))
      if (!addendumIds.length) return out
      const rows = must(
        await db
          .from('addendum_approvals')
          .select('addendum_id, step_order, step_name, role_id, director_id, status, decided_by, decided_at, comment, roles(name), approval_directors(name, user_id)')
          .in('addendum_id', addendumIds)
          .order('step_order'),
      ) as {
        addendum_id: string; step_order: number; step_name: string; role_id: string; director_id: string | null; status: ApprovalDTO['status']
        decided_by: string | null; decided_at: string | null; comment: string | null; roles: { name: string } | null; approval_directors: { name: string; user_id: string | null } | null
      }[]
      const who = await names(rows.map((r) => r.decided_by))
      for (const r of rows) {
        out.get(r.addendum_id)?.push({
          stepOrder: r.step_order, stepName: r.step_name, roleId: r.role_id, roleName: r.roles?.name ?? '', directorId: r.director_id,
          directorName: r.approval_directors?.name ?? null, directorUserId: r.approval_directors?.user_id ?? null, status: r.status, decidedById: r.decided_by,
          decidedByName: (r.decided_by && who.get(r.decided_by)) ?? null, decidedAt: r.decided_at, comment: r.comment,
        })
      }
      return out
    },
    async createAddendumPlan(addendumId, plan) {
      must(await db.from('addendum_approvals').delete().eq('addendum_id', addendumId))
      must(
        await db.from('addendum_approvals').insert(
          plan.map((p) => ({ addendum_id: addendumId, step_order: p.stepOrder, step_name: p.stepName, role_id: p.roleId, director_id: p.directorId ?? null, status: p.status })),
        ),
      )
    },
    async saveAddendumDecision(addendumId, step) {
      must(
        await db
          .from('addendum_approvals')
          .update({ status: step.status, decided_by: step.decidedBy, decided_at: step.decidedAt, comment: step.comment })
          .eq('addendum_id', addendumId)
          .eq('step_order', step.stepOrder),
      )
    },
  }
}
