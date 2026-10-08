/**
 * Clientes Supabase — SOMENTE server-side.
 *
 *  - userClient: usa SUPABASE_ANON_KEY + JWT do usuário → todas as consultas passam pelo RLS.
 *  - serviceClient: usa SUPABASE_SERVICE_ROLE_KEY → ignora RLS. Uso restrito à sincronização
 *    com ERP e a logs de integração. Nunca exposto ao browser (sem prefixo VITE_).
 *
 * Cabeçalhos de auditoria são enviados ao PostgREST e lidos pelo trigger audit_row_changes().
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RequestContext } from '../../application/context'

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`)
  return v
}

function auditHeaders(ctx: Pick<RequestContext, 'correlationId' | 'origin'> & { actorId?: string | null }) {
  const h: Record<string, string> = {
    'x-audit-origin': ctx.origin,
    'x-correlation-id': ctx.correlationId,
  }
  if (ctx.actorId) h['x-actor-id'] = ctx.actorId
  return h
}

const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

export function createUserClient(accessToken: string, ctx: Pick<RequestContext, 'correlationId' | 'origin'>): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: authOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}`, ...auditHeaders(ctx) } },
  })
}

export function createServiceClient(ctx: Pick<RequestContext, 'correlationId' | 'origin'> & { actorId?: string | null }): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: authOptions,
    global: { headers: auditHeaders(ctx) },
  })
}

/** Valida o JWT recebido e devolve o id do usuário. */
export async function verifyAccessToken(accessToken: string): Promise<string | null> {
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: authOptions })
  const { data, error } = await client.auth.getUser(accessToken)
  if (error || !data.user) return null
  return data.user.id
}
