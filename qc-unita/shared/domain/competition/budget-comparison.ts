/**
 * Comparação com orçamento.
 *
 * Verba disponível = total orçado − verba já utilizada + acréscimos/reduções.
 * (Na planilha o usuário digitava "verba já utilizada" com sinal negativo e somava;
 *  aqui o sinal é explícito no domínio para evitar erro de lançamento.)
 */
import { Decimal } from '../decimal'
import type { BudgetEnvelope } from './types'

export type BudgetStatus = 'within' | 'attention' | 'over'

export function availableBudget(e: BudgetEnvelope): Decimal {
  return e.budgetAmount.minus(e.usedAmount).plus(e.adjustmentAmount)
}

export interface BudgetComparison {
  available: Decimal
  amount: Decimal
  /** disponível − valor (positivo = saldo/economia) */
  result: Decimal
  /** resultado / total orçado */
  resultRatio: Decimal | null
  status: BudgetStatus
}

/**
 * @param attentionThreshold razão de consumo da verba disponível a partir da qual sinaliza atenção (padrão 95%)
 */
export function compareWithBudget(
  envelope: BudgetEnvelope,
  amount: Decimal,
  attentionThreshold: Decimal = Decimal.from('0.95'),
): BudgetComparison {
  const available = availableBudget(envelope)
  const result = available.minus(amount)
  let status: BudgetStatus = 'within'
  if (result.isNegative()) status = 'over'
  else if (available.isPositive() && amount.div(available, 6).gte(attentionThreshold)) status = 'attention'
  return {
    available,
    amount,
    result,
    resultRatio: envelope.budgetAmount.isZero() ? null : result.div(envelope.budgetAmount, 6),
    status,
  }
}
