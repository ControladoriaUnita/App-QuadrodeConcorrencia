/**
 * Anexos de um QC ou de uma solicitação de contrato: arraste os arquivos (ou clique), escolha a
 * categoria e, nas propostas, o fornecedor. O arquivo vai direto para o armazenamento privado.
 */
import { useRef, useState, type DragEvent } from 'react'
import { Download, FileImage, FileSpreadsheet, FileText, FileArchive, Paperclip, Trash2, UploadCloud } from 'lucide-react'
import type { AttachmentCategory, AttachmentDTO } from '@shared/contracts'
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton, type Tone } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { cn } from '@/utils/cn'
import { EMPTY, formatDateTime } from '@/utils/format'
import { ACCEPT, openAttachment, useAttachments, useDeleteAttachment, useUploadAttachment, type AttachmentTarget } from './api'

export const categoryLabel: Record<AttachmentCategory, { label: string; tone: Tone }> = {
  proposal: { label: 'Proposta', tone: 'primary' },
  memorial: { label: 'Memorial / projeto', tone: 'info' },
  contract: { label: 'Contrato', tone: 'success' },
  addendum: { label: 'Aditivo', tone: 'warning' },
  supplier_document: { label: 'Documento do fornecedor', tone: 'neutral' },
  other: { label: 'Outros', tone: 'neutral' },
}

interface SupplierOption {
  id: string
  name: string
}

interface Upload {
  key: string
  name: string
  progress: number
  error?: string
}

export function formatBytes(n: number | null): string {
  if (n == null) return EMPTY
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB`
  return `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

function FileIcon({ mime }: { mime: string | null }) {
  const cls = 'size-4 shrink-0'
  if (mime?.startsWith('image/')) return <FileImage className={cn(cls, 'text-info')} aria-hidden />
  if (mime?.includes('sheet') || mime?.includes('excel') || mime === 'text/csv') return <FileSpreadsheet className={cn(cls, 'text-success')} aria-hidden />
  if (mime === 'application/zip') return <FileArchive className={cn(cls, 'text-warning')} aria-hidden />
  return <FileText className={cn(cls, 'text-primary')} aria-hidden />
}

export function AttachmentsPanel({
  target,
  categories,
  defaultCategory,
  suppliers,
  title = 'Anexos',
  description,
}: {
  target: AttachmentTarget
  categories: AttachmentCategory[]
  defaultCategory: AttachmentCategory
  /** Fornecedores do QC (para vincular propostas) */
  suppliers?: SupplierOption[]
  title?: string
  description?: string
}) {
  const { can } = useAuth()
  const list = useAttachments(target)
  const upload = useUploadAttachment(target)
  const remove = useDeleteAttachment(target)
  const input = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState<AttachmentCategory>(defaultCategory)
  const [supplierId, setSupplierId] = useState('')
  const [note, setNote] = useState('')
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const [deleting, setDeleting] = useState<AttachmentDTO | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const canUpload = can('attachment.upload')
  const supplierName = (id: string | null) => (id ? (suppliers?.find((s) => s.id === id)?.name ?? EMPTY) : null)

  const send = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Date.now()}`
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }])
      try {
        await upload.mutateAsync({
          file,
          category,
          description: note.trim() || null,
          competitionSupplierId: category === 'proposal' || category === 'supplier_document' ? supplierId || null : null,
          onProgress: (p) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))),
        })
        setUploads((u) => u.filter((x) => x.key !== key))
      } catch (e) {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: (e as Error).message } : x)))
      }
    }
    setNote('')
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (canUpload && e.dataTransfer.files.length) void send(e.dataTransfer.files)
  }

  const rows = list.data ?? []
  const th = 'border-b border-border bg-ink-50 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-text-muted'
  const td = 'border-b border-border px-3 py-2 align-middle'

  return (
    <Card>
      <CardHeader title={title} description={description} actions={<span className="text-xs text-text-muted">{rows.length} arquivo(s)</span>} />

      {canUpload && (
        <div className="grid gap-3 border-b border-border px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="grid content-start gap-3 sm:grid-cols-2">
            <Field label="Categoria">
              <Select value={category} onChange={(e) => setCategory(e.target.value as AttachmentCategory)}>
                {categories.map((c) => (
                  <option key={c} value={c}>{categoryLabel[c].label}</option>
                ))}
              </Select>
            </Field>
            {suppliers && (category === 'proposal' || category === 'supplier_document') && (
              <Field label="Fornecedor">
                <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">— Não vincular —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Observação (opcional)" className="sm:col-span-2">
              <Input maxLength={500} placeholder="Ex.: proposta revisada após equalização" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed px-4 py-4 text-center transition-colors',
              dragging ? 'border-primary bg-primary-soft' : 'border-border bg-ink-50 hover:border-primary/60',
            )}
          >
            <UploadCloud className="size-6 text-primary" aria-hidden />
            <p className="text-sm font-medium text-text">Arraste os arquivos aqui ou clique para escolher</p>
            <p className="text-xs text-text-muted">PDF, imagem, Excel, Word, ZIP ou CSV · até 50 MB cada</p>
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void send(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
          {uploads.length > 0 && (
            <ul className="grid gap-1.5 lg:col-span-2">
              {uploads.map((u) => (
                <li key={u.key} className="flex items-center gap-3 text-sm">
                  <Paperclip className="size-4 shrink-0 text-ink-400" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  {u.error ? (
                    <>
                      <span className="text-xs text-error">{u.error}</span>
                      <Button size="sm" variant="ghost" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>Fechar</Button>
                    </>
                  ) : (
                    <span className="flex w-48 items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-200">
                        <span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                      </span>
                      <span className="tabular w-9 text-right text-xs text-text-muted">{Math.round(u.progress * 100)}%</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {openError && <Alert tone="error" className="m-4">{openError}</Alert>}
      {list.error ? (
        <Alert tone="error" className="m-4">{(list.error as Error).message}</Alert>
      ) : list.isLoading ? (
        <div className="grid gap-2 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : !rows.length ? (
        <EmptyState title="Nenhum anexo" description="Propostas dos fornecedores, memoriais e projetos enviados aqui ficam guardados junto com o histórico." />
      ) : (
        <div className="overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={th}>Arquivo</th>
                <th className={th}>Categoria</th>
                {suppliers && <th className={th}>Fornecedor</th>}
                <th className={cn(th, 'text-right')}>Tamanho</th>
                <th className={th}>Enviado por</th>
                <th className={cn(th, 'w-24')} />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-ink-50">
                  <td className={td}>
                    <button
                      type="button"
                      className="flex max-w-md items-center gap-2 text-left font-medium text-text hover:text-primary hover:underline"
                      onClick={() => openAttachment(a.id).catch((e: Error) => setOpenError(e.message))}
                      title="Abrir / baixar"
                    >
                      <FileIcon mime={a.mimeType} />
                      <span className="truncate">{a.fileName}</span>
                    </button>
                    {a.description && <p className="ml-6 text-xs text-text-muted">{a.description}</p>}
                  </td>
                  <td className={td}>
                    <Badge tone={categoryLabel[a.category].tone}>{categoryLabel[a.category].label}</Badge>
                  </td>
                  {suppliers && <td className={cn(td, 'text-ink-700')}>{supplierName(a.competitionSupplierId) ?? EMPTY}</td>}
                  <td className={cn(td, 'tabular text-right whitespace-nowrap text-text-muted')}>{formatBytes(a.sizeBytes)}</td>
                  <td className={cn(td, 'whitespace-nowrap')}>
                    <p>{a.uploadedBy?.fullName ?? EMPTY}</p>
                    <p className="text-xs text-text-muted">{formatDateTime(a.uploadedAt)}</p>
                  </td>
                  <td className={cn(td, 'text-right whitespace-nowrap')}>
                    <Button size="sm" variant="ghost" aria-label={`Baixar ${a.fileName}`} icon={<Download className="size-4" />} onClick={() => openAttachment(a.id).catch((e: Error) => setOpenError(e.message))} />
                    {a.canDelete && <Button size="sm" variant="ghost" aria-label={`Remover ${a.fileName}`} icon={<Trash2 className="size-4 text-error" />} onClick={() => setDeleting(a)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Remover anexo?"
        description={`“${deleting?.fileName}” será apagado do armazenamento. A remoção fica registrada na auditoria.`}
        confirmLabel="Remover"
        tone="danger"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting.id).catch((e: Error) => setOpenError(e.message))
          setDeleting(null)
        }}
      />
    </Card>
  )
}
