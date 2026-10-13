/**
 * Anexos no Supabase: metadados em public.attachments (RLS 006/014) e binários no bucket privado
 * qc-attachments (políticas 007/014). Tudo com o client do usuário — o banco reaplica as permissões.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttachmentEntity } from '../../../shared/contracts'
import type { AttachmentRecord, AttachmentRepository, FileStorage } from '../../application/ports'

const BUCKET = 'qc-attachments'
const COLS = 'id, work_id, entity_type, entity_id, category, storage_path, file_name, mime_type, size_bytes, description, competition_supplier_id, uploaded_by, uploaded_at'

type Json = Record<string, unknown>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must<T = any>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

export function createSupabaseAttachments(db: SupabaseClient): AttachmentRepository {
  const toRecords = async (rows: Json[]): Promise<AttachmentRecord[]> => {
    const ids = [...new Set(rows.map((r) => r.uploaded_by).filter(Boolean))] as string[]
    const people = ids.length ? (must(await db.from('profiles').select('id, full_name').in('id', ids)) as { id: string; full_name: string }[]) : []
    return rows.map((r) => {
      const p = people.find((x) => x.id === r.uploaded_by)
      return {
        id: r.id as string,
        workId: r.work_id as string,
        entityType: r.entity_type as AttachmentEntity,
        entityId: r.entity_id as string,
        category: r.category as AttachmentRecord['category'],
        storagePath: r.storage_path as string,
        fileName: r.file_name as string,
        mimeType: (r.mime_type as string) ?? null,
        sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
        description: (r.description as string) ?? null,
        competitionSupplierId: (r.competition_supplier_id as string) ?? null,
        uploadedBy: p ? { id: p.id, fullName: p.full_name } : r.uploaded_by ? { id: r.uploaded_by as string, fullName: '—' } : null,
        uploadedAt: r.uploaded_at as string,
      }
    })
  }

  return {
    async list(f) {
      let q = db.from('attachments').select(COLS).eq('work_id', f.workId)
      if (f.entityType) q = q.eq('entity_type', f.entityType)
      if (f.entityId) q = q.eq('entity_id', f.entityId)
      return toRecords(must(await q.order('uploaded_at', { ascending: false })))
    },
    async get(id) {
      const r = must(await db.from('attachments').select(COLS).eq('id', id).maybeSingle()) as Json | null
      return r ? (await toRecords([r]))[0]! : null
    },
    async create(d, actorId) {
      const r = must(
        await db
          .from('attachments')
          .insert({
            work_id: d.workId,
            entity_type: d.entityType,
            entity_id: d.entityId,
            category: d.category,
            bucket: BUCKET,
            storage_path: d.storagePath,
            file_name: d.fileName,
            mime_type: d.mimeType,
            size_bytes: d.sizeBytes,
            description: d.description,
            competition_supplier_id: d.competitionSupplierId,
            uploaded_by: actorId,
          })
          .select('id')
          .single(),
      ) as { id: string }
      return r.id
    },
    async delete(id) {
      must(await db.from('attachments').delete().eq('id', id))
    },
  }
}

export function createSupabaseStorage(db: SupabaseClient): FileStorage {
  const bucket = () => db.storage.from(BUCKET)
  return {
    async createUploadUrl(path, mimeType) {
      const { data, error } = await bucket().createSignedUploadUrl(path)
      if (error || !data) throw new Error(`Não foi possível autorizar o envio: ${error?.message ?? 'sem resposta'}`)
      return { uploadUrl: data.signedUrl, headers: { 'content-type': mimeType, 'x-upsert': 'false' } }
    },
    async createDownloadUrl(path, fileName) {
      const { data, error } = await bucket().createSignedUrl(path, 60, { download: fileName })
      if (error || !data) throw new Error(`Não foi possível gerar o link do anexo: ${error?.message ?? 'sem resposta'}`)
      return data.signedUrl
    },
    async stat(path) {
      const dir = path.slice(0, path.lastIndexOf('/'))
      const name = path.slice(path.lastIndexOf('/') + 1)
      const { data, error } = await bucket().list(dir, { search: name, limit: 5 })
      if (error) throw new Error(error.message)
      const f = data?.find((x) => x.name === name)
      if (!f) return null
      const size = (f.metadata as { size?: number } | null)?.size
      return { size: typeof size === 'number' ? size : null }
    },
    async remove(path) {
      const { error } = await bucket().remove([path])
      if (error) throw new Error(error.message)
    },
  }
}
