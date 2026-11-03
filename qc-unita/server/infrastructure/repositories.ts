/**
 * Composição: escolhe a implementação dos repositórios conforme DATA_SOURCE.
 */
import type { Actor, RequestContext } from '../application/context'
import type { Repositories } from '../application/ports'
import { getMemoryDb } from './memory/memory-db'
import { createMemoryRepositories } from './memory/memory-repositories'
import { DEMO_USERS, ensureSeeded } from './memory/seed'
import { createServiceClient, createUserClient, verifyAccessToken } from './supabase/client'
import { createSupabaseRepositories } from './supabase/supabase-repositories'

export type DataSource = 'memory' | 'supabase'

export function dataSource(): DataSource {
  return process.env.DATA_SOURCE === 'supabase' ? 'supabase' : 'memory'
}

export interface Session {
  repos: Repositories
  actor: Actor
  /**
   * Repositórios sem as regras de acesso por linha (service_role no Supabase). Só para operações
   * que o caso de uso já restringiu ao administrador global (ex.: o simulado decide todas as alçadas).
   */
  elevated: () => Repositories
}

/**
 * Resolve repositórios + ator autenticado para a requisição.
 * - supabase: exige Bearer JWT válido do Supabase Auth.
 * - memory: modo demonstração; o usuário vem do cabeçalho x-demo-user (padrão: administrador).
 */
export async function openSession(
  req: { authorization: string | null; demoUser: string | null },
  ctx: Pick<RequestContext, 'correlationId' | 'origin'>,
): Promise<Session | null> {
  if (dataSource() === 'supabase') {
    const token = req.authorization?.replace(/^Bearer\s+/i, '')
    if (!token) return null
    const userId = await verifyAccessToken(token)
    if (!userId) return null
    const service = createServiceClient({ ...ctx, actorId: userId })
    const repos = createSupabaseRepositories(createUserClient(token, ctx), service)
    const actor = await repos.identity.loadActor(userId)
    return actor ? { repos, actor, elevated: () => createSupabaseRepositories(service, service) } : null
  }

  const db = getMemoryDb()
  await ensureSeeded(db)
  const userId = DEMO_USERS.some((u) => u.id === req.demoUser) ? req.demoUser! : DEMO_USERS[0].id
  const repos = createMemoryRepositories(db, { actorId: userId, origin: ctx.origin, correlationId: ctx.correlationId })
  const actor = await repos.identity.loadActor(userId)
  return actor ? { repos, actor, elevated: () => repos } : null
}
