/**
 * De-para do orçamento (tela "De-para"): nome e IP por Item da EAP, IP por insumo do indireto.
 * Quem mantém o catálogo edita; a lista já traz o que aparece nas obras e ainda não está no de-para,
 * para completar. Vale a partir da próxima versão do orçamento de cada obra ("Atualizar dados").
 */
import type { BudgetMappingsDTO, IndirectMappingRowDTO, ItemMappingRowDTO, SetIndirectMappingInput, SetItemMappingInput } from '../../../shared/contracts'
import { compareItemCodes } from '../../../shared/domain/budget/budget-sheet'
import { descriptionKey } from '../../../shared/domain/budget/mappings'
import { requirePermission, type RequestContext } from '../context'
import type { Repositories } from '../ports'
import { catalogPlanningCodes } from './works'

export async function getBudgetMappings(repos: Repositories, ctx: RequestContext): Promise<BudgetMappingsDTO> {
  requirePermission(ctx, 'catalog.manage')
  const [mappings, workItems, indirects, planningCodes] = await Promise.all([
    repos.budgetMappings.list(),
    repos.budgetMappings.listWorkItems(),
    repos.indirect.listAll(),
    catalogPlanningCodes(repos),
  ])

  // Itens: os do de-para + os que aparecem nos orçamentos das obras
  const items = new Map<string, ItemMappingRowDTO & { works_: Set<string>; names: Map<string, number> }>()
  const itemRow = (wbs: string) => {
    let r = items.get(wbs)
    if (!r) items.set(wbs, (r = { wbs, description: null, planning: null, mapped: false, works: 0, suggestion: null, works_: new Set(), names: new Map() }))
    return r
  }
  for (const m of mappings.items) Object.assign(itemRow(m.wbs), { description: m.description, planning: m.planning, mapped: true })
  for (const w of workItems) {
    const r = itemRow(w.wbs)
    r.works_.add(w.workId)
    if (w.name) r.names.set(w.name, (r.names.get(w.name) ?? 0) + 1)
  }

  // Insumos do indireto: os do de-para + os dos indiretos importados nas obras
  const indirect = new Map<string, IndirectMappingRowDTO & { items_: Set<string>; works_: Set<string> }>()
  const indirectRow = (description: string) => {
    const key = descriptionKey(description)
    let r = indirect.get(key)
    if (!r) indirect.set(key, (r = { description: description.trim(), planning: null, items: [], works: 0, items_: new Set(), works_: new Set() }))
    return r
  }
  for (const m of mappings.indirect) Object.assign(indirectRow(m.description), { description: m.description, planning: m.planning })
  for (const { workId, budget } of indirects) {
    for (const item of budget.items) {
      for (const l of item.lines) {
        const r = indirectRow(l.description)
        r.items_.add(`${item.wbs} ${item.description}`)
        r.works_.add(workId)
      }
    }
  }

  return {
    items: [...items.values()]
      .map(({ works_, names, ...r }) => ({ ...r, works: works_.size, suggestion: [...names].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }))
      .sort((a, b) => compareItemCodes(a.wbs, b.wbs)),
    indirect: [...indirect.values()]
      .map(({ items_, works_, ...r }) => ({ ...r, items: [...items_].sort(), works: works_.size }))
      .sort((a, b) => a.description.localeCompare(b.description, 'pt-BR')),
    planningCodes,
  }
}

export async function setItemMapping(repos: Repositories, ctx: RequestContext, input: SetItemMappingInput) {
  requirePermission(ctx, 'catalog.manage')
  const planning = input.planningCode ? { code: input.planningCode, description: input.planningDescription ?? null } : null
  await repos.budgetMappings.setItem(input.wbs, { description: input.description, planning }, ctx.actor.id)
  return { ok: true }
}

export async function setIndirectMapping(repos: Repositories, ctx: RequestContext, input: SetIndirectMappingInput) {
  requirePermission(ctx, 'catalog.manage')
  const planning = input.planningCode ? { code: input.planningCode, description: input.planningDescription ?? null } : null
  await repos.budgetMappings.setIndirect(input.description, planning, ctx.actor.id)
  return { ok: true }
}
