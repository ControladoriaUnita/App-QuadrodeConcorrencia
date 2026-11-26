/**
 * Fluxos de aprovação configuráveis pela API (modo memória): configuração, pedido do QC e
 * aditivo aprovado em etapas.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { ApprovalConfigDTO, CompetitionDetailDTO, CompetitionListItemDTO, ContractListItemDTO, ContractRequestDTO, WorkDTO } from '../../shared/contracts'
import { DEMO_USERS } from '../infrastructure/memory/seed'
import { handle } from './router'
import { pendingCrossDirectorNotices } from '../application/notifications'

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

describe('diretores aprovam os QCs uns dos outros', () => {
  it('o diretor SR decide a etapa do RT; fica registrado e o aviso ao dono do pedido é montado; quem não é diretor continua barrado', async () => {
    const dirs = (await config()).directors
    const rt = dirs.find((d) => d.code === 'RT')!
    const sr = dirs.find((d) => d.code === 'SR')!
    const save = (d: typeof rt, userId: string | null) => call('PUT', `/approval-directors/${d.id}`, { code: d.code, name: d.name, userId, active: true }, ADMIN)
    // RT ligado a outro usuário (MGR, que não tem o papel de Diretoria); SR ligado à Diretoria (DIR)
    expect((await save(rt, MGR!)).status).toBe(200)
    expect((await save(sr, DIR!)).status).toBe(200)

    // QC ainda em rascunho: preenche o que falta para enviar
    const comps = (await call<CompetitionListItemDTO[]>('GET', `/competitions?workId=${alpha}`)).data
    const draft = comps.find((x) => x.revisionStatus === 'draft' && x.title.startsWith('Pavimentação'))!
    const target = (await call<CompetitionDetailDTO>('GET', `/competitions/${draft.id}`)).data
    const rid = target.revision.id
    const types = (await call<{ id: string }[]>('GET', '/contract-types')).data
    const winner = target.suppliers.find((x) => !x.isPlaceholder)!
    const head = await call('PATCH', `/revisions/${rid}`, {
      requestKind: 'labor', origin: 'work', directorId: rt.id, serviceStartOn: '2027-01-04', serviceEndOn: '2027-03-31',
      engineeringOwnerName: 'Eng. Teste', contractTypeId: types[0]!.id, winnerSupplierId: winner.supplierId, winnerJustification: 'Melhor preço.',
    })
    expect(head.status, JSON.stringify(head.data)).toBe(200)
    const sub = await call('POST', `/revisions/${rid}/submit`)
    expect(sub.status, JSON.stringify(sub.data)).toBe(200)
    const sent = (await call<CompetitionDetailDTO>('GET', `/competitions/${target.competition.id}`)).data
    const byRole: Record<string, typeof PROC> = { Suprimentos: PROC, Engenharia: ENG, 'Gerente / Coordenador de Obra': MGR }
    const before = pendingCrossDirectorNotices().length
    for (const a of sent.approvals) {
      if (a.directorId) {
        expect(a.directorUserId).toBe(MGR)
        // Admin não é diretor: barrado; o SR (outro diretor) pode
        expect((await call('POST', `/revisions/${rid}/approvals`, { stepOrder: a.stepOrder, decision: 'approved' }, ADMIN)).status).toBe(403)
        expect((await call<CompetitionDetailDTO>('GET', `/competitions/${target.competition.id}`, undefined, DIR)).data.can.decide).toBe(true)
        expect((await call('POST', `/revisions/${rid}/approvals`, { stepOrder: a.stepOrder, decision: 'approved', comment: 'De acordo pelo SR.' }, DIR)).status).toBe(200)
      } else {
        expect((await call('POST', `/revisions/${rid}/approvals`, { stepOrder: a.stepOrder, decision: 'approved', comment: 'De acordo.' }, byRole[a.roleName])).status).toBe(200)
      }
    }
    const done = (await call<CompetitionDetailDTO>('GET', `/competitions/${target.competition.id}`)).data
    expect(done.revision.status).toBe('approved')
    const step = done.approvals.find((a) => a.directorId)!
    expect([step.decidedById, step.directorUserId]).toEqual([DIR, MGR])
    const notices = pendingCrossDirectorNotices().slice(before)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ competitionId: target.competition.id, directorId: rt.id, decision: 'approved' })

    // volta os diretores como estavam
    await save(rt, DIR!)
    await save(sr, null)
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

    const contractId = (await call<ContractListItemDTO[]>('GET', `/contracts?workId=${alpha}`)).data.find((c) => c.status === 'submitted')!.id
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
