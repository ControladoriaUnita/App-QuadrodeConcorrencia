import type { CompetitionStatus, RevisionStatus, SupplierParticipation } from '@shared/contracts'
import type { Tone } from '@/components/ui'

export const revisionStatus: Record<RevisionStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  in_approval: { label: 'Em aprovação', tone: 'warning' },
  approved: { label: 'Aprovada', tone: 'success' },
  rejected: { label: 'Reprovada', tone: 'error' },
  superseded: { label: 'Substituída', tone: 'neutral' },
}

export const competitionStatus: Record<CompetitionStatus, { label: string; tone: Tone }> = {
  open: { label: 'Em cotação', tone: 'primary' },
  in_approval: { label: 'Em aprovação', tone: 'warning' },
  approved: { label: 'Aprovada', tone: 'success' },
  contracted: { label: 'Contratada', tone: 'info' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
}

export const supplierStatus: Record<SupplierParticipation, { label: string; tone: Tone }> = {
  invited: { label: 'Convidado', tone: 'neutral' },
  responded: { label: 'Proposta recebida', tone: 'info' },
  declined: { label: 'Declinou', tone: 'warning' },
  disqualified: { label: 'Desclassificado', tone: 'error' },
}

export const approvalStatus = {
  pending: { label: 'Pendente', tone: 'neutral' as Tone },
  approved: { label: 'Aprovado', tone: 'success' as Tone },
  rejected: { label: 'Reprovado', tone: 'error' as Tone },
  skipped: { label: 'Não aplicável', tone: 'neutral' as Tone },
}

export const budgetTone = { within: 'success', attention: 'warning', over: 'error' } as const

export const entityLabel: Record<string, string> = {
  competitions: 'Concorrência',
  competition_revisions: 'Revisão',
  competition_items: 'Item',
  competition_suppliers: 'Fornecedor',
  supplier_proposals: 'Proposta',
  supplier_proposal_items: 'Preço',
  prices: 'Preço',
  best_conditions: 'Melhor condição',
  approvals: 'Aprovação',
  competition_item_links: 'Vínculo de planejamento',
}

export const fieldLabel: Record<string, string> = {
  unitPrice: 'R$ unitário', unit_price: 'R$ unitário', quantity: 'Quantidade', status: 'Status',
  winnerSupplierId: 'Vencedora', winner_supplier_id: 'Vencedora', winnerJustification: 'Justificativa', winner_justification: 'Justificativa',
  serviceStartOn: 'Início do serviço', service_start_on: 'Início do serviço', serviceEndOn: 'Término do serviço', service_end_on: 'Término do serviço',
  contractTypeId: 'Tipo de contrato', contract_type_id: 'Tipo de contrato', budgetUsedAmount: 'Verba já utilizada', budget_used_amount: 'Verba já utilizada',
  budgetAdjustmentAmount: 'Acréscimos/Reduções', budget_adjustment_amount: 'Acréscimos/Reduções', comment: 'Comentário',
  deliveryTerms: 'Prazo', delivery_terms: 'Prazo', paymentTerms: 'Pagamento', payment_terms: 'Pagamento',
  readjustmentTerms: 'Reajuste', readjustment_terms: 'Reajuste', decidedAt: 'Decidido em', decided_at: 'Decidido em',
  frozenAt: 'Congelada em', frozen_at: 'Congelada em', snapshotHash: 'Hash do snapshot', snapshot_hash: 'Hash do snapshot',
  pctMaterial: '% Material', pct_material: '% Material', pctEquipment: '% Equipamento', pct_equipment: '% Equipamento',
  pctRetention: '% Retenção', pct_retention: '% Retenção', scopeDescription: 'Escopo', scope_description: 'Escopo',
  engineeringOwnerId: 'Eng. responsável', engineering_owner_id: 'Eng. responsável', procurementOwnerId: 'Suprimentos', procurement_owner_id: 'Suprimentos',
  currentRevisionId: 'Revisão corrente', current_revision_id: 'Revisão corrente',
  proposalReceivedOn: 'Proposta recebida em', received_on: 'Proposta recebida em', proposalValidUntil: 'Validade da proposta',
  valid_until: 'Validade da proposta', proposalRef: 'Nº da proposta', proposal_ref: 'Nº da proposta', notes: 'Observações',
  strengths: 'Pontos positivos', weaknesses: 'Pontos negativos', engineeringNotes: 'Obs. engenharia', engineering_notes: 'Obs. engenharia',
  procurementNotes: 'Obs. suprimentos', procurement_notes: 'Obs. suprimentos', submittedAt: 'Enviada em', submitted_at: 'Enviada em',
  submittedBy: 'Enviada por', submitted_by: 'Enviada por', decidedBy: 'Decidido por', decided_by: 'Decidido por',
  contractNotes: 'Obs. contratos', packageCode: 'Vínculo PL', package_code: 'Vínculo PL', materialId: 'Insumo', material_id: 'Insumo', contract_notes: 'Obs. contratos', total_amount: 'Total da proposta',
}

/** Tradução de valores de enum exibidos na auditoria */
export const valueLabel: Record<string, string> = {
  draft: 'Rascunho', in_approval: 'Em aprovação', approved: 'Aprovado(a)', rejected: 'Reprovado(a)', superseded: 'Substituída',
  open: 'Em cotação', contracted: 'Contratada', cancelled: 'Cancelada', pending: 'Pendente', skipped: 'Não aplicável',
  invited: 'Convidado', responded: 'Proposta recebida', declined: 'Declinou', disqualified: 'Desclassificado',
}

export const originLabel: Record<string, string> = { ui: 'Aplicação', api: 'API', erp_sync: 'Sincronização ERP', system: 'Sistema' }
