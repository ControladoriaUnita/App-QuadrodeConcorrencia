/**
 * Indireto aberto da obra, importado do arquivo de custo indireto (Excel).
 *
 * O orçamento do SharePoint traz o indireto fechado (um valor por item). O arquivo de indireto da
 * obra abre esse valor insumo a insumo; até a API trazer o indireto aberto, ele é importado por obra
 * e substitui, item a item, as linhas fechadas do orçamento.
 *
 * Formato do arquivo:
 *  - Aba "Total Indiretos": resumo com Item · Descrição · Preço Total. O código do item é o do
 *    orçamento da obra (16.01 EQUIPAMENTOS, 16.02 INSTALAÇÃO DA OBRA…).
 *  - Uma aba por item (Equipamentos, M.O.I., Tarifas…), com o cabeçalho DESCRIÇÃO (ou FUNÇÃO) ·
 *    FASE · quantidade · UN · … · TOTAL. Cada insumo ocupa uma linha por fase (FASE 01, FASE 02,
 *    Instaladora): a descrição só aparece na primeira, e o insumo soma todas as fases. A aba termina
 *    nas linhas "TOTAL-->>". A M.O.I. separa CLT e PJ na primeira coluna (dois itens do resumo).
 *  - Insumos com total zero não entram (não fazem parte do orçamento).
 *
 * Funções puras: o arquivo é lido no navegador (prévia) e o resultado é revalidado no servidor.
 */
import type { BudgetImportInput } from '../../contracts'
import { Decimal } from '../decimal'
import { formatBRL } from '../../format'
import { compareItemCodes, genericItemName } from './budget-sheet'
import { cellDecimal, type Cell } from './excel-import'
import { descriptionKey, type MappingResolver } from './mappings'

export interface WorkbookSheet {
  sheet: string
  data: Cell[][]
}

export interface IndirectLine {
  /** Descrição do insumo (com o complemento, quando houver) */
  description: string
  unit: string
  /** Soma das fases */
  quantity: string
  total: string
  /** Aba e linha (1ª fase) de onde veio */
  sheet: string
  row: number
}

export interface IndirectItem {
  /** Código do item no orçamento da obra (16.01…) */
  wbs: string
  description: string
  /** Preço total do item na aba de resumo */
  declaredTotal: string
  /** Σ dos insumos */
  total: string
  lines: IndirectLine[]
}

export interface IndirectBudget {
  items: IndirectItem[]
  total: string
  warnings: string[]
}

/** Aba de cada item do resumo (descrições sem acento, em minúsculas). */
const SECTIONS: { item: string; sheet: string; category?: string }[] = [
  { item: 'equipamentos', sheet: 'equipamentos' },
  { item: 'instalacao da obra', sheet: 'instalacao da obra' },
  { item: 'servicos terceirizados', sheet: 'servs. terceirizados' },
  { item: 'consumos permanentes', sheet: 'consumos permanentes' },
  { item: 'mao de obra indireta - clt', sheet: 'm.o.i.', category: 'clt' },
  { item: 'mao de obra indireta - pj', sheet: 'm.o.i.', category: 'pj' },
  { item: 'mao de obra indireta', sheet: 'm.o.i.' },
  { item: 'mao de obra direta', sheet: 'm.o.d.' },
  { item: 'tarifas', sheet: 'tarifas' },
  { item: 'ligacoes', sheet: 'ligacoes e habite-se' },
]
const SUMMARY_SHEET = 'total indiretos'
const DESCRIPTION_HEADERS = ['descricao', 'descricao do servico', 'funcao']

const text = (c: Cell) => (c === null || c === undefined ? '' : String(c).trim())
const key = (c: Cell) => descriptionKey(text(c))
/** Número da célula (erros do Excel como #REF! e textos valem zero) */
const amount = (c: Cell) => (typeof c === 'number' ? (cellDecimal(c) ?? Decimal.ZERO) : Decimal.ZERO)
const ITEM_CODE = /^\d+(\.\d+)+$/

export function parseIndirectWorkbook(sheets: WorkbookSheet[]): IndirectBudget {
  const bySheet = new Map(sheets.map((s) => [key(s.sheet), s]))
  const summary = bySheet.get(SUMMARY_SHEET)
  if (!summary) throw new Error('O arquivo não tem a aba "Total Indiretos" (resumo do indireto com os itens do orçamento).')
  const summaryItems = readSummary(summary)

  const warnings: string[] = []
  const items: IndirectItem[] = []
  for (const s of summaryItems) {
    const section = SECTIONS.find((x) => x.item === key(s.description))
    const sheet = section && bySheet.get(section.sheet)
    if (!section || !sheet) {
      if (s.declaredTotal.isPositive()) warnings.push(`Item ${s.wbs} ${s.description}: aba não encontrada no arquivo — fica como está no orçamento.`)
      continue
    }
    const lines = readSection(sheet, section.category)
    const total = Decimal.sum(lines.map((l) => l.total))
    if (!total.minus(s.declaredTotal).abs().lte(1)) {
      warnings.push(`Item ${s.wbs} ${s.description}: os insumos da aba "${sheet.sheet}" somam ${formatBRL(total)}, mas o resumo diz ${formatBRL(s.declaredTotal)}.`)
    }
    items.push({ wbs: s.wbs, description: s.description, declaredTotal: s.declaredTotal.toDb(), total: total.toDb(), lines })
  }
  if (!items.some((i) => i.lines.length)) throw new Error('Nenhum insumo com valor foi encontrado nas abas do indireto.')
  return { items, total: Decimal.sum(items.map((i) => i.total)).toDb(), warnings }
}

/** Itens da aba "Total Indiretos": código do orçamento, descrição e preço total. */
function readSummary(sheet: WorkbookSheet) {
  const rows = sheet.data
  const headerRow = rows.findIndex((r) => r.some((c) => key(c) === 'item') && r.some((c) => key(c).startsWith('preco total')))
  if (headerRow < 0) throw new Error('A aba "Total Indiretos" não tem o cabeçalho Item · Descrição · Preço Total.')
  const header = rows[headerRow]!.map(key)
  const itemCol = header.indexOf('item')
  const descCol = header.findIndex((h) => h.startsWith('descricao'))
  const totalCol = header.findIndex((h) => h.startsWith('preco total'))

  const items: { wbs: string; description: string; declaredTotal: Decimal }[] = []
  for (const r of rows.slice(headerRow + 1)) {
    const code = text(r[itemCol])
    if (key(code).startsWith('total')) break
    if (!ITEM_CODE.test(code)) continue
    items.push({ wbs: code, description: text(r[descCol]), declaredTotal: amount(r[totalCol]) })
  }
  if (!items.length) throw new Error('A aba "Total Indiretos" não tem itens (16.01, 16.02…).')
  return items
}

/** Insumos de uma aba de item, somando as fases; `category` filtra CLT/PJ (1ª coluna). */
function readSection(sheet: WorkbookSheet, category?: string): IndirectLine[] {
  const rows = sheet.data
  const headerRow = rows.findIndex((r) => r.some((c) => DESCRIPTION_HEADERS.includes(key(c))))
  if (headerRow < 0) throw new Error(`A aba "${sheet.sheet}" não tem o cabeçalho DESCRIÇÃO (ou FUNÇÃO) · FASE · UN · TOTAL.`)
  // O cabeçalho ocupa duas linhas: vale o rótulo da primeira; vazio, o da segunda (ex.: FASE)
  const [top, bottom] = [rows[headerRow]!, rows[headerRow + 1] ?? []]
  const labels = Array.from({ length: Math.max(top.length, bottom.length) }, (_, c) => key(top[c]) || key(bottom[c]))
  const descCol = labels.findIndex((l) => DESCRIPTION_HEADERS.includes(l))
  const phaseCol = labels.indexOf('fase')
  const unitCol = labels.findIndex((l) => l === 'un' || l === 'un.')
  const totalCol = labels.lastIndexOf('total')
  const complementCol = labels.indexOf('complementos')
  if (phaseCol < 0 || unitCol < 1 || totalCol < 0) throw new Error(`A aba "${sheet.sheet}" precisa das colunas FASE, UN e TOTAL.`)
  // A quantidade fica logo antes da unidade (QUANT., ou TOTAL na M.O.D.)
  const qtyCol = unitCol - 1

  type Acc = { description: string; unit: string; category: string; quantity: Decimal; total: Decimal; row: number }
  const all: Acc[] = []
  let current: Acc | null = null
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    if (r.some((c) => key(c).startsWith('total-->>'))) break
    const description = text(r[descCol])
    const phase = text(r[phaseCol])
    if (description && phase) {
      const complement = complementCol >= 0 ? text(r[complementCol]) : ''
      current = {
        description: complement && key(complement) !== key(description) ? `${description} - ${complement}` : description,
        unit: text(r[unitCol]),
        category: key(r[0]),
        quantity: Decimal.ZERO,
        total: Decimal.ZERO,
        row: i + 1,
      }
      all.push(current)
    } else if (!phase) {
      // Título de grupo dentro da aba (ex.: FERRAMENTAS E UTILITÁRIOS) ou linha vazia
      current = null
      continue
    }
    if (!current) continue
    current.quantity = current.quantity.plus(amount(r[qtyCol]))
    current.total = current.total.plus(amount(r[totalCol]))
    if (!current.unit) current.unit = text(r[unitCol])
  }
  return all
    .filter((a) => (!category || a.category === category) && a.total.isPositive())
    .map((a) => ({ description: a.description, unit: a.unit || 'vb', quantity: a.quantity.toDb(), total: a.total.toDb(), sheet: sheet.sheet, row: a.row }))
}

// ----------------------------------------------------------------------------- abrir no orçamento
/** Código do insumo do indireto (o arquivo não tem código da UAU): estável pela descrição e unidade. */
export function indirectMaterialCode(description: string, unit: string): string {
  let h = 0x811c9dc5
  for (const ch of `${descriptionKey(description)}|${descriptionKey(unit)}`) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `IND${h.toString(36).toUpperCase().padStart(7, '0')}`
}

type BudgetParts = Pick<BudgetImportInput, 'groups' | 'activities' | 'lines' | 'materials'>

/**
 * Tipo de custo indireto pela descrição, para achar o item do orçamento: a UAU descreve os itens
 * do indireto ("M.O.I (PJ) - (INDIRETO)", "INSTALAÇÕES DA OBRA - (INDIRETO)") e a numeração do
 * arquivo pode não bater com a do orçamento (ex.: CLT e PJ trocados entre 16.05 e 16.06).
 */
export function indirectKind(description: string): string | null {
  const d = descriptionKey(description).replace(/\./g, '')
  const moi = /\bmoi\b|mao de obra indireta/.test(d)
  if (moi) return /\bclt\b/.test(d) ? 'moi-clt' : /\bpj\b/.test(d) ? 'moi-pj' : 'moi'
  if (/\bmod\b|mao de obra direta/.test(d)) return 'mod'
  const kinds: [string, RegExp][] = [
    ['equipamentos', /equipamento/], ['instalacao', /instalac/], ['terceirizados', /terceiriz/],
    ['consumos', /consumo/], ['tarifas', /tarifa/], ['ligacoes', /ligac/],
  ]
  return kinds.find(([, re]) => re.test(d))?.[0] ?? null
}

/**
 * Item do orçamento de cada item do indireto: o item irmão (mesmo pai, ex.: 16) cuja descrição é do
 * mesmo tipo; sem um único item assim, o código do arquivo.
 */
function targetItems(budget: BudgetParts, items: IndirectItem[]): Map<IndirectItem, string> {
  const parentOf = (wbs: string) => wbs.split('.').slice(0, -1).join('.')
  const out = new Map<IndirectItem, string>()
  const used = new Set<string>()
  for (const item of items) {
    const kind = indirectKind(item.description)
    const parent = parentOf(item.wbs)
    const matches = kind
      ? budget.activities.filter((a) => parentOf(a.wbs) === parent && indirectKind(a.description) === kind).map((a) => a.wbs)
      : []
    const wbs = matches.length === 1 && !used.has(matches[0]!) ? matches[0]! : item.wbs
    used.add(wbs)
    out.set(item, wbs)
  }
  // Dois itens no mesmo código: volta à numeração do arquivo
  if (new Set(out.values()).size < out.size) for (const item of items) out.set(item, item.wbs)
  return out
}

/** O arquivo não é desta obra: nenhum item dele existe no orçamento. */
export class IndirectMismatchError extends Error {}

const under = (code: string, wbs: string) => code === wbs || code.startsWith(`${wbs}.`)
const parentsOf = (wbs: string) => {
  const parts = wbs.split('.')
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('.'))
}

/**
 * Troca as linhas fechadas de cada item do indireto pelos insumos abertos (o item do orçamento é
 * achado pelo tipo de custo da descrição; ver targetItems). O item passa a ser uma
 * composição com os insumos do arquivo (o que havia abaixo dele no orçamento sai). O IP de cada
 * insumo vem do de-para do indireto (pela descrição); sem ele, do de-para do Item; sem os dois, o
 * próprio item do orçamento.
 */
export function openIndirect(budget: BudgetParts, indirect: IndirectBudget, resolver: MappingResolver): { budget: BudgetParts; warnings: string[] } {
  const targets = targetItems(budget, indirect.items.filter((i) => i.lines.length))
  const items = [...targets].map(([item, wbs]) => ({ ...item, wbs }))
  const known = (wbs: string) => budget.activities.some((a) => under(a.wbs, wbs)) || budget.groups.some((g) => under(g.wbs, wbs))
  if (!items.some((i) => known(i.wbs))) {
    throw new IndirectMismatchError(`Nenhum item do indireto (${items.map((i) => i.wbs).join(', ')}) existe no orçamento da obra. Confira se o arquivo é desta obra.`)
  }

  let { groups, activities, lines } = budget
  const materials = new Map(budget.materials.map((m) => [m.code, m]))
  const warnings: string[] = []
  let unmapped = 0

  for (const item of items) {
    const existing = activities.find((a) => a.wbs === item.wbs)
    const closed = Decimal.sum(lines.filter((l) => under(l.activityWbs, item.wbs)).map((l) => l.total))
    if (!known(item.wbs)) warnings.push(`Item ${item.wbs} ${item.description} não existia no orçamento: entrou com o indireto.`)
    else if (!closed.minus(item.total).abs().lte(1)) {
      warnings.push(`Item ${item.wbs} ${item.description}: o indireto aberto soma ${formatBRL(item.total)}; o orçamento fechado trazia ${formatBRL(closed)}.`)
    }

    lines = lines.filter((l) => !under(l.activityWbs, item.wbs))
    activities = activities.filter((a) => !under(a.wbs, item.wbs))
    groups = groups.filter((g) => !under(g.wbs, item.wbs))
    const description = existing?.description ?? item.description
    activities.push({ wbs: item.wbs, code: existing?.code ?? null, description, unit: 'vb', quantity: '1.0000', unitCost: item.total })
    for (const parent of parentsOf(item.wbs)) {
      if (!groups.some((g) => g.wbs === parent) && !activities.some((a) => a.wbs === parent)) groups.push({ wbs: parent, description: genericItemName(parent) })
    }

    const seen = new Map<string, number>()
    for (const l of item.lines) {
      const code = indirectMaterialCode(l.description, l.unit)
      materials.set(code, { code, description: l.description, unit: l.unit })
      const base = `${item.wbs}|${code}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      const planning = resolver.planningForIndirect(l.description, item.wbs)
      if (!planning) unmapped++
      const quantity = Decimal.from(l.quantity)
      lines.push({
        lineKey: n === 1 ? base : `${base}|${n}`,
        sourceRow: l.row,
        activityWbs: item.wbs,
        materialCode: code,
        quantity: l.quantity,
        unitCost: quantity.isPositive() ? Decimal.from(l.total).div(quantity, 4).toDb() : l.total,
        total: l.total,
        packageCode: planning?.code ?? item.wbs,
        packageDescription: planning ? (planning.description ?? planning.code) : description,
        aux: null,
      })
    }
  }
  if (unmapped) warnings.push(`${unmapped} insumo(s) do indireto sem IP no de-para: ficam vinculados ao próprio item até o planejamento escolher o IP.`)

  const byCode = <T extends { wbs: string }>(xs: T[]) => [...xs].sort((a, b) => compareItemCodes(a.wbs, b.wbs))
  const order = new Map(byCode(activities).map((a, i) => [a.wbs, i]))
  return {
    budget: {
      groups: byCode(groups),
      activities: byCode(activities),
      // Ordem da EAP; dentro do item, a ordem que já tinham (sort estável)
      lines: [...lines].sort((a, b) => order.get(a.activityWbs)! - order.get(b.activityWbs)!),
      materials: [...materials.values()],
    },
    warnings,
  }
}
