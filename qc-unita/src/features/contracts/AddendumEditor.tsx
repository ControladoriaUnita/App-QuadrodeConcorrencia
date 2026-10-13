/**
 * Editor de aditivo ou distrato, item a item. Quem digita informa quantidades positivas; o tipo define o sinal.
 * Cada item com quantidade é distribuído entre os IPs (sugestão proporcional ao IP vigente, editável).
 */
import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { AddendumDTO, AddendumKind, BudgetPackageDTO, ContractRequestDTO, SaveAddendumInput } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { computeAddendum, currentAllocations, currentEndOn, signedQuantity, suggestAllocations } from '@shared/domain/contract/addendum'
import { Button, Card, CardBody, CardHeader, DecimalInput, Field, Input } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatBRL, formatDate, formatQuantity } from '@/utils/format'
import { AllocationsEditor, type AllocationRow, type IpOption } from './AllocationsEditor'
import { KIND_TEXT, approvedBefore, contractItemsOf, lineOf, nextNumber } from './addendum-model'
import { AddendumTotals } from './AddendumSummary'

interface ItemDraft {
  quantity: string | null
  unitPrice: string | null
  allocations: AllocationRow[]
  /** Vínculos ainda na sugestão automática (acompanham a quantidade) */
  auto: boolean
}
interface NewRow extends ItemDraft {
  key: number
  code: string
  description: string
  unit: string
}

const abs = (v: string) => Decimal.from(v).abs().toDb()
const toRows = (a: { packageCode: string; quantity: Decimal }[]): AllocationRow[] => a.map((x) => ({ packageCode: x.packageCode, quantity: x.quantity.toDb() }))

export function AddendumEditor({ c, kind, addendum, packages, busy, onCancel, onSave }: {
  c: ContractRequestDTO
  kind: AddendumKind
  addendum: AddendumDTO | null
  packages: BudgetPackageDTO[]
  busy: boolean
  onCancel: () => void
  onSave: (b: SaveAddendumInput) => Promise<void>
}) {
  const text = KIND_TEXT[kind]
  const isTermination = kind === 'termination'
  const number = addendum?.number ?? nextNumber(c, kind)
  const previous = approvedBefore(c, addendum)
  const previousLines = previous.flatMap((a) => a.items.map(lineOf))
  const contractItems = contractItemsOf(c)

  const [reason, setReason] = useState(addendum?.reason ?? '')
  const [requestedOn, setRequestedOn] = useState(addendum?.requestedOn ?? new Date().toISOString().slice(0, 10))
  const [newEndOn, setNewEndOn] = useState(addendum?.newEndOn ?? '')
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>(() =>
    Object.fromEntries(
      (addendum?.items ?? [])
        .filter((i) => i.contractItemId)
        .map((i) => [i.contractItemId!, { quantity: abs(i.quantityDelta), unitPrice: i.unitPrice, auto: false, allocations: i.allocations.map((a) => ({ packageCode: a.packageCode, quantity: abs(a.quantity) })) }]),
    ),
  )
  const [rows, setRows] = useState<NewRow[]>(() =>
    (addendum?.items ?? [])
      .filter((i) => !i.contractItemId)
      .map((i, k) => ({
        key: k, code: i.code, description: i.description, unit: i.unit, quantity: abs(i.quantityDelta), unitPrice: i.unitPrice, auto: false,
        allocations: i.allocations.map((a) => ({ packageCode: a.packageCode, quantity: abs(a.quantity) })),
      })),
  )

  // IPs vigentes por item (contrato + aprovados) e opções de IP
  const currentByItem = new Map(contractItems.map((i) => [i.id, currentAllocations(i, previousLines)]))
  const packageLabel = new Map(packages.map((p) => [p.packageCode, `${p.packageCode} — ${p.description}`]))
  const optionsFor = (itemId: string | null): IpOption[] => {
    const current = itemId ? currentByItem.get(itemId) : undefined
    const own = [...(current ?? new Map<string, Decimal>())]
      .filter(([k]) => k)
      .map(([k, q]) => ({ packageCode: k, label: `${packageLabel.get(k) ?? k} · vigente ${formatQuantity(q)}`, available: isTermination ? q : undefined }))
    if (isTermination) return own
    const others = packages.filter((p) => !current?.has(p.packageCode)).map((p) => ({ packageCode: p.packageCode, label: packageLabel.get(p.packageCode)! }))
    return [...own, ...others]
  }

  const setItem = (id: string, patch: Partial<ItemDraft>) =>
    setDrafts((s) => {
      const prev = s[id] ?? { quantity: null, unitPrice: null, allocations: [], auto: true }
      const next = { ...prev, ...patch }
      // Enquanto o usuário não mexer nos vínculos, a sugestão acompanha a quantidade
      if ('quantity' in patch && next.auto) {
        next.allocations = next.quantity ? toRows(suggestAllocations(currentByItem.get(id) ?? new Map(), Decimal.from(next.quantity))) : []
      }
      return { ...s, [id]: next }
    })

  const input: SaveAddendumInput = useMemo(
    () => ({
      kind,
      reason,
      requestedOn,
      newEndOn: newEndOn || null,
      items: [
        ...c.items
          .filter((i) => drafts[i.id]?.quantity && Decimal.from(drafts[i.id]!.quantity!).isPositive())
          .map((i) => {
            const d = drafts[i.id]!
            return {
              contractItemId: i.id,
              quantity: d.quantity!,
              unitPrice: isTermination ? undefined : (d.unitPrice ?? i.unitPrice),
              allocations: d.allocations.filter((a) => a.packageCode && a.quantity).map((a) => ({ packageCode: a.packageCode, quantity: a.quantity! })),
            }
          }),
        ...rows
          .filter((r) => r.code.trim() && r.quantity)
          .map((r) => ({
            code: r.code.trim(),
            description: r.description.trim() || r.code.trim(),
            unit: r.unit.trim() || 'un',
            quantity: r.quantity!,
            unitPrice: r.unitPrice ?? '0',
            allocations: r.allocations.filter((a) => a.packageCode && a.quantity).map((a) => ({ packageCode: a.packageCode, quantity: a.quantity! })),
          })),
      ],
    }),
    [kind, reason, requestedOn, newEndOn, drafts, rows, c.items, isTermination],
  )

  const sign = (v: string) => signedQuantity(kind, Decimal.from(v))
  const summary = computeAddendum(
    contractItems,
    previousLines,
    input.items.map((i) => ({
      contractItemId: i.contractItemId ?? null,
      code: 'code' in i ? i.code : '',
      quantityDelta: sign(i.quantity),
      unitPrice: Decimal.from(i.unitPrice ?? c.items.find((x) => x.id === i.contractItemId)?.unitPrice ?? '0'),
      allocations: i.allocations.map((a) => ({ packageCode: a.packageCode, quantity: sign(a.quantity) })),
    })),
  )
  const qtyNow = new Map(contractItems.map((i) => [i.id, i.quantity]))
  for (const l of previousLines) if (l.contractItemId) qtyNow.set(l.contractItemId, (qtyNow.get(l.contractItemId) ?? Decimal.ZERO).plus(l.quantityDelta))

  const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
  const td = 'border-b border-border px-3 py-1 whitespace-nowrap align-top'

  return (
    <Card className="border-primary/40">
      <CardHeader
        title={`${number}º ${text.title} — ${addendum ? 'editar rascunho' : 'nova solicitação'}`}
        description={
          isTermination
            ? 'Informe quanto será retirado de cada item do contrato (ao preço contratado) e de quais IPs.'
            : 'Informe a quantidade a aditivar por item (ou itens novos), o R$ unitário se mudar e os IPs de cada item.'
        }
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
            <Button size="sm" variant="primary" loading={busy} disabled={reason.trim().length < 5} onClick={() => onSave(input)}>Salvar rascunho</Button>
          </>
        }
      />
      <CardBody className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_12rem]">
          <Field label={`Motivo do ${text.title}`} required>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isTermination ? 'Ex.: serviço retirado do escopo da contratada' : 'Ex.: volume adicional apontado pela engenharia'}
            />
          </Field>
          <Field label="Data da solicitação">
            <Input type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
          </Field>
          <Field label="Nova data de término" hint={`Vigente: ${formatDate(currentEndOn(c.endOn, previous))}`}>
            <Input type="date" value={newEndOn} min={c.startOn} onChange={(e) => setNewEndOn(e.target.value)} />
          </Field>
        </div>

        <div className="max-h-[36rem] overflow-auto rounded-control border border-border">
          <table className="tabular w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={cn(th, 'text-left')}>Insumo</th>
                <th className={cn(th, 'text-right')}>Qtd vigente</th>
                <th className={cn(th, 'w-40 text-right')}>{text.qty}</th>
                <th className={cn(th, 'text-right')}>Qtd final</th>
                <th className={cn(th, 'w-36 text-right')}>R$ unitário</th>
                <th className={cn(th, 'text-right')}>R$ total</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((i) => {
                const d = drafts[i.id]
                const qty = d?.quantity ? Decimal.from(d.quantity) : Decimal.ZERO
                const delta = signedQuantity(kind, qty)
                const price = Decimal.from(isTermination ? i.unitPrice : (d?.unitPrice ?? i.unitPrice))
                const before = qtyNow.get(i.id) ?? Decimal.ZERO
                const after = before.plus(delta)
                const active = qty.isPositive()
                return [
                  <tr key={i.id} className={cn(active && (isTermination ? 'bg-warning-soft/40' : 'bg-primary-soft/40'))}>
                    <td className={cn(td, 'max-w-72')}>
                      <p className="truncate" title={i.description}>{i.description}</p>
                      <p className="text-[11px] text-text-muted">{i.code}</p>
                    </td>
                    <td className={cn(td, 'text-right text-text-muted')}>{formatQuantity(before)} {i.unit}</td>
                    <td className={cn(td, 'px-1')}>
                      <DecimalInput
                        value={d?.quantity ?? null}
                        fractionDigits={4}
                        trimZeros
                        max={isTermination ? before.toDb() : undefined}
                        gridColumn="addendum-qty"
                        aria-label={`${text.qty} de ${i.code}`}
                        onCommit={(v) => setItem(i.id, { quantity: v })}
                      />
                    </td>
                    <td className={cn(td, 'text-right', after.isNegative() && 'font-semibold text-error')}>{formatQuantity(after)}</td>
                    <td className={cn(td, 'px-1')}>
                      {isTermination ? (
                        <p className="py-1.5 text-right text-text-muted">{formatBRL(i.unitPrice)}</p>
                      ) : (
                        <DecimalInput
                          value={d?.unitPrice ?? i.unitPrice}
                          allowEmpty={false}
                          gridColumn="addendum-price"
                          aria-label={`R$ unitário de ${i.code}`}
                          onCommit={(v) => setItem(i.id, { unitPrice: v })}
                        />
                      )}
                    </td>
                    <td className={cn(td, 'text-right', delta.isNegative() && 'text-error')}>{active ? formatBRL(price.times(delta).round(4)) : '—'}</td>
                  </tr>,
                  active && (
                    <tr key={`${i.id}-ip`}>
                      <td colSpan={6} className="border-b border-border bg-ink-50/60 px-3 py-2">
                        <AllocationsEditor
                          rows={d!.allocations}
                          options={optionsFor(i.id)}
                          target={qty}
                          unit={i.unit}
                          onChange={(allocations) => setItem(i.id, { allocations, auto: false })}
                        />
                      </td>
                    </tr>
                  ),
                ]
              })}
              {rows.map((r) => {
                const set = (patch: Partial<NewRow>) => setRows((s) => s.map((x) => (x.key === r.key ? { ...x, ...patch } : x)))
                const total = r.quantity && r.unitPrice ? Decimal.from(r.quantity).times(r.unitPrice).round(4) : null
                return [
                  <tr key={`n${r.key}`} className="bg-info-soft/40">
                    <td className={td}>
                      <div className="grid grid-cols-[6rem_1fr_3.5rem_auto] items-center gap-1">
                        <Input className="h-8" placeholder="Código" aria-label="Código do item novo" value={r.code} onChange={(e) => set({ code: e.target.value })} />
                        <Input className="h-8" placeholder="Descrição" aria-label="Descrição do item novo" value={r.description} onChange={(e) => set({ description: e.target.value })} />
                        <Input className="h-8" placeholder="Un." aria-label="Unidade do item novo" value={r.unit} onChange={(e) => set({ unit: e.target.value })} />
                        <button type="button" className="rounded-control p-1 text-ink-500 hover:bg-error-soft hover:text-error" aria-label="Remover item novo" onClick={() => setRows((s) => s.filter((x) => x.key !== r.key))}>
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                    <td className={cn(td, 'text-right text-text-muted')}>item novo</td>
                    <td className={cn(td, 'px-1')}>
                      <DecimalInput value={r.quantity} fractionDigits={4} trimZeros aria-label="Quantidade do item novo" onCommit={(v) => set({ quantity: v })} />
                    </td>
                    <td className={cn(td, 'text-right')}>{formatQuantity(r.quantity)}</td>
                    <td className={cn(td, 'px-1')}>
                      <DecimalInput value={r.unitPrice} aria-label="R$ unitário do item novo" onCommit={(v) => set({ unitPrice: v })} />
                    </td>
                    <td className={cn(td, 'text-right')}>{total ? formatBRL(total) : '—'}</td>
                  </tr>,
                  r.quantity && (
                    <tr key={`n${r.key}-ip`}>
                      <td colSpan={6} className="border-b border-border bg-ink-50/60 px-3 py-2">
                        <AllocationsEditor
                          rows={r.allocations}
                          options={optionsFor(null)}
                          target={Decimal.from(r.quantity)}
                          unit={r.unit || 'un'}
                          onChange={(allocations) => set({ allocations })}
                        />
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {isTermination ? (
            <span className="text-xs text-text-muted">O distrato só reduz itens do contrato, ao preço contratado.</span>
          ) : (
            <Button
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={() => setRows((s) => [...s, { key: Date.now(), code: '', description: '', unit: '', quantity: null, unitPrice: null, allocations: [], auto: false }])}
            >
              Incluir item novo
            </Button>
          )}
          <AddendumTotals summary={summary} title={`${number}º ${text.title}`} />
        </div>
      </CardBody>
    </Card>
  )
}
