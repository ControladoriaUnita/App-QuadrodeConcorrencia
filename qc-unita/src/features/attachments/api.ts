/**
 * Anexos: lista, envio (URL assinada → PUT direto no Storage → confirmação) e download.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AttachmentCategory, AttachmentDTO, AttachmentEntity, UploadTicketDTO } from '@shared/contracts'
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES } from '@shared/contracts'
import { api, ApiError } from '@/lib/api'

export interface AttachmentTarget {
  workId: string
  entityType: AttachmentEntity
  entityId: string
}

const key = (t: AttachmentTarget) => ['attachments', t.workId, t.entityType, t.entityId] as const

export const useAttachments = (t: AttachmentTarget) =>
  useQuery({
    queryKey: key(t),
    queryFn: () => api<AttachmentDTO[]>(`/attachments?${new URLSearchParams({ workId: t.workId, entityType: t.entityType, entityId: t.entityId })}`),
    enabled: !!t.entityId,
  })

/** Tipo MIME aceito pelo bucket; alguns navegadores mandam vazio para .xlsx/.csv — deduz pela extensão. */
export function mimeOf(file: File): string | null {
  const byExt: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
    zip: 'application/zip', csv: 'text/csv',
  }
  const t = (ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type) ? file.type : byExt[file.name.split('.').pop()?.toLowerCase() ?? '']
  return t ?? null
}

export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.docx,.doc,.zip,.csv'

function put(url: string, file: File, headers: Record<string, string>, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, 'UPLOAD', `Falha no envio do arquivo (${xhr.status}).`)))
    xhr.onerror = () => reject(new ApiError(0, 'UPLOAD', 'Falha de rede no envio do arquivo.'))
    xhr.send(file)
  })
}

export interface UploadInput {
  file: File
  category: AttachmentCategory
  description?: string | null
  competitionSupplierId?: string | null
  onProgress?: (ratio: number) => void
}

export function useUploadAttachment(t: AttachmentTarget) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, category, description, competitionSupplierId, onProgress }: UploadInput) => {
      const mimeType = mimeOf(file)
      if (!mimeType) throw new ApiError(422, 'MIME', `“${file.name}”: tipo não aceito (PDF, imagem, Excel, Word, ZIP ou CSV).`)
      if (file.size > ATTACHMENT_MAX_BYTES) throw new ApiError(422, 'SIZE', `“${file.name}” passa de 50 MB.`)
      const meta = { ...t, category, fileName: file.name, mimeType, sizeBytes: file.size, description: description || null, competitionSupplierId: competitionSupplierId || null }
      const ticket = await api<UploadTicketDTO>('/attachments/upload-url', { method: 'POST', body: meta })
      await put(ticket.uploadUrl, file, ticket.headers, onProgress ?? (() => {}))
      return api<AttachmentDTO>('/attachments', { method: 'POST', body: { ...meta, storagePath: ticket.storagePath } })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key(t) }),
  })
}

export function useDeleteAttachment(t: AttachmentTarget) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(t) }),
  })
}

/** Abre o link temporário de download (válido por 1 minuto). */
export async function openAttachment(id: string) {
  const { url } = await api<{ url: string }>(`/attachments/${id}/download`)
  window.open(url, '_blank', 'noopener')
}
