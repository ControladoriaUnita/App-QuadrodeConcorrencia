/**
 * Contexto de execução de um caso de uso + erros de aplicação.
 */
import { DomainError } from '../../shared/domain/competition/revision'

export type AuditOrigin = 'ui' | 'api' | 'erp_sync' | 'system'

export interface ActorRole {
  roleId: string
  roleKey: string
  roleName: string
  workId: string | null
}

export interface Actor {
  id: string
  fullName: string
  email: string | null
  roles: ActorRole[]
  /** Permissões efetivas: chave + escopo (null = global) */
  permissions: { key: string; workId: string | null }[]
}

export interface RequestContext {
  correlationId: string
  actor: Actor
  origin: AuditOrigin
  now: () => Date
}

export function can(actor: Actor, permission: string, workId?: string | null): boolean {
  return actor.permissions.some((p) => p.key === permission && (p.workId === null || (workId != null && p.workId === workId)))
}

export function roleIdsFor(actor: Actor, workId: string): string[] {
  return actor.roles.filter((r) => r.workId === null || r.workId === workId).map((r) => r.roleId)
}

export function requirePermission(ctx: RequestContext, permission: string, workId?: string | null): void {
  if (!can(ctx.actor, permission, workId)) {
    throw new AppError('FORBIDDEN', 'Você não tem permissão para esta operação.', 403, { permission, workId })
  }
}

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} não encontrado(a).`, 404)

/** Converte erros de domínio/banco em AppError com status HTTP coerente. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (err instanceof DomainError) {
    const status = err.code.endsWith('FORBIDDEN') ? 403 : 409
    return new AppError(err.code, err.message, status, err.details)
  }
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('QC_REVISION_FROZEN')) {
    return new AppError('REVISION_FROZEN', 'Revisão aprovada é imutável. Crie uma nova revisão.', 409)
  }
  const locked = /(CONTRACT_LOCKED|ADDENDUM_LOCKED|ADDENDUM_NOT_ALLOWED): (.+)/.exec(msg)
  if (locked) return new AppError(locked[1]!, locked[2]!.charAt(0).toUpperCase() + locked[2]!.slice(1) + '.', 409)
  if (/works_code_key/.test(msg)) return new AppError('WORK_CODE_EXISTS', 'Já existe uma obra com este número.', 409)
  if (/contract_requests_one_active/.test(msg)) {
    return new AppError('CONTRACT_EXISTS', 'Já existe uma solicitação de contrato ativa para esta concorrência.', 409)
  }
  if (/row-level security|permission denied/i.test(msg)) {
    return new AppError('FORBIDDEN', 'Operação bloqueada pelas regras de acesso.', 403)
  }
  return new AppError('INTERNAL', 'Erro inesperado. Tente novamente.', 500)
}
