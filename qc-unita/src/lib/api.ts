/**
 * Cliente HTTP da API (/api/*). Nunca fala com ERP nem usa service role.
 */
import type { ApiErrorBody } from '@shared/contracts'
import { isDemoMode, supabase } from './supabase'

const DEMO_USER_KEY = 'qc.demoUser'

export function getDemoUser(): string | null {
  try {
    return localStorage.getItem(DEMO_USER_KEY)
  } catch {
    return null
  }
}
export function setDemoUser(id: string) {
  try {
    localStorage.setItem(DEMO_USER_KEY, id)
  } catch {
    /* armazenamento indisponível: segue com o usuário padrão */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly correlationId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-audit-origin': 'ui' }
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    if (data.session) headers.authorization = `Bearer ${data.session.access_token}`
  } else if (isDemoMode) {
    const demo = getDemoUser()
    if (demo) headers['x-demo-user'] = demo
  }
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error
    throw new ApiError(res.status, e?.code ?? 'HTTP', e?.message ?? `Erro ${res.status}`, e?.details, e?.correlationId)
  }
  return data as T
}
