import type { AddendumStatus, ContractRequestStatus } from '@shared/contracts'
import type { Tone } from '@/components/ui'

export const contractStatus: Record<ContractRequestStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  // sent_to_erp e signed: contratos antigos (antes de sair a assinatura); todos contam como concluídos
  submitted: { label: 'Concluído', tone: 'success' },
  sent_to_erp: { label: 'Concluído', tone: 'success' },
  signed: { label: 'Concluído', tone: 'success' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
}

export const addendumStatus: Record<AddendumStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  submitted: { label: 'Aguardando aprovação', tone: 'warning' },
  approved: { label: 'Aprovado', tone: 'success' },
  rejected: { label: 'Reprovado', tone: 'error' },
}
