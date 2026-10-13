/**
 * Anexos em modo memória: URL de envio → PUT direto → confirmação → lista → download → remoção.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { AttachmentDTO, CompetitionListItemDTO, UploadTicketDTO } from '../../shared/contracts'
import { safeFileName } from '../application/use-cases/attachments'
import { DEMO_USERS } from '../infrastructure/memory/seed'
import { handle } from './router'

const [ADMIN, PROC, ENG, MGR] = DEMO_USERS.map((u) => u.id)

async function call<T = unknown>(method: string, path: string, body?: unknown, user = PROC): Promise<{ status: number; data: T }> {
  const res = await handle(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-demo-user': user! },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, data: (await res.json()) as T }
}

let qc: CompetitionListItemDTO
const bytes = new TextEncoder().encode('%PDF-1.4 proposta de teste')

beforeAll(async () => {
  process.env.DATA_SOURCE = 'memory'
  qc = (await call<CompetitionListItemDTO[]>('GET', '/competitions')).data.find((c) => c.title.startsWith('Pavimentação'))!
})

const meta = () => ({
  workId: qc.workId,
  entityType: 'competition',
  entityId: qc.id,
  category: 'proposal',
  fileName: 'Proposta Ação & Cia nº 12.pdf',
  mimeType: 'application/pdf',
  sizeBytes: bytes.byteLength,
})

describe('anexos', () => {
  it('nome do arquivo no caminho fica seguro', () => {
    expect(safeFileName('Proposta Ação & Cia nº 12.pdf')).toBe('Proposta-Acao-Cia-n-12.pdf')
    expect(safeFileName('../../etc/passwd')).toBe('etc-passwd')
    expect(safeFileName('   ')).toBe('arquivo')
  })

  it('envio completo, download e remoção pelo dono', async () => {
    const t = await call<UploadTicketDTO>('POST', '/attachments/upload-url', meta())
    expect(t.status).toBe(200)
    expect(t.data.storagePath.startsWith(`${qc.workId}/competition/${qc.id}/`)).toBe(true)

    // confirmar antes do arquivo chegar é recusado
    expect((await call('POST', '/attachments', { ...meta(), storagePath: t.data.storagePath })).status).toBe(409)

    const put = await handle(new Request(`http://localhost${t.data.uploadUrl}`, { method: 'PUT', headers: t.data.headers, body: bytes }))
    expect(put.status).toBe(200)
    const created = await call<AttachmentDTO>('POST', '/attachments', { ...meta(), storagePath: t.data.storagePath })
    expect(created.status).toBe(201)
    expect(created.data).toMatchObject({ fileName: 'Proposta Ação & Cia nº 12.pdf', sizeBytes: bytes.byteLength, canDelete: true })

    const list = await call<AttachmentDTO[]>('GET', `/attachments?workId=${qc.workId}&entityType=competition&entityId=${qc.id}`)
    expect(list.data.map((a) => a.id)).toContain(created.data.id)

    const link = await call<{ url: string }>('GET', `/attachments/${created.data.id}/download`)
    const file = await handle(new Request(`http://localhost${link.data.url}`))
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
    expect(file.headers.get('content-disposition')).toContain('Proposta')

    // outro usuário não remove; o dono remove
    expect((await call('DELETE', `/attachments/${created.data.id}`, undefined, ENG)).status).toBe(403)
    expect((await call('DELETE', `/attachments/${created.data.id}`)).status).toBe(200)
    expect((await call<AttachmentDTO[]>('GET', `/attachments?workId=${qc.workId}&entityId=${qc.id}`)).data.some((a) => a.id === created.data.id)).toBe(false)
  })

  it('valida permissão, tipo, tamanho e obra', async () => {
    expect((await call('POST', '/attachments/upload-url', meta(), MGR)).status).toBe(403)
    expect((await call('POST', '/attachments/upload-url', { ...meta(), mimeType: 'application/x-msdownload' })).status).toBe(422)
    expect((await call('POST', '/attachments/upload-url', { ...meta(), sizeBytes: 60 * 1024 * 1024 })).status).toBe(422)
    const other = (await call<{ id: string }[]>('GET', '/works', undefined, ADMIN)).data.find((w) => w.id !== qc.workId)!
    expect((await call('POST', '/attachments/upload-url', { ...meta(), workId: other.id }, ADMIN)).status).toBe(422)
  })

  it('caminho adulterado na confirmação é recusado', async () => {
    const t = await call<UploadTicketDTO>('POST', '/attachments/upload-url', meta())
    const r = await call('POST', '/attachments', { ...meta(), storagePath: t.data.storagePath.replace('/competition/', '/contract_request/') })
    expect(r.status).toBe(422)
  })
})
