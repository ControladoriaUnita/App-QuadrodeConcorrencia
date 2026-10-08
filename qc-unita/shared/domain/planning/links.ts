/**
 * Vínculos de planejamento dos itens do QC — linha a linha do orçamento da obra.
 * Cada vínculo aponta para uma linha do orçamento (insumo de uma composição, com seu IP).
 *
 * Regras
 *  - A soma das quantidades vinculadas de um item deve ser igual à quantidade equalizada do item
 *    (planilha: "VÍNCULOS NÃO INDICADOS / ERRO NA QUANTIDADE VINCULADA").
 *  - Preço contratado do item = preço da vencedora indicada (se cotou); senão, a melhor condição.
 *  - Valor contratado do vínculo = preço contratado × quantidade vinculada (4 casas).
 *  - Consolidação: orçado do vínculo/insumo × comprometido em outros QCs × este QC × saldo.
 */
import type { BudgetLineDTO, LinkCommitmentDTO } from '../../contracts'
import { Decimal } from '../decimal'
import { lineTotal } from '../competition/best-condition'
import type { ValidationIssue } from '../competition/revision'
import type { BestCondition, QcItem, QcPrice } from '../competition/types'

export interface PlanningLink {
  id?: string
  itemId: string
  activityItemId?: string | null
  lineKey?: string | null
  materialId: string
  packageCode: string | null
  quantity: Decimal
  budgetUnitCost: Decimal
  /** Percentual da linha comprometido (0..1) */
  share?: Decimal
  /** Verba puxada da linha (custo total × percentual) */
  budgetValue?: Decimal
}

const ONE = Decimal.from(1)

/**
 * Vínculo definido pelo PERCENTUAL da linha que será comprometido ("puxar verba").
 * Verba = Custo Total da linha × %; quantidade = quantidade da linha × %.
 * 100% devolve exatamente o custo total e a quantidade da linha (sem arredondamento).
 */
export function linkFromShare(line: Pick<BudgetLineDTO, 'quantity' | 'total'>, share: Decimal) {
  const s = share.round(6)
  if (s.eq(ONE)) return { share: ONE, quantity: Decimal.from(line.quantity).round(4), budgetValue: Decimal.from(line.total).round(4) }
  return { share: s, quantity: Decimal.from(line.quantity).times(s).round(4), budgetValue: Decimal.from(line.total).times(s).round(4) }
}

/** Vínculo definido pela quantidade (o percentual é derivado). */
export function linkFromQuantity(line: Pick<BudgetLineDTO, 'quantity' | 'total' | 'unitCost'>, quantity: Decimal) {
  const q = Decimal.from(line.quantity)
  if (q.isZero()) return { share: ONE, quantity, budgetValue: quantity.times(line.unitCost).round(4) }
  if (quantity.eq(q)) return { share: ONE, quantity, budgetValue: Decimal.from(line.total) }
  return { share: quantity.div(q, 6), quantity, budgetValue: lineBudgetValue(line, quantity) }
}

/**
 * Valor orçado correspondente a uma quantidade de uma linha do orçamento:
 * proporcional ao Custo Total da linha (vínculo integral = custo total exato).
 */
export function lineBudgetValue(line: Pick<BudgetLineDTO, 'quantity' | 'total' | 'unitCost'>, quantity: Decimal): Decimal {
  const q = Decimal.from(line.quantity)
  if (q.isZero()) return quantity.times(line.unitCost).round(4)
  if (quantity.eq(q)) return Decimal.from(line.total)
  return Decimal.from(line.total).times(quantity).div(q, 4)
}

/** Orçado do item a partir das linhas vinculadas: quantidade somada e unitário médio ponderado. */
export function itemBudgetFromLines(parts: { quantity: Decimal; budget: Decimal }[]) {
  const quantity = Decimal.sum(parts.map((p) => p.quantity)).round(4)
  const budget = Decimal.sum(parts.map((p) => p.budget)).round(4)
  return { quantity, budget, unitCost: quantity.isZero() ? Decimal.ZERO : budget.div(quantity, 4) }
}

const ZERO = Decimal.ZERO
const RATIO = 6

/** Preço contratado por item: vencedora indicada (se cotou o item) ou melhor condição. */
export function awardedUnitPrices(
  items: QcItem[],
  best: BestCondition[],
  prices: QcPrice[],
  winnerCompetitionSupplierId: string | null,
): Map<string, Decimal | null> {
  const bestBy = new Map(best.map((b) => [b.itemId, b]))
  const winnerPrice = new Map(
    prices
      .filter((p) => p.competitionSupplierId === winnerCompetitionSupplierId && p.unitPrice?.isPositive())
      .map((p) => [p.itemId, p.unitPrice as Decimal]),
  )
  return new Map(items.map((i) => [i.id, winnerPrice.get(i.id) ?? bestBy.get(i.id)?.unitPrice ?? null]))
}

/** Valor contratado da revisão = Σ quantidade equalizada × preço contratado. */
export function awardedTotal(items: QcItem[], awarded: Map<string, Decimal | null>): Decimal {
  return Decimal.sum(items.map((i) => {
    const u = awarded.get(i.id)
    return u ? lineTotal(u, i.quantity) : ZERO
  }))
}

export function linkAwardedValue(link: Pick<PlanningLink, 'itemId' | 'quantity'>, awarded: Map<string, Decimal | null>) {
  const unit = awarded.get(link.itemId) ?? null
  return { unit, total: unit ? lineTotal(unit, link.quantity) : null }
}

export interface ItemLinkBalance {
  linked: Decimal
  /** quantidade do item − quantidade vinculada (0 = ok) */
  diff: Decimal
  count: number
}

export function linkBalanceByItem(items: QcItem[], links: PlanningLink[]): Map<string, ItemLinkBalance> {
  const out = new Map<string, ItemLinkBalance>()
  for (const i of items) {
    const own = links.filter((l) => l.itemId === i.id)
    const linked = Decimal.sum(own.map((l) => l.quantity))
    out.set(i.id, { linked, diff: i.quantity.minus(linked), count: own.length })
  }
  return out
}

export function validateLinks(items: QcItem[], links: PlanningLink[]): ValidationIssue[] {
  const balance = linkBalanceByItem(items, links)
  const missing = items.filter((i) => i.quantity.isPositive() && balance.get(i.id)!.count === 0)
  const wrong = items.filter((i) => balance.get(i.id)!.count > 0 && !balance.get(i.id)!.diff.isZero())
  const issues: ValidationIssue[] = []
  if (missing.length) issues.push({ field: 'links', message: `${missing.length} item(ns) sem vínculo de planejamento.` })
  if (wrong.length) {
    issues.push({ field: 'links', message: `${wrong.length} item(ns) com quantidade vinculada diferente da quantidade do QC.` })
  }
  return issues
}

/**
 * Redistribui proporcionalmente as quantidades para somar `target` (escala 4).
 * A diferença de arredondamento fica na maior linha. Sem base (tudo zero) → divide igualmente.
 */
export function rebalance(quantities: Decimal[], target: Decimal): Decimal[] {
  if (!quantities.length) return []
  const sum = Decimal.sum(quantities)
  let out = sum.isZero()
    ? quantities.map(() => target.div(quantities.length, 4))
    : quantities.map((q) => target.times(q).div(sum, 4))
  const diff = target.minus(Decimal.sum(out))
  if (!diff.isZero()) {
    const idx = out.reduce((best, q, i) => (q.gt(out[best]!) ? i : best), 0)
    out = out.map((q, i) => (i === idx ? q.plus(diff) : q))
  }
  return out.map((q) => q.round(4))
}

// ----------------------------------------------------------------------------- consolidação
export interface PackageConsolidation {
  packageCode: string
  description: string
  budgetTotal: Decimal
  othersAmount: Decimal
  thisBudget: Decimal
  thisAmount: Decimal
  balance: Decimal
  /** (outros + este) / orçado do vínculo */
  consumption: Decimal | null
}

export interface MaterialConsolidation {
  materialId: string
  code: string
  description: string
  unit: string
  budgetQuantity: Decimal
  budgetTotal: Decimal
  othersQuantity: Decimal
  thisQuantity: Decimal
  balanceQuantity: Decimal
  thisAmount: Decimal
}

export function consolidate(
  lines: BudgetLineDTO[],
  links: (PlanningLink & { awardedTotal: Decimal | null })[],
  others: LinkCommitmentDTO[],
): { byPackage: PackageConsolidation[]; byMaterial: MaterialConsolidation[] } {
  const packages = [...new Set(links.map((l) => l.packageCode).filter((p): p is string => !!p))].sort()
  const materials = [...new Set(links.map((l) => l.materialId))]
  const lineByKey = new Map(lines.map((l) => [l.lineKey, l]))

  const byPackage = packages.map<PackageConsolidation>((code) => {
    const rows = lines.filter((i) => i.packageCode === code)
    const own = links.filter((l) => l.packageCode === code)
    const budgetTotal = Decimal.sum(rows.map((r) => r.total))
    const othersAmount = Decimal.sum(others.filter((o) => o.packageCode === code).map((o) => o.amount))
    const thisAmount = Decimal.sum(own.map((l) => l.awardedTotal ?? ZERO))
    const used = othersAmount.plus(thisAmount)
    return {
      packageCode: code,
      description: rows[0]?.packageDescription ?? code,
      budgetTotal,
      othersAmount,
      thisBudget: Decimal.sum(
        own.map((l) => {
          const line = l.lineKey ? lineByKey.get(l.lineKey) : undefined
          if (l.budgetValue) return l.budgetValue
          return line ? lineBudgetValue(line, l.quantity) : lineTotal(l.budgetUnitCost, l.quantity)
        }),
      ),
      thisAmount,
      balance: budgetTotal.minus(used),
      consumption: budgetTotal.isZero() ? null : used.div(budgetTotal, RATIO),
    }
  })

  const byMaterial = materials
    .map<MaterialConsolidation>((id) => {
      const rows = lines.filter((i) => i.materialId === id)
      const own = links.filter((l) => l.materialId === id)
      const budgetQuantity = Decimal.sum(rows.map((r) => r.quantity))
      const othersQuantity = Decimal.sum(others.filter((o) => o.materialId === id).map((o) => o.quantity))
      const thisQuantity = Decimal.sum(own.map((l) => l.quantity))
      return {
        materialId: id,
        code: rows[0]?.code ?? '—',
        description: rows[0]?.description ?? 'Insumo fora do orçamento vigente',
        unit: rows[0]?.unit ?? '',
        budgetQuantity,
        budgetTotal: Decimal.sum(rows.map((r) => r.total)),
        othersQuantity,
        thisQuantity,
        balanceQuantity: budgetQuantity.minus(othersQuantity).minus(thisQuantity),
        thisAmount: Decimal.sum(own.map((l) => l.awardedTotal ?? ZERO)),
      }
    })
    .sort((a, b) => a.code.localeCompare(b.code))

  return { byPackage, byMaterial }
}

/**
 * Saldo por linha do orçamento a partir dos compromissos (por chave da linha):
 * quantidade e percentual já comprometidos, e o que resta livre.
 */
export function lineBalances(lines: BudgetLineDTO[], commitments: Pick<LinkCommitmentDTO, 'lineKey' | 'quantity' | 'share' | 'budgetValue'>[]) {
  const used = new Map<string, { q: Decimal; s: Decimal; v: Decimal }>()
  for (const c of commitments) {
    if (!c.lineKey) continue
    const u = used.get(c.lineKey) ?? { q: ZERO, s: ZERO, v: ZERO }
    used.set(c.lineKey, { q: u.q.plus(c.quantity), s: u.s.plus(c.share), v: u.v.plus(c.budgetValue) })
  }
  return new Map(lines.map((l) => {
    const u = used.get(l.lineKey) ?? { q: ZERO, s: ZERO, v: ZERO }
    return [l.lineKey, {
      committed: u.q,
      balance: Decimal.from(l.quantity).minus(u.q),
      committedShare: u.s,
      balanceShare: ONE.minus(u.s),
      committedValue: u.v,
    }]
  }))
}

// ----------------------------------------------------------------------------- montagem do QC
export interface GroupedLineLink {
  activityItemId: string
  lineKey: string
  materialId: string
  packageCode: string | null
  packageDescription: string | null
  quantity: Decimal
  share: Decimal
  budget: Decimal
  budgetUnitCost: Decimal
}

export interface GroupedItem {
  materialId: string
  code: string
  description: string
  unit: string
  quantity: Decimal
  budget: Decimal
  /** custo unitário médio ponderado = Σ orçado / Σ quantidade */
  unitCost: Decimal
  links: GroupedLineLink[]
}

/**
 * Agrupa linhas do orçamento em itens de QC (um item por insumo), mantendo um vínculo por linha.
 * Percentual de cada linha: o informado em `shares` (por id da linha); senão o percentual livre
 * em `available` (por chave da linha); senão 100%. Linhas com percentual ≤ 0 são ignoradas.
 */
export function groupBudgetLines(
  lines: BudgetLineDTO[],
  opts: { available?: Map<string, Decimal>; shares?: Map<string, Decimal> } = {},
): GroupedItem[] {
  const byMaterial = new Map<string, GroupedItem>()
  for (const l of lines) {
    const requested = opts.shares?.get(l.id)
    const free = opts.available?.get(l.lineKey)
    const share = requested ?? (free !== undefined ? Decimal.min(ONE, free) : ONE)
    if (!share.isPositive()) continue
    const v = linkFromShare(l, share)
    const g = byMaterial.get(l.materialId) ?? {
      materialId: l.materialId, code: l.code, description: l.description, unit: l.unit,
      quantity: ZERO, budget: ZERO, unitCost: ZERO, links: [],
    }
    g.links.push({
      activityItemId: l.id,
      lineKey: l.lineKey,
      materialId: l.materialId,
      packageCode: l.packageCode,
      packageDescription: l.packageDescription,
      quantity: v.quantity,
      share: v.share,
      budget: v.budgetValue,
      budgetUnitCost: v.quantity.isZero() ? Decimal.from(l.unitCost) : v.budgetValue.div(v.quantity, 4),
    })
    byMaterial.set(l.materialId, g)
  }
  return [...byMaterial.values()]
    .map((g) => {
      const b = itemBudgetFromLines(g.links)
      return { ...g, quantity: b.quantity, budget: b.budget, unitCost: b.unitCost }
    })
    .sort((a, b) => a.code.localeCompare(b.code))
}
