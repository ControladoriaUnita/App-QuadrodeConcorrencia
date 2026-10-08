/**
 * Teste de integração dos repositórios Supabase contra um PostgREST real.
 * Executado apenas com SUPABASE_IT=1 (ex.: `supabase start` local ou PostgREST + Postgres).
 *
 *   SUPABASE_URL=http://localhost:54321 SUPABASE_JWT_SECRET=... npm run test:integration
 *
 * Pré-requisito: usuários de supabase/tests/002_integration_users.sql.
 */
import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import type { RequestContext } from '../../application/context'
import * as qc from '../../application/use-cases/competitions'
import { syncFromErp } from '../../application/use-cases/erp-sync'
import * as works from '../../application/use-cases/works'
import { parseBudgetSheet, type Cell } from '../../../shared/domain/budget/excel-import'
import { MockERPProvider } from '../erp/mock-erp-provider'
import { createServiceClient, createUserClient } from './client'
import { createSupabaseRepositories } from './supabase-repositories'

const RUN = process.env.SUPABASE_IT === '1'
const SECRET = process.env.SUPABASE_JWT_SECRET ?? ''

const USERS = {
  admin: '10000000-0000-4000-8000-000000000001',
  procurement: '10000000-0000-4000-8000-000000000002',
  engineering: '10000000-0000-4000-8000-000000000003',
  manager: '10000000-0000-4000-8000-000000000004',
}

function jwt(payload: Record<string, unknown>) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = enc({ alg: 'HS256', typ: 'JWT' })
  const body = enc({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload })
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

async function session(userId: string, origin: RequestContext['origin'] = 'ui') {
  const correlationId = `it-${globalThis.crypto.randomUUID().slice(0, 8)}`
  const token = jwt({ sub: userId, role: 'authenticated' })
  const repos = createSupabaseRepositories(createUserClient(token, { correlationId, origin }), createServiceClient({ correlationId, origin, actorId: userId }))
  const actor = await repos.identity.loadActor(userId)
  if (!actor) throw new Error(`Usuário ${userId} sem perfil`)
  const ctx: RequestContext = { correlationId, origin, actor, now: () => new Date() }
  return { repos, ctx }
}

describe.runIf(RUN)('Supabase repositories (integração)', () => {
  beforeAll(() => {
    process.env.SUPABASE_ANON_KEY ??= jwt({ role: 'anon' })
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= jwt({ role: 'service_role' })
  })

  let competitionId = ''
  let revisionId = ''

  it('sincroniza ERP mock (service_role) e registra integration_logs', async () => {
    const { repos, ctx } = await session(USERS.admin, 'erp_sync')
    const r = await syncFromErp(repos, new MockERPProvider(), ctx, { scope: 'all' })
    expect(r.steps.filter((s) => s.status === 'error')).toEqual([])
    const logs = await repos.integrationLogs.list(20)
    expect(logs.some((l) => l.correlationId === ctx.correlationId && l.status === 'success')).toBe(true)
  })

  it('suprimentos cria QC a partir do pacote do orçamento', async () => {
    const { repos, ctx } = await session(USERS.procurement)
    const works = await repos.catalog.listWorks()
    const work = works.find((w) => w.code === '2041')!
    expect(work.currentBudgetId).toBeTruthy()
    const packages = await repos.catalog.listPackages(work.currentBudgetId!)
    expect(packages.find((p) => p.packageCode === 'IP00105')).toBeTruthy()

    const ids = await qc.createCompetition(repos, ctx, { workId: work.id, title: 'Pavimentação (IT)', packageCodes: ['IP00105'] })
    competitionId = ids.competitionId
    revisionId = ids.revisionId
    const suppliers = await repos.catalog.listSuppliers()
    for (const s of suppliers.slice(0, 3)) await qc.addSupplier(repos, ctx, revisionId, s.id)

    const data = (await repos.competitions.getData(competitionId))!
    expect(data.items.length).toBeGreaterThan(5)
    expect(data.items[0]!.budgetQuantity).toMatch(/^\d+\.\d{4}$/) // numeric como texto

    await qc.upsertPrices(repos, ctx, revisionId, {
      prices: data.items.flatMap((i, ii) =>
        data.suppliers.map((s, si) => ({ competitionSupplierId: s.id, itemId: i.id, unitPrice: (Number(i.budgetUnitCost) * (0.95 + 0.03 * si + 0.001 * ii)).toFixed(2) })),
      ),
    })
    const list = await repos.competitions.list({})
    const row = list.find((c) => c.id === competitionId)!
    expect(row.bestMixTotal).toMatch(/^\d+\.\d{4}$/)
    expect(row.suppliersCount).toBe(3)

    await qc.updateRevision(repos, ctx, revisionId, {
      serviceStartOn: '2026-11-03', serviceEndOn: '2027-02-26', engineeringOwnerId: USERS.engineering, procurementOwnerId: USERS.procurement,
      contractTypeId: data.contractTypes[0]!.id, winnerSupplierId: data.suppliers[0]!.supplierId, winnerJustification: 'Menor preço.',
    })
    await qc.submitRevision(repos, ctx, revisionId)
  })

  it('fluxo de aprovação com RLS por papel e congelamento', async () => {
    const mgr = await session(USERS.manager)
    await expect(qc.decideApproval(mgr.repos, mgr.ctx, revisionId, { stepOrder: 1, decision: 'approved' })).rejects.toThrow()

    for (const [user, step] of [[USERS.procurement, 1], [USERS.engineering, 2], [USERS.manager, 3]] as const) {
      const s = await session(user)
      await qc.decideApproval(s.repos, s.ctx, revisionId, { stepOrder: step, decision: 'approved', comment: 'ok' })
    }
    const s = await session(USERS.procurement)
    const data = (await s.repos.competitions.getData(competitionId))!
    expect(data.revision.status).toBe('approved')
    expect(data.revision.snapshotHash).toMatch(/^[0-9a-f]{64}$/)

    // trigger do banco bloqueia alteração direta mesmo ignorando o domínio
    await expect(s.repos.competitions.updateItem(data.items[0]!.id, { quantity: '1' })).rejects.toThrow(/QC_REVISION_FROZEN/)

    const { revisionId: rev1 } = await qc.createRevision(s.repos, s.ctx, competitionId, 'Ajuste de quantidades')
    const d1 = (await s.repos.competitions.getData(competitionId, rev1))!
    expect(d1.revision.number).toBe(1)
    expect(d1.prices.length).toBe(data.prices.length)
  })

  it('vínculos de planejamento e consumo do orçamento da obra', async () => {
    const s = await session(USERS.procurement)
    const detail = await qc.getCompetition(s.repos, s.ctx, competitionId)
    expect(detail.links.length).toBeGreaterThanOrEqual(detail.items.length)
    expect(detail.budgetLines.some((i) => i.packageCode === 'IP00105')).toBe(true)
    expect(detail.links.every((l) => l.activityItemId && l.lineKey)).toBe(true)
    const ov = await works.getWorkOverview(s.repos, s.ctx, detail.competition.workId)
    const c = ov.competitions.find((x) => x.id === competitionId)!
    expect(c.category).toBe('contracted')
    expect(Number(c.committedTotal)).toBeGreaterThan(0)
    const linked = ov.links.filter((l) => l.competitionId === competitionId).reduce((a, l) => a + Number(l.amount), 0)
    expect(linked).toBeCloseTo(Number(c.committedTotal), 2)

    // rev01 (rascunho) aceita reescrever vínculos; rev00 congelada não
    const rev1 = detail.revision.id
    const item = detail.items[0]!
    const link = detail.links.find((l) => l.itemId === item.id)!
    await qc.setItemLinks(s.repos, s.ctx, rev1, item.id, { links: [{ activityItemId: link.activityItemId!, quantity: item.quantity }] })
    await expect(s.repos.competitions.setItemLinks(revisionId, (await s.repos.competitions.getData(competitionId, revisionId))!.items[0]!.id, [])).rejects.toThrow(/QC_REVISION_FROZEN/)
  })

  it('orçamento linha a linha: QC com linhas de outro IP e sincronização preserva linhas vinculadas', async () => {
    const s = await session(USERS.procurement)
    const detail = await qc.getCompetition(s.repos, s.ctx, competitionId)
    const lines = await works.listBudgetLinesUsage(s.repos, s.ctx, detail.competition.workId, { packages: ['IP00157'] })
    expect(lines.length).toBeGreaterThan(2)
    const r = await qc.addLines(s.repos, s.ctx, detail.revision.id, lines.slice(0, 2).map((l) => l.id))
    expect(r.createdItems + r.mergedItems).toBeGreaterThan(0)
    // % da linha: 50% puxa metade da verba e grava budget_share/budget_value
    const d2 = await qc.getCompetition(s.repos, s.ctx, competitionId)
    const lk = d2.links.find((l) => l.lineKey === lines[0]!.lineKey)!
    await qc.setItemLinks(s.repos, s.ctx, d2.revision.id, lk.itemId, { links: [{ activityItemId: lk.activityItemId!, share: '0.5' }] })
    // (a rev01 é rascunho; o consumo da obra segue a rev00 aprovada, então conferimos no próprio QC)
    const half = (await qc.getCompetition(s.repos, s.ctx, competitionId)).links.find((l) => l.lineKey === lines[0]!.lineKey)!
    expect(half.share).toBe('0.500000')
    expect(Number(half.budgetValue)).toBeCloseTo(Number(lines[0]!.total) / 2, 3)
    expect(Number(half.quantity)).toBeCloseTo(Number(lines[0]!.quantity) / 2, 3)
    const used = await works.listBudgetLinesUsage(s.repos, s.ctx, detail.competition.workId, { packages: ['IP00105'] })
    expect(used.some((l) => l.usage.length > 0)).toBe(true)

    // nova sincronização do ERP (mesma versão) não pode apagar linhas vinculadas
    const a = await session(USERS.admin, 'erp_sync')
    const sync = await syncFromErp(a.repos, new MockERPProvider(), a.ctx, { scope: 'budget' })
    expect(sync.steps.filter((x) => x.status === 'error')).toEqual([])
    const again = await qc.getCompetition(s.repos, s.ctx, competitionId)
    const ids = again.links.map((l) => l.activityItemId!)
    expect((await s.repos.catalog.getBudgetLines(ids)).length).toBe(ids.length)
  })

  it.runIf(process.env.QC_XLSX)('importa a planilha real como nova versão do orçamento', async () => {
    const { readSheet } = await import('read-excel-file/node')
    const parsed = parseBudgetSheet((await readSheet(process.env.QC_XLSX!, 'Orçamento')) as Cell[][])
    const s = await session(USERS.admin)
    const work = (await s.repos.catalog.listWorks()).find((w) => w.code === '2055')!
    const t0 = Date.now()
    const r = await works.importBudget(s.repos, s.ctx, work.id, { fileName: 'QC.xlsx', sheetName: 'Orçamento', ...parsed })
    console.log('import real', r, `${Date.now() - t0}ms`)
    expect(r.lines).toBe(parsed.lines.length)
    const after = (await s.repos.catalog.getWork(work.id))!
    expect(after.currentBudget?.source).toBe('excel')
    expect(after.currentBudgetTotal).toBe(parsed.total)
  }, 120_000)

  it('auditoria grava usuário, campo, valores, revisão, origem e correlationId', async () => {
    const s = await session(USERS.admin)
    const logs = await qc.listAudit(s.repos, s.ctx, competitionId)
    const status = logs.find((l) => l.entity === 'competition_revisions' && l.field === 'status' && l.newValue === 'approved')
    expect(status?.userName).toBeTruthy()
    expect(status?.revisionId).toBe(revisionId)
    expect(status?.origin).toBe('ui')
    expect(status?.correlationId).toMatch(/^it-/)
  })
})
