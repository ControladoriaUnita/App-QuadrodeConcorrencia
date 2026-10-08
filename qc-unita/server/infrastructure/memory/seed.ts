/**
 * Semente do modo memória: dados de referência (espelho de 008_seed_reference_data.sql),
 * usuários de demonstração, sincronização com o MockERPProvider e três QCs de exemplo
 * percorrendo o fluxo real dos casos de uso (rascunho, em aprovação, aprovado).
 */
import { Decimal } from '../../../shared/domain/decimal'
import type { RequestContext } from '../../application/context'
import * as contracts from '../../application/use-cases/contracts'
import * as qc from '../../application/use-cases/competitions'
import { syncFromErp } from '../../application/use-cases/erp-sync'
import { MockERPProvider } from '../erp/mock-erp-provider'
import { type MemoryDb, uid } from './memory-db'
import { createMemoryRepositories } from './memory-repositories'

export const DEMO_USERS = [
  { id: '00000000-0000-4000-8000-000000000001', fullName: 'Lucas · Controladoria', email: 'lucas@unitaengenharia.com.br', roles: ['admin'] },
  { id: '00000000-0000-4000-8000-000000000002', fullName: 'Adriano Carvalho', email: 'suprimentos@unita.example', roles: ['procurement'] },
  { id: '00000000-0000-4000-8000-000000000003', fullName: 'Marina Costa', email: 'engenharia@unita.example', roles: ['engineering'] },
  { id: '00000000-0000-4000-8000-000000000004', fullName: 'Roberto Lima', email: 'gerente@unita.example', roles: ['manager'] },
  { id: '00000000-0000-4000-8000-000000000005', fullName: 'Helena Duarte', email: 'diretoria@unita.example', roles: ['director'] },
] as const

const ROLES = [
  ['admin', 'Administrador'],
  ['procurement', 'Suprimentos'],
  ['engineering', 'Engenharia'],
  ['manager', 'Gerente / Coordenador de Obra'],
  ['director', 'Diretoria'],
  ['viewer', 'Visualizador'],
] as const

const ALL_PERMS = [
  'work.read', 'work.manage', 'budget.read', 'catalog.manage', 'supplier.read', 'supplier.manage', 'competition.read',
  'competition.create', 'competition.edit', 'proposal.edit', 'competition.submit', 'approval.decide', 'contract.read',
  'contract.manage', 'attachment.upload', 'audit.read', 'integration.read', 'integration.run', 'budget.import',
]

const MATRIX: Record<string, string[]> = {
  admin: ALL_PERMS,
  procurement: ['work.read', 'budget.read', 'budget.import', 'supplier.read', 'supplier.manage', 'competition.read', 'competition.create', 'competition.edit', 'proposal.edit', 'competition.submit', 'approval.decide', 'contract.read', 'contract.manage', 'attachment.upload', 'audit.read'],
  engineering: ['work.read', 'budget.read', 'budget.import', 'supplier.read', 'competition.read', 'competition.edit', 'approval.decide', 'contract.read', 'attachment.upload'],
  manager: ['work.read', 'budget.read', 'supplier.read', 'competition.read', 'approval.decide', 'contract.read', 'audit.read'],
  director: ['work.read', 'budget.read', 'supplier.read', 'competition.read', 'approval.decide', 'contract.read', 'audit.read'],
  viewer: ['work.read', 'budget.read', 'competition.read'],
}

const CONTRACT_TYPES: [string, string][] = [
  ['CTD01', 'Prestação de Serviços Engenharia PJ'],
  ['CTD02', 'Empreitada Global Com Fornec. de Material - Sem Fat. Direto'],
  ['CTD04', 'Empreitada Global Com Fornec. de Material - Com Fat. Direto'],
  ['CTD05', 'Empreitada Global Sem Fornec. de Material'],
  ['CTD06', 'Locação, Manutenção e Operação de Equipamentos'],
  ['CTD08', 'Empreitada de MDO Preço Unitário'],
  ['CTD10', 'Empreitada Preço Unitário Com Fornec. de Material - Com Fat. Direto'],
]

let seeding: Promise<void> | null = null

export function ensureSeeded(db: MemoryDb): Promise<void> {
  if (db.seeded) return Promise.resolve()
  return (seeding ??= seed(db).then(() => {
    db.seeded = true
  }))
}

async function seed(db: MemoryDb) {
  const now = new Date().toISOString()
  const roleIds: Record<string, string> = {}
  for (const [key, name] of ROLES) {
    const id = uid()
    roleIds[key] = id
    db.put('roles', { id, key, name })
  }
  const permIds: Record<string, string> = {}
  for (const key of ALL_PERMS) {
    permIds[key] = uid()
    db.put('permissions', { id: permIds[key]!, key })
  }
  for (const [role, perms] of Object.entries(MATRIX)) {
    for (const p of perms) db.put('role_permissions', { id: uid(), roleId: roleIds[role], permissionId: permIds[p] })
  }
  for (const u of DEMO_USERS) {
    db.put('profiles', { id: u.id, fullName: u.fullName, email: u.email, active: true, createdAt: now })
    for (const r of u.roles) db.put('user_roles', { id: uid(), userId: u.id, roleId: roleIds[r], workId: null })
  }
  ;[
    [1, 'Suprimentos', 'procurement', null],
    [2, 'Engenharia', 'engineering', null],
    [3, 'Gerente / Coordenador de Obra', 'manager', null],
    [4, 'Diretoria', 'director', '500000'],
  ].forEach(([order, name, role, min]) =>
    db.put('approval_steps', { id: uid(), stepOrder: order, name, roleId: roleIds[role as string], minAmount: min, active: true }),
  )
  for (const [code, name] of CONTRACT_TYPES) db.put('contract_types', { id: uid(), code, name, directBilling: code === 'CTD04' || code === 'CTD10' })

  // ------------------------------------------------------------------ ERP mock
  const ctxFor = (userId: string, origin: RequestContext['origin'] = 'system'): { ctx: RequestContext; repos: ReturnType<typeof createMemoryRepositories> } => {
    const correlationId = `seed-${uid().slice(0, 8)}`
    const repos = createMemoryRepositories(db, { actorId: userId, origin, correlationId })
    return { repos, ctx: { correlationId, origin, now: () => new Date(), actor: null as never } }
  }
  const load = async (userId: string, origin: RequestContext['origin'] = 'ui') => {
    const { repos, ctx } = ctxFor(userId, origin)
    ctx.actor = (await repos.identity.loadActor(userId))!
    return { repos, ctx }
  }

  {
    const { repos, ctx } = await load(DEMO_USERS[0].id, 'erp_sync')
    await syncFromErp(repos, new MockERPProvider(), ctx, { scope: 'all' })
  }

  const [admin, procurement, engineering, manager, director] = DEMO_USERS
  const s = await load(procurement.id)
  const works = await s.repos.catalog.listWorks()
  const alpha = works.find((w) => w.code === '2041')!
  const suppliers = await s.repos.catalog.listSuppliers()
  const sup = (trade: string) => suppliers.find((x) => x.tradeName === trade)!
  const ct = (code: string) => db.find('contract_types', (c) => c.code === code)[0]!.id

  /** Preço determinístico: custo orçado × fator do fornecedor × variação por item */
  const quote = (unitCost: string, factor: string, seed: number) => {
    const wobble = Decimal.from(((seed * 37) % 11) - 5).div(100, 4) // −5% … +5%
    return Decimal.from(unitCost).times(Decimal.from(factor).plus(wobble)).round(2).toFixed(2)
  }

  async function build(opts: { title: string; pkgs: string[]; codes?: string[]; suppliers: [string, string][]; skip?: [number, number][] }) {
    const { competitionId, revisionId } = await qc.createCompetition(s.repos, s.ctx, {
      workId: alpha.id, title: opts.title, packageCodes: opts.pkgs, materialCodes: opts.codes, requestedOn: '2026-09-28',
    })
    const ids: string[] = []
    for (const [trade] of opts.suppliers) ids.push((await qc.addSupplier(s.repos, s.ctx, revisionId, sup(trade).id)).id)
    const data = (await s.repos.competitions.getData(competitionId, revisionId))!
    const prices = data.items.flatMap((item, ii) =>
      ids.map((csId, si) => ({
        competitionSupplierId: csId,
        itemId: item.id,
        unitPrice: opts.skip?.some(([a, b]) => a === ii && b === si) ? null : quote(item.budgetUnitCost, opts.suppliers[si]![1], ii + si * 3),
      })),
    )
    await qc.upsertPrices(s.repos, s.ctx, revisionId, { prices })
    const terms = [
      ['30 dias após mobilização', '30/60 dias, medição mensal', 'INCC anual'],
      ['45 dias', '28 dias após medição', 'Fixo e irreajustável'],
      ['35 dias', 'Medição quinzenal', 'INCC após 12 meses'],
      ['40 dias', '30 dias', 'IPCA anual'],
    ]
    for (const [i, csId] of ids.entries()) {
      const [deliveryTerms, paymentTerms, readjustmentTerms] = terms[i % terms.length]!
      await qc.updateSupplier(s.repos, s.ctx, revisionId, csId, { status: 'responded', deliveryTerms, paymentTerms, readjustmentTerms, proposalReceivedOn: '2026-10-01' })
    }
    return { competitionId, revisionId, ids }
  }

  const fillHeader = async (competitionId: string, revisionId: string, winnerTrade: string, contract: string) => {
    await qc.updateRevision(s.repos, s.ctx, revisionId, {
      serviceStartOn: '2026-11-03', serviceEndOn: '2027-02-26', engineeringOwnerId: engineering.id, procurementOwnerId: procurement.id,
      contractTypeId: ct(contract), winnerSupplierId: sup(winnerTrade).id,
      winnerJustification: 'Menor preço global entre as propostas completas, prazo compatível com o cronograma e CND válida.',
    })
    return competitionId
  }

  // 1) Rascunho com propostas — principal exemplo do mapa
  await build({
    title: 'Pavimentação externa e passeio',
    pkgs: ['IP00105'],
    suppliers: [['Pavimenta', '0.94'], ['Horizonte', '1.02'], ['Terra Forte', '0.98'], ['Mineira Obras', '1.06']],
    skip: [[2, 3], [5, 1]],
  })

  // 2) Em aprovação (Suprimentos já aprovou)
  {
    const { competitionId, revisionId } = await build({
      title: 'Contrapiso — torres e áreas comuns',
      pkgs: ['IP00141'],
      suppliers: [['Mineira Obras', '0.97'], ['Horizonte', '1.01'], ['Pavimenta', '1.04']],
    })
    await fillHeader(competitionId, revisionId, 'Mineira Obras', 'CTD08')
    await qc.submitRevision(s.repos, s.ctx, revisionId)
    await qc.decideApproval(s.repos, s.ctx, revisionId, { stepOrder: 1, decision: 'approved', comment: 'Equalização conferida.' })
  }

  // 4) Um QC com vários IPs de planejamento: materiais de impermeabilização, soleiras e fachada,
  //    selecionados linha a linha no orçamento (linhas já comprometidas em outros QCs ficam de fora)
  await build({
    title: 'Materiais básicos — cimento, areia e argamassas',
    pkgs: ['IP00138', 'IP00144', 'IP00149'],
    codes: ['IM00012', 'IM00013', 'IM00017', 'IM04525', 'IM00021'],
    suppliers: [['Mineira Obras', '0.96'], ['Horizonte', '1.03'], ['Pavimenta', '0.99']],
  })

  // 3) Aprovado (rev00 congelada) e rev01 em rascunho
  {
    const { competitionId, revisionId } = await build({
      title: 'Terraplenagem e bota-fora',
      pkgs: ['IP00104'],
      suppliers: [['Terra Forte', '0.93'], ['Horizonte', '1.00'], ['Mineira Obras', '0.99']],
    })
    await fillHeader(competitionId, revisionId, 'Terra Forte', 'CTD05')
    await qc.submitRevision(s.repos, s.ctx, revisionId)
    for (const [user, step] of [[procurement, 1], [engineering, 2], [manager, 3]] as const) {
      const a = await load(user.id)
      await qc.decideApproval(a.repos, a.ctx, revisionId, { stepOrder: step, decision: 'approved', comment: 'De acordo.' })
    }
    // Solicitação de contrato da rev00 aprovada (enviada) + 1º aditivo aguardando a Gerência
    const { id: contractId } = await contracts.createContractRequest(s.repos, s.ctx, competitionId)
    await contracts.updateContractRequest(s.repos, s.ctx, contractId, {
      projects: [
        { sheet: 'TER-01', fileName: 'Planta de terraplenagem — cortes e aterros.pdf', revision: 'R02' },
        { sheet: 'TER-02', fileName: 'Seções transversais.pdf', revision: 'R01' },
      ],
      measurementCriteria: 'Medição mensal por volume executado (m³ geométrico), conferida por topografia da obra até o dia 25.',
      scopeDefinitions: 'Corte, carga, transporte e espalhamento conforme projeto; bota-fora em área licenciada pela contratada.',
    })
    await contracts.submitContractRequest(s.repos, s.ctx, contractId)
    const contract = (await s.repos.contracts.get(contractId))!
    const first = contract.items[0]!
    await contracts.createAddendum(s.repos, s.ctx, contractId, {
      reason: 'Volume adicional de bota-fora apontado pela engenharia após sondagem complementar.',
      requestedOn: '2026-10-02',
      newEndOn: '2027-03-31',
      items: [{ contractItemId: first.id, quantityDelta: Decimal.from(first.quantity).times('0.1').round(4).toDb() }],
    })
    const addendum = (await s.repos.contracts.get(contractId))!.addenda[0]!
    await contracts.submitAddendum(s.repos, s.ctx, addendum.id)

    await qc.createRevision(s.repos, s.ctx, competitionId, 'Inclusão de volume adicional de bota-fora apontado pela engenharia.')
  }

  void admin
  void director
}
