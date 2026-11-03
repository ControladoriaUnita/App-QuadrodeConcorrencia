/**
 * Simulado (administrador): concorrências em todos os estágios do app, a partir do orçamento da obra.
 *
 *   cotação (convite, propostas) → aprovação parada em cada alçada → reprovada → aprovada →
 *   solicitações (cotação escolhida, enviada, assinada, cancelada) → aditivo (aguardando, aprovado) →
 *   distrato → contratado com nova revisão
 *
 * Cada cenário passa pelos mesmos casos de uso das telas (o resultado é o que um usuário faria à mão).
 * As alçadas são decididas pelo administrador com os papéis de cada etapa: por isso a rota usa os
 * repositórios sem as regras de acesso por linha, depois de conferir que é o administrador global.
 * Os cenários rodam um por chamada (limite de tempo da função na Vercel); antes, `resetSimulation`
 * apaga as concorrências e contratos da obra (a obra e o orçamento ficam).
 */
import type { SimulationScenarioDTO } from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import { formatBRL } from '../../../shared/format'
import { buildQcMap } from '../../../shared/domain/competition/qc-map'
import { DomainError } from '../../../shared/domain/competition/revision'
import { currentAllocations, suggestAllocations } from '../../../shared/domain/contract/addendum'
import { lineBalances } from '../../../shared/domain/planning/links'
import { AppError, notFound, requireGlobalAdmin, type RequestContext } from '../context'
import type { Repositories } from '../ports'
import * as addenda from './addenda'
import * as qc from './competitions'
import * as contracts from './contracts'
import { purgeWorkData } from './works'

/** Insumos por concorrência do simulado (mapa enxuto: cada cenário cabe numa chamada) */
const LINES_PER_QC = 8
/** Margem sobre a alçada: as propostas saem até ~10% abaixo do orçado */
const TIER_MARGIN = '1.2'

type Stage =
  | 'invite'
  | 'quoting'
  | 'approval'
  | 'rejected'
  | 'approved'
  | 'split-contracts'
  | 'contract-submitted'
  | 'contract-signed'
  | 'addendum-pending'
  | 'addendum-approved'
  | 'termination'
  | 'contract-cancelled'
  | 'new-revision'

interface Scenario extends SimulationScenarioDTO {
  stage: Stage
  /** Aprovação parada nesta etapa (stage 'approval') */
  stepOrder?: number
}

const FIXED: { key: string; stage: Stage; label: string }[] = [
  { key: 'convite', stage: 'invite', label: 'Em cotação — fornecedores convidados, aguardando propostas' },
  { key: 'propostas', stage: 'quoting', label: 'Em cotação — propostas lançadas e cotação escolhida em andamento' },
  { key: 'reprovado', stage: 'rejected', label: 'Reprovado na 2ª alçada (pede nova revisão)' },
  { key: 'aprovado', stage: 'approved', label: 'Aprovado — pronto para gerar a solicitação de contrato' },
  { key: 'cotacao-escolhida', stage: 'split-contracts', label: 'Aprovado com cotação escolhida — uma solicitação por empresa (rascunho)' },
  { key: 'contrato-enviado', stage: 'contract-submitted', label: 'Solicitação enviada a Contratos' },
  { key: 'contrato-assinado', stage: 'contract-signed', label: 'Contrato assinado' },
  { key: 'aditivo-aguardando', stage: 'addendum-pending', label: 'Aditivo aguardando a Gerência/Diretoria' },
  { key: 'aditivo-aprovado', stage: 'addendum-approved', label: 'Aditivo aprovado (novo total do contrato)' },
  { key: 'distrato', stage: 'termination', label: 'Distrato aprovado' },
  { key: 'contrato-cancelado', stage: 'contract-cancelled', label: 'Solicitação cancelada (QC volta a aprovado)' },
  { key: 'nova-revisao', stage: 'new-revision', label: 'Contratado com nova revisão em rascunho' },
]

/** Cenários na ordem do fluxo: um "em aprovação" para cada alçada ativa */
async function scenarios(repos: Repositories): Promise<Scenario[]> {
  const steps = (await repos.approvals.listSteps()).filter((s) => s.active)
  const approval = steps.map<Scenario>((s) => ({
    key: `aprovacao-${s.stepOrder}`,
    stage: 'approval',
    stepOrder: s.stepOrder,
    label: `Em aprovação — aguardando ${s.name}${s.minAmount ? ` (acima de ${formatBRL(s.minAmount)})` : ''}`,
  }))
  const [invite, quoting, ...rest] = FIXED
  return [invite!, quoting!, ...approval, ...rest]
}

export async function listSimulation(repos: Repositories, ctx: RequestContext, workId: string): Promise<SimulationScenarioDTO[]> {
  requireGlobalAdmin(ctx)
  if (!(await repos.catalog.getWork(workId))) throw notFound('Obra')
  return (await scenarios(repos)).map(({ key, label }) => ({ key, label }))
}

/** Antes do simulado: apaga as concorrências, contratos e anexos da obra (obra e orçamento ficam). */
export async function resetSimulation(repos: Repositories, ctx: RequestContext, workId: string, confirmCode: string) {
  requireGlobalAdmin(ctx)
  const work = await repos.catalog.getWork(workId)
  if (!work) throw notFound('Obra')
  if (confirmCode.trim() !== work.code) throw new AppError('CONFIRM_CODE', `Digite o número da obra (${work.code}) para confirmar.`, 422)
  if (!work.currentBudgetId) throw new AppError('BUDGET_MISSING', 'A obra não possui orçamento vigente.', 409)
  return purgeWorkData(repos, ctx, workId, { keepWork: true })
}

// ----------------------------------------------------------------------------- execução
interface Sim {
  repos: Repositories
  ctx: RequestContext
  workId: string
  budgetId: string
  today: string
  addDays: (n: number) => string
  suppliers: string[]
  contractTypeId: string
}

/** Administrador com os papéis de todas as alçadas (decide cada etapa do simulado) */
async function simulationContext(repos: Repositories, ctx: RequestContext): Promise<RequestContext> {
  const steps = await repos.approvals.listSteps()
  const roles = steps.map((s) => ({ roleId: s.roleId, roleKey: 'simulado', roleName: s.name, workId: null }))
  const permissions = ['competition.create', 'competition.edit', 'competition.submit', 'proposal.edit', 'approval.decide', 'contract.manage', 'contract.read', 'competition.read']
  return {
    ...ctx,
    actor: {
      ...ctx.actor,
      roles: [...ctx.actor.roles, ...roles],
      permissions: [...ctx.actor.permissions, ...permissions.map((key) => ({ key, workId: null }))],
    },
  }
}

export async function runScenario(repos: Repositories, ctx: RequestContext, workId: string, key: string) {
  requireGlobalAdmin(ctx)
  const scenario = (await scenarios(repos)).find((s) => s.key === key)
  if (!scenario) throw notFound('Cenário do simulado')
  const work = await repos.catalog.getWork(workId)
  if (!work) throw notFound('Obra')
  if (!work.currentBudgetId) throw new AppError('BUDGET_MISSING', 'A obra não possui orçamento vigente.', 409)

  const today = ctx.now().toISOString().slice(0, 10)
  // Fornecedores com CND válida (ou sem CND informada); "Sem Fornecedor" fica de fora
  const suppliers = (await repos.catalog.listSuppliers())
    .filter((s) => !s.isPlaceholder && (!s.cndValidUntil || s.cndValidUntil >= today))
    .sort((a, b) => (a.tradeName || a.legalName).localeCompare(b.tradeName || b.legalName))
    .slice(0, 3)
  if (suppliers.length < 2) throw new DomainError('SIM_SUPPLIERS', 'O simulado precisa de ao menos 2 fornecedores com CND válida no cadastro.')
  const types = await repos.catalog.listContractTypes()
  const type = types.find((t) => !t.directBilling) ?? types[0]
  if (!type) throw new DomainError('SIM_CONTRACT_TYPE', 'Cadastre ao menos um tipo de contrato.')

  const sim: Sim = {
    repos,
    ctx: await simulationContext(repos, ctx),
    workId,
    budgetId: work.currentBudgetId,
    today,
    addDays: (n) => new Date(ctx.now().getTime() + n * 86_400_000).toISOString().slice(0, 10),
    suppliers: suppliers.map((s) => s.id),
    contractTypeId: type.id,
  }
  const n = (await scenarios(repos)).findIndex((s) => s.key === key) + 1
  const title = `Simulado ${String(n).padStart(2, '0')} — ${scenario.label}`.slice(0, 200)
  const created = await build(sim, scenario, title)
  const detail = (await repos.competitions.getData(created.competitionId))!
  return { key, competitionId: created.competitionId, code: detail.competition.code, title, contracts: created.contracts ?? 0 }
}

async function build(sim: Sim, s: Scenario, title: string): Promise<{ competitionId: string; contracts?: number }> {
  const { repos, ctx } = sim
  const steps = (await repos.approvals.listSteps()).filter((x) => x.active).sort((a, b) => a.stepOrder - b.stepOrder)
  // Alçada mínima para a etapa parada (a de Diretoria só entra acima do valor dela)
  const minAmount = s.stage === 'approval' ? steps.find((x) => x.stepOrder === s.stepOrder)?.minAmount ?? null : null
  const { competitionId, revisionId } = await createQc(sim, title, minAmount)
  if (s.stage === 'invite') {
    for (const id of sim.suppliers) await qc.addSupplier(repos, ctx, revisionId, id)
    return { competitionId }
  }
  const css = await quote(sim, competitionId, revisionId)

  if (s.stage === 'quoting') {
    // Cabeçalho em andamento e cotação escolhida em metade dos insumos (duas empresas)
    await qc.updateRevision(repos, ctx, revisionId, { serviceStartOn: sim.addDays(20), engineeringOwnerName: 'Eng. responsável (simulado)', procurementOwnerName: ctx.actor.fullName })
    await chooseSplit(sim, competitionId, revisionId, css, 0.5)
    return { competitionId }
  }

  if (s.stage === 'split-contracts') await chooseSplit(sim, competitionId, revisionId, css, 1)
  await fillHeader(sim, competitionId, revisionId, s.stage !== 'split-contracts')
  await qc.submitRevision(repos, ctx, revisionId)

  const plan = (await repos.competitions.getData(competitionId, revisionId))!.approvals.map((a) => a.stepOrder).sort((a, b) => a - b)
  const decide = (stepOrder: number, decision: 'approved' | 'rejected', comment: string) =>
    qc.decideApproval(repos, ctx, revisionId, { stepOrder, decision, comment })

  if (s.stage === 'approval') {
    for (const step of plan.filter((x) => x < s.stepOrder!)) await decide(step, 'approved', 'Simulado: de acordo.')
    return { competitionId }
  }
  if (s.stage === 'rejected') {
    await decide(plan[0]!, 'approved', 'Simulado: de acordo.')
    await decide(plan[1] ?? plan[0]!, 'rejected', 'Simulado: rever o escopo e negociar o preço do insumo principal.')
    return { competitionId }
  }
  for (const step of plan) await decide(step, 'approved', 'Simulado: de acordo.')
  if (s.stage === 'approved') return { competitionId }

  const { created } = await contracts.createContractRequest(repos, ctx, competitionId)
  if (s.stage === 'split-contracts') return { competitionId, contracts: created.length }

  const contractId = created[0]!.id
  await contracts.updateContractRequest(repos, ctx, contractId, {
    measurementCriteria: 'Simulado: medição mensal pelo executado, conferida pela engenharia da obra até o dia 25.',
    scopeDefinitions: 'Simulado: fornecimento e execução conforme projeto e memorial descritivo.',
  })
  await contracts.submitContractRequest(repos, ctx, contractId)
  if (s.stage === 'contract-submitted') return { competitionId, contracts: 1 }
  if (s.stage === 'contract-cancelled') {
    await contracts.cancelContractRequest(repos, ctx, contractId, 'Simulado: fornecedor desistiu antes da assinatura.')
    return { competitionId, contracts: 1 }
  }
  if (s.stage === 'new-revision') {
    await qc.createRevision(repos, ctx, competitionId, 'Simulado: inclusão de serviço complementar (vai por aditivo).')
    return { competitionId, contracts: 1 }
  }

  await contracts.signContract(repos, ctx, contractId, { signedOn: sim.today, erpContractId: `SIM-${Date.now().toString().slice(-6)}` })
  if (s.stage === 'contract-signed') return { competitionId, contracts: 1 }

  const kind = s.stage === 'termination' ? 'termination' : 'addendum'
  const addendumId = await createAddendum(sim, contractId, kind)
  await addenda.submitAddendum(repos, ctx, addendumId)
  if (s.stage !== 'addendum-pending') {
    await addenda.decideAddendum(repos, ctx, addendumId, { decision: 'approved', comment: 'Simulado: de acordo.' })
  }
  return { competitionId, contracts: 1 }
}

/** Concorrência com até LINES_PER_QC linhas livres de um IP ainda sem QC (ou, numa alçada, as maiores até passar dela) */
async function createQc(sim: Sim, title: string, minAmount: Decimal | null) {
  const { repos } = sim
  const [lines, commitments, comps] = await Promise.all([
    repos.catalog.listBudgetLines(sim.budgetId),
    repos.competitions.workCommitments(sim.workId),
    repos.competitions.list({ workId: sim.workId }),
  ])
  const balance = lineBalances(lines, commitments.links)
  const free = lines
    .filter((l) => l.packageCode && Decimal.from(l.total).isPositive() && (balance.get(l.lineKey)?.balanceShare.isPositive() ?? true))
    .map((l) => ({ l, value: Decimal.from(l.total).times(balance.get(l.lineKey)?.balanceShare ?? 1) }))
    .sort((a, b) => b.value.compare(a.value))

  let picked: typeof free
  if (minAmount) {
    const target = minAmount.times(TIER_MARGIN)
    picked = []
    let sum = Decimal.ZERO
    for (const f of free) {
      if (sum.gte(target) || picked.length >= LINES_PER_QC * 3) break
      picked.push(f)
      sum = sum.plus(f.value)
    }
    if (sum.lt(target)) {
      throw new DomainError('SIM_TIER', `O saldo livre do orçamento (${formatBRL(sum)}) não alcança esta alçada (${formatBRL(minAmount)}).`)
    }
  } else {
    const used = new Set(comps.map((c) => c.packageCode))
    const byPackage = new Map<string, typeof free>()
    for (const f of free) byPackage.set(f.l.packageCode!, [...(byPackage.get(f.l.packageCode!) ?? []), f])
    const pkg = [...byPackage.keys()].sort().find((p) => !used.has(p)) ?? [...byPackage.keys()].sort()[0]
    if (!pkg) throw new DomainError('SIM_NO_BALANCE', 'O orçamento não tem mais linhas com saldo livre para outro QC do simulado.')
    picked = byPackage.get(pkg)!.slice(0, LINES_PER_QC)
  }
  return qc.createCompetition(repos, sim.ctx, {
    workId: sim.workId,
    title,
    description: `Gerado pelo simulado em ${sim.today} por ${sim.ctx.actor.fullName}.`,
    packageCodes: [...new Set(picked.map((f) => f.l.packageCode!))],
    lineIds: picked.map((f) => f.l.id),
    requestedOn: sim.addDays(-10),
  })
}

/** Convida os fornecedores e lança as propostas: orçado × fator do fornecedor ± variação por insumo */
async function quote(sim: Sim, competitionId: string, revisionId: string) {
  const { repos, ctx } = sim
  const css: string[] = []
  for (const id of sim.suppliers) css.push((await qc.addSupplier(repos, ctx, revisionId, id)).id)
  const map = buildQcMap((await repos.competitions.getData(competitionId, revisionId))!)
  const factors = ['0.93', '0.98', '1.04']
  const prices = map.items.flatMap((item, ii) =>
    css.map((csId, si) => {
      const unit = item.quantity.isPositive() ? item.budgetTotal.div(item.quantity, 4) : Decimal.ZERO
      const wobble = Decimal.from((((ii + 1) * (si + 3) * 37) % 9) - 4).div(100, 4) // −4% … +4%
      return { competitionSupplierId: csId, itemId: item.id, unitPrice: unit.isPositive() ? unit.times(Decimal.from(factors[si]!).plus(wobble)).round(2).toFixed(2) : '1.00' }
    }),
  )
  await qc.upsertPrices(repos, ctx, revisionId, { prices })
  for (const [i, csId] of css.entries()) {
    await qc.updateSupplier(repos, ctx, revisionId, csId, {
      status: 'responded',
      proposalReceivedOn: sim.addDays(-3),
      deliveryTerms: ['30 dias após mobilização', '45 dias', '35 dias'][i] ?? '30 dias',
      paymentTerms: ['30/60 dias, medição mensal', '28 dias após medição', 'Medição quinzenal'][i] ?? '30 dias',
      readjustmentTerms: ['INCC anual', 'Fixo e irreajustável', 'IPCA anual'][i] ?? 'INCC anual',
    })
  }
  return css
}

/** Cotação escolhida: em cada insumo, a mais barata entre as duas melhores empresas (garantindo as duas) */
async function chooseSplit(sim: Sim, competitionId: string, revisionId: string, css: string[], fraction: number) {
  const { repos, ctx } = sim
  const map = buildQcMap((await repos.competitions.getData(competitionId, revisionId))!)
  const [a, b] = map.summaries.filter((x) => x.rank !== null).sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99)).map((x) => x.competitionSupplierId)
  const pair = [a ?? css[0]!, b ?? css[1]!]
  const items = map.items.filter((i) => i.quantity.isPositive())
  const count = Math.max(2, Math.ceil(items.length * fraction))
  for (const [k, item] of items.slice(0, count).entries()) {
    const price = (cs: string) => map.prices.find((p) => p.itemId === item.id && p.competitionSupplierId === cs)?.unitPrice ?? null
    const [pa, pb] = [price(pair[0]!), price(pair[1]!)]
    // Os dois primeiros alternam para a divisão ter sempre as duas empresas
    const pick = k < 2 ? pair[k]! : pa && pb ? (pa.lt(pb) ? pair[0]! : pair[1]!) : pa ? pair[0]! : pair[1]!
    await qc.updateItem(repos, ctx, revisionId, item.id, { chosenSupplierId: pick })
  }
}

async function fillHeader(sim: Sim, competitionId: string, revisionId: string, withWinner: boolean) {
  const { repos, ctx } = sim
  const map = buildQcMap((await repos.competitions.getData(competitionId, revisionId))!)
  const winner = map.lowestComplete ? map.suppliers.find((s) => s.id === map.lowestComplete!.competitionSupplierId) : null
  if (withWinner && !winner) throw new DomainError('SIM_WINNER', 'Nenhum fornecedor cotou todos os insumos.')
  await qc.updateRevision(repos, ctx, revisionId, {
    serviceStartOn: sim.addDays(20),
    serviceEndOn: sim.addDays(140),
    engineeringOwnerName: 'Eng. responsável (simulado)',
    procurementOwnerName: ctx.actor.fullName,
    contractTypeId: sim.contractTypeId,
    winnerSupplierId: withWinner ? winner!.supplierId : null,
    winnerJustification: withWinner
      ? 'Simulado: menor preço global entre as propostas completas e prazo compatível com o cronograma.'
      : 'Simulado: cada insumo com a empresa de melhor preço entre as duas mais bem colocadas.',
  })
}

/** Aditivo de +10% ou distrato de −20% no primeiro item do contrato, pelos IPs dele */
async function createAddendum(sim: Sim, contractId: string, kind: 'addendum' | 'termination') {
  const { repos, ctx } = sim
  const contract = (await repos.contracts.get(contractId))!
  const item = contract.items.find((i) => i.allocations.some((a) => a.packageCode)) ?? contract.items[0]!
  const qty = Decimal.from(item.quantity).times(kind === 'addendum' ? '0.1' : '0.2').round(4)
  const current = currentAllocations(
    { id: item.id, quantity: Decimal.from(item.quantity), totalPrice: Decimal.from(item.totalPrice), allocations: item.allocations.map((a) => ({ packageCode: a.packageCode, quantity: Decimal.from(a.quantity) })) },
    [],
  )
  const { id } = await addenda.createAddendum(repos, ctx, contractId, {
    kind,
    reason: kind === 'addendum' ? 'Simulado: acréscimo de quantidade apontado pela engenharia da obra.' : 'Simulado: redução de escopo do item.',
    requestedOn: sim.today,
    newEndOn: kind === 'addendum' ? sim.addDays(170) : null,
    items: [{ contractItemId: item.id, quantity: qty.toDb(), allocations: suggestAllocations(current, qty).map((a) => ({ packageCode: a.packageCode, quantity: a.quantity.toDb() })) }],
  })
  return id
}
