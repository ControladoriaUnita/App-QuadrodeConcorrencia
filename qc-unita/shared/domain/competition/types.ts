import type { Decimal } from '../decimal'

export type RevisionStatus = 'draft' | 'in_approval' | 'approved' | 'rejected' | 'superseded'
export type CompetitionStatus = 'open' | 'in_approval' | 'approved' | 'contracted' | 'cancelled'
export type CompetitionSupplierStatus = 'invited' | 'responded' | 'declined' | 'disqualified'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'skipped'

export interface QcItem {
  id: string
  sortOrder: number
  code: string
  description: string
  unit: string
  budgetQuantity: Decimal
  budgetUnitCost: Decimal
  /** Quantidade equalizada usada para comparar propostas */
  quantity: Decimal
  pctMaterial: Decimal
  pctEquipment: Decimal
  pctRetention: Decimal
}

export interface QcSupplier {
  id: string // competition_supplier_id
  supplierId: string
  sortOrder: number
  status: CompetitionSupplierStatus
  legalName: string
  cndValidUntil: string | null
}

export interface QcPrice {
  competitionSupplierId: string
  itemId: string
  /** null = não cotado */
  unitPrice: Decimal | null
}

export interface BudgetEnvelope {
  /** Total orçado */
  budgetAmount: Decimal
  /** Verba já utilizada (consome a verba) */
  usedAmount: Decimal
  /** Acréscimos (+) / reduções (−) */
  adjustmentAmount: Decimal
}

export interface BestCondition {
  itemId: string
  competitionSupplierId: string | null
  unitPrice: Decimal | null
  totalPrice: Decimal | null
  budgetTotal: Decimal
  /** orçado − melhor (positivo = economia) */
  varianceAmount: Decimal | null
  varianceRatio: Decimal | null
  isOverride: boolean
  overrideReason: string | null
}

export interface BestConditionOverride {
  itemId: string
  competitionSupplierId: string
  reason: string
}

export interface SupplierSummary {
  competitionSupplierId: string
  total: Decimal
  quotedItems: number
  totalItems: number
  /** cotou todos os itens com quantidade > 0 */
  complete: boolean
  /** verba disponível − total da proposta */
  result: Decimal
  /** resultado / total orçado */
  resultRatio: Decimal | null
  /** 1 = menor total entre propostas completas */
  rank: number | null
  bestItemsCount: number
}
