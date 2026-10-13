/**
 * Fonte de orçamentos do modo demonstração: linhas no formato da aba "BD_Orcamentos" para as
 * obras do MockERPProvider (2041, 2055, 1980) e para a obra 2070, que só existe na "UAU" e pode
 * ser criada pela tela. Passa pelo mesmo parser da planilha real (shared/domain/budget/budget-sheet).
 */
import type { SheetBudgetDTO } from '../../../shared/contracts'
import { buildSheetBudget, listSheetBudgets, type BudgetSheetKey, type SheetBudget } from '../../../shared/domain/budget/budget-sheet'
import type { Cell } from '../../../shared/domain/budget/excel-import'
import type { BudgetSheetSource } from '../../application/ports'

export const SHEET_HEADER = [
  'Empresa_pla', 'Obra_pla', 'NumOrca_pla', 'NumOrca_pla2', 'Item_pla', 'Descr_pla', 'unid_pla', 'QtdPai', 'ItemPreco', 'ItemCoef', 'SubItemPreco',
  'SubItemCoef', 'PrecoItem', 'PrecoFinal', 'Insumo', 'TIns_cio', 'TipoInsumo', 'Cod_comp', 'Descr_comp', 'Unid_comp', 'Descr_ins', 'CodUn_UnIns',
]

// Insumos com a mesma descrição/unidade do orçamento de exemplo (fixtures/budget-sample.json)
const MATERIALS: Record<string, [string, string]> = {
  IM00002: ['Tinta acrílica fosco - (NBR 14942)', 'l'],
  IM00012: ['Cimento CP II-32 - (NBR 11578)', 'kg'],
  IM00013: ['Areia média - (NBR 7211)', 'm³'],
  IM00014: ['Brita 2 (dois) - (NBR 7211)', 'm³'],
  IM00258: ['Primer - (NBR 9686)', 'l'],
  IM00275: ['Argamassa colante AC1 cinza - (NBR 14081)', 'kg'],
  IP00302: ['Servente/Ajudante (com encargos)', 'VB'],
  IP00349: ['Oficial (com encargos)', 'h'],
  IS00012: ['Serviço de contra piso, incluso preparo da argamassa', 'm²'],
  IS00075: ['Serviço de pintura acrílica', 'm²'],
  IS00093: ['Serviço de proteção mecânica para manta asfaltica', 'm²'],
  IS00094: ['Execução de impermeabilização com manta asfáltica, uma camada, aderida à maçarico', 'm²'],
}

/** Composição auxiliar: insumos com [preço, coeficiente] por unidade da auxiliar */
const CONCRETO = {
  code: 'CPU00312',
  description: 'CONCRETO NÃO ESTRUTURAL',
  unit: 'm³',
  inputs: [['IM00012', 0.58, 220], ['IM00013', 98, 0.677], ['IM00014', 92, 0.83], ['IP00302', 22.5, 6]] as [string, number, number][],
}
type Input = [code: string, price: number, coef: number] | { aux: typeof CONCRETO; coef: number }

/** Serviços do orçamento: [item, descrição, unidade, quantidade base, insumos] */
const SERVICES: [string, string, string, number, Input[]][] = [
  ['01.01', 'LOCAÇÃO DA OBRA', 'm²', 1200, [['IP00349', 32.5, 0.05], ['IP00302', 22.5, 0.1]]],
  ['01.02', 'FABRICAÇÃO DE GABARITO', 'm', 510, [{ aux: CONCRETO, coef: 0.02545 }, ['IM00002', 14.35, 0.15]]],
  ['02.01.01', 'CONTRAPISO', 'm²', 3400, [['IS00012', 28.9, 1], ['IM00275', 0.95, 4]]],
  ['02.01.02', 'IMPERMEABILIZAÇÃO COM MANTA ASFÁLTICA', 'm²', 850, [['IS00094', 42, 1], ['IM00258', 21.4, 0.3], ['IS00093', 18, 1]]],
  ['02.02.01', 'PINTURA ACRÍLICA', 'm²', 9800, [['IS00075', 16.8, 1], ['IM00002', 14.35, 0.17]]],
]

/** Orçamentos de exemplo: [Empresa_pla, Obra_pla, NumOrca_pla, fator de quantidade] */
const BUDGETS: [number, string, number, number][] = [
  [1, '2041', 1, 1],
  [1, '2041', 2, 1.08],
  [1, '2055', 1, 0.7],
  [2, '1980', 1, 0.5],
  // Empresa na planilha diferente da empresa da obra na UAU (2), como acontece na planilha real
  [72, '2070', 3, 1.3],
]

const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d

/** Linhas da aba de exemplo (1ª = cabeçalho) */
export function mockSheetRows(): Cell[][] {
  const rows: Cell[][] = [SHEET_HEADER]
  for (const [company, work, budget, factor] of BUDGETS) {
    for (const [item, descr, unit, baseQty, inputs] of SERVICES) {
      const qty = round(baseQty * factor, 2)
      const base = [company, work, budget, budget, item, descr, unit, qty]
      for (const input of inputs) {
        if (Array.isArray(input)) {
          const [code, price, coef] = input
          const precoItem = round(price * coef)
          rows.push([...base, price, coef, null, null, precoItem, round(qty * precoItem, 4), code, 0, 'Insumo', null, null, null, ...MATERIALS[code]!])
          continue
        }
        // Auxiliar aberta: uma linha por insumo dela
        const { aux, coef } = input
        const auxPrice = round(aux.inputs.reduce((s, [, p, c]) => s + p * c, 0), 4)
        for (const [code, price, subCoef] of aux.inputs) {
          const precoItem = round(price * subCoef * coef)
          rows.push([
            ...base, auxPrice, coef, price, subCoef, precoItem, round(qty * precoItem, 4), code, 1, 'Composição Auxiliar',
            aux.code, aux.description, aux.unit, ...MATERIALS[code]!,
          ])
        }
      }
    }
  }
  return rows
}

export class MockBudgetSheetSource implements BudgetSheetSource {
  readonly name = 'mock' as const
  readonly sheetName = 'BD_Orcamentos'
  private readonly rows = mockSheetRows()

  async listBudgets(workCode?: string): Promise<SheetBudgetDTO[]> {
    const work = workCode?.trim().toUpperCase()
    return listSheetBudgets(this.rows).filter((b) => !work || b.work === work)
  }

  async loadBudget(key: BudgetSheetKey): Promise<SheetBudget> {
    return buildSheetBudget(this.rows, key)
  }
}
