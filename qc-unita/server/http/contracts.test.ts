/**
 * Solicitação de contrato e aditivos pela API (modo memória).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { CompetitionDetailDTO, CompetitionListItemDTO, ContractListItemDTO, ContractRequestDTO } from '../../shared/contracts'
import { buildQcMap } from '../../shared/domain/competition/qc-map'
import { Decimal } from '../../shared/domain/decimal'
import { DEMO_USERS } from '../infrastructure/memory/seed'
import { handle } from './router'

const [, PROC, ENG, MGR, DIR] = DEMO_USERS.map((u) => u.id)

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


/** Aprova as etapas pendentes em ordem, cada uma com o usuário do papel (inclui a etapa de desvio) */
async function approveAll(competitionId: string) {
  const byRole: Record<string, typeof PROC> = { Suprimentos: PROC, Engenharia: ENG, 'Gerente / Coordenador de Obra': MGR, Diretoria: DIR }
  for (;;) {
    const { data } = await call<CompetitionDetailDTO>('GET', `/competitions/${competitionId}`)
    const step = data.approvals.find((a) => a.status === 'pending')
    if (!step || data.revision.status !== 'in_approval') return
    const res = await call('POST', `/revisions/${data.revision.id}/approvals`, { stepOrder: step.stepOrder, decision: 'approved', comment: 'De acordo.' }, byRole[step.roleName])
    expect(res.status, JSON.stringify(res.data)).toBe(200)
  }
}

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
    expect(d.revision.status).toBe('in_approval')
    await approveAll(contrapiso.id)
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

  it('cotação escolhida: gera uma solicitação por empresa escolhida, só as que faltam', async () => {
    const contrapiso = (await comps()).find((c) => c.title.startsWith('Contrapiso'))!
    const detail = async () => (await call<CompetitionDetailDTO>('GET', `/competitions/${contrapiso.id}`)).data
    const { data: rev } = await call<{ revisionId: string }>('POST', `/competitions/${contrapiso.id}/revisions`, { reason: 'Dividir entre duas empresas' }, ENG)
    const d = await detail()
    expect(d.revision.id).toBe(rev.revisionId)
    // Duas empresas com CND válida (para poder enviar as solicitações)
    const hoje = new Date().toISOString().slice(0, 10)
    const [a, b] = d.suppliers.filter((s) => !s.cndValidUntil || s.cndValidUntil >= hoje)
    const items = d.items.filter((i) => Number(i.quantity) > 0)
    // 1º insumo com a 2ª empresa, os demais com a 1ª
    const choose = (itemId: string, chosenSupplierId: string) => call('PATCH', `/revisions/${rev.revisionId}/items/${itemId}`, { chosenSupplierId })
    for (const [n, item] of items.slice(0, -1).entries()) expect((await choose(item.id, (n === 0 ? b : a)!.id)).status).toBe(200)
    // Com cotação escolhida, todo insumo com quantidade precisa de empresa (a vencedora única não é mais exigida)
    const incomplete = await call<{ error: { details: { field: string; message: string }[] } }>('POST', `/revisions/${rev.revisionId}/submit`)
    expect(incomplete.status).toBe(422)
    expect(incomplete.data.error.details).toEqual([{ field: 'chosen', message: 'Cotação escolhida: 1 insumo(s) com quantidade sem empresa escolhida.' }])
    expect((await choose(items.at(-1)!.id, a!.id)).status).toBe(200)
    expect((await call('PATCH', `/revisions/${rev.revisionId}`, { winnerSupplierId: null })).status).toBe(200)
    expect((await call('POST', `/revisions/${rev.revisionId}/submit`)).status).toBe(200)
    // A alçada usa o total da cotação escolhida
    const sent = await detail()
    expect(sent.revision.status).toBe('in_approval')
    await approveAll(contrapiso.id)
    expect((await detail()).can.createContract).toBe(true)

    const created = await call<{ created: { id: string }[] }>('POST', '/contracts', { competitionId: contrapiso.id })
    expect(created.status).toBe(201)
    expect(created.data.created).toHaveLength(2)
    const made = await Promise.all(created.data.created.map(async (x) => (await call<ContractRequestDTO>('GET', `/contracts/${x.id}`)).data))
    expect(made.map((c) => c.supplier.id)).toEqual([a!.supplierId, b!.supplierId])
    expect(made[1]!.items.map((i) => i.code)).toEqual([items[0]!.code])
    expect(made[0]!.items.map((i) => i.code)).toEqual(items.slice(1).map((i) => i.code))
    // Cada solicitação leva só a verba dos seus insumos: a soma volta à verba do QC
    const { data: approved } = await call<CompetitionDetailDTO>('GET', `/competitions/${contrapiso.id}?revisionId=${rev.revisionId}`)
    const qcBudget = buildQcMap(approved).budgetTotal
    expect(made.every((c) => Decimal.from(c.budgetAmount).lt(qcBudget))).toBe(true)
    expect(Decimal.sum(made.map((c) => c.budgetAmount)).toDb()).toBe(qcBudget.toDb())
    expect((await detail()).can.createContract).toBe(false)
    const dup = await call<{ error: { code: string } }>('POST', '/contracts', { competitionId: contrapiso.id })
    expect(dup.data.error.code).toBe('CONTRACT_EXISTS')

    // Cancelada a de uma empresa, gera de novo só a dela
    expect((await call('POST', `/contracts/${made[1]!.id}/cancel`, { reason: 'Refazer' })).status).toBe(200)
    expect((await detail()).can.createContract).toBe(true)
    const again = await call<{ created: { id: string }[] }>('POST', '/contracts', { competitionId: contrapiso.id })
    expect(again.data.created).toHaveLength(1)
    expect((await call<ContractRequestDTO>('GET', `/contracts/${again.data.created[0]!.id}`)).data.supplier.id).toBe(b!.supplierId)

    // Com as duas enviadas, cancelar uma mantém a concorrência contratada
    for (const id of [made[0]!.id, again.data.created[0]!.id]) {
      await call('PATCH', `/contracts/${id}`, { measurementCriteria: 'Medição mensal por m² executado.' })
      const sub = await call('POST', `/contracts/${id}/submit`)
      expect(sub.status, JSON.stringify(sub.data)).toBe(200)
    }
    expect((await call('POST', `/contracts/${made[0]!.id}/cancel`, { reason: 'Fornecedor desistiu' })).status).toBe(200)
    expect((await comps()).find((x) => x.id === contrapiso.id)!.status).toBe('contracted')
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

  it('distrato: numeração própria, sinal negativo, sem passar do contratado e com vínculo por IP', async () => {
    const id = await seeded()
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    const item = c.items[0]!
    const ip = item.allocations[0]!.packageCode!
    const tooMuch = Decimal.from(item.quantity).times('2').toDb()
    const created = await call<{ id: string; kind: string; number: number }>('POST', `/contracts/${id}/addenda`, {
      kind: 'termination',
      reason: 'Redução de escopo do item',
      items: [{ contractItemId: item.id, quantity: tooMuch, allocations: [{ packageCode: ip, quantity: tooMuch }] }],
    })
    expect(created.status).toBe(201)
    expect([created.data.kind, created.data.number]).toEqual(['termination', 1])
    const sub = await call<{ error: { details: { message: string }[] } }>('POST', `/addenda/${created.data.id}/submit`)
    expect(sub.status).toBe(422)
    expect(sub.data.error.details.map((d) => d.message).join()).toMatch(/passa da quantidade contratada/)

    // Distrato não aceita item novo
    const novo = await call('PUT', `/addenda/${created.data.id}`, {
      reason: 'Item novo no distrato',
      items: [{ code: 'IS99999', description: 'X', unit: 'm', quantity: '1', unitPrice: '1', allocations: [{ packageCode: ip, quantity: '1' }] }],
    })
    expect(novo.status).toBe(422)

    const half = Decimal.from(item.quantity).div(2).round(4).toDb()
    const saved = await call('PUT', `/addenda/${created.data.id}`, {
      reason: 'Redução de escopo do item',
      items: [{ contractItemId: item.id, quantity: half, unitPrice: '1', allocations: [{ packageCode: ip, quantity: half }] }],
    })
    expect(saved.status).toBe(200)
    const { data: c2 } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    const t = c2.addenda.find((x) => x.id === created.data.id)!
    expect(t.items[0]!.quantityDelta).toBe(Decimal.from(half).neg().toDb())
    expect(t.items[0]!.unitPrice).toBe(item.unitPrice) // distrato usa o preço contratado
    expect(t.items[0]!.allocations).toEqual([{ packageCode: ip, locationCode: null, quantity: Decimal.from(half).neg().toDb() }])
    expect(Number(t.totalDelta)).toBeLessThan(0)
    expect((await call('POST', `/contracts/${id}/addenda`, { reason: 'Outro aditivo', items: [] })).status).toBe(409)
    expect((await call('POST', `/addenda/${created.data.id}/submit`)).status).toBe(200)
    const before = await contracted()
    expect((await call('POST', `/addenda/${created.data.id}/decide`, { decision: 'approved', comment: 'De acordo.' }, MGR)).status).toBe(200)
    expect(await contracted()).toBeCloseTo(before + Number(t.totalDelta), 2) // distrato reduz o contratado
  })

  it('aditivo com remanejamento: reduz um item e acrescenta outro na mesma solicitação', async () => {
    const id = await seeded()
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    const item = c.items[0]!
    const ip = item.allocations[0]!.packageCode!
    // Um décimo do contratado cabe no vigente mesmo depois do distrato aprovado acima (metade)
    const q = Decimal.from(item.allocations[0]!.quantity).div(10).round(4)
    const created = await call<{ id: string; kind: string }>('POST', `/contracts/${id}/addenda`, {
      reason: 'Remanejamento entre itens',
      items: [
        // A redução ignora o R$ informado: volta ao preço contratado
        { contractItemId: item.id, reduce: true, quantity: q.toDb(), unitPrice: '999', allocations: [{ packageCode: ip, quantity: q.toDb() }] },
        { code: 'IS99998', description: 'Serviço remanejado', unit: 'm', quantity: '2', unitPrice: '10', allocations: [{ packageCode: ip, quantity: '2' }] },
      ],
    })
    expect(created.status, JSON.stringify(created.data)).toBe(201)
    expect(created.data.kind).toBe('addendum')
    const { data: c2 } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    const a = c2.addenda.find((x) => x.id === created.data.id)!
    const reduced = a.items.find((i) => i.contractItemId === item.id)!
    expect([reduced.quantityDelta, reduced.unitPrice]).toEqual([q.neg().toDb(), item.unitPrice])
    expect(reduced.allocations[0]!.quantity).toBe(q.neg().toDb())
    expect(a.totalDelta).toBe(Decimal.from('20').minus(q.times(item.unitPrice).round(4)).toDb())
    const sub = await call('POST', `/addenda/${created.data.id}/submit`)
    expect(sub.status, JSON.stringify(sub.data)).toBe(200)
    expect((await call('POST', `/addenda/${created.data.id}/decide`, { decision: 'rejected', comment: 'Refazer.' }, MGR)).status).toBe(200)
  })

  it('aditivo com item novo exige vínculo de planejamento e numera depois dos aditivos anteriores', async () => {
    const id = await seeded()
    const created = await call<{ id: string; number: number }>('POST', `/contracts/${id}/addenda`, {
      reason: 'Serviço complementar de drenagem',
      newEndOn: '2027-04-30',
      items: [{ code: 'IS99999', description: 'Drenagem provisória', unit: 'm', quantity: '120', unitPrice: '35.5', allocations: [] }],
    })
    expect(created.data.number).toBe(3)
    const sub = await call<{ error: { details: { message: string }[] } }>('POST', `/addenda/${created.data.id}/submit`)
    expect(sub.data.error.details.map((d) => d.message).join()).toMatch(/Vincule ao planejamento/)
    expect((await call('DELETE', `/addenda/${created.data.id}`)).status).toBe(200)
  })

  it('enviar conclui o contrato: sem envio ao ERP nem assinatura', async () => {
    const id = await seeded()
    const edit = await call<{ error: { code: string } }>('PATCH', `/contracts/${id}`, { notes: 'x' })
    expect(edit.data.error.code).toBe('CONTRACT_STATUS')
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    expect(c.status).toBe('submitted')
    expect(c.can).not.toHaveProperty('sign')
    expect(c.can).not.toHaveProperty('pushToErp')
    expect((await call('POST', `/contracts/${id}/erp-push`)).status).toBe(404)
    expect((await call('POST', `/contracts/${id}/sign`, { signedOn: '2026-10-05' })).status).toBe(404)
  })
})
