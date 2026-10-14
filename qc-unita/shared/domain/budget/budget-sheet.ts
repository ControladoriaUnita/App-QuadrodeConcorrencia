/**
 * Orçamentos da UAU publicados no SharePoint (aba "BD_Orcamento" do Excel online).
 *
 * Função pura: recebe as linhas da aba (1ª linha = cabeçalho, valores como o Microsoft Graph
 * devolve em `usedRange(valuesOnly=true)`) e devolve o orçamento de uma obra no mesmo formato da
 * importação por Excel (BudgetImportResult), pronto para gravar como nova versão.
 *
 * Uma linha da aba = um insumo de um serviço do orçamento:
 *   Empresa_pla · Obra_pla · NumOrca_pla     → de qual orçamento da UAU é a linha
 *   Item_pla · Descr_pla · unid_pla · QtdPai → serviço (composição) do orçamento e sua quantidade
 *   Insumo · Descr_ins · CodUn_UnIns         → insumo
 *   ItemPreco · ItemCoef                     → preço e coeficiente do insumo no serviço
 *                                              (ou da composição auxiliar, quando TIns_cio = 1)
 *   Cod_comp · Descr_comp · Unid_comp        → composição auxiliar (aberta: uma linha por insumo dela)
 *   SubItemPreco · SubItemCoef               → preço e coeficiente do insumo dentro da auxiliar
 *   PrecoItem · PrecoFinal                   → custo por unidade do serviço e total da linha
 *
 * Regras
 *  - Quantidade da linha = QtdPai × ItemCoef (× SubItemCoef na auxiliar); unitário = ItemPreco
 *    (SubItemPreco na auxiliar); total = QtdPai × PrecoItem, como na planilha.
 *  - A EAP vem do Item_pla: 02.06.01.03 é o serviço; 02, 02.06 e 02.06.01 viram grupos.
 *  - Tudo ordenado pelos códigos (itens numericamente; dentro do serviço, insumos e auxiliares por código).
 *  - Vínculo de planejamento: coluna "Vínculo PL"/"IP" quando existir; sem ela, o próprio item do
 *    orçamento (Item_pla), que é a chave que a UAU usa para vincular contratos ao orçamento.
 */
import { Decimal } from '../decimal'
import type { BudgetImportResult, Cell, ImportedActivity, ImportedGroup, ImportedLine, ImportedMaterial } from './excel-import'

// ----------------------------------------------------------------------------- colunas
const COLUMNS = {
  company: ['empresa_pla'],
  work: ['obra_pla'],
  budget: ['numorca_pla'],
  item: ['item_pla'],
  itemDescription: ['descr_pla'],
  itemUnit: ['unid_pla'],
  itemQuantity: ['qtdpai'],
  price: ['itempreco'],
  coef: ['itemcoef'],
  subPrice: ['subitempreco'],
  subCoef: ['subitemcoef'],
  unitCost: ['precoitem'],
  total: ['precofinal'],
  material: ['insumo'],
  auxFlag: ['tins_cio'],
  auxCode: ['cod_comp'],
  auxDescription: ['descr_comp'],
  auxUnit: ['unid_comp'],
  materialDescription: ['descr_ins'],
  materialUnit: ['codun_unins'],
  // Opcionais
  serviceCode: ['serv_pla'],
  package: ['vínculo pl', 'vinculo pl', 'vinculo_pla', 'vínculo', 'vinculo', 'ip'],
  packageDescription: ['classificação', 'classificacao', 'descr_vinculo'],
} as const
type Column = keyof typeof COLUMNS
const OPTIONAL: Column[] = ['serviceCode', 'package', 'packageDescription', 'total']

export type SheetColumns = Record<Column, number>

const text = (c: Cell) => (c === null || c === undefined ? '' : String(c).trim())

/** Localiza as colunas pelo nome (sem diferenciar maiúsculas). Lança erro listando as que faltam. */
export function readSheetColumns(header: Cell[]): SheetColumns {
  const names = header.map((h) => text(h).toLowerCase())
  const cols = Object.fromEntries(
    (Object.keys(COLUMNS) as Column[]).map((k) => [k, names.findIndex((n) => (COLUMNS[k] as readonly string[]).includes(n))]),
  ) as SheetColumns
  const missing = (Object.keys(COLUMNS) as Column[]).filter((k) => cols[k] < 0 && !OPTIONAL.includes(k))
  if (missing.length) {
    throw new Error(`A aba de orçamentos não tem as colunas: ${missing.map((k) => COLUMNS[k][0]).join(', ')}.`)
  }
  return cols
}

// ----------------------------------------------------------------------------- números
/** Número exato (sem arredondar): coeficientes da UAU têm mais de 4 casas. */
function exact(c: Cell): Decimal | null {
  if (c === null || c === undefined || c === '') return null
  if (typeof c === 'number') return Number.isFinite(c) ? Decimal.from(c) : null
  try {
    return Decimal.parseBR(String(c))
  } catch {
    return null
  }
}

/** Ordena códigos de item numericamente por segmento: 2 < 10, 02.01 < 02.01.01 < 02.02. */
export function compareItemCodes(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    const na = Number(pa[i])
    const nb = Number(pb[i])
    const diff = Number.isNaN(na) || Number.isNaN(nb) ? pa[i]!.localeCompare(pb[i]!) : na - nb
    if (diff) return diff
  }
  return 0
}

// ----------------------------------------------------------------------------- orçamentos disponíveis
export interface BudgetSheetKey {
  /** Empresa_pla (nº da empresa na UAU) */
  company: string
  /** Obra_pla (código da obra na UAU) */
  work: string
  /** NumOrca_pla */
  budget: string
}

export interface BudgetSheetEntry extends BudgetSheetKey {
  services: number
  lines: number
  total: string
}

export const sameBudget = (a: BudgetSheetKey, b: BudgetSheetKey) => a.company === b.company && a.work === b.work && a.budget === b.budget

const keyOf = (r: Cell[], cols: SheetColumns): BudgetSheetKey => ({
  company: text(r[cols.company]),
  work: text(r[cols.work]).toUpperCase(),
  budget: text(r[cols.budget]),
})

/** Orçamentos presentes na aba (uma entrada por empresa + obra + nº do orçamento). */
export function listSheetBudgets(rows: Cell[][]): BudgetSheetEntry[] {
  const [header, ...data] = rows
  if (!header) return []
  const cols = readSheetColumns(header)
  const map = new Map<string, BudgetSheetEntry & { items: Set<string>; sum: Decimal }>()
  for (const r of data) {
    const key = keyOf(r, cols)
    if (!key.work || !key.budget) continue
    const id = `${key.company}|${key.work}|${key.budget}`
    const e = map.get(id) ?? { ...key, services: 0, lines: 0, total: '0', items: new Set<string>(), sum: Decimal.ZERO }
    e.items.add(text(r[cols.item]))
    e.lines++
    e.sum = e.sum.plus(lineTotal(r, cols) ?? Decimal.ZERO)
    map.set(id, e)
  }
  return [...map.values()]
    .map(({ items, sum, ...e }) => ({ ...e, services: items.size, total: sum.round(4).toDb() }))
    .sort((a, b) => a.work.localeCompare(b.work) || Number(a.budget) - Number(b.budget) || a.company.localeCompare(b.company))
}

// ----------------------------------------------------------------------------- orçamento estruturado
export interface AuxComposition {
  code: string
  description: string
  unit: string | null
  /** Quantidade da auxiliar por unidade do serviço (ItemCoef) */
  coefficient: string
  /** Custo unitário da auxiliar (ItemPreco) */
  unitCost: string
}

export type SheetBudgetLine = ImportedLine & { aux: AuxComposition | null }

export interface SheetBudget extends Omit<BudgetImportResult, 'lines' | 'layout'> {
  layout: 'bd-orcamentos'
  key: BudgetSheetKey
  lines: SheetBudgetLine[]
}

/** Total da linha: QtdPai × PrecoItem (como a planilha); PrecoFinal só quando não der para calcular. */
function lineTotal(r: Cell[], cols: SheetColumns): Decimal | null {
  const qty = exact(r[cols.itemQuantity])
  const unit = exact(r[cols.unitCost])
  if (qty && unit) return qty.times(unit)
  return cols.total >= 0 ? exact(r[cols.total]) : null
}

/** Grupos da EAP acima de um item: 02.06.01.03 → 02, 02.06, 02.06.01 */
const parentsOf = (item: string) => {
  const parts = item.split('.')
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('.'))
}

/** Monta o orçamento de uma obra a partir das linhas da aba. */
export function buildSheetBudget(rows: Cell[][], key: BudgetSheetKey): SheetBudget {
  const [header, ...data] = rows
  if (!header) throw new Error('A aba de orçamentos está vazia.')
  const cols = readSheetColumns(header)
  const warnings: string[] = []

  const mine = data.map((r, i) => ({ r, row: i + 2 })).filter(({ r }) => sameBudget(keyOf(r, cols), key))
  if (!mine.length) throw new Error(`Orçamento ${key.budget} da obra ${key.work} (empresa ${key.company}) não encontrado na planilha.`)

  const activities = new Map<string, ImportedActivity & { sum: Decimal }>()
  const materials = new Map<string, ImportedMaterial>()
  const pending: (SheetBudgetLine & { sortKey: string })[] = []
  let skipped = 0

  for (const { r, row } of mine) {
    const wbs = text(r[cols.item])
    const code = text(r[cols.material])
    const parentQty = exact(r[cols.itemQuantity])
    const coef = exact(r[cols.coef])
    const price = exact(r[cols.price])
    if (!wbs || !code || !parentQty || !coef || !price) {
      skipped++
      continue
    }
    const auxCode = text(r[cols.auxCode])
    const isAux = !!auxCode || text(r[cols.auxFlag]) === '1'
    const subCoef = isAux ? exact(r[cols.subCoef]) : null
    const subPrice = isAux ? exact(r[cols.subPrice]) : null
    if (isAux && (!subCoef || !subPrice || !auxCode)) {
      skipped++
      continue
    }

    const quantity = parentQty.times(coef).times(subCoef ?? 1)
    const unitCost = subPrice ?? price
    const total = lineTotal(r, cols) ?? quantity.times(unitCost)

    const act = activities.get(wbs) ?? {
      wbs,
      code: cols.serviceCode >= 0 ? text(r[cols.serviceCode]) || null : null,
      description: text(r[cols.itemDescription]),
      unit: text(r[cols.itemUnit]) || null,
      quantity: parentQty.round(4).toDb(),
      unitCost: '0',
      sum: Decimal.ZERO,
    }
    act.sum = act.sum.plus(total)
    activities.set(wbs, act)

    const packageCode = (cols.package >= 0 && text(r[cols.package])) || wbs
    const packageDescription = cols.package >= 0 && text(r[cols.package]) ? text(r[cols.packageDescription]) || packageCode : act.description

    pending.push({
      lineKey: '',
      sourceRow: row,
      activityWbs: wbs,
      materialCode: code,
      quantity: quantity.round(4).toDb(),
      unitCost: unitCost.round(4).toDb(),
      total: total.round(4).toDb(),
      packageCode,
      packageDescription,
      aux: isAux
        ? {
            code: auxCode,
            description: text(r[cols.auxDescription]),
            unit: text(r[cols.auxUnit]) || null,
            coefficient: coef.toFixed(8).replace(/\.?0+$/, ''),
            unitCost: price.round(4).toDb(),
          }
        : null,
      // Dentro do serviço: insumos diretos e auxiliares lado a lado, pelo código
      sortKey: `${isAux ? auxCode : code}\u0000${code}`,
    })
    if (!materials.has(code)) {
      materials.set(code, { code, description: text(r[cols.materialDescription]) || code, unit: text(r[cols.materialUnit]) || 'un' })
    }
  }
  if (!pending.length) throw new Error('O orçamento não tem linhas de insumo válidas.')
  if (skipped) warnings.push(`${skipped} linha(s) sem item, insumo, quantidade, coeficiente ou preço foram ignoradas.`)
  if (cols.package < 0) warnings.push('A planilha não tem coluna de Vínculo PL: cada linha fica vinculada ao próprio item do orçamento (Item_pla).')

  // Ordem pelos códigos e chave estável por linha (reimportar não perde vínculos com QCs)
  pending.sort((a, b) => compareItemCodes(a.activityWbs, b.activityWbs) || a.sortKey.localeCompare(b.sortKey) || a.sourceRow - b.sourceRow)
  const seen = new Map<string, number>()
  const lines: SheetBudgetLine[] = pending.map(({ sortKey: _s, ...l }) => {
    const base = `${l.activityWbs}|${l.aux ? `${l.aux.code}>` : ''}${l.materialCode}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { ...l, lineKey: n === 1 ? base : `${base}|${n}` }
  })

  const acts = [...activities.values()].sort((a, b) => compareItemCodes(a.wbs, b.wbs))
  const groupCodes = [...new Set(acts.flatMap((a) => parentsOf(a.wbs)))].filter((g) => !activities.has(g)).sort(compareItemCodes)
  // A planilha não traz o nome dos grupos: usa o código
  const groups: ImportedGroup[] = groupCodes.map((wbs) => ({ wbs, description: `Item ${wbs}` }))

  const packages = new Map<string, { packageCode: string; description: string; total: Decimal; lines: number }>()
  for (const l of lines) {
    const p = packages.get(l.packageCode!) ?? { packageCode: l.packageCode!, description: l.packageDescription ?? l.packageCode!, total: Decimal.ZERO, lines: 0 }
    p.total = p.total.plus(l.total)
    p.lines++
    packages.set(l.packageCode!, p)
  }

  const total = Decimal.sum(lines.map((l) => l.total))
  return {
    layout: 'bd-orcamentos',
    key,
    sheetHeaderRow: 1,
    groups,
    activities: acts.map(({ sum, ...a }) => ({
      ...a,
      unitCost: Decimal.from(a.quantity).isPositive() ? sum.div(a.quantity, 8).round(4).toDb() : '0.0000',
    })),
    lines,
    materials: [...materials.values()],
    total: total.toDb(),
    compositionsTotal: total.toDb(),
    declaredTotal: null,
    packages: [...packages.values()].sort((a, b) => compareItemCodes(a.packageCode, b.packageCode)).map((p) => ({ ...p, total: p.total.toDb() })),
    warnings,
  }
}
