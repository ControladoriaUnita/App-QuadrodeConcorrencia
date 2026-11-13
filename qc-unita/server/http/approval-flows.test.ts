/**
 * Fluxos de aprovação configuráveis pela API (modo memória): configuração, pedido do QC e
 * aditivo aprovado em etapas.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { ApprovalConfigDTO, CompetitionDetailDTO, CompetitionListItemDTO, ContractListItemDTO, ContractRequestDTO, WorkDTO } from '../../shared/contracts'
import { DEMO_USERS } from '../infrastructure/memory/seed'
import { handle } from './router'

const [ADMIN, PROC, ENG, MGR, DIR] = DEMO_USERS.map((u) => u.id)

async function call<T = unknown>(method: string, path: string, body?: unknown, user = PROC): Promise<{ status: number; data: T }> {
  const res = await handle(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-demo-user': user! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, data: (await res.json()) as T }
}

let alpha: string
const config = async (user = ADMIN) => (await call<ApprovalConfigDTO>('GET', '/approval-config', undefined, user)).data

beforeAll(async () => {
  process.env.DATA_SOURCE = 'memory'
  alpha = (await call<WorkDTO[]>('GET', '/works', undefined, ADMIN)).data.find((w) => w.code === '2041')!.id
})

describe('configuração dos fluxos', () => {
  it('todos consultam; só o administrador grava', async () => {
    const proc = await config(PROC)
    expect(proc.canManage).toBe(false)
    expect(proc.people).toEqual([])
    expect(proc.directors.map((d) => d.code)).toEqual(['RT', 'SR'])
    expect(proc.flows.map((f) => f.name)).toEqual(expect.arrayContaining(['Contratação de serviço (RT)', 'Desvio de custo ou quantidade', 'Aditivo / distrato', 'Aditivo de prazo contratual']))
    const admin = await config()
    expect(admin.canManage).toBe(true)
    expect(admin.people.length).toBeGreaterThan(0)

    const role = admin.roles.find((r) => r.key === 'manager')!
    const body = { kind: 'competition', name: 'Contratação de material pela obra', origin: 'work', requestKind: 'material', directorId: null, active: true, steps: [{ name: 'Gerente', roleId: role.id, director: false, minAmount: null, active: true }] }
    expect((await call('POST', '/approval-flows', body, PROC)).status).toBe(403)
    const created = await call<{ id: string }>('POST', '/approval-flows', body, ADMIN)
    expect(created.status).toBe(201)
    expect((await call('POST', '/approval-flows', { ...body, steps: [] }, ADMIN)).status).toBe(422)
    expect((await config()).flows.find((f) => f.id === created.data.id)!.steps.map((s) => s.name)).toEqual(['Gerente'])
    expect((await call('DELETE', `/approval-flows/${created.data.id}`, undefined, ADMIN)).status).toBe(200)

    const dup = await call<{ error: { code: string } }>('POST', '/approval-directors', { code: 'rt', name: 'Outro', userId: null, active: true }, ADMIN)
    expect(dup.data.error.code).toBe('DIRECTOR_CODE_DUPLICATED')
  })
})

describe('pedido do QC escolhe o fluxo', () => {
  it('diretor RT no pedido: a etapa do diretor só é decidida pelo usuário ligado a ele', async () => {
    const rt = (await config()).directors.find((d) => d.code === 'RT')!
    const comps = (await call<CompetitionListItemDTO[]>('GET', `/competitions?workId=${alpha}`)).data
    let target: CompetitionDetailDTO | null = null
    for (const c of comps.filter((x) => x.revisionStatus === 'draft')) {
      const d = (await call<CompetitionDetailDTO>('GET', `/competitions/${c.id}`)).data
      if (d.can.submit) {
        target = d
        break
      }
    }
    expect(target).not.toBeNull()
    const rid = target!.revision.id
    expect((await call('PATCH', `/revisions/${rid}`, { requestKind: 'labor', origin: 'work', directorId: rt.id })).status).toBe(200)
    const d = (await call<CompetitionDetailDTO>('GET', `/competitions/${target!.competition.id}`)).data
    expect([d.competition.requestKind, d.competition.origin, d.competition.directorName]).toEqual(['labor', 'work', 'Diretor RT'])

    const sub = await call<{ steps: number }>('POST', `/revisions/${rid}/submit`)
    expect(sub.status, JSON.stringify(sub.data)).toBe(200)
    const sent = (await call<CompetitionDetailDTO>('GET', `/competitions/${target!.competition.id}`)).data
    expect(sent.approvals.map((a) => a.stepName)).toContain('Diretor responsável (RT)')
    const byRole: Record<string, typeof PROC> = { Suprimentos: PROC, Engenharia: ENG, 'Gerente / Coordenador de Obra': MGR }
    for (const a of sent.approvals) {
      if (a.directorId) {
        expect((await call('POST', `/revisions/${rid}/approvals`, { stepOrder: a.stepOrder, decision: 'approved' }, ADMIN)).status).toBe(403)
        expect((await call('POST', `/revisions/${rid}/approvals`, { stepOrder: a.stepOrder, decision: 'approved', comment: 'De acordo.' }, DIR)).status).toBe(200)
      } else {
        expect((await call('POST', `/revisions/${rid}/approvals`, { stepOrder: a.stepOrder, decision: 'approved', comment: 'De acordo.' }, byRole[a.roleName])).status).toBe(200)
      }
    }
    expect((await call<CompetitionDetailDTO>('GET', `/competitions/${target!.competition.id}`)).data.revision.status).toBe('approved')
  })
})

describe('aditivo em etapas', () => {
  it('o fluxo de aditivo configurado vira etapas; o aditivo só fica aprovado na última', async () => {
    const admin = await config()
    const flow = admin.flows.find((f) => f.kind === 'addendum')!
    const director = admin.roles.find((r) => r.key === 'director')!
    const steps = [
      ...flow.steps.map((s) => ({ name: s.name, roleId: s.roleId, director: s.director, minAmount: s.minAmount, active: s.active })),
      { name: 'Diretor responsável', roleId: director.id, director: true, minAmount: null, active: true },
    ]
    expect((await call('PUT', `/approval-flows/${flow.id}`, { kind: flow.kind, name: flow.name, origin: null, requestKind: null, directorId: null, active: true, steps }, ADMIN)).status).toBe(200)

    const contractId = (await call<ContractListItemDTO[]>('GET', `/contracts?workId=${alpha}`)).data.find((c) => c.code === 'SC-2041-001')!.id
    const contract = async (user = PROC) => (await call<ContractRequestDTO>('GET', `/contracts/${contractId}`, undefined, user)).data
    // O 1º aditivo da semente foi enviado com o fluxo antigo (1 etapa): a Gerência decide
    const first = (await contract()).addenda[0]!
    expect(first.approvals.map((a) => a.stepName)).toEqual(['Gerente / Coordenador de Obra'])
    expect((await call('POST', `/addenda/${first.id}/decide`, { decision: 'approved' }, MGR)).status).toBe(200)

    // Aditivo só de prazo usa o fluxo de prazo
    const prazo = await call<{ id: string }>('POST', `/contracts/${contractId}/addenda`, { reason: 'Prorrogação do prazo', newEndOn: '2027-06-30', items: [] })
    expect(prazo.status).toBe(201)
    expect((await call('POST', `/addenda/${prazo.data.id}/submit`)).status).toBe(200)
    const p = (await contract()).addenda.find((a) => a.id === prazo.data.id)!
    expect(p.approvals.map((a) => a.stepName)).toEqual(['Gerente / Coordenador de Obra'])
    expect((await contract(MGR)).can.decideAddendum).toBe(true)
    expect((await call('POST', `/addenda/${prazo.data.id}/decide`, { decision: 'approved' }, MGR)).status).toBe(200)

    // Aditivo de valor: Gerente e depois Diretor
    const c = await contract()
    const item = c.items[0]!
    const add = await call<{ id: string }>('POST', `/contracts/${contractId}/addenda`, {
      reason: 'Volume adicional',
      items: [{ contractItemId: item.id, quantity: '1', allocations: [{ packageCode: item.allocations[0]!.packageCode!, quantity: '1' }] }],
    })
    expect((await call('POST', `/addenda/${add.data.id}/submit`)).status).toBe(200)
    expect((await contract()).addenda.find((a) => a.id === add.data.id)!.approvals.map((a) => a.stepName)).toEqual(['Gerente / Coordenador de Obra', 'Diretor responsável'])
    expect((await contract(DIR)).can.decideAddendum).toBe(false) // a etapa atual é do Gerente
    expect((await call<{ status: string }>('POST', `/addenda/${add.data.id}/decide`, { decision: 'approved' }, MGR)).data.status).toBe('submitted')
    expect((await contract(DIR)).can.decideAddendum).toBe(true)
    expect((await call<{ status: string }>('POST', `/addenda/${add.data.id}/decide`, { decision: 'approved' }, DIR)).data.status).toBe('approved')
    const done = (await contract()).addenda.find((a) => a.id === add.data.id)!
    expect([done.status, done.approvals.map((a) => a.status)]).toEqual(['approved', ['approved', 'approved']])
  })
})
