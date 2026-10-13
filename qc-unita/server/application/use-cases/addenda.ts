/**
 * Casos de uso de aditivos e distratos da Solicitação de Contrato.
 *
 *   draft ──submit──▶ submitted ──Gerente/Diretoria──▶ approved | rejected
 *
 * Aditivo soma e distrato subtrai, sempre item a item e com os vínculos de planejamento (IP) de cada
 * item. Regras de cálculo e validação em shared/domain/contract/addendum.ts.
 */
import type { AddendumItemInput, SaveAddendumData } from '../../../shared/contracts'
import { Decimal } from '../../../shared/domain/decimal'
import { DomainError } from '../../../shared/domain/competition/revision'
import {
  ADDENDUM_KIND_LABEL,
  computeAddendum,
  currentEndOn,
  signedQuantity,
  validateAddendum,
  type AddendumKind,
  type AddendumLine,
  type ContractItemBase,
} from '../../../shared/domain/contract/addendum'
import { AppError, notFound, type RequestContext } from '../context'
import type { AddendumContent, ContractData, NewAddendumItem, Repositories } from '../ports'
import { canDecideAddendum, loadContract } from './contracts'

const today = (ctx: RequestContext) => ctx.now().toISOString().slice(0, 10)
const isOpen = (a: ContractData['addenda'][number]) => a.status === 'draft' || a.status === 'submitted'

// ----------------------------------------------------------------------------- conversões
const contractItemsOf = (c: ContractData): ContractItemBase[] =>
  c.items.map((i) => ({
    id: i.id,
    quantity: Decimal.from(i.quantity),
    totalPrice: Decimal.from(i.totalPrice),
    allocations: i.allocations.map((a) => ({ packageCode: a.packageCode, quantity: Decimal.from(a.quantity) })),
  }))

const lineOf = (i: Pick<NewAddendumItem, 'contractItemId' | 'code' | 'quantityDelta' | 'unitPrice' | 'allocations'>): AddendumLine => ({
  contractItemId: i.contractItemId,
  code: i.code,
  quantityDelta: Decimal.from(i.quantityDelta),
  unitPrice: Decimal.from(i.unitPrice),
  allocations: i.allocations.map((a) => ({ packageCode: a.packageCode, quantity: Decimal.from(a.quantity) })),
})

/** Itens de lançamentos aprovados (exceto o informado) — base para quantidades e IPs vigentes. */
const approvedLines = (c: ContractData, exceptId?: string) =>
  c.addenda.filter((a) => a.status === 'approved' && a.id !== exceptId).flatMap((a) => a.items.map(lineOf))

/** Resolve as linhas digitadas (quantidades positivas) em linhas persistíveis, com o sinal do tipo. */
function resolveItems(c: ContractData, kind: AddendumKind, items: AddendumItemInput[]): NewAddendumItem[] {
  const byId = new Map(c.items.map((i) => [i.id, i]))
  const seen = new Set<string>()
  const signed = (v: string) => signedQuantity(kind, Decimal.from(v)).round(4).toDb()
  const allocationsOf = (it: AddendumItemInput) =>
    it.allocations.map((a) => ({ packageCode: a.packageCode.trim(), locationCode: a.locationCode?.trim() || null, quantity: signed(a.quantity) }))

  return items.map((it) => {
    if (it.contractItemId) {
      const ci = byId.get(it.contractItemId)
      if (!ci) throw new AppError('ADDENDUM_ITEM', 'Item não pertence a este contrato.', 422)
      if (seen.has(ci.id)) throw new AppError('ADDENDUM_ITEM_DUPLICATED', `O item ${ci.code} foi informado duas vezes.`, 422)
      seen.add(ci.id)
      // Distrato devolve ao preço contratado; aditivo pode renegociar o unitário
      const unitPrice = kind === 'termination' ? ci.unitPrice : (it.unitPrice ?? ci.unitPrice)
      return {
        contractItemId: ci.id, materialId: ci.materialId, code: ci.code, description: ci.description, unit: ci.unit,
        quantityDelta: signed(it.quantity), unitPrice: Decimal.from(unitPrice).round(4).toDb(), allocations: allocationsOf(it),
      }
    }
    if (kind === 'termination') throw new AppError('ADDENDUM_ITEM', 'O distrato só reduz itens do contrato.', 422)
    const n = it as Extract<AddendumItemInput, { code: string }>
    return {
      contractItemId: null, materialId: null, code: n.code, description: n.description, unit: n.unit,
      quantityDelta: signed(n.quantity), unitPrice: Decimal.from(n.unitPrice).round(4).toDb(), allocations: allocationsOf(n),
    }
  })
}

function contentOf(c: ContractData, kind: AddendumKind, input: SaveAddendumData, ctx: RequestContext, addendumId?: string): AddendumContent {
  const items = resolveItems(c, kind, input.items)
  const summary = computeAddendum(contractItemsOf(c), approvedLines(c, addendumId), items.map(lineOf))
  return {
    kind,
    reason: input.reason.trim(),
    requestedOn: input.requestedOn ?? today(ctx),
    newEndOn: input.newEndOn ?? null,
    totalDelta: summary.totalDelta.toDb(),
    items,
  }
}

async function loadAddendum(repos: Repositories, ctx: RequestContext, addendumId: string, permission: string) {
  const ref = await repos.contracts.getAddendumRef(addendumId)
  if (!ref) throw notFound('Aditivo')
  const c = await loadContract(repos, ctx, ref.contractId, permission)
  const a = c.addenda.find((x) => x.id === addendumId)!
  return { c, a, label: ADDENDUM_KIND_LABEL[a.kind].singular }
}

// ----------------------------------------------------------------------------- casos de uso
export async function createAddendum(repos: Repositories, ctx: RequestContext, contractId: string, input: SaveAddendumData) {
  const c = await loadContract(repos, ctx, contractId, 'contract.manage')
  if (!['submitted', 'sent_to_erp', 'signed'].includes(c.status)) {
    throw new DomainError('CONTRACT_STATUS', 'Aditivos e distratos só podem ser solicitados para contratos já enviados.', { status: c.status })
  }
  if (c.addenda.some(isOpen)) {
    throw new DomainError('ADDENDUM_OPEN', 'Já existe um aditivo ou distrato em aberto (rascunho ou aguardando aprovação).')
  }
  const kind = input.kind
  const number = c.addenda.filter((a) => a.kind === kind).reduce((m, a) => Math.max(m, a.number), 0) + 1
  const id = await repos.contracts.createAddendum(contractId, number, contentOf(c, kind, input, ctx), ctx.actor.id)
  return { id, kind, number }
}

export async function saveAddendum(repos: Repositories, ctx: RequestContext, addendumId: string, input: SaveAddendumData) {
  const { c, a, label } = await loadAddendum(repos, ctx, addendumId, 'contract.manage')
  if (a.status !== 'draft') throw new DomainError('ADDENDUM_LOCKED', `Somente ${label}s em rascunho podem ser alterados.`)
  // O tipo é fixado na criação; o corpo pode omiti-lo
  await repos.contracts.saveAddendum(addendumId, contentOf(c, a.kind, input, ctx, addendumId))
}

export async function deleteAddendum(repos: Repositories, ctx: RequestContext, addendumId: string) {
  const { a, label } = await loadAddendum(repos, ctx, addendumId, 'contract.manage')
  if (a.status !== 'draft') throw new DomainError('ADDENDUM_LOCKED', `Somente ${label}s em rascunho podem ser excluídos.`)
  await repos.contracts.deleteAddendum(addendumId)
}

export async function submitAddendum(repos: Repositories, ctx: RequestContext, addendumId: string) {
  const { c, a, label } = await loadAddendum(repos, ctx, addendumId, 'contract.manage')
  if (a.status !== 'draft') throw new DomainError('ADDENDUM_LOCKED', `O ${label} já foi enviado.`)
  const contractItems = contractItemsOf(c)
  const previous = approvedLines(c, a.id)
  const summary = computeAddendum(contractItems, previous, a.items.map(lineOf))
  const approved = c.addenda.filter((x) => x.status === 'approved')
  const issues = validateAddendum(
    { kind: a.kind, reason: a.reason, newEndOn: a.newEndOn, contractStartOn: c.startOn, currentEndOn: currentEndOn(c.endOn, approved) },
    summary,
    { contractItems, previous },
  )
  if (issues.length) throw new AppError('ADDENDUM_INVALID', `Existem pendências no ${label}.`, 422, issues)
  await repos.contracts.updateAddendum(addendumId, { status: 'submitted', submittedAt: ctx.now().toISOString(), submittedBy: ctx.actor.id })
  return { status: 'submitted' as const }
}

export async function decideAddendum(repos: Repositories, ctx: RequestContext, addendumId: string, input: { decision: 'approved' | 'rejected'; comment?: string | null }) {
  const { c, a, label } = await loadAddendum(repos, ctx, addendumId, 'contract.read')
  if (!canDecideAddendum(ctx.actor, c.work.id)) {
    throw new AppError('FORBIDDEN', 'Aditivos e distratos são aprovados pela Gerência ou Diretoria.', 403)
  }
  if (a.status !== 'submitted') throw new DomainError('ADDENDUM_NOT_SUBMITTED', `O ${label} não está aguardando aprovação.`)
  const comment = input.comment?.trim() || null
  if (input.decision === 'rejected' && !comment) throw new DomainError('ADDENDUM_REJECT_COMMENT', 'Informe o motivo da reprovação.')
  await repos.contracts.updateAddendum(addendumId, { status: input.decision, decidedAt: ctx.now().toISOString(), decidedBy: ctx.actor.id, decisionComment: comment })
  return { status: input.decision }
}
