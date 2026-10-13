/**
 * Anexos em memória (modo demonstração): metadados no MemoryDb e binários num mapa do processo.
 * As URLs "assinadas" apontam para /api/dev-storage/:token (só existe com DATA_SOURCE=memory),
 * reproduzindo o fluxo real: PUT direto do navegador e download por link temporário.
 */
import type { AttachmentEntity } from '../../../shared/contracts'
import type { AttachmentRecord, AttachmentRepository, FileStorage } from '../../application/ports'
import type { AuditCtx, MemoryDb, Row } from './memory-db'

interface StoredFile {
  bytes: Uint8Array
  mimeType: string
}
interface SignedEntry {
  op: 'upload' | 'download'
  path: string
  mimeType?: string
  fileName?: string
  expiresAt: number
}

// No globalThis para sobreviver ao recarregamento de módulos do vite dev (como o MemoryDb)
const g = globalThis as { __qcFiles?: Map<string, StoredFile>; __qcSigned?: Map<string, SignedEntry> }
const files = (g.__qcFiles ??= new Map())
const signed = (g.__qcSigned ??= new Map())

function sign(entry: Omit<SignedEntry, 'expiresAt'>, ttlMs: number): string {
  const token = globalThis.crypto.randomUUID()
  signed.set(token, { ...entry, expiresAt: Date.now() + ttlMs })
  return token
}

export function createMemoryAttachments(db: MemoryDb, audit: AuditCtx): AttachmentRepository {
  const toRecord = (r: Row): AttachmentRecord => {
    const by = typeof r.uploadedBy === 'string' ? db.get('profiles', r.uploadedBy) : undefined
    return {
      id: r.id,
      workId: r.workId as string,
      entityType: r.entityType as AttachmentEntity,
      entityId: r.entityId as string,
      category: r.category as AttachmentRecord['category'],
      storagePath: r.storagePath as string,
      fileName: r.fileName as string,
      mimeType: (r.mimeType as string) ?? null,
      sizeBytes: (r.sizeBytes as number) ?? null,
      description: (r.description as string) ?? null,
      competitionSupplierId: (r.competitionSupplierId as string) ?? null,
      uploadedBy: by ? { id: by.id, fullName: by.fullName as string } : null,
      uploadedAt: r.uploadedAt as string,
    }
  }
  return {
    async list(f) {
      return db
        .find('attachments', (r) => r.workId === f.workId && (!f.entityType || r.entityType === f.entityType) && (!f.entityId || r.entityId === f.entityId))
        .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))
        .map(toRecord)
    },
    async get(id) {
      const r = db.get('attachments', id)
      return r ? toRecord(r) : null
    },
    async create(data, actorId) {
      if (db.find('attachments', (r) => r.storagePath === data.storagePath).length) throw new Error('storage_path duplicado')
      return db.insert('attachments', { ...data, uploadedBy: actorId, uploadedAt: new Date().toISOString() }, audit, { workId: data.workId }).id
    },
    async delete(id) {
      const r = db.get('attachments', id)
      if (r) db.remove('attachments', id, audit, { workId: r.workId as string })
    },
  }
}

export function createMemoryStorage(): FileStorage {
  return {
    async createUploadUrl(path, mimeType) {
      return { uploadUrl: `/api/dev-storage/${sign({ op: 'upload', path, mimeType }, 10 * 60_000)}`, headers: { 'content-type': mimeType } }
    },
    async createDownloadUrl(path, fileName) {
      return `/api/dev-storage/${sign({ op: 'download', path, fileName }, 60_000)}`
    },
    async stat(path) {
      const f = files.get(path)
      return f ? { size: f.bytes.byteLength } : null
    },
    async remove(path) {
      files.delete(path)
    },
  }
}

/** Atende PUT/GET em /api/dev-storage/:token (somente modo demonstração). */
export async function handleDevStorage(req: Request, token: string): Promise<Response> {
  const entry = signed.get(token)
  if (!entry || entry.expiresAt < Date.now()) return new Response('Link expirado ou inválido.', { status: 403 })
  if (req.method === 'PUT' && entry.op === 'upload') {
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.byteLength > 50 * 1024 * 1024) return new Response('Arquivo acima de 50 MB.', { status: 413 })
    files.set(entry.path, { bytes, mimeType: entry.mimeType ?? 'application/octet-stream' })
    signed.delete(token)
    return new Response(JSON.stringify({ Key: entry.path }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (req.method === 'GET' && entry.op === 'download') {
    const f = files.get(entry.path)
    if (!f) return new Response('Arquivo não encontrado.', { status: 404 })
    return new Response(f.bytes, {
      status: 200,
      headers: {
        'content-type': f.mimeType,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(entry.fileName ?? 'arquivo')}`,
        'cache-control': 'no-store',
      },
    })
  }
  return new Response('Operação não permitida.', { status: 405 })
}
