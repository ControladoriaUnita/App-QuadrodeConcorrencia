/**
 * Solicitação de contrato e aditivos pela API (modo memória).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { CompetitionDetailDTO, CompetitionListItemDTO, ContractListItemDTO, ContractRequestDTO } from '../../shared/contracts'
import { buildQcMap } from '../../shared/domain/competition/qc-map'
import { Decimal } from '../../shared/domain/decimal'
import { DEMO_USERS } from '../infrastructure/memory/seed'
import { handle } from './router'

const [, PROC, ENG, MGR, DIR, PLAN] = DEMO_USERS.map((u) => u.id)

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
/** Contrato da semente: o da Terraplenagem (concluído, com aditivo) */
const seeded = async () => {
  const terra = (await comps()).find((c) => c.title.startsWith('Terraplenagem'))!
  return (await call<ContractListItemDTO[]>('GET', `/contracts?competitionId=${terra.id}`)).data.find((c) => c.status !== 'cancelled')!.id
}


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

  it('não gera duas solicitações nem solicitação de QC sem vencedora, tipo de contrato e datas', async () => {
    const all = await comps()
    const terra = all.find((c) => c.title.startsWith('Terraplenagem'))!
    const dup = await call<{ error: { code: string } }>('POST', '/contracts', { competitionId: terra.id })
    expect(dup.status).toBe(409)
    expect(dup.data.error.code).toBe('CONTRACT_EXISTS')
    const draft = all.find((c) => c.title.startsWith('Pavimentação'))!
    const none = await call<{ error: { code: string } }>('POST', '/contracts', { competitionId: draft.id })
    expect(none.data.error.code).toBe('CONTRACT_REVISION_INCOMPLETE')
    expect((await call('POST', '/contracts', { competitionId: terra.id }, ENG)).status).toBe(403)
  })

  it('nasce no envio do QC (antes da aprovação), só conclui depois de aprovado, exige critérios de medição e cancela', async () => {
    const contrapiso = (await comps()).find((c) => c.title.startsWith('Contrapiso'))!
    const { data: d } = await call<CompetitionDetailDTO>('GET', `/competitions/${contrapiso.id}`)
    expect(d.revision.status).toBe('in_approval')
    // A semente enviou o QC: a solicitação já existe em rascunho, antes da aprovação
    const list = (await call<ContractListItemDTO[]>('GET', `/contracts?competitionId=${contrapiso.id}`)).data
    expect(list.map((x) => [x.code, x.status])).toEqual([['SC-2041-001', 'draft']])
    const id = list[0]!.id
    const { data: early } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    expect(early.qcApproved).toBe(false)
    expect(early.can.submit).toBe(false)
    expect(early.can.edit).toBe(true)
    expect(early.issues.map((i) => i.field)).toContain('competition')
    const tooSoon = await call<{ error: { code: string } }>('POST', `/contracts/${id}/submit`)
    expect(tooSoon.data.error.code).toBe('CONTRACT_QC_NOT_APPROVED')

    await approveAll(contrapiso.id)
    expect((await comps()).find((x) => x.id === contrapiso.id)!.status).toBe('approved')
    // Já existe: nada a gerar
    expect((await call<CompetitionDetailDTO>('GET', `/competitions/${contrapiso.id}`)).data.can.createContract).toBe(false)

    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    expect(c.status).toBe('draft')
    expect(c.qcApproved).toBe(true)
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
    // O envio do QC já gerou uma solicitação por empresa escolhida
    const active = async () => (await call<ContractListItemDTO[]>('GET', `/contracts?competitionId=${contrapiso.id}`)).data.filter((x) => x.status !== 'cancelled')
    expect((await active()).map((x) => x.status)).toEqual(['draft', 'draft'])
    await approveAll(contrapiso.id)
    expect((await detail()).can.createContract).toBe(false)

    const made = (await Promise.all((await active()).map(async (x) => (await call<ContractRequestDTO>('GET', `/contracts/${x.id}`)).data)))
      .sort((x, y) => x.code.localeCompare(y.code))
    expect(made.every((c) => c.revision.id === rev.revisionId)).toBe(true)
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
    const row = (await call<ContractListItemDTO[]>('GET', `/contracts?workId=${workId}`)).data.find((x) => x.id === c.id)!
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

  it('aditivo com remanejamento: reduz um item e acrescenta em outro na mesma solicitação, sempre ao preço contratado', async () => {
    const id = await seeded()
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    const item = c.items[0]!
    const other = c.items[1]!
    const ip = item.allocations[0]!.packageCode!
    const ip2 = other.allocations[0]!.packageCode!
    // Um décimo do contratado cabe no vigente mesmo depois do distrato aprovado acima (metade)
    const q = Decimal.from(item.allocations[0]!.quantity).div(10).round(4)
    const created = await call<{ id: string; kind: string }>('POST', `/contracts/${id}/addenda`, {
      reason: 'Remanejamento entre itens',
      items: [
        // O R$ informado é ignorado: item do contrato fica sempre no preço contratado
        { contractItemId: item.id, reduce: true, quantity: q.toDb(), unitPrice: '999', allocations: [{ packageCode: ip, quantity: q.toDb() }] },
        { contractItemId: other.id, quantity: '2', unitPrice: '999', allocations: [{ packageCode: ip2, quantity: '2' }] },
      ],
    })
    expect(created.status, JSON.stringify(created.data)).toBe(201)
    expect(created.data.kind).toBe('addendum')
    const { data: c2 } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    const a = c2.addenda.find((x) => x.id === created.data.id)!
    const reduced = a.items.find((i) => i.contractItemId === item.id)!
    const added = a.items.find((i) => i.contractItemId === other.id)!
    expect([reduced.quantityDelta, reduced.unitPrice]).toEqual([q.neg().toDb(), item.unitPrice])
    expect([added.quantityDelta, added.unitPrice]).toEqual(['2.0000', other.unitPrice])
    expect(reduced.allocations[0]!.quantity).toBe(q.neg().toDb())
    expect(a.totalDelta).toBe(Decimal.from(other.unitPrice).times(2).round(4).minus(q.times(item.unitPrice).round(4)).toDb())
    const sub = await call('POST', `/addenda/${created.data.id}/submit`)
    expect(sub.status, JSON.stringify(sub.data)).toBe(200)
    expect((await call('POST', `/addenda/${created.data.id}/decide`, { decision: 'rejected', comment: 'Refazer.' }, MGR)).status).toBe(200)
  })

  it('aditivo não inclui insumo novo; mudar o R$ unitário duplica a linha e zera a original (histórico)', async () => {
    const id = await seeded()
    const novo = await call('POST', `/contracts/${id}/addenda`, {
      reason: 'Serviço complementar de drenagem',
      items: [{ code: 'IS99999', description: 'Drenagem provisória', unit: 'm', quantity: '120', unitPrice: '35.5', allocations: [] }],
    })
    expect(novo.status).toBeGreaterThanOrEqual(400)

    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    const item = c.items[1]!
    const approvedDelta = Decimal.sum(c.addenda.filter((x) => x.status === 'approved').flatMap((x) => x.items.filter((i) => i.contractItemId === item.id).map((i) => i.quantityDelta)))
    const vigente = Decimal.from(item.quantity).plus(approvedDelta)
    const ips = item.allocations.map((al) => ({ packageCode: al.packageCode!, quantity: al.quantity }))
    const saldo = vigente.minus(1)
    const newPrice = Decimal.from(item.unitPrice).plus('7.5').toDb()
    const zero = { contractItemId: item.id, reduce: true, quantity: vigente.toDb(), allocations: ips }
    const dup = { sourceItemId: item.id, quantity: saldo.toDb(), unitPrice: newPrice, allocations: [] as { packageCode: string; quantity: string }[] }

    // Sem zerar a original: recusa
    const noZero = await call<{ error: { code: string } }>('POST', `/contracts/${id}/addenda`, { reason: 'Novo preço negociado', items: [dup] })
    expect(noZero.data.error.code).toBe('ADDENDUM_DUPLICATE_ORIGINAL')
    // Mesmo unitário: recusa
    const same = await call<{ error: { code: string } }>('POST', `/contracts/${id}/addenda`, { reason: 'Novo preço negociado', items: [zero, { ...dup, unitPrice: item.unitPrice }] })
    expect(same.data.error.code).toBe('ADDENDUM_SAME_PRICE')

    const created = await call<{ id: string; number: number }>('POST', `/contracts/${id}/addenda`, { reason: 'Novo preço negociado', newEndOn: '2027-04-30', items: [zero, dup] })
    expect(created.status, JSON.stringify(created.data)).toBe(201)
    expect(created.data.number).toBe(3)
    const { data: c2 } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    const a = c2.addenda.find((x) => x.id === created.data.id)!
    const original = a.items.find((i) => i.contractItemId === item.id)!
    const copy = a.items.find((i) => !i.contractItemId)!
    // A original fica com saldo zero e o unitário original; a duplicada leva o saldo (editável) com o novo unitário
    expect([original.quantityDelta, original.unitPrice]).toEqual([vigente.neg().toDb(), item.unitPrice])
    expect([copy.code, copy.description, copy.unit, copy.quantityDelta, copy.unitPrice]).toEqual([item.code, item.description, item.unit, saldo.toDb(), newPrice])
    // Vínculo continua obrigatório na linha duplicada
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

describe('vínculos de planejamento na solicitação', () => {
  it('o Planejamento edita os vínculos do contrato concluído; a soma fecha com a quantidade; sem permissão → 403', async () => {
    const id = await seeded()
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${id}`, undefined, PLAN)
    expect(c.status).toBe('submitted')
    expect(c.can.planning).toBe(true)
    expect(c.can.edit).toBe(false)
    const item = c.items[0]!
    const half = Decimal.from(item.quantity).div(2).round(4)
    const rest = Decimal.from(item.quantity).minus(half)
    const url = `/contracts/${id}/items/${item.id}/allocations`

    const wrong = await call<{ error: { code: string } }>('PUT', url, { allocations: [{ packageCode: 'IP00104', quantity: half.toDb() }] }, PLAN)
    expect(wrong.data.error.code).toBe('ALLOCATION_SUM')
    expect((await call('PUT', url, { allocations: [{ packageCode: 'IP00104', quantity: item.quantity }] }, ENG)).status).toBe(403)

    const ok = await call('PUT', url, { allocations: [{ packageCode: 'IP00104', quantity: half.toDb() }, { packageCode: 'IP00999', quantity: rest.toDb() }] }, PLAN)
    expect(ok.status, JSON.stringify(ok.data)).toBe(200)
    const { data: after } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    const allocs = after.items.find((i) => i.id === item.id)!.allocations
    expect(allocs.map((a) => [a.packageCode, a.quantity]).sort()).toEqual([['IP00104', half.toDb()], ['IP00999', rest.toDb()]].sort())
    // As referências do item não mudam
    expect(after.items.find((i) => i.id === item.id)!.references).toEqual(item.references)
    // volta ao vínculo original
    await call('PUT', url, { allocations: item.allocations.map((a) => ({ packageCode: a.packageCode, quantity: a.quantity })) }, PLAN)
  })

  it('o rascunho acompanha o mapa ao reenviar o QC e mantém os vínculos editados de itens que não mudaram', async () => {
    // Pavimentação: em rascunho na semente; preenche o necessário, gera a solicitação antes de enviar
    const pav = (await comps()).find((c) => c.title.startsWith('Pavimentação'))!
    const { data: d } = await call<CompetitionDetailDTO>('GET', `/competitions/${pav.id}`)
    const rid = d.revision.id
    const winner = d.suppliers.find((s) => !s.isPlaceholder)!
    const types = (await call<{ id: string; code: string }[]>('GET', '/contract-types')).data
    const head = await call('PATCH', `/revisions/${rid}`, {
      winnerSupplierId: winner.supplierId, winnerJustification: 'Melhor preço.', contractTypeId: types[0]!.id,
      serviceStartOn: '2027-01-04', serviceEndOn: '2027-03-31',
    })
    expect(head.status, JSON.stringify(head.data)).toBe(200)
    expect((await call<CompetitionDetailDTO>('GET', `/competitions/${pav.id}`)).data.can.createContract).toBe(true)
    const created = await call<{ id: string }>('POST', '/contracts', { competitionId: pav.id })
    expect(created.status, JSON.stringify(created.data)).toBe(201)
    const id = created.data.id
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    expect(c.revision.id).toBe(rid)
    expect(c.can.sync).toBe(true)
    const [keep, change] = c.items
    // vínculo editado à mão no item que não muda
    const put = await call('PUT', `/contracts/${id}/items/${keep!.id}/allocations`, { allocations: [{ packageCode: 'IP00777', quantity: keep!.quantity }] })
    expect(put.status, JSON.stringify(put.data)).toBe(200)
    // muda a quantidade de outro item no mapa e atualiza pelo mapa
    const qcItem = d.items.find((i) => i.id === change!.competitionItemId)!
    expect((await call('PATCH', `/revisions/${rid}/items/${qcItem.id}`, { quantity: Decimal.from(qcItem.quantity).plus(1).toDb() })).status).toBe(200)
    const sync = await call<{ updated: number }>('POST', `/contracts/${id}/sync`)
    expect(sync.data.updated).toBe(1)
    const { data: after } = await call<ContractRequestDTO>('GET', `/contracts/${id}`)
    const k = after.items.find((i) => i.competitionItemId === keep!.competitionItemId)!
    const ch = after.items.find((i) => i.competitionItemId === change!.competitionItemId)!
    expect(k.allocations.map((a) => a.packageCode)).toEqual(['IP00777'])
    expect(ch.quantity).toBe(Decimal.from(change!.quantity).plus(1).toDb())
    expect(after.totalAmount).toBe(Decimal.sum(after.items.map((i) => i.totalPrice)).toDb())
  })
})

describe('solicitação acompanha o mapa e aponta o item do orçamento', () => {
  it('insumo criado no mapa depois da solicitação entra sozinho; cada linha aponta o Item da EAP e a composição', async () => {
    const pav = (await comps()).find((c) => c.title.startsWith('Pavimentação'))!
    const { data: d } = await call<CompetitionDetailDTO>('GET', `/competitions/${pav.id}`)
    const rid = d.revision.id
    const draft = (await call<ContractListItemDTO[]>('GET', `/contracts?competitionId=${pav.id}`)).data.find((x) => x.status === 'draft')!
    expect(draft).toBeTruthy()
    const winner = d.suppliers.find((s) => s.supplierId === d.revision.winnerSupplierId)!

    // Insumo criado no mapa, com preço da vencedora: entra na solicitação sem "Atualizar pelo mapa"
    const add = await call<{ id: string }>('POST', `/revisions/${rid}/items`, { code: 'IS77777', description: 'Item criado no mapa', unit: 'm', quantity: '10', referenceIds: [], planningCode: 'IP00105', planningDescription: 'Pavimentação' })
    expect(add.status, JSON.stringify(add.data)).toBe(201)
    expect((await call('PUT', `/revisions/${rid}/prices`, { prices: [{ competitionSupplierId: winner.id, itemId: add.data.id, unitPrice: '12' }] })).status).toBe(200)
    const { data: c } = await call<ContractRequestDTO>('GET', `/contracts/${draft.id}`)
    const manual = c.items.find((i) => i.code === 'IS77777')!
    expect(manual).toBeTruthy()
    expect(manual.totalPrice).toBe('120.0000')
    expect(c.totalAmount).toBe(Decimal.sum(c.items.map((i) => i.totalPrice)).toDb())
    // Sem referência do orçamento: fora do orçamento
    expect(manual.budgetItems).toEqual([])
    // Os insumos que vêm do orçamento apontam Item da EAP e composição
    const fromBudget = c.items.filter((i) => i.references.length)
    expect(fromBudget.length).toBeGreaterThan(0)
    for (const i of fromBudget) {
      expect(i.budgetItems!.length).toBeGreaterThan(0)
      for (const b of i.budgetItems!) expect(b.activityWbs.startsWith(b.itemWbs)).toBe(true)
    }
    // Removido do mapa, sai da solicitação
    expect((await call('DELETE', `/revisions/${rid}/items/${add.data.id}`)).status).toBe(200)
    expect((await call<ContractRequestDTO>('GET', `/contracts/${draft.id}`)).data.items.some((i) => i.code === 'IS77777')).toBe(false)
  })
})
