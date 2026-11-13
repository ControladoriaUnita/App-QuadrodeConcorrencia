/**
 * Fluxos de aprovação configuráveis.
 *
 * Tipos de fluxo
 *  - competition: contratação (envio do QC). Escolhido pela origem (obra / Suprimentos), pelo tipo
 *    (material / mão de obra) e pelo diretor (RT, SR…) do pedido.
 *  - deviation: desvio de custo ou quantidade. Não se escolhe: quando o mapa tem desvio em alguma
 *    linha, as etapas dele entram no fim do plano da contratação.
 *  - addendum: aditivo / distrato; deadline: aditivo só de prazo. Vêm da tela de Contratos.
 *
 * Regras
 *  - Critério null = qualquer. Um critério preenchido precisa ser igual ao do pedido.
 *  - Entre os fluxos que servem, vence o mais específico (mais critérios preenchidos); empate fica
 *    com o de nome menor em ordem alfabética, para ser previsível.
 *  - Etapas ativas cuja alçada mínima é nula ou ≤ valor entram no plano, renumeradas 1, 2, 3…
 *  - Etapa "diretor responsável" fica com o diretor do pedido (directorId da instância).
 */
import { Decimal } from '../decimal'
import { DomainError } from '../competition/revision'
import type { ApprovalInstance } from './approval-flow'

export type FlowKind = 'competition' | 'deviation' | 'addendum' | 'deadline'
export type RequestKind = 'material' | 'labor'
export type RequestOrigin = 'work' | 'procurement'

export const REQUEST_KIND_LABEL: Record<RequestKind, string> = { material: 'Material', labor: 'Mão de obra' }
export const REQUEST_ORIGIN_LABEL: Record<RequestOrigin, string> = { work: 'Obra', procurement: 'Suprimentos' }
export const FLOW_KIND_LABEL: Record<FlowKind, string> = {
  competition: 'Contratação',
  deviation: 'Desvio de custo ou quantidade',
  addendum: 'Aditivo / distrato',
  deadline: 'Aditivo de prazo contratual',
}

export interface FlowStepLike {
  stepOrder: number
  name: string
  roleId: string
  director: boolean
  minAmount: Decimal | string | null
  active: boolean
}

export interface FlowLike {
  id: string
  kind: FlowKind
  name: string
  origin: RequestOrigin | null
  requestKind: RequestKind | null
  directorId: string | null
  active: boolean
  steps: FlowStepLike[]
}

export interface FlowContext {
  origin: RequestOrigin | null
  requestKind: RequestKind | null
  directorId: string | null
}

/** Fluxo do tipo pedido que vale para o contexto (o mais específico), ou null. */
export function matchFlow<F extends FlowLike>(flows: F[], kind: FlowKind, ctx: FlowContext): F | null {
  const fits = (criterion: string | null, value: string | null) => criterion === null || criterion === value
  const candidates = flows.filter(
    (f) => f.active && f.kind === kind && fits(f.origin, ctx.origin) && fits(f.requestKind, ctx.requestKind) && fits(f.directorId, ctx.directorId),
  )
  const score = (f: FlowLike) => [f.origin, f.requestKind, f.directorId].filter((x) => x !== null).length
  return [...candidates].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, 'pt-BR'))[0] ?? null
}

/** Etapas do fluxo que entram para o valor (ativas e dentro da alçada), na ordem. */
export function flowSteps(flow: FlowLike, amount: Decimal): FlowStepLike[] {
  return flow.steps
    .filter((s) => s.active && (s.minAmount === null || amount.gte(s.minAmount)))
    .sort((a, b) => a.stepOrder - b.stepOrder)
}

export interface FlowPlan {
  flow: FlowLike
  /** Fluxo de desvio somado, quando houve desvio */
  deviationFlow: FlowLike | null
  approvals: ApprovalInstance[]
}

/**
 * Plano de aprovação a partir dos fluxos. Devolve null quando nenhum fluxo do tipo serve (quem chama
 * usa o comportamento anterior). Com `deviation`, as etapas do fluxo de desvio vão para o fim.
 */
export function planFromFlows(flows: FlowLike[], kind: FlowKind, ctx: FlowContext, amount: Decimal, opts: { deviation?: boolean } = {}): FlowPlan | null {
  const flow = matchFlow(flows, kind, ctx)
  if (!flow) return null
  const deviationFlow = opts.deviation ? matchFlow(flows, 'deviation', ctx) : null
  const steps = [...flowSteps(flow, amount), ...(deviationFlow ? flowSteps(deviationFlow, amount) : [])]
  if (!steps.length) throw new DomainError('APPROVAL_PLAN_EMPTY', `O fluxo "${flow.name}" não tem etapas para este valor.`)
  return {
    flow,
    deviationFlow,
    approvals: steps.map<ApprovalInstance>((s, k) => ({
      stepOrder: k + 1,
      stepName: s.name,
      roleId: s.roleId,
      directorId: s.director ? ctx.directorId : null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
    })),
  }
}
