/**
 * Anexos (propostas, memoriais, documentos de contrato).
 *
 * Fluxo de envio em dois passos, para o binário não passar pela Vercel Function:
 *   1. requestUpload  → valida permissão/entidade e devolve uma URL assinada (PUT direto no Storage);
 *   2. confirmUpload  → confere que o objeto chegou e grava os metadados em attachments.
 * Caminho: {work_id}/{entity_type}/{entity_id}/{uuid}-{arquivo} (as políticas do Storage leem o work_id).
 */
import type { AttachmentDTO, AttachmentEntity, ConfirmUploadInput, RequestUploadInput, UploadTicketDTO } from '../../../shared/contracts'
import { AppError, can, notFound, requirePermission, type RequestContext } from '../context'
import type { AttachmentRecord, Repositories } from '../ports'

const isAdmin = (ctx: RequestContext) => ctx.actor.roles.some((r) => r.roleKey === 'admin' && r.workId === null)

/** Nome seguro para o caminho do Storage (sem acentos, barras ou espaços); o nome original fica nos metadados. */
export function safeFileName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return (base || 'arquivo').slice(-120)
}

/** Garante que a entidade existe e pertence à obra informada (o caminho do Storage depende disso). */
async function assertEntityInWork(repos: Repositories, workId: string, type: AttachmentEntity, id: string): Promise<{ frozen: boolean }> {
  const fail = () => {
    throw new AppError('ATTACHMENT_TARGET', 'O item ao qual o anexo se refere não pertence a esta obra.', 422)
  }
  switch (type) {
    case 'work':
      if (id !== workId) fail()
      return { frozen: false }
    case 'budget': {
      const work = await repos.catalog.getWork(workId)
      if (!work || work.currentBudgetId !== id) fail()
      return { frozen: false }
    }
    case 'competition': {
      const list = await repos.competitions.list({ workId })
      if (!list.some((c) => c.id === id)) fail()
      return { frozen: false }
    }
    case 'competition_revision': {
      const ref = await repos.competitions.getRevisionRef(id)
      if (!ref || ref.workId !== workId) fail()
      return { frozen: !!ref?.frozenAt }
    }
    case 'contract_request': {
      const c = await repos.contracts.get(id)
      if (!c || c.work.id !== workId) fail()
      return { frozen: false }
    }
    case 'contract_addendum': {
      const a = await repos.contracts.getAddendumRef(id)
      const c = a && (await repos.contracts.get(a.contractId))
      if (!c || c.work.id !== workId) fail()
      return { frozen: false }
    }
    default:
      throw new AppError('ATTACHMENT_TARGET', 'Tipo de anexo ainda não suportado.', 422)
  }
}

function toDto(ctx: RequestContext, r: AttachmentRecord, frozen: boolean): AttachmentDTO {
  const { storagePath: _path, ...rest } = r
  const owner = r.uploadedBy?.id === ctx.actor.id && can(ctx.actor, 'attachment.upload', r.workId)
  return { ...rest, canDelete: isAdmin(ctx) || (owner && !frozen) }
}

export async function listAttachments(repos: Repositories, ctx: RequestContext, filter: { workId: string; entityType?: AttachmentEntity; entityId?: string }) {
  requirePermission(ctx, 'competition.read', filter.workId)
  const rows = await repos.attachments.list(filter)
  const frozen = new Map<string, boolean>()
  for (const r of rows) {
    if (r.entityType === 'competition_revision' && !frozen.has(r.entityId)) frozen.set(r.entityId, !!(await repos.competitions.getRevisionRef(r.entityId))?.frozenAt)
  }
  return rows.map((r) => toDto(ctx, r, frozen.get(r.entityId) ?? false))
}

export async function requestUpload(repos: Repositories, ctx: RequestContext, input: RequestUploadInput): Promise<UploadTicketDTO> {
  requirePermission(ctx, 'attachment.upload', input.workId)
  await assertEntityInWork(repos, input.workId, input.entityType, input.entityId)
  const storagePath = `${input.workId}/${input.entityType}/${input.entityId}/${globalThis.crypto.randomUUID()}-${safeFileName(input.fileName)}`
  const { uploadUrl, headers } = await repos.storage.createUploadUrl(storagePath, input.mimeType)
  return { storagePath, uploadUrl, headers }
}

export async function confirmUpload(repos: Repositories, ctx: RequestContext, input: ConfirmUploadInput): Promise<AttachmentDTO> {
  requirePermission(ctx, 'attachment.upload', input.workId)
  const prefix = `${input.workId}/${input.entityType}/${input.entityId}/`
  if (!input.storagePath.startsWith(prefix) || input.storagePath.slice(prefix.length).includes('/')) {
    throw new AppError('ATTACHMENT_PATH', 'Caminho do anexo não confere com a obra/item informados.', 422)
  }
  const { frozen } = await assertEntityInWork(repos, input.workId, input.entityType, input.entityId)
  const stat = await repos.storage.stat(input.storagePath)
  if (!stat) throw new AppError('ATTACHMENT_MISSING', 'O arquivo não chegou ao armazenamento. Tente enviar de novo.', 409)

  const id = await repos.attachments.create(
    {
      workId: input.workId,
      entityType: input.entityType,
      entityId: input.entityId,
      category: input.category,
      storagePath: input.storagePath,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: stat.size ?? input.sizeBytes,
      description: input.description ?? null,
      competitionSupplierId: input.competitionSupplierId ?? null,
    },
    ctx.actor.id,
  )
  const row = await repos.attachments.get(id)
  if (!row) throw notFound('Anexo')
  return toDto(ctx, row, frozen)
}

export async function downloadUrl(repos: Repositories, ctx: RequestContext, id: string): Promise<{ url: string }> {
  const row = await repos.attachments.get(id)
  if (!row) throw notFound('Anexo')
  requirePermission(ctx, 'competition.read', row.workId)
  return { url: await repos.storage.createDownloadUrl(row.storagePath, row.fileName) }
}

export async function deleteAttachment(repos: Repositories, ctx: RequestContext, id: string): Promise<void> {
  const row = await repos.attachments.get(id)
  if (!row) throw notFound('Anexo')
  const frozen = row.entityType === 'competition_revision' && !!(await repos.competitions.getRevisionRef(row.entityId))?.frozenAt
  if (!toDto(ctx, row, frozen).canDelete) {
    throw new AppError('FORBIDDEN', frozen ? 'Anexo de revisão aprovada não pode ser removido.' : 'Só quem enviou o anexo (ou um administrador) pode removê-lo.', 403)
  }
  // Binário primeiro: a política do Storage confere o dono pelo metadado, que ainda existe aqui
  await repos.storage.remove(row.storagePath)
  await repos.attachments.delete(id)
}
