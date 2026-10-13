/**
 * Conversões entre os DTOs do contrato e o domínio de aditivos/distratos (shared/domain/contract/addendum),
 * usadas pela lista e pelo editor. O cálculo é o mesmo do servidor.
 */
import type { AddendumDTO, AddendumKind, ContractRequestDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { type AddendumLine, type ContractItemBase } from '@shared/domain/contract/addendum'

export const KIND_TEXT: Record<AddendumKind, { title: string; plural: string; qty: string; tone: 'info' | 'warning' }> = {
  addendum: { title: 'aditivo', plural: 'aditivos', qty: 'Qtd a aditivar', tone: 'info' },
  termination: { title: 'distrato', plural: 'distratos', qty: 'Qtd a distratar', tone: 'warning' },
}

/** "1º aditivo", "2º distrato" */
export const addendumTitle = (a: Pick<AddendumDTO, 'kind' | 'number'>) => `${a.number}º ${KIND_TEXT[a.kind].title}`

export const contractItemsOf = (c: ContractRequestDTO): ContractItemBase[] =>
  c.items.map((i) => ({
    id: i.id,
    quantity: Decimal.from(i.quantity),
    totalPrice: Decimal.from(i.totalPrice),
    allocations: i.allocations.map((a) => ({ packageCode: a.packageCode, quantity: Decimal.from(a.quantity) })),
  }))

export const lineOf = (i: AddendumDTO['items'][number]): AddendumLine => ({
  contractItemId: i.contractItemId,
  code: i.code,
  quantityDelta: Decimal.from(i.quantityDelta),
  unitPrice: Decimal.from(i.unitPrice),
  allocations: i.allocations.map((a) => ({ packageCode: a.packageCode, quantity: Decimal.from(a.quantity) })),
})

/** Lançamentos aprovados antes de `a` (ou todos os aprovados, para um lançamento novo). */
export const approvedBefore = (c: ContractRequestDTO, a?: Pick<AddendumDTO, 'id' | 'createdAt'> | null) =>
  c.addenda.filter((x) => x.status === 'approved' && x.id !== a?.id && (!a || x.createdAt < a.createdAt))

export const nextNumber = (c: ContractRequestDTO, kind: AddendumKind) => c.addenda.filter((a) => a.kind === kind).reduce((m, a) => Math.max(m, a.number), 0) + 1
