/**
 * Visão da obra: consumo do orçamento geral pelas concorrências, por tipo de serviço
 * (vínculo de planejamento / pacote).
 *
 *  - contratado   = revisões efetivas aprovadas (valor da vencedora)
 *  - em aprovação = revisões enviadas, ainda sem decisão final
 *  - em cotação   = estimativa das revisões em rascunho (vencedora indicada ou melhor condição)
 *  - comprometido = contratado + em aprovação
 *  - O valor de cada QC é distribuído aos vínculos pelos seus links; o que não estiver
 *    vinculado aparece em "Sem vínculo de planejamento".
 */
import type { BudgetPackageDTO, CommitmentCategory, LinkCommitmentDTO, WorkCompetitionDTO, WorkOverviewDTO, WorkSummaryDTO } from '../../contracts'
import { Decimal } from '../decimal'

export const UNLINKED = '__sem_vinculo__'

export interface Amounts {
  contracted: Decimal
  inApproval: Decimal
  quoting: Decimal
}

const zero = (): Amounts => ({ contracted: Decimal.ZERO, inApproval: Decimal.ZERO, quoting: Decimal.ZERO })
const key: Record<CommitmentCategory, keyof Amounts> = { contracted: 'contracted', in_approval: 'inApproval', quoting: 'quoting' }

function add(a: Amounts, cat: CommitmentCategory, v: Decimal) {
  a[key[cat]] = a[key[cat]].plus(v)
}

export interface ConsumptionRatios {
  committed: Decimal
  contractedRatio: Decimal | null
  inApprovalRatio: Decimal | null
  quotingRatio: Decimal | null
  /** (contratado + em aprovação) / orçado */
  committedRatio: Decimal | null
  /** (contratado + em aprovação + em cotação) / orçado */
  projectedRatio: Decimal | null
  balance: Decimal
}

export function ratios(budget: Decimal, a: Amounts): ConsumptionRatios {
  const committed = a.contracted.plus(a.inApproval)
  const projected = committed.plus(a.quoting)
  const r = (v: Decimal) => (budget.isZero() ? null : v.div(budget, 6))
  return {
    committed,
    contractedRatio: r(a.contracted),
    inApprovalRatio: r(a.inApproval),
    quotingRatio: r(a.quoting),
    committedRatio: r(committed),
    projectedRatio: r(projected),
    balance: budget.minus(projected),
  }
}

export interface ServiceGroup extends Amounts, ConsumptionRatios {
  packageCode: string
  description: string
  budget: Decimal
  competitions: WorkCompetitionDTO[]
}

export interface WorkOverview {
  budget: Decimal
  totals: Amounts & ConsumptionRatios
  groups: ServiceGroup[]
  /** Pacotes do orçamento sem nenhuma concorrência */
  uncovered: number
}

export function buildWorkOverview(d: Pick<WorkOverviewDTO, 'budgetTotal' | 'packages' | 'competitions' | 'links'>): WorkOverview {
  const budget = Decimal.from(d.budgetTotal)
  const byPackage = new Map<string, Amounts>()
  const linkedByCompetition = new Map<string, Decimal>()

  for (const l of d.links) {
    const comp = d.competitions.find((c) => c.id === l.competitionId)
    if (!comp) continue
    const pkg = l.packageCode ?? UNLINKED
    const a = byPackage.get(pkg) ?? zero()
    add(a, l.category, Decimal.from(l.amount))
    byPackage.set(pkg, a)
    linkedByCompetition.set(l.competitionId, (linkedByCompetition.get(l.competitionId) ?? Decimal.ZERO).plus(l.amount))
  }

  // Parcela não vinculada de cada QC
  for (const c of d.competitions) {
    const rest = Decimal.from(c.committedTotal).minus(linkedByCompetition.get(c.id) ?? Decimal.ZERO)
    if (!rest.isZero()) {
      const a = byPackage.get(UNLINKED) ?? zero()
      add(a, c.category, rest)
      byPackage.set(UNLINKED, a)
    }
  }

  const known = new Set(d.packages.map((p) => p.packageCode))

  // Tipo de serviço do QC: o pacote informado na criação; senão, o vínculo com maior valor
  const primary = new Map<string, string | null>()
  for (const c of d.competitions) {
    if (c.packageCode && known.has(c.packageCode)) {
      primary.set(c.id, c.packageCode)
      continue
    }
    const byPkg = new Map<string, Decimal>()
    for (const l of d.links.filter((x) => x.competitionId === c.id && !!x.packageCode && known.has(x.packageCode))) {
      byPkg.set(l.packageCode!, (byPkg.get(l.packageCode!) ?? Decimal.ZERO).plus(l.amount))
    }
    const top = [...byPkg.entries()].sort((a, b) => b[1].compare(a[1]))[0]
    primary.set(c.id, top?.[0] ?? null)
  }
  const groups: ServiceGroup[] = d.packages.map((p) => {
    const a = byPackage.get(p.packageCode) ?? zero()
    const b = Decimal.from(p.total)
    return {
      packageCode: p.packageCode,
      description: p.description,
      budget: b,
      ...a,
      ...ratios(b, a),
      competitions: d.competitions.filter((c) => primary.get(c.id) === p.packageCode),
    }
  })

  // QCs sem pacote do orçamento + valores sem vínculo
  const orphanComps = d.competitions.filter((c) => !primary.get(c.id))
  const orphanAmounts = [...byPackage.entries()].filter(([k]) => !known.has(k))
  if (orphanComps.length || orphanAmounts.length) {
    const a = zero()
    for (const [, v] of orphanAmounts) {
      a.contracted = a.contracted.plus(v.contracted)
      a.inApproval = a.inApproval.plus(v.inApproval)
      a.quoting = a.quoting.plus(v.quoting)
    }
    groups.push({ packageCode: UNLINKED, description: 'Sem vínculo de planejamento', budget: Decimal.ZERO, ...a, ...ratios(Decimal.ZERO, a), competitions: orphanComps })
  }

  const totals = zero()
  for (const c of d.competitions) add(totals, c.category, Decimal.from(c.committedTotal))

  return {
    budget,
    totals: { ...totals, ...ratios(budget, totals) },
    groups,
    uncovered: groups.filter((g) => g.packageCode !== UNLINKED && g.competitions.length === 0).length,
  }
}

export function summarizeWork(budgetTotal: string, competitions: WorkCompetitionDTO[]): WorkSummaryDTO {
  const a = zero()
  for (const c of competitions) add(a, c.category, Decimal.from(c.committedTotal))
  return {
    budgetTotal,
    contracted: a.contracted.toDb(),
    inApproval: a.inApproval.toDb(),
    quoting: a.quoting.toDb(),
    competitions: competitions.length,
  }
}

export type { BudgetPackageDTO, LinkCommitmentDTO }
