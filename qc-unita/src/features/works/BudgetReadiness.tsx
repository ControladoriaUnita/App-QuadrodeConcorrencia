/**
 * Orçamento pronto para concorrência (shared/domain/budget/readiness): toda linha com IP e todo
 * Item com nome. Enquanto faltar algo, as telas avisam o que é e não deixam criar concorrência.
 */
import { useMemo } from 'react'
import type { BudgetLineDTO, BudgetStructureDTO } from '@shared/contracts'
import { budgetReadiness, missingSummary, type BudgetReadiness } from '@shared/domain/budget/readiness'
import { Alert } from '@/components/ui'

/** null enquanto a estrutura e as linhas não carregaram */
export function useBudgetReadiness(structure: BudgetStructureDTO | null | undefined, lines: Pick<BudgetLineDTO, 'packageCode'>[] | undefined): BudgetReadiness | null {
  return useMemo(() => (structure && lines ? budgetReadiness(structure.groups, lines) : null), [structure, lines])
}

export function BudgetIncompleteAlert({ readiness, className }: { readiness: BudgetReadiness; className?: string }) {
  return (
    <Alert tone="warning" className={className} title="Orçamento incompleto: ainda não é possível criar concorrência">
      Falta(m) {missingSummary(readiness)}. Escolha o IP das linhas no <b>Vínculo PL</b> (ou complete o <b>De-para</b> e use <b>Atualizar dados</b>) e dê nome aos
      Itens clicando no nome deles.
    </Alert>
  )
}
