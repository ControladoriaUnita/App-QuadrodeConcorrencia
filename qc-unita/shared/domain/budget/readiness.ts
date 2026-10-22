/**
 * Orçamento pronto para concorrência: só se cria concorrência quando o orçamento vigente está 100%
 * completo — toda linha com vínculo de planejamento (IP) e todo Item da EAP com nome.
 *
 *  - IP válido = código do cadastro de IPs da UAU ("IP" + números). O código do próprio item do
 *    orçamento (02.06.01…), que versões antigas gravavam na falta de IP, não conta.
 *  - Item sem nome = vazio ou o nome genérico do SharePoint ("Item 02"), depois de aplicados o
 *    de-para e o nome dado na obra.
 *
 * Função pura: o servidor barra a criação e as telas mostram o que falta com a mesma regra.
 */
import { genericItemName } from './budget-sheet'

export const isPlanningCode = (code: string | null | undefined): boolean => !!code && /^IP\d/i.test(code.trim())

export interface BudgetReadiness {
  ready: boolean
  /** Linhas sem IP válido */
  linesWithoutPlanning: number
  /** Itens da EAP sem nome, em ordem */
  unnamedItems: string[]
}

export function budgetReadiness(
  groups: { wbs: string; description: string }[],
  lines: { packageCode: string | null }[],
): BudgetReadiness {
  const linesWithoutPlanning = lines.filter((l) => !isPlanningCode(l.packageCode)).length
  const unnamedItems = groups.filter((g) => !g.description.trim() || g.description.trim() === genericItemName(g.wbs)).map((g) => g.wbs)
  return { ready: !linesWithoutPlanning && !unnamedItems.length, linesWithoutPlanning, unnamedItems }
}

/** O que falta, em uma frase (ex.: "12 linha(s) sem vínculo de planejamento (IP) e 2 Item(ns) sem nome (02.06, 16)") */
export function missingSummary(r: BudgetReadiness): string {
  const items = r.unnamedItems.slice(0, 8).join(', ') + (r.unnamedItems.length > 8 ? ` e mais ${r.unnamedItems.length - 8}` : '')
  return [
    r.linesWithoutPlanning && `${r.linesWithoutPlanning.toLocaleString('pt-BR')} linha(s) sem vínculo de planejamento (IP)`,
    r.unnamedItems.length && `${r.unnamedItems.length} Item(ns) sem nome (${items})`,
  ]
    .filter(Boolean)
    .join(' e ')
}
