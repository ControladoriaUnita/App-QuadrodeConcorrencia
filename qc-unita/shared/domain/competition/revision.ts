/**
 * Controle de revisões do QC (rev00, rev01 ...).
 *
 *   draft ──submit──▶ in_approval ──(todas as etapas)──▶ approved (congelada)
 *     ▲                    │                                   │
 *     │                 reject                          nova revisão aprovada
 *     │                    ▼                                   ▼
 *     └──nova revisão── rejected                          superseded
 *
 * - Só a revisão em rascunho é editável.
 * - Apenas uma revisão aberta (draft/in_approval) por concorrência.
 * - Nova revisão parte da última aprovada ou rejeitada (cópia integral).
 */
import { Decimal } from '../decimal'
import type { BestCondition, QcItem, QcSupplier, RevisionStatus } from './types'

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export interface RevisionHeader {
  id: string
  number: number
  status: RevisionStatus
  frozenAt: string | null
  requestedOn: string | null
  serviceStartOn: string | null
  serviceEndOn: string | null
  engineeringOwnerId: string | null
  procurementOwnerId: string | null
  contractTypeId: string | null
  winnerSupplierId: string | null
  winnerJustification: string | null
}

export function isEditable(rev: Pick<RevisionHeader, 'status' | 'frozenAt'>): boolean {
  return rev.status === 'draft' && !rev.frozenAt
}

export function assertEditable(rev: Pick<RevisionHeader, 'status' | 'frozenAt' | 'number'>): void {
  if (!isEditable(rev)) {
    throw new DomainError(
      'REVISION_NOT_EDITABLE',
      `A revisão ${rev.number} está "${rev.status}" e não pode ser alterada. Crie uma nova revisão.`,
    )
  }
}

export function canCreateRevision(revisions: Pick<RevisionHeader, 'status'>[]): { ok: boolean; reason?: string } {
  if (revisions.some((r) => r.status === 'draft' || r.status === 'in_approval')) {
    return { ok: false, reason: 'Já existe uma revisão aberta (rascunho ou em aprovação).' }
  }
  if (!revisions.some((r) => r.status === 'approved' || r.status === 'rejected')) {
    return { ok: false, reason: 'Não há revisão aprovada ou reprovada para servir de base.' }
  }
  return { ok: true }
}

export function nextRevisionNumber(revisions: Pick<RevisionHeader, 'number'>[]): number {
  return revisions.reduce((max, r) => Math.max(max, r.number), -1) + 1
}

/** Revisão base para a próxima: a de maior número entre aprovadas/rejeitadas. */
export function baseRevisionFor<T extends Pick<RevisionHeader, 'number' | 'status'>>(revisions: T[]): T | null {
  return (
    [...revisions]
      .filter((r) => r.status === 'approved' || r.status === 'rejected')
      .sort((a, b) => b.number - a.number)[0] ?? null
  )
}

export interface ValidationIssue {
  field: string
  message: string
}

/**
 * Pendências para envio à aprovação (equivalente a "Faltam campos a serem preenchidos").
 */
export function validateForSubmission(input: {
  revision: RevisionHeader
  items: QcItem[]
  suppliers: QcSupplier[]
  best: BestCondition[]
  minSuppliers?: number
  today?: string // yyyy-mm-dd
}): ValidationIssue[] {
  const { revision: r, items, suppliers, best } = input
  const minSuppliers = input.minSuppliers ?? 3
  const issues: ValidationIssue[] = []
  const req = (cond: unknown, field: string, message: string) => {
    if (!cond) issues.push({ field, message })
  }

  req(r.status === 'draft', 'status', 'Somente revisões em rascunho podem ser enviadas.')
  req(r.requestedOn, 'requestedOn', 'Informe a data da solicitação.')
  req(r.serviceStartOn, 'serviceStartOn', 'Informe o início do serviço.')
  req(r.serviceEndOn, 'serviceEndOn', 'Informe o término do serviço.')
  if (r.serviceStartOn && r.serviceEndOn && r.serviceEndOn < r.serviceStartOn) {
    issues.push({ field: 'serviceEndOn', message: 'O término deve ser posterior ao início.' })
  }
  req(r.engineeringOwnerId, 'engineeringOwnerId', 'Informe o engenheiro responsável.')
  req(r.procurementOwnerId, 'procurementOwnerId', 'Informe o responsável de suprimentos.')
  req(r.contractTypeId, 'contractTypeId', 'Selecione o tipo de contrato.')
  req(r.winnerSupplierId, 'winnerSupplierId', 'Indique a empresa vencedora.')
  req(r.winnerJustification?.trim(), 'winnerJustification', 'Justifique a escolha da empresa vencedora.')

  const activeItems = items.filter((i) => i.quantity.isPositive())
  req(activeItems.length > 0, 'items', 'Inclua ao menos um item com quantidade.')

  for (const i of items) {
    if (i.pctMaterial.plus(i.pctEquipment).gt(1)) {
      issues.push({ field: `items.${i.id}.pct`, message: `Item ${i.code}: % material + % equipamento excede 100%.` })
    }
  }

  const participating = suppliers.filter((s) => s.status !== 'declined' && s.status !== 'disqualified')
  req(
    participating.length >= minSuppliers,
    'suppliers',
    `São necessários ao menos ${minSuppliers} fornecedores participantes (há ${participating.length}).`,
  )

  const winner = suppliers.find((s) => s.supplierId === r.winnerSupplierId)
  if (r.winnerSupplierId && !winner) {
    issues.push({ field: 'winnerSupplierId', message: 'A empresa vencedora não participa desta revisão.' })
  }
  if (winner && input.today && winner.cndValidUntil && winner.cndValidUntil < input.today) {
    issues.push({ field: 'winnerSupplierId', message: `CND da vencedora vencida em ${winner.cndValidUntil}.` })
  }

  const unquoted = best.filter((b) => !b.competitionSupplierId && activeItems.some((i) => i.id === b.itemId))
  if (unquoted.length) {
    issues.push({ field: 'prices', message: `${unquoted.length} item(ns) sem nenhuma cotação.` })
  }

  return issues
}

/** Valor de referência para alçada de aprovação: total do vencedor, ou do mix se não houver vencedor. */
export function approvalAmount(winnerTotal: Decimal | null, mixTotal: Decimal): Decimal {
  return winnerTotal ?? mixTotal
}
