/**
 * Teste de integração da API em modo memória (mesmo router das Vercel Functions).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { BudgetLineUsageDTO, CompetitionDetailDTO, CompetitionListItemDTO } from '../../shared/contracts'
import { parseBudgetSheet } from '../../shared/domain/budget/excel-import'
import { buildQcMap } from '../../shared/domain/competition/qc-map'
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

let list: CompetitionListItemDTO[]

beforeAll(async () => {
  process.env.DATA_SOURCE = 'memory'
  list = (await call<CompetitionListItemDTO[]>('GET', '/competitions')).data
})

describe('API modo memória', () => {
  it('semente cria 4 QCs em estados diferentes', () => {
    expect(list).toHaveLength(4)
    const byTitle = Object.fromEntries(list.map((c) => [c.title, c]))
    expect(byTitle['Pavimentação externa e passeio']!.revisionStatus).toBe('draft')
    expect(byTitle['Contrapiso — torres e áreas comuns']!.revisionStatus).toBe('in_approval')
    expect(byTitle['Terraplenagem e bota-fora']!.revisionNumber).toBe(1)
  })

  it('detalhe calcula melhor condição coerente com a persistida', async () => {
    const draft = list.find((c) => c.title.startsWith('Pavimentação'))!
    const { data } = await call<CompetitionDetailDTO>('GET', `/competitions/${draft.id}`)
    expect(data.items.length).toBeGreaterThan(5)
    expect(data.suppliers).toHaveLength(4)
    const map = buildQcMap(data)
    expect(map.mixTotal.toDb()).toBe(draft.bestMixTotal)
    expect(data.can.editPrices).toBe(true)
  })

  it('valida entrada com Zod', async () => {
    const draft = list.find((c) => c.title.startsWith('Pavimentação'))!
    const { data: d } = await call<CompetitionDetailDTO>('GET', `/competitions/${draft.id}`)
    const r = await call('PUT', `/revisions/${d.revision.id}/prices`, { prices: [{ competitionSupplierId: 'x', itemId: 'y', unitPrice: '1,5' }] })
    expect(r.status).toBe(422)
  })

  it('lançar preço recalcula a melhor condição', async () => {
    const draft = list.find((c) => c.title.startsWith('Pavimentação'))!
    const { data: d } = await call<CompetitionDetailDTO>('GET', `/competitions/${draft.id}`)
    const item = d.items[0]!
    const lastSupplier = d.suppliers[3]!
    const r = await call<{ bestMixTotal: string }>('PUT', `/revisions/${d.revision.id}/prices`, {
      prices: [{ competitionSupplierId: lastSupplier.id, itemId: item.id, unitPrice: '0.01' }],
    })
    expect(r.status).toBe(200)
    const { data: after } = await call<CompetitionDetailDTO>('GET', `/competitions/${draft.id}`)
    expect(buildQcMap(after).bestByItem.get(item.id)!.competitionSupplierId).toBe(lastSupplier.id)
  })

  it('envio com pendências retorna 422 com a lista', async () => {
    const draft = list.find((c) => c.title.startsWith('Pavimentação'))!
    const { data: d } = await call<CompetitionDetailDTO>('GET', `/competitions/${draft.id}`)
    const r = await call<{ error: { code: string; details: { field: string }[] } }>('POST', `/revisions/${d.revision.id}/submit`)
    expect(r.status).toBe(422)
    expect(r.data.error.details.map((x) => x.field)).toContain('winnerSupplierId')
  })

  it('aprovação respeita ordem e papel; conclusão congela a revisão', async () => {
    const comp = list.find((c) => c.revisionStatus === 'in_approval')!
    const { data: d } = await call<CompetitionDetailDTO>('GET', `/competitions/${comp.id}`)
    const rid = d.revision.id
    expect((await call('POST', `/revisions/${rid}/approvals`, { stepOrder: 3, decision: 'approved' }, MGR)).status).toBe(409)
    expect((await call('POST', `/revisions/${rid}/approvals`, { stepOrder: 2, decision: 'approved' }, MGR)).status).toBe(403)
    expect((await call('POST', `/revisions/${rid}/approvals`, { stepOrder: 2, decision: 'approved' }, ENG)).status).toBe(200)
    const done = await call<{ outcome: string }>('POST', `/revisions/${rid}/approvals`, { stepOrder: 3, decision: 'approved' }, MGR)
    expect(done.data.outcome).toBe('approved')

    const { data: frozen } = await call<CompetitionDetailDTO>('GET', `/competitions/${comp.id}`)
    expect(frozen.revision.status).toBe('approved')
    expect(frozen.revision.snapshotHash).toMatch(/^[0-9a-f]{64}$/)
    expect(frozen.can.edit).toBe(false)

    const edit = await call<{ error: { code: string } }>('PATCH', `/revisions/${rid}/items/${frozen.items[0]!.id}`, { quantity: '1' })
    expect(edit.status).toBe(409)
    expect(edit.data.error.code).toBe('REVISION_NOT_EDITABLE')
  })

  it('auditoria registra quem, o quê, valores e revisão', async () => {
    const comp = list.find((c) => c.title.startsWith('Pavimentação'))!
    const { data } = await call<{ field: string; oldValue: unknown; newValue: unknown; userName: string; revisionId: string; correlationId: string }[]>('GET', `/competitions/${comp.id}/audit`)
    const priceChange = data.find((l) => l.field === 'unitPrice' && l.newValue === '0.01')
    expect(priceChange).toBeTruthy()
    expect(priceChange!.userName).toBe('Adriano Carvalho')
    expect(priceChange!.revisionId).toBeTruthy()
    expect(priceChange!.correlationId).toBeTruthy()
  })

  it('sincronização ERP gera logs de integração e não altera QC aprovado', async () => {
    const terra = list.find((c) => c.title.startsWith('Terraplenagem'))!
    const before = await call<CompetitionDetailDTO>('GET', `/competitions/${terra.id}?revisionId=${(await call<CompetitionDetailDTO>('GET', `/competitions/${terra.id}`)).data.revisions[0]!.id}`)
    const sync = await call<{ steps: { status: string }[]; correlationId: string }>('POST', '/integration/erp-sync', { scope: 'all' }, ADMIN)
    expect(sync.status).toBe(200)
    expect(sync.data.steps.every((s) => s.status === 'success')).toBe(true)
    const logs = await call<{ correlationId: string }[]>('GET', '/integration/logs', undefined, ADMIN)
    expect(logs.data.some((l) => l.correlationId === sync.data.correlationId)).toBe(true)
    const after = await call<CompetitionDetailDTO>('GET', `/competitions/${terra.id}?revisionId=${before.data.revision.id}`)
    expect(after.data.items).toEqual(before.data.items)
    expect(after.data.revision.snapshotHash).toBe(before.data.revision.snapshotHash)
  })

  it('sem permissão de integração → 403', async () => {
    expect((await call('POST', '/integration/erp-sync', { scope: 'works' }, ENG)).status).toBe(403)
  })
})

describe('obra e vínculos de planejamento', () => {
  it('lista obras com resumo de consumo e visão por tipo de serviço', async () => {
    const works = await call<{ id: string; code: string; summary: { budgetTotal: string; contracted: string; competitions: number } }[]>('GET', '/works')
    const alpha = works.data.find((w) => w.code === '2041')!
    expect(alpha.summary.competitions).toBe(4)
    expect(Number(alpha.summary.contracted)).toBeGreaterThan(0)
    const ov = await call<{ packages: unknown[]; competitions: { category: string }[]; links: unknown[] }>('GET', `/works/${alpha.id}/overview`)
    expect(ov.status).toBe(200)
    expect(ov.data.packages.length).toBeGreaterThan(3)
    expect(ov.data.competitions.map((c) => c.category).sort()).toContain('contracted')
    expect(ov.data.links.length).toBeGreaterThan(0)
  })

  it('QC com vários IPs, linha a linha, consolidando outros QCs', async () => {
    const mats = (await call<CompetitionListItemDTO[]>('GET', '/competitions')).data.find((c) => c.title.startsWith('Materiais'))!
    expect(mats.packageCode).toBe('IP00138')
    const { data: d } = await call<CompetitionDetailDTO>('GET', `/competitions/${mats.id}`)
    expect(new Set(d.links.map((l) => l.packageCode)).size).toBeGreaterThan(1)
    expect(d.links.some((l) => l.packageCode === 'IP00105')).toBe(false)
    expect(d.links.every((l) => l.activityItemId && l.lineKey)).toBe(true)
    expect(buildQcMap(d).issues.some((i) => i.field === 'links')).toBe(false)
    expect(d.otherCommitments.length).toBeGreaterThan(0)
    // orçado do QC acompanha os vínculos selecionados
    const linkedBudget = d.items.reduce((a, i) => a + Number(i.budgetQuantity) * Number(i.budgetUnitCost), 0)
    expect(Number(d.revision.budgetAmount)).toBeCloseTo(linkedBudget, 0)
    expect(Number(d.revision.budgetAmount)).toBeLessThan(112000)
  })

  it('compromete % da linha (verba puxada) e acusa diferença de quantidade no envio', async () => {
    const all = (await call<CompetitionListItemDTO[]>('GET', '/competitions')).data
    const terra = all.find((c) => c.title.startsWith('Terraplenagem'))!
    const { data: d } = await call<CompetitionDetailDTO>('GET', `/competitions/${terra.id}`)
    expect(d.links.length).toBeGreaterThanOrEqual(d.items.length)
    expect(d.budgetLines.length).toBeGreaterThan(3)
    const item = d.items.find((i) => d.links.filter((l) => l.itemId === i.id).length === 1)!
    const link = d.links.find((l) => l.itemId === item.id)!
    const line = d.budgetLines.find((l) => l.id === link.activityItemId)!
    expect(link.share).toBe('1.000000')
    expect(link.budgetValue).toBe(Number(line.total).toFixed(4))

    // 40% da linha: verba e quantidade proporcionais; quantidade do item acompanha
    const r = await call('PUT', `/revisions/${d.revision.id}/items/${item.id}/links`, {
      links: [{ activityItemId: link.activityItemId, share: '0.4' }],
    })
    expect(r.status).toBe(200)
    const { data: after } = await call<CompetitionDetailDTO>('GET', `/competitions/${terra.id}`)
    const l2 = after.links.find((l) => l.itemId === item.id)!
    expect(l2.share).toBe('0.400000')
    expect(Number(l2.budgetValue)).toBeCloseTo(Number(line.total) * 0.4, 3)
    expect(Number(l2.quantity)).toBeCloseTo(Number(line.quantity) * 0.4, 3)
    expect(after.items.find((i) => i.id === item.id)!.quantity).toBe(l2.quantity)
    expect(buildQcMap(after).issues.map((i) => i.message).join()).not.toMatch(/quantidade vinculada diferente/)

    // Quantidade do item alterada à mão → divergência acusada
    await call('PATCH', `/revisions/${d.revision.id}/items/${item.id}`, { quantity: '1' })
    const { data: diverged } = await call<CompetitionDetailDTO>('GET', `/competitions/${terra.id}`)
    expect(buildQcMap(diverged).issues.map((i) => i.message).join()).toMatch(/quantidade vinculada diferente/)

    const bad = await call('PUT', `/revisions/${d.revision.id}/items/${item.id}/links`, {
      links: [{ activityItemId: '00000000-0000-4000-8000-00000000abcd', quantity: '1' }],
    })
    expect(bad.status).toBe(422)
    const over = await call('PUT', `/revisions/${d.revision.id}/items/${item.id}/links`, {
      links: [{ activityItemId: link.activityItemId, share: '1.5' }],
    })
    expect(over.status).toBe(422)
  })

  it('lista o orçamento linha a linha com o comprometido e inclui linhas de outro IP no QC', async () => {
    const works = (await call<{ id: string; code: string }[]>('GET', '/works')).data
    const alpha = works.find((w) => w.code === '2041')!
    const lines = (await call<BudgetLineUsageDTO[]>('GET', `/works/${alpha.id}/budget-lines`)).data
    expect(lines.length).toBeGreaterThan(100)
    const pav = lines.filter((l) => l.packageCode === 'IP00105')
    expect(pav.every((l) => l.usage.length === 1 && l.usage[0]!.competitionCode === 'QC-0001')).toBe(true)
    expect(pav.every((l) => Number(l.balanceQuantity) === 0)).toBe(true)

    // inclui no QC de materiais linhas livres de outro IP (pintura interna)
    const mats = (await call<CompetitionListItemDTO[]>('GET', '/competitions')).data.find((c) => c.title.startsWith('Materiais'))!
    const { data: before } = await call<CompetitionDetailDTO>('GET', `/competitions/${mats.id}`)
    const free = lines.filter((l) => l.packageCode === 'IP00157').slice(0, 3)
    const r = await call<{ createdItems: number; mergedItems: number }>('POST', `/revisions/${before.revision.id}/lines`, { lineIds: free.map((l) => l.id) })
    expect(r.status).toBe(200)
    const { data: after } = await call<CompetitionDetailDTO>('GET', `/competitions/${mats.id}`)
    expect(after.links.length).toBe(before.links.length + 3)
    expect(after.links.some((l) => l.packageCode === 'IP00157')).toBe(true)
    expect(Number(after.revision.budgetAmount)).toBeGreaterThan(Number(before.revision.budgetAmount))
    // repetir as mesmas linhas → conflito
    expect((await call('POST', `/revisions/${before.revision.id}/lines`, { lineIds: free.map((l) => l.id) })).status).toBe(409)
    // remover um item criado
    const newItem = after.items.find((i) => !before.items.some((b) => b.id === i.id))!
    expect((await call('DELETE', `/revisions/${before.revision.id}/items/${newItem.id}`)).status).toBe(200)
  })

  it('inclui linha com % escolhido e respeita o saldo livre entre QCs', async () => {
    const works = (await call<{ id: string; code: string }[]>('GET', '/works')).data
    const alpha = works.find((w) => w.code === '2041')!
    const lines = (await call<BudgetLineUsageDTO[]>('GET', `/works/${alpha.id}/budget-lines`)).data
    const target = lines.find((l) => l.packageCode === 'IP00157' && l.usage.length === 0 && Number(l.total) > 0)!
    const all = (await call<CompetitionListItemDTO[]>('GET', '/competitions')).data
    const mats = all.find((c) => c.title.startsWith('Materiais'))!
    const terra = all.find((c) => c.title.startsWith('Terraplenagem'))!
    const { data: m } = await call<CompetitionDetailDTO>('GET', `/competitions/${mats.id}`)
    const { data: t } = await call<CompetitionDetailDTO>('GET', `/competitions/${terra.id}`)

    // 30% da linha neste QC
    expect((await call('POST', `/revisions/${m.revision.id}/lines`, { lineIds: [target.id], shares: { [target.id]: '0.3' } })).status).toBe(200)
    const after = (await call<BudgetLineUsageDTO[]>('GET', `/works/${alpha.id}/budget-lines`)).data.find((l) => l.id === target.id)!
    expect(after.committedShare).toBe('0.300000')
    expect(after.balanceShare).toBe('0.700000')
    expect(Number(after.committedValue)).toBeCloseTo(Number(target.total) * 0.3, 3)

    // outro QC não pode puxar mais que os 70% livres
    const over = await call('POST', `/revisions/${t.revision.id}/lines`, { lineIds: [target.id], shares: { [target.id]: '0.8' } })
    expect(over.status).toBe(422)
    // sem % informado, entra com o saldo livre
    expect((await call('POST', `/revisions/${t.revision.id}/lines`, { lineIds: [target.id] })).status).toBe(200)
    const { data: t2 } = await call<CompetitionDetailDTO>('GET', `/competitions/${terra.id}`)
    expect(t2.links.find((l) => l.lineKey === target.lineKey)!.share).toBe('0.700000')
  })

  it('importa orçamento do Excel como nova versão vigente sem afetar os QCs', async () => {
    const works = (await call<{ id: string; code: string; currentBudget: { version: number } }[]>('GET', '/works')).data
    const vila = works.find((w) => w.code === '2055')!
    const parsed = parseBudgetSheet([
      ['X', 'Item', 'Serviço', 'Código', 'Descrição', 'Unid', 'Quantidade', 'Custo Unit.', 'Custo Total', 'Vínculo PL', 'Classificação'],
      ['01', '01', 'Fundações', 'Item', 'Fundações'],
      ['01.01', '01.01', 'ESTACA', 'CPU9', 'ESTACA', 'm', 100, 50, 5000],
      [null, '01.01', 'ESTACA', 'IS9001', 'Perfuração de estaca', 'm', 100, 50, 5000, 'IP00900', 'Fundações profundas'],
    ])
    const body = { fileName: 'orcamento.xlsx', sheetName: 'Orçamento', ...parsed }
    expect((await call('POST', `/works/${vila.id}/budget-import`, body, ENG)).status).toBe(201)
    expect((await call('POST', `/works/${vila.id}/budget-import`, body, MGR)).status).toBe(403)
    const after = (await call<{ id: string; code: string; currentBudget: { version: number; source: string; total: string } }[]>('GET', '/works')).data.find((w) => w.code === '2055')!
    expect(after.currentBudget.version).toBe(vila.currentBudget.version + 1)
    expect(after.currentBudget.source).toBe('excel')
    expect(after.currentBudget.total).toBe('5000.0000')
    const lines = (await call<BudgetLineUsageDTO[]>('GET', `/works/${vila.id}/budget-lines`)).data
    expect(lines.map((l) => l.lineKey)).toEqual(['01.01|IS9001|IP00900'])
  })
})
