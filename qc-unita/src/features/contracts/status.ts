import type { AddendumStatus, ContractRequestStatus } from '@shared/contracts'
import type { Tone } from '@/components/ui'

export const contractStatus: Record<ContractRequestStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  submitted: { label: 'Enviada a Contratos', tone: 'warning' },
  sent_to_erp: { label: 'No ERP', tone: 'info' },
  signed: { label: 'Assinado', tone: 'success' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
}

export const addendumStatus: Record<AddendumStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  submitted: { label: 'Aguardando aprovação', tone: 'warning' },
  approved: { label: 'Aprovado', tone: 'success' },
  rejected: { label: 'Reprovado', tone: 'error' },
}

/** "1º aditamento" */
export const ordinal = (n: number) => `${n}º`
