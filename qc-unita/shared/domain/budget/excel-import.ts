/**
 * Importação do orçamento da obra a partir do Excel (aba "Orçamento" do modelo de QC).
 *
 * Função pura: recebe a planilha como matriz de células (já lida por qualquer leitor de .xlsx)
 * e devolve a estrutura do orçamento. Usada no browser (prévia) e revalidada no servidor.
 *
 * Layouts aceitos (cabeçalho localizado automaticamente):
 *
 *   A) Orçamento analítico Unità ("ORC ANL", formato padrão):
 *      NÍVEL | ITEM_PLA | ITEM | SERVIÇO | DESCRIÇÕES | UNID. | QNT | CUSTO UNITÁRIO | CUSTO TOTAL
 *      - SERVIÇO = "Item"            → grupo da EAP (ITEM = 01, 02.01 …)
 *      - ITEM preenchido             → composição (CPU/CPO/CPL/ORC)
 *      - ITEM vazio                  → insumo da composição ITEM_PLA (IM/IS/IP; CPU auxiliar também vira linha)
 *      - "CUSTO RASO:" acima do cabeçalho → total declarado, usado para conferência
 *      - Vínculo PL é opcional (se a coluna existir, é lida)
 *
 *   B) Modelo da planilha de QC (aba "Orçamento"):
 *      [nº do item] | Item | Serviço | Código | Descrição | Unid | Quantidade | Custo Unit. | Custo Total | Vínculo PL | Classificação
 *
 * Valores numéricos do Excel chegam como double; são convertidos aqui para decimal de 4 casas
 * (fronteira única de conversão — daqui em diante tudo é Decimal/string).
 */
import { Decimal } from '../decimal'

export type Cell = string | number | boolean | Date | null | undefined

export interface ImportedGroup { wbs: string; description: string }
export interface ImportedActivity { wbs: string; code: string | null; description: string; unit: string | null; quantity: string; unitCost: string }
export interface ImportedLine {
  lineKey: string
  sourceRow: number
  activityWbs: string
  materialCode: string
  quantity: string
  unitCost: string
  /** Custo total da linha (coluna "Custo Total"; fonte da verdade do orçamento) */
  total: string
  packageCode: string | null
  packageDescription: string | null
}
export interface ImportedMaterial { code: string; description: string; unit: string }

export interface BudgetImportResult {
  sheetHeaderRow: number
  groups: ImportedGroup[]
  activities: ImportedActivity[]
  lines: ImportedLine[]
  materials: ImportedMaterial[]
  /** Σ custo total das linhas */
  total: string
  /** Σ custo total das composições (CPU/CPO) */
  compositionsTotal: string
  /** Total declarado na planilha ("CUSTO RASO"), quando houver */
  declaredTotal: string | null
  /** Layout reconhecido */
  layout: 'orc-analitico' | 'modelo-qc'
  packages: { packageCode: string; description: string; total: string; lines: number }[]
  warnings: string[]
}

const HEADERS = {
  item: ['item'],
  parentItem: ['item_pla', 'item pla', 'item_pai'],
  service: ['serviço', 'servico'],
  code: ['código', 'codigo'],
  description: ['descrição', 'descricao', 'descrições', 'descricoes'],
  unit: ['unid', 'unid.', 'unidade', 'un'],
  quantity: ['quantidade', 'quant.', 'qtde', 'qnt', 'qtd'],
  unitCost: ['custo unit.', 'custo unitário', 'custo unitario', 'r$ unit.'],
  total: ['custo total', 'r$ total', 'total'],
  package: ['vínculo pl', 'vinculo pl', 'vínculo', 'vinculo'],
  classification: ['classificação', 'classificacao'],
} as const
type Col = keyof typeof HEADERS

const norm = (c: Cell) => (c === null || c === undefined ? '' : String(c).trim())
const lower = (c: Cell) => norm(c).toLowerCase()

/** Converte célula numérica (double do Excel ou texto pt-BR) em decimal de 4 casas. */
export function cellDecimal(c: Cell): Decimal | null {
  if (c === null || c === undefined || c === '') return null
  if (typeof c === 'number') return Number.isFinite(c) ? Decimal.from(c).round(4) : null
  try {
    return Decimal.parseBR(String(c)).round(4)
  } catch {
    return null
  }
}

/** Nº de item vindo do Excel pode ser número (1, 1.01) — normaliza para texto da EAP. */
function wbsText(c: Cell): string {
  return norm(c)
}

export interface SheetHeader {
  row: number
  layout: BudgetImportResult['layout']
  cols: Record<Col, number>
  /** Coluna do código do insumo/composição */
  codeCol: number
  /** Coluna com o nº do item (preenchida só em grupos e composições) */
  itemNumberCol: number
  /** Coluna com o item da composição-pai do insumo (layout A) */
  parentCol: number
}

export function findHeader(rows: Cell[][]): SheetHeader | null {
  for (let r = 0; r < Math.min(rows.length, 50); r++) {
    const cells = (rows[r] ?? []).map(lower)
    const idx = (names: readonly string[]) => cells.findIndex((c) => names.includes(c))
    const cols = Object.fromEntries((Object.keys(HEADERS) as Col[]).map((k) => [k, idx(HEADERS[k])])) as Record<Col, number>
    if (cols.description < 0 || cols.quantity < 0 || cols.item < 0) continue
    if (cols.code >= 0) {
      // B) modelo de QC: exige Vínculo PL; o nº original do item fica imediatamente antes de "Item"
      if (cols.package < 0) continue
      return { row: r, layout: 'modelo-qc', cols, codeCol: cols.code, itemNumberCol: cols.item > 0 ? cols.item - 1 : -1, parentCol: -1 }
    }
    // A) orçamento analítico: "SERVIÇO" traz o código
    if (cols.service >= 0) {
      return { row: r, layout: 'orc-analitico', cols: { ...cols, service: -1 }, codeCol: cols.service, itemNumberCol: cols.item, parentCol: cols.parentItem }
    }
  }
  return null
}

/** "CUSTO RASO:" nas linhas acima do cabeçalho → primeiro número à direita. */
function declaredTotalOf(rows: Cell[][], headerRow: number): Decimal | null {
  for (let r = 0; r < headerRow; r++) {
    const row = rows[r] ?? []
    const at = row.findIndex((c) => /^custo raso\s*:?$/.test(lower(c)))
    if (at < 0) continue
    for (let c = at + 1; c < row.length; c++) {
      const d = typeof row[c] === 'number' ? cellDecimal(row[c]) : null
      if (d) return d
    }
  }
  return null
}

export function parseBudgetSheet(rows: Cell[][]): BudgetImportResult {
  const header = findHeader(rows)
  if (!header) {
    throw new Error(
      'Cabeçalho do orçamento não encontrado. Esperado: ITEM_PLA · ITEM · SERVIÇO · DESCRIÇÕES · UNID. · QNT · CUSTO UNITÁRIO · CUSTO TOTAL.',
    )
  }
  const { cols, itemNumberCol, parentCol, codeCol, layout } = header
  for (const required of ['unitCost', 'total'] as Col[]) {
    if (cols[required] < 0) throw new Error(`Coluna obrigatória ausente: ${HEADERS[required][0].toUpperCase()}`)
  }

  const warnings: string[] = []
  const groups: ImportedGroup[] = []
  const activities: ImportedActivity[] = []
  const activityByWbs = new Map<string, ImportedActivity>()
  const lines: ImportedLine[] = []
  const materials = new Map<string, ImportedMaterial>()
  const keyCount = new Map<string, number>()
  let currentActivity: ImportedActivity | null = null
  let noPackage = 0
  let totalMismatch = 0
  let compositionsTotal = Decimal.ZERO

  const get = (r: Cell[], c: Col) => (cols[c] >= 0 ? r[cols[c]] : null)

  for (let i = header.row + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const code = norm(r[codeCol])
    const description = norm(get(r, 'description'))
    if (!code && !description) continue
    const itemNumber = itemNumberCol >= 0 ? wbsText(r[itemNumberCol]) : ''
    const itemFilled = wbsText(get(r, 'item'))

    if (code.toLowerCase() === 'item') {
      if (itemNumber || itemFilled) groups.push({ wbs: itemNumber || itemFilled, description })
      currentActivity = null
      continue
    }

    const qty = cellDecimal(get(r, 'quantity')) ?? Decimal.ZERO
    const unitCost = cellDecimal(get(r, 'unitCost')) ?? Decimal.ZERO

    if (itemNumber) {
      const existing = activityByWbs.get(itemNumber)
      if (existing) {
        warnings.push(`Linha ${i + 1}: item ${itemNumber} repetido — os insumos seguintes entram na primeira ocorrência.`)
        currentActivity = existing
        continue
      }
      currentActivity = {
        wbs: itemNumber,
        code: code || null,
        description: norm(get(r, 'service')) || description,
        unit: norm(get(r, 'unit')) || null,
        quantity: qty.toDb(),
        unitCost: unitCost.toDb(),
      }
      activityByWbs.set(itemNumber, currentActivity)
      activities.push(currentActivity)
      compositionsTotal = compositionsTotal.plus(cellDecimal(get(r, 'total')) ?? qty.times(unitCost).round(4))
      continue
    }

    // Insumo: a composição-pai vem de ITEM_PLA (layout A) ou da última composição lida
    const parentWbs = parentCol >= 0 ? wbsText(r[parentCol]) : ''
    const activity = (parentWbs && activityByWbs.get(parentWbs)) || currentActivity
    if (!activity) {
      warnings.push(`Linha ${i + 1}: insumo ${code} sem composição acima — ignorado.`)
      continue
    }
    if (!code) {
      warnings.push(`Linha ${i + 1}: insumo sem código — ignorado.`)
      continue
    }
    const packageCode = norm(get(r, 'package')) || null
    if (!packageCode) noPackage++
    // O Custo Total da planilha é a referência; o unitário é derivado dele (evita divergência de arredondamento)
    const excelTotal = cellDecimal(get(r, 'total'))
    const computed = qty.times(unitCost).round(4)
    if (excelTotal && !excelTotal.minus(computed).abs().lte('0.05')) totalMismatch++
    const lineTotalValue = excelTotal ?? computed
    const lineUnit = qty.isPositive() ? lineTotalValue.div(qty, 4) : unitCost

    const base = `${activity.wbs}|${code}|${packageCode ?? '-'}`
    const n = (keyCount.get(base) ?? 0) + 1
    keyCount.set(base, n)
    lines.push({
      lineKey: n === 1 ? base : `${base}|${n}`,
      sourceRow: i + 1,
      activityWbs: activity.wbs,
      materialCode: code,
      quantity: qty.toDb(),
      unitCost: lineUnit.toDb(),
      total: lineTotalValue.toDb(),
      packageCode,
      packageDescription: packageCode ? norm(get(r, 'classification')) || packageCode : null,
    })
    if (!materials.has(code)) materials.set(code, { code, description, unit: norm(get(r, 'unit')) || 'un' })
  }

  if (!lines.length) throw new Error('Nenhuma linha de insumo encontrada abaixo do cabeçalho.')
  if (cols.package < 0) {
    warnings.push('A planilha não tem a coluna Vínculo PL: as linhas entram sem IP de planejamento.')
  } else if (noPackage) {
    warnings.push(`${noPackage} linha(s) de insumo sem Vínculo PL — não poderão ser vinculadas a um IP de planejamento.`)
  }
  if (totalMismatch) warnings.push(`${totalMismatch} linha(s) com Custo Total diferente de Quantidade × Custo Unit. — mantido o Custo Total da planilha.`)

  const lineTotal = (l: ImportedLine) => Decimal.from(l.total)
  const pk = new Map<string, { packageCode: string; description: string; total: Decimal; lines: number }>()
  for (const l of lines) {
    if (!l.packageCode) continue
    const e = pk.get(l.packageCode) ?? { packageCode: l.packageCode, description: l.packageDescription ?? l.packageCode, total: Decimal.ZERO, lines: 0 }
    e.total = e.total.plus(lineTotal(l))
    e.lines++
    pk.set(l.packageCode, e)
  }

  const total = Decimal.sum(lines.map(lineTotal))
  const declared = declaredTotalOf(rows, header.row)
  const reference = declared ?? (layout === 'orc-analitico' ? compositionsTotal : null)
  if (reference && !reference.minus(total).abs().lte('1')) {
    warnings.push(
      `Σ dos insumos (R$ ${total.toFixed(2)}) difere do ${declared ? 'custo raso da planilha' : 'total das composições'} (R$ ${reference.toFixed(2)}).`,
    )
  }

  return {
    sheetHeaderRow: header.row + 1,
    layout,
    compositionsTotal: compositionsTotal.toDb(),
    declaredTotal: declared?.toDb() ?? null,
    groups,
    activities,
    lines,
    materials: [...materials.values()],
    total: total.toDb(),
    packages: [...pk.values()].sort((a, b) => a.packageCode.localeCompare(b.packageCode)).map((p) => ({ ...p, total: p.total.toDb() })),
    warnings,
  }
}

/** Chaves estáveis para linhas vindas de outra origem (ERP): mesma regra do Excel. */
export function assignLineKeys<T extends { activityWbs: string; materialCode: string; packageCode: string | null; lineKey?: string }>(items: T[]): (T & { lineKey: string })[] {
  const count = new Map<string, number>()
  return items.map((it) => {
    if (it.lineKey) return it as T & { lineKey: string }
    const base = `${it.activityWbs}|${it.materialCode}|${it.packageCode ?? '-'}`
    const n = (count.get(base) ?? 0) + 1
    count.set(base, n)
    return { ...it, lineKey: n === 1 ? base : `${base}|${n}` }
  })
}
