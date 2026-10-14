/**
 * Insumos do mapa (reais, de contrato) × insumos referência (do orçamento).
 *
 * O insumo referência é um insumo do orçamento puxado pelo QC: suas linhas (com IP e % de cada uma)
 * dão a VERBA. O insumo do mapa é o que os fornecedores cotam; ele se liga a uma ou mais
 * referências para comparar economia/estouro. Uma referência pode servir a vários insumos do mapa.
 *
 * Regras
 *  - Verba da referência = Σ verba puxada das suas linhas.
 *  - Grupo de comparação = insumos do mapa e referências ligados entre si (componente conexo).
 *    No grupo: orçado = Σ verba das referências; contratado = Σ valor dos insumos do mapa.
 *  - Orçado de cada insumo do mapa: com um só insumo no grupo, a verba inteira do grupo; com vários,
 *    rateada pelo valor contratado (sem preços, em partes iguais). Sem referência: orçado zero.
 *  - IP do insumo do mapa: herdado das linhas das referências, na proporção da verba de cada linha;
 *    o IP manual (planningCode) substitui os herdados.
 *  - Valor contratado de cada linha do orçamento = contratado do grupo distribuído pela verba das linhas.
 */
import { Decimal } from '../decimal'
import type { ValidationIssue } from '../competition/revision'
import { rebalance } from './links'

const ZERO = Decimal.ZERO
const ONE = Decimal.from(1)

export interface ReferenceLink {
  id?: string
  referenceId: string
  packageCode: string | null
  packageDescription?: string | null
  budgetValue: Decimal
}

/** Linhas de cada referência (índice para não varrer todas as linhas por insumo) */
export function linksByReference<L extends ReferenceLink>(links: L[]): Map<string, L[]> {
  const out = new Map<string, L[]>()
  for (const l of links) {
    const own = out.get(l.referenceId)
    if (own) own.push(l)
    else out.set(l.referenceId, [l])
  }
  return out
}

export interface MapItemRef {
  id: string
  quantity: Decimal
  referenceIds: string[]
  planningCode?: string | null
  planningDescription?: string | null
}

export interface ComparisonGroup {
  key: string
  itemIds: string[]
  referenceIds: string[]
  /** Σ verba das referências do grupo */
  budget: Decimal
}

/** Verba de cada referência (Σ verba puxada das suas linhas). */
export function referenceBudgets(referenceIds: string[], links: ReferenceLink[]): Map<string, Decimal> {
  const out = new Map(referenceIds.map((id) => [id, ZERO]))
  for (const l of links) out.set(l.referenceId, (out.get(l.referenceId) ?? ZERO).plus(l.budgetValue))
  return out
}

/**
 * Grupos de comparação: componentes conexos do grafo insumo do mapa ↔ referência.
 * Referências sem nenhum insumo do mapa ficam fora dos grupos. Os insumos devem trazer só
 * referências existentes (ver buildQcMap).
 */
export function comparisonGroups(items: MapItemRef[], budgets: Map<string, Decimal>): {
  groups: ComparisonGroup[]
  groupOfItem: Map<string, ComparisonGroup>
  groupOfReference: Map<string, ComparisonGroup>
} {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  const add = (x: string) => !parent.has(x) && parent.set(x, x)
  const join = (a: string, b: string) => parent.set(find(a), find(b))

  for (const i of items) {
    add(`i:${i.id}`)
    for (const r of i.referenceIds) {
      add(`r:${r}`)
      join(`i:${i.id}`, `r:${r}`)
    }
  }
  const byRoot = new Map<string, ComparisonGroup>()
  for (const node of parent.keys()) {
    const root = find(node)
    const g = byRoot.get(root) ?? { key: root, itemIds: [], referenceIds: [], budget: ZERO }
    if (node.startsWith('i:')) g.itemIds.push(node.slice(2))
    else {
      g.referenceIds.push(node.slice(2))
      g.budget = g.budget.plus(budgets.get(node.slice(2)) ?? ZERO)
    }
    byRoot.set(root, g)
  }
  const groups = [...byRoot.values()]
  const groupOfItem = new Map<string, ComparisonGroup>()
  const groupOfReference = new Map<string, ComparisonGroup>()
  for (const g of groups) {
    for (const i of g.itemIds) groupOfItem.set(i, g)
    for (const r of g.referenceIds) groupOfReference.set(r, g)
  }
  return { groups, groupOfItem, groupOfReference }
}

/**
 * Orçado de cada insumo do mapa a partir do grupo. `contracted` = valor de cada insumo
 * (vencedora ou melhor condição); null/zero quando ainda sem preço.
 */
export function allocateGroupBudgets(groups: ComparisonGroup[], contracted: Map<string, Decimal | null>): Map<string, Decimal> {
  const out = new Map<string, Decimal>()
  for (const g of groups) {
    if (!g.itemIds.length) continue
    if (g.itemIds.length === 1) {
      out.set(g.itemIds[0]!, g.budget)
      continue
    }
    const weights = g.itemIds.map((id) => Decimal.max(ZERO, contracted.get(id) ?? ZERO))
    const parts = rebalance(weights, g.budget)
    g.itemIds.forEach((id, k) => out.set(id, parts[k]!))
  }
  return out
}

export interface PlanningAllocation {
  packageCode: string | null
  packageDescription: string | null
  /** Parte do item neste IP (0..1) */
  share: Decimal
  /** Quantidade do item neste IP (4 casas; a soma fecha com a quantidade do item) */
  quantity: Decimal
}

/** IPs do insumo do mapa: manual, ou herdados das linhas das referências pela verba. */
export function itemPlanningAllocations(item: MapItemRef, byReference: Map<string, ReferenceLink[]>): PlanningAllocation[] {
  if (item.planningCode) {
    return [{ packageCode: item.planningCode, packageDescription: item.planningDescription ?? null, share: ONE, quantity: item.quantity }]
  }
  const byPackage = new Map<string, { packageCode: string | null; packageDescription: string | null; weight: Decimal; count: number }>()
  for (const l of item.referenceIds.flatMap((r) => byReference.get(r) ?? [])) {
    const k = l.packageCode ?? ''
    const e = byPackage.get(k) ?? { packageCode: l.packageCode, packageDescription: l.packageDescription ?? null, weight: ZERO, count: 0 }
    e.weight = e.weight.plus(Decimal.max(ZERO, l.budgetValue))
    e.count++
    byPackage.set(k, e)
  }
  const entries = [...byPackage.values()].sort((a, b) => (a.packageCode ?? '').localeCompare(b.packageCode ?? ''))
  if (!entries.length) return [{ packageCode: null, packageDescription: null, share: ONE, quantity: item.quantity }]
  const total = Decimal.sum(entries.map((e) => e.weight))
  const weights = total.isZero() ? entries.map((e) => Decimal.from(e.count)) : entries.map((e) => e.weight)
  const weightTotal = Decimal.sum(weights)
  const quantities = rebalance(weights, item.quantity)
  return entries.map((e, k) => ({
    packageCode: e.packageCode,
    packageDescription: e.packageDescription,
    share: weights[k]!.div(weightTotal, 6),
    quantity: quantities[k]!,
  }))
}

/**
 * Valor contratado de cada linha do orçamento: o contratado do grupo distribuído pela verba
 * das linhas das suas referências. null = grupo ainda sem preço (ou referência sem uso).
 */
export function linkAwardedAmounts(
  links: ReferenceLink[],
  groupOfReference: Map<string, ComparisonGroup>,
  contracted: Map<string, Decimal | null>,
): Map<string, Decimal | null> {
  const out = new Map<string, Decimal | null>()
  const byGroup = new Map<ComparisonGroup, ReferenceLink[]>()
  for (const l of links) {
    const g = groupOfReference.get(l.referenceId)
    if (!g) {
      if (l.id) out.set(l.id, null)
      continue
    }
    const own = byGroup.get(g)
    if (own) own.push(l)
    else byGroup.set(g, [l])
  }
  for (const [g, own] of byGroup) {
    const values = g.itemIds.map((id) => contracted.get(id) ?? null).filter((v): v is Decimal => v !== null)
    if (!values.length) {
      own.forEach((l) => l.id && out.set(l.id, null))
      continue
    }
    const amounts = rebalance(own.map((l) => Decimal.max(ZERO, l.budgetValue)), Decimal.sum(values))
    own.forEach((l, k) => l.id && out.set(l.id, amounts[k]!))
  }
  return out
}

/** Pendências da amarração insumo do mapa ↔ referência. */
export function validateReferences(items: MapItemRef[], referenceIds: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const used = new Set(items.flatMap((i) => i.referenceIds))
  const orphan = items.filter((i) => i.quantity.isPositive() && !i.referenceIds.length && !i.planningCode)
  if (orphan.length) {
    issues.push({ field: 'references', message: `${orphan.length} insumo(s) do mapa sem insumo referência (nem IP manual).` })
  }
  const unused = referenceIds.filter((r) => !used.has(r))
  if (unused.length) {
    issues.push({ field: 'references', message: `${unused.length} insumo(s) referência não usado(s) no mapa de cotação.` })
  }
  return issues
}
