/**
 * Avisos por e-mail (envio ainda não definido).
 *
 * Quando um diretor aprova ou reprova a etapa de outro diretor (os diretores aprovam os QCs uns dos
 * outros), o dono do pedido deve ser avisado por e-mail. O meio de envio será decidido depois; por
 * ora o aviso é montado e guardado nesta caixa de saída em memória, para o envio ser ligado aqui.
 */
export interface CrossDirectorNotice {
  /** QC (ou aditivo) decidido */
  subject: string
  competitionId: string
  stepName: string
  /** Diretor dono da etapa */
  directorId: string | null
  /** Quem decidiu no lugar dele */
  decidedBy: string
  decision: 'approved' | 'rejected'
  at: string
}

const outbox: CrossDirectorNotice[] = []

export async function notifyCrossDirectorDecision(notice: CrossDirectorNotice): Promise<void> {
  // TODO(e-mail): enviar ao dono do pedido quando o meio de envio estiver definido.
  outbox.push(notice)
}

/** Avisos montados e ainda não enviados (testes e futura rotina de envio) */
export function pendingCrossDirectorNotices(): readonly CrossDirectorNotice[] {
  return outbox
}
