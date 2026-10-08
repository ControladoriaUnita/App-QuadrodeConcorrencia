/**
 * Solicitação de contrato e aditivos pela API (modo memória).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { CompetitionDetailDTO, CompetitionListItemDTO, ContractListItemDTO, ContractRequestDTO } from '../../shared/contracts'
import { Decimal } from '../../shared/domain/decimal'
import { DEMO_USERS } from '../infrastructure/memory/seed'
import { handle } from './router'

const [ADMIN, PROC, ENG, MGR] = DEMO_USERS.map((u) => u.id)

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

const comps = async () => (await call<CompetitionListItemDTO[]>('GET', '/competitions')).data
let workId: string
const contracted = async () =>
  Number((await call<{ code: string; summary: { contracted: string } }[]>('GET', '/works')).data.find((w) => w.code === '2041')!.summary.contracted)
const seeded = async () => (await call<ContractListItemDTO[]>('GET', `/contracts?workId=${workId}`)).data.find((c) => c.code === 'SC-2041-001')!.id

beforeAll(async () => {
  process.env.DATA_SOURCE = 'memory'
  workId = (await call<{ id: string; code: string }[]>('GET', '/works')).data.find((w) => w.code === '2041')!.id
})

describe('solicitação de contrato', () => {
  it('semente: contrato da Terraplenagem enviado e 1º aditivo aguardando a Gerência', async () => {
    const terra = (await comps()).find((c) => c.title.startsWith('Terraplenagem'))!
    expect(terra.status).toBe('contracted')
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${await seeded()}`)
    expect(c.status).toBe('submitted')
    expect(c.revision.number).toBe(0)
    expect(c.supplier.tradeName).toBe('Terra Forte')
    expect(c.items.length).toBeGreaterThan(0)
    expect(c.items.every((i) => i.allocations.length > 0)).toBe(true)
    expect(c.totalAmount).toBe(Decimal.sum(c.items.map((i) => i.totalPrice)).toDb())
    expect(Decimal.from(c.pctMaterial).plus(c.pctEquipment).plus(c.pctService).toFixed(4)).toBe('1.0000')
    expect(c.addenda.map((a) => [a.number, a.status])).toEqual([[1, 'submitted']])
    expect(c.can.edit).toBe(false)
    expect(c.can.addendum).toBe(false) // há aditivo em aberto
  })

  it('não gera duas solicitações nem contrato de QC sem revisão aprovada', async () => {
    const all = await comps()
    const terra = all.find((c) => c.title.startsWith('Terraplenagem'))!
    const dup = await call<{ error: { code: string } }>('POST', '/contracts', { competitionId: terra.id })
    expect(dup.status).toBe(409)
    expect(dup.data.error.code).toBe('CONTRACT_EXISTS')
    const draft = all.find((c) => c.title.startsWith('Pavimentação'))!
    const none = await call<{ error: { code: string } }>('POST', '/contracts', { competitionId: draft.id })
    expect(none.data.error.code).toBe('CONTRACT_NO_APPROVED_REVISION')
    expect((await call('POST', '/contracts', { competitionId: terra.id }, ENG)).status).toBe(403)
  })

  it('gera do QC aprovado, exige critérios de medição, envia e cancela', async () => {
    const contrapiso = (await comps()).find((c) => c.title.startsWith('Contrapiso'))!
    const { data: d } = await call<CompetitionDetailDTO>('GET', `/competitions/${contrapiso.id}`)
    await call('POST', `/revisions/${d.revision.id}/approvals`, { stepOrder: 2, decision: 'approved' }, ENG)
    await call('POST', `/revisions/${d.revision.id}/approvals`, { stepOrder: 3, decision: 'approved' }, MGR)
    expect((await comps()).find((x) => x.id === contrapiso.id)!.status).toBe('approved')

    const created = await call<{ id: string; code: string }>('POST', '/contracts', { competitionId: contrapiso.id })
    expect(created.status).toBe(201)
    expect(created.data.code).toBe('SC-2041-002')
    const id = created.data.id
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    expect(c.status).toBe('draft')
    expect(c.can.edit).toBe(true)
    expect(c.contractType.code).toBe('CTD08')
    expect(c.issues.map((i) => i.field)).toContain('measurementCriteria')

    const sub = await call<{ error: { code: string } }>('POST', `/contracts/${id}/submit`)
    expect(sub.data.error.code).toBe('CONTRACT_INVALID')
    expect((await call('PATCH', `/contracts/${id}`, { startOn: '2026-12-01', endOn: '2026-11-01' })).status).toBe(409)
    expect(
      (await call('PATCH', `/contracts/${id}`, {
        measurementCriteria: 'Medição quinzenal por m² executado.',
        projects: [{ sheet: 'A-01', fileName: 'Planta.pdf', revision: 'R00' }],
      })).status,
    ).toBe(200)
    expect((await call('PATCH', `/contracts/${id}/items/${c.items[0]!.id}`, { pctRetention: '0.05', specification: 'Conforme memorial' })).status).toBe(200)
    expect((await call('POST', `/contracts/${id}/submit`)).status).toBe(200)

    const { data: after } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    expect(after.items[0]!.pctRetention).toBe('0.05')
    expect(after.items[0]!.specification).toBe('Conforme memorial')
    expect(after.projects).toHaveLength(1)
    expect((await comps()).find((x) => x.id === contrapiso.id)!.status).toBe('contracted')
    expect((await call('PATCH', `/contracts/${id}/items/${c.items[0]!.id}`, { pctRetention: '0.1' })).status).toBe(409)
    // cancelar a enviada devolve o QC para "aprovado"
    expect((await call('POST', `/contracts/${id}/cancel`, { reason: 'Fornecedor desistiu' })).status).toBe(200)
    expect((await comps()).find((x) => x.id === contrapiso.id)!.status).toBe('approved')
  })
})

describe('aditivos', () => {
  it('é decidido pela Gerência e entra no contratado da obra', async () => {
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${await seeded()}`)
    const a = c.addenda[0]!
    expect(Number(a.totalDelta)).toBeGreaterThan(0)
    expect((await call('POST', `/addenda/${a.id}/decide`, { decision: 'approved' }, PROC)).status).toBe(403)
    expect((await call('POST', `/addenda/${a.id}/decide`, { decision: 'rejected' }, MGR)).status).toBe(409)
    const before = await contracted()
    expect((await call('POST', `/addenda/${a.id}/decide`, { decision: 'approved', comment: 'De acordo.' }, MGR)).status).toBe(200)
    expect(await contracted()).toBeCloseTo(before + Number(a.totalDelta), 2)
    const row = (await call<ContractListItemDTO[]>('GET', `/contracts?workId=${workId}`)).data.find((x) => x.code === 'SC-2041-001')!
    expect(row.addendaTotal).toBe(a.totalDelta)
    expect((await call('PUT', `/addenda/${a.id}`, { reason: 'Alterar depois de aprovado', items: [] })).status).toBe(409)
  })

  it('2º aditivo: quantidade acumulada, item novo, um aberto por vez, exclusão do rascunho', async () => {
    const id = await seeded()
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    expect(c.can.addendum).toBe(true)
    const item = c.items[0]!
    const created = await call<{ id: string; number: number }>('POST', `/contracts/${id}/addenda`, {
      reason: 'Redução de escopo do item',
      items: [{ contractItemId: item.id, quantityDelta: Decimal.from(item.quantity).times('2').neg().toDb() }],
    })
    expect(created.status).toBe(201)
    expect(created.data.number).toBe(2)
    const sub = await call<{ error: { details: { message: string }[] } }>('POST', `/addenda/${created.data.id}/submit`)
    expect(sub.status).toBe(422)
    expect(sub.data.error.details.map((d) => d.message).join()).toMatch(/negativa/)

    const saved = await call('PUT', `/addenda/${created.data.id}`, {
      reason: 'Serviço complementar de drenagem',
      newEndOn: '2027-04-30',
      items: [{ code: 'IS99999', description: 'Drenagem provisória', unit: 'm', quantityDelta: '120', unitPrice: '35.5' }],
    })
    expect(saved.status).toBe(200)
    const { data: c2 } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    expect(c2.addenda[1]!.totalDelta).toBe('4260.0000')
    expect(c2.addenda[1]!.items[0]!.contractItemId).toBeNull()
    expect((await call('POST', `/contracts/${id}/addenda`, { reason: 'Outro aditivo', items: [] })).status).toBe(409)
    expect((await call('DELETE', `/addenda/${created.data.id}`)).status).toBe(200)
  })

  it('envio ao ERP e assinatura', async () => {
    const id = await seeded()
    const edit = await call<{ error: { code: string } }>('PATCH', `/contracts/${id}`, { notes: 'x' })
    expect(edit.data.error.code).toBe('CONTRACT_STATUS')
    const pushed = await call<{ erpContractId: string }>('POST', `/contracts/${id}/erp-push`)
    expect(pushed.status).toBe(200)
    expect(pushed.data.erpContractId).toMatch(/^MOCK-CT-/)
    expect((await call('POST', `/contracts/${id}/cancel`, { reason: 'Desistência do fornecedor' })).status).toBe(409)
    expect((await call('POST', `/contracts/${id}/sign`, { signedOn: '2999-01-01' })).status).toBe(409)
    expect((await call('POST', `/contracts/${id}/sign`, { signedOn: '2026-10-05' })).status).toBe(200)
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    expect([c.status, c.signedOn, c.erpContractId]).toEqual(['signed', '2026-10-05', pushed.data.erpContractId])
    const logs = (await call<{ operation: string; status: string }[]>('GET', '/integration/logs', undefined, ADMIN)).data
    expect(logs.some((l) => l.operation === 'push_contract' && l.status === 'success')).toBe(true)
  })
})
