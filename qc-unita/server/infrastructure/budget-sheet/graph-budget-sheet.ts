/**
 * Orçamentos da aba "BD_Orcamentos" (Excel no SharePoint) lidos pelo Microsoft Graph.
 *
 * A aba tem os orçamentos de TODAS as obras (centenas de milhares de linhas), então:
 *  - Índice: lê em blocos só as colunas de chave e de total (Empresa_pla, Obra_pla, NumOrca_pla,
 *    Item_pla, QtdPai, PrecoItem, PrecoFinal) e guarda em memória por alguns minutos. A lista de
 *    orçamentos sai inteira dele.
 *  - Orçamento: lê a linha inteira só nas faixas onde o orçamento aparece (descobertas pelo índice)
 *    e confere a chave de cada linha lida; se a planilha mudou desde o índice, refaz o índice uma vez.
 */
import type { SheetBudgetDTO } from '../../../shared/contracts'
import { buildSheetBudget, listSheetBudgets, readSheetColumns, type BudgetSheetKey, type SheetBudget, type SheetColumns } from '../../../shared/domain/budget/budget-sheet'
import type { Cell } from '../../../shared/domain/budget/excel-import'
import { AppError } from '../../application/context'
import type { BudgetSheetSource } from '../../application/ports'
import { rowSpans, type CellValue, type GraphClient, type SheetArea, type SheetRef } from '../microsoft-graph/graph-client'

export interface GraphBudgetSheetOptions {
  /** Validade do índice em memória (padrão 5 min) */
  cacheTtlMs?: number
  /** Células por chamada ao Graph */
  maxCells?: number
  /** Chamadas simultâneas ao Graph */
  concurrency?: number
}

interface SheetIndex {
  area: SheetArea
  /** Cabeçalho indexado pela coluna absoluta (A = 0) */
  header: Cell[]
  cols: SheetColumns
  /** Colunas de chave/total; rows[i] é a linha area.firstRow + 1 + i da aba */
  rows: CellValue[][]
  loadedAt: number
}

const text = (c: Cell) => (c === null || c === undefined ? '' : String(c).trim())

export class GraphBudgetSheetSource implements BudgetSheetSource {
  readonly name = 'sharepoint' as const
  private index: SheetIndex | null = null
  private pending: Promise<SheetIndex> | null = null
  private readonly ttl: number
  readonly sheetName: string

  constructor(
    private readonly client: GraphClient,
    private readonly ref: SheetRef,
    private readonly opts: GraphBudgetSheetOptions = {},
  ) {
    this.ttl = opts.cacheTtlMs ?? 5 * 60 * 1000
    this.sheetName = ref.sheet
  }

  async listBudgets(workCode?: string): Promise<SheetBudgetDTO[]> {
    const idx = await this.getIndex()
    const work = workCode?.trim().toUpperCase()
    const rows = work ? idx.rows.filter((r) => text(r[idx.cols.work]).toUpperCase() === work) : idx.rows
    return listSheetBudgets([idx.header, ...rows])
  }

  async loadBudget(key: BudgetSheetKey): Promise<SheetBudget> {
    for (let attempt = 0; ; attempt++) {
      const idx = await this.getIndex(attempt > 0)
      const matches = (r: Cell[]) => sameKey(r, idx.cols, key)
      const sheetRows = idx.rows.flatMap((r, i) => (matches(r) ? [idx.area.firstRow + 1 + i] : []))
      if (!sheetRows.length) {
        throw new AppError('SHEET_BUDGET_NOT_FOUND', `Orçamento ${key.budget} da obra ${key.work} (empresa ${key.company}) não encontrado na planilha.`, 404)
      }
      const rows = await this.client.readRows(this.ref, {
        columns: range(idx.area.firstColumn, idx.area.lastColumn),
        rows: rowSpans(sheetRows),
        maxCells: this.opts.maxCells,
        concurrency: this.opts.concurrency,
      })
      // A planilha pode ter mudado depois do índice (linhas deslocadas): confere antes de usar
      if (rows.every(matches)) {
        const budget = buildSheetBudget([idx.header, ...rows], key)
        // Linha de origem = linha real da aba (o parser numera a partir do recorte)
        return { ...budget, lines: budget.lines.map((l) => ({ ...l, sourceRow: sheetRows[l.sourceRow - 2] ?? l.sourceRow })) }
      }
      if (attempt) throw new AppError('SHEET_CHANGED', 'A planilha de orçamentos mudou durante a leitura. Tente de novo em instantes.', 409)
    }
  }

  /** Índice em cache; leituras simultâneas compartilham a mesma carga. */
  private async getIndex(force = false): Promise<SheetIndex> {
    if (!force && this.index && Date.now() - this.index.loadedAt < this.ttl) return this.index
    this.pending ??= this.buildIndex()
      .then((idx) => (this.index = idx))
      .finally(() => (this.pending = null))
    return this.pending
  }

  private async buildIndex(): Promise<SheetIndex> {
    const area = await this.client.usedRange(this.ref)
    const [first] = await this.client.readRows(this.ref, { columns: range(area.firstColumn, area.lastColumn), rows: [[area.firstRow, area.firstRow]] })
    const header: Cell[] = first ?? []
    const cols = readSheetColumns(header)
    const keyColumns = [cols.company, cols.work, cols.budget, cols.item, cols.itemQuantity, cols.unitCost, cols.total].filter((c) => c >= 0)
    const rows =
      area.lastRow > area.firstRow
        ? await this.client.readRows(this.ref, {
            columns: keyColumns,
            rows: [[area.firstRow + 1, area.lastRow]],
            maxCells: this.opts.maxCells,
            concurrency: this.opts.concurrency,
          })
        : []
    return { area, header, cols, rows, loadedAt: Date.now() }
  }
}

function sameKey(r: Cell[], cols: SheetColumns, key: BudgetSheetKey): boolean {
  return text(r[cols.work]).toUpperCase() === key.work.toUpperCase() && text(r[cols.budget]) === key.budget && text(r[cols.company]) === key.company
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
