/**
 * De-para do orçamento: a primeira visão de nomes e vínculos de planejamento (IPs) que toda obra
 * recebe ao montar uma versão do orçamento vindo do SharePoint. Depois disso, o time de cada obra
 * revisa e ajusta (nome do Item e IP da linha, escolhidos no app, valem sobre o de-para).
 *
 *  - Itens do orçamento (por código da EAP: 02, 02.06, 16.01…):
 *      nome do Item → usado no lugar do nome genérico "Item 02" que a UAU manda;
 *      IP           → replicado para todas as linhas abaixo do Item (o código mais próximo vale).
 *  - Insumos do indireto (pela descrição, já que o indireto aberto não tem código da UAU):
 *      IP           → vale para o insumo em qualquer obra; sem ele, vale o IP do Item.
 *
 * Funções puras: quem chama carrega o de-para do banco e aplica aqui.
 */
import { compareItemCodes, genericItemName } from './budget-sheet'

export interface Planning {
  code: string
  description: string | null
}

export interface ItemMapping {
  /** Código do Item na EAP (02, 02.06…) */
  wbs: string
  description: string | null
  planning: Planning | null
}

export interface IndirectMapping {
  /** Descrição do insumo do indireto, como veio do arquivo */
  description: string
  planning: Planning
}

export interface BudgetMappings {
  items: ItemMapping[]
  indirect: IndirectMapping[]
}

export const EMPTY_MAPPINGS: BudgetMappings = { items: [], indirect: [] }

/** Chave de comparação de descrições: sem acentos, maiúsculas, pontuação de borda ou espaços repetidos. */
export function descriptionKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export interface MappingResolver {
  /** IP do Item mais próximo (o próprio código ou o ancestral mais longo) com IP no de-para */
  planningForItem(wbs: string): Planning | null
  /** IP de um insumo do indireto: o da descrição; sem ele, o do Item */
  planningForIndirect(description: string, wbs: string): Planning | null
  /** Nome do Item no de-para (só o próprio código) */
  itemName(wbs: string): string | null
}

export function mappingResolver(m: BudgetMappings): MappingResolver {
  const items = new Map(m.items.map((i) => [i.wbs, i]))
  const indirect = new Map(m.indirect.map((i) => [descriptionKey(i.description), i.planning]))
  const planningForItem = (wbs: string) => {
    const parts = wbs.split('.')
    for (let n = parts.length; n > 0; n--) {
      const planning = items.get(parts.slice(0, n).join('.'))?.planning
      if (planning) return planning
    }
    return null
  }
  return {
    planningForItem,
    planningForIndirect: (description, wbs) => indirect.get(descriptionKey(description)) ?? planningForItem(wbs),
    itemName: (wbs) => items.get(wbs)?.description ?? null,
  }
}

interface PlannedLine {
  activityWbs: string
  packageCode: string | null
  packageDescription: string | null
}

/**
 * IP das linhas pelo de-para dos Itens. Linhas sem Item no de-para ficam como estão (vinculadas ao
 * próprio item do orçamento); `skip` deixa linhas de fora (ex.: o indireto aberto, que já tem o IP).
 * Retorna as linhas novas e quantas ficaram sem IP no de-para.
 */
export function applyItemPlanning<L extends PlannedLine>(lines: L[], resolver: MappingResolver, skip?: (line: L) => boolean): { lines: L[]; unmapped: number } {
  let unmapped = 0
  const out = lines.map((l) => {
    if (skip?.(l)) return l
    const planning = resolver.planningForItem(l.activityWbs)
    if (!planning) {
      unmapped++
      return l
    }
    return { ...l, packageCode: planning.code, packageDescription: planning.description ?? planning.code }
  })
  return { lines: out, unmapped }
}

/**
 * Nome de cada Item: o dado na obra vale sobre o de-para, e o de-para só troca o nome genérico
 * ("Item 02") — nome que veio de outra origem (Excel) fica como está.
 */
export function nameGroups<G extends { wbs: string; description: string; renamed?: boolean }>(groups: G[], resolver: MappingResolver): G[] {
  return groups.map((g) => {
    if (g.renamed || g.description !== genericItemName(g.wbs)) return g
    const name = resolver.itemName(g.wbs)
    return name ? { ...g, description: name } : g
  })
}

/** De-para dos Itens em ordem de EAP */
export const sortItemMappings = <T extends { wbs: string }>(items: T[]) => [...items].sort((a, b) => compareItemCodes(a.wbs, b.wbs))
