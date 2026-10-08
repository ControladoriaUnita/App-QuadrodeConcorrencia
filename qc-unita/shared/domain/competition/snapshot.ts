/**
 * Snapshot histórico congelado de uma revisão aprovada.
 * JSON canônico (chaves ordenadas) + SHA-256 para comprovar integridade.
 */

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const obj = v as Record<string, unknown>
    // Objetos com toJSON (ex.: Decimal) serializam pelo próprio método
    if (typeof (obj as { toJSON?: unknown }).toJSON === 'function') return (obj as { toJSON(): unknown }).toJSON()
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .filter((k) => obj[k] !== undefined)
        .map((k) => [k, sortDeep(obj[k])]),
    )
  }
  return v
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function buildSnapshot(payload: Record<string, unknown>): Promise<{ snapshot: unknown; hash: string }> {
  const json = canonicalJson({ schemaVersion: 1, ...payload })
  return { snapshot: JSON.parse(json), hash: await sha256Hex(json) }
}
