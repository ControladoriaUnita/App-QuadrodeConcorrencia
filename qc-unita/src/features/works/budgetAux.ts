/**
 * Composições auxiliares abertas, como na tabela de origem: dentro de cada composição (serviço),
 * os insumos com o mesmo `aux.code` passam a ficar sob um nó da auxiliar (código, descrição,
 * unidade, coeficiente e custo unitário). Insumos diretos ficam no mesmo nível do nó auxiliar.
 * A ordem é a das linhas vindas do servidor (já por código); o nó entra na posição do 1º insumo dele.
 */
import type { AuxCompositionDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import type { BudgetTreeRow, TreeLineInput } from '@shared/domain/budget/structure'

export interface AuxRow {
  kind: 'aux'
  key: string
  level: number
  /** Composição (serviço) dona da auxiliar */
  parentKey: string
  activityWbs: string
  code: string
  description: string
  unit: string | null
  /** Quantidade da auxiliar por unidade do serviço */
  coefficient: Decimal
  unitCost: Decimal
  /** Σ custo total dos insumos da auxiliar */
  total: Decimal
  committed: Decimal
  lines: number
}

export type TreeRowWithAux<L> = BudgetTreeRow<L> | AuxRow

type AuxLine = TreeLineInput & { aux?: AuxCompositionDTO | null }

export function withAuxCompositions<L extends AuxLine>(tree: BudgetTreeRow<L>[]): TreeRowWithAux<L>[] {
  const out: TreeRowWithAux<L>[] = []
  let i = 0
  while (i < tree.length) {
    const row = tree[i++]!
    out.push(row)
    if (row.kind !== 'activity') continue

    // Insumos da composição vêm logo depois dela
    const own: Extract<BudgetTreeRow<L>, { kind: 'line' }>[] = []
    while (i < tree.length) {
      const next = tree[i]!
      if (next.kind !== 'line' || next.parentKey !== row.key) break
      own.push(next)
      i++
    }
    if (!own.some((r) => r.line.aux)) {
      out.push(...own)
      continue
    }

    // Cada posição é um insumo direto ou uma auxiliar (com seus insumos)
    const slots: (TreeRowWithAux<L> | { aux: AuxRow; lines: typeof own })[] = []
    const byCode = new Map<string, { aux: AuxRow; lines: typeof own }>()
    for (const r of own) {
      const aux = r.line.aux
      if (!aux) {
        slots.push(r)
        continue
      }
      let slot = byCode.get(aux.code)
      if (!slot) {
        slot = {
          aux: {
            kind: 'aux',
            key: `x:${row.wbs}:${aux.code}`,
            level: row.level + 1,
            parentKey: row.key,
            activityWbs: row.wbs,
            code: aux.code,
            description: aux.description,
            unit: aux.unit,
            coefficient: Decimal.from(aux.coefficient || '0'),
            unitCost: Decimal.from(aux.unitCost || '0'),
            total: Decimal.ZERO,
            committed: Decimal.ZERO,
            lines: 0,
          },
          lines: [],
        }
        byCode.set(aux.code, slot)
        slots.push(slot)
      }
      slot.aux.total = slot.aux.total.plus(r.total)
      slot.aux.committed = slot.aux.committed.plus(r.committed)
      slot.aux.lines++
      slot.lines.push({ ...r, level: r.level + 1, parentKey: slot.aux.key })
    }
    for (const s of slots) {
      if ('kind' in s) out.push(s)
      else out.push(s.aux, ...s.lines)
    }
  }
  return out
}
