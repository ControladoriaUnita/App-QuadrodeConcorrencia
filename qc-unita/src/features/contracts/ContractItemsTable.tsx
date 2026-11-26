/**
 * 2. Especificação dos serviços contratados: insumo, especificação, % retenção, quantidade, preço e
 * vínculos (IP · Qtd · Valor). Abaixo de cada insumo, os insumos referência (do orçamento) usados
 * para compará-lo no QC, com seus IPs e verba. Rodapé com os totais da planilha.
 * Com % de material no QC, a linha fixa "Materiais globais" soma o material ponderado de cada linha
 * (total × % material), com os IPs vindos dos vínculos dos itens (shared/domain/contract/global-materials.ts).
 */
import { useMemo, useState } from 'react'
import { Package, Pencil } from 'lucide-react'
import type { ContractItemDTO, ContractRequestDTO, UpdateContractItemInput } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { globalMaterials } from '@shared/domain/contract/global-materials'
import { Alert, Badge, Button, Card, CardHeader, DecimalInput, Dialog, InlineTextInput } from '@/components/ui'
import { usePackages } from '@/features/competitions/api'
import { AllocationsEditor, allocationsTotal, type AllocationRow } from './AllocationsEditor'
import { cn } from '@/utils/cn'
import { formatBRL, formatPercent, formatQuantity } from '@/utils/format'

export function ContractItemsTable({ c, onUpdate, onAllocations }: {
  c: ContractRequestDTO
  onUpdate: (itemId: string, patch: UpdateContractItemInput) => void
  /** Planejamento: troca os vínculos (IP · Qtd) de um item */
  onAllocations?: (itemId: string, allocations: { packageCode: string; quantity: string }[]) => Promise<unknown>
}) {
  const editable = c.can.edit
  const [editing, setEditing] = useState<ContractItemDTO | null>(null)
  const th = 'sticky top-0 z-10 border-b border-border bg-ink-100 px-3 py-2.5 text-xs font-semibold text-ink-700 whitespace-nowrap'
  const td = 'border-b border-border px-3 py-2.5 align-top'
  const result = Decimal.from(c.availableAmount).minus(c.totalAmount)
  const ratio = Decimal.from(c.budgetAmount).isZero() ? null : result.div(c.budgetAmount, 6)
  const materials = useMemo(() => globalMaterials(c.items), [c.items])
  const hasMaterials = materials.total.isPositive()

  return (
    <Card className="border-primary/30">
      <CardHeader
        title="2. Itens do contrato — especificação dos serviços contratados"
        description={`${c.items.length} item(ns) · preços da vencedora na ${c.competition.code}; vínculos de planejamento por IP (herdados das referências ou escolhidos no mapa)`}
      />
      <div className="max-h-[calc(100dvh-14rem)] overflow-auto">
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={cn(th, 'text-left')}>Cód. do insumo / descrição</th>
              <th className={cn(th, 'min-w-56 text-left')}>Especificação</th>
              <th className={cn(th, 'w-24 text-right')}>% Retenção</th>
              <th className={cn(th, 'text-right')}>Quant.</th>
              <th className={cn(th, 'text-right')}>R$ unitário</th>
              <th className={cn(th, 'text-right')}>R$ total</th>
              <th className={cn(th, 'min-w-64 text-left')}>Vínculos (IP · Qtd · Valor)</th>
            </tr>
          </thead>
          <tbody>
            {c.items.map((i) => (
              <tr key={i.id} className="odd:bg-surface even:bg-ink-50/50 hover:bg-primary-soft/30">
                <td className={cn(td, 'max-w-80')}>
                  <p className="truncate text-[15px] font-semibold text-text" title={i.description}>{i.description}</p>
                  <p className="text-xs leading-4 font-medium text-ink-600">{i.code}</p>
                  {i.budgetItems && (
                    <div className="mt-1 flex flex-wrap gap-1" aria-label={`Item do orçamento de ${i.code}`}>
                      {i.budgetItems.length ? (
                        i.budgetItems.map((b) => (
                          <span
                            key={b.activityWbs}
                            className="inline-flex max-w-full items-center gap-1 rounded-control border border-info/30 bg-info-soft px-1.5 py-0.5 text-[11px] leading-4 text-info"
                            title={`Item ${b.itemWbs}${b.itemName ? ` — ${b.itemName}` : ''} › ${b.activityWbs} ${b.activityDescription}`}
                          >
                            <span className="font-semibold whitespace-nowrap">Item {b.itemWbs}{b.itemName ? ` · ${b.itemName}` : ''}</span>
                            <span className="truncate">› {b.activityWbs} {b.activityDescription}</span>
                          </span>
                        ))
                      ) : (
                        <Badge tone="warning" className="px-1.5 py-0 text-[10px]" title="Insumo criado no mapa sem insumo referência do orçamento">fora do orçamento · criado no mapa</Badge>
                      )}
                    </div>
                  )}
                  {i.references.length > 0 && (
                    <ul className="mt-1 grid gap-0.5 border-l-2 border-border pl-2 text-[11px] leading-4 text-text-muted">
                      {i.references.map((r) => (
                        <li key={r.code} className="truncate" title={`${r.code} — ${r.description} · ${r.packageCodes.join(', ') || 'sem IP'} · verba ${formatBRL(r.budget)}`}>
                          Ref. {r.code} · {r.packageCodes.join(', ') || 'sem IP'} · verba {formatBRL(r.budget)}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className={td}>
                  {editable ? (
                    <InlineTextInput value={i.specification} label={`Especificação de ${i.code}`} onCommit={(v) => onUpdate(i.id, { specification: v })} />
                  ) : (
                    <span className="text-ink-700">{i.specification ?? '—'}</span>
                  )}
                </td>
                <td className={cn(td, 'px-1')}>
                  <DecimalInput
                    value={i.pctRetention}
                    scale="ratio"
                    fractionDigits={1}
                    allowEmpty={false}
                    max="1"
                    suffix="%"
                    disabled={!editable}
                    gridColumn="retention"
                    aria-label={`% retenção de ${i.code}`}
                    onCommit={(v) => v !== null && onUpdate(i.id, { pctRetention: v })}
                  />
                </td>
                <td className={cn(td, 'text-right font-medium whitespace-nowrap text-text')}>{formatQuantity(i.quantity)} <span className="text-text-muted">{i.unit}</span></td>
                <td className={cn(td, 'text-right font-medium whitespace-nowrap text-text')}>{formatBRL(i.unitPrice)}</td>
                <td className={cn(td, 'text-right font-semibold whitespace-nowrap text-text')}>
                  {formatBRL(i.totalPrice)}
                  {materials.byItem.has(i.id) && (
                    <span className="block text-[11px] leading-4 font-normal text-text-muted" title="Parte de material desta linha (total × % material), somada em Materiais globais">
                      material {formatBRL(materials.byItem.get(i.id)!)} · {formatPercent(Decimal.from(i.pctMaterial), 1)}
                    </span>
                  )}
                </td>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-1">
                    {i.allocations.length === 0 && <span className="text-xs text-warning">Sem vínculo</span>}
                    {i.allocations.map((a, k) => (
                      <span key={k} className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-2 py-0.5 text-xs whitespace-nowrap">
                        <span className="font-semibold">{a.packageCode ?? 'Sem IP'}</span>
                        <span className="text-text-muted">{formatQuantity(a.quantity)}</span>
                        <span>{formatBRL(a.amount)}</span>
                      </span>
                    ))}
                    {c.can.planning && onAllocations && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary-soft"
                        aria-label={`Editar vínculos de ${i.code}`}
                        onClick={() => setEditing(i)}
                      >
                        <Pencil className="size-3" aria-hidden /> Editar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {hasMaterials && (
              <tr className="bg-info-soft/40">
                <td className={cn(td, 'font-semibold')} colSpan={5}>
                  <p className="flex items-center gap-1.5 text-info">
                    <Package className="size-4" aria-hidden />
                    Materiais globais
                  </p>
                  <p className="text-[11px] leading-4 font-normal text-text-muted">
                    Soma do material de {materials.byItem.size} linha(s): total da linha × % material. Valor já incluso nos itens acima.
                  </p>
                </td>
                <td className={cn(td, 'text-right font-semibold whitespace-nowrap text-info')}>{formatBRL(materials.total)}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    {materials.byPackage.map((p) => (
                      <span key={p.packageCode ?? '-'} className="inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-2 py-0.5 text-xs whitespace-nowrap">
                        <span className="font-semibold">{p.packageCode ?? 'Sem IP'}</span>
                        <span>{formatBRL(p.amount)}</span>
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="font-semibold">
            <tr>
              <td className="bg-ink-50 px-3 py-2" colSpan={3}>
                Total orçado <span className="ml-2 font-normal text-text-muted">{formatBRL(c.budgetAmount)}</span>
                <span className="ml-6">Verba disponível</span> <span className="ml-2 font-normal text-text-muted">{formatBRL(c.availableAmount)}</span>
              </td>
              <td className="bg-ink-50 px-3 py-2 text-right" colSpan={2}>Total a contratar</td>
              <td className="bg-ink-50 px-3 py-2 text-right whitespace-nowrap">
                {formatBRL(c.totalAmount)}
                {hasMaterials && (
                  <span className="block text-[11px] leading-4 font-normal text-text-muted">
                    serviço {formatBRL(materials.service)} · materiais {formatBRL(materials.total)}
                  </span>
                )}
              </td>
              <td className={cn('bg-ink-50 px-3 py-2 whitespace-nowrap', result.isNegative() ? 'text-error' : 'text-success')}>
                Resultado QC {formatBRL(result)} {ratio && <span className="font-normal">({formatPercent(ratio, 1)})</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {editing && onAllocations && <AllocationsDialog c={c} item={editing} onClose={() => setEditing(null)} onSave={(rows) => onAllocations(editing.id, rows)} />}
    </Card>
  )
}

/** Vínculos de planejamento de um item, editados pelo Planejamento (as referências não mudam). */
function AllocationsDialog({ c, item, onClose, onSave }: {
  c: ContractRequestDTO
  item: ContractItemDTO
  onClose: () => void
  onSave: (rows: { packageCode: string; quantity: string }[]) => Promise<unknown>
}) {
  const packages = usePackages(c.work.id).data ?? []
  const [rows, setRows] = useState<AllocationRow[]>(() => item.allocations.map((a) => ({ packageCode: a.packageCode ?? '', quantity: a.quantity })))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = Decimal.from(item.quantity)
  const options = [
    ...rows.filter((r) => r.packageCode && !packages.some((p) => p.packageCode === r.packageCode)).map((r) => ({ packageCode: r.packageCode, label: r.packageCode })),
    ...packages.map((p) => ({ packageCode: p.packageCode, label: `${p.packageCode} — ${p.description}` })),
  ]
  const valid = rows.length > 0 && rows.every((r) => r.packageCode && r.quantity) && allocationsTotal(rows).eq(target)
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(rows.map((r) => ({ packageCode: r.packageCode, quantity: r.quantity! })))
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      width="min(94vw, 40rem)"
      title="Vínculos de planejamento do item"
      description={`${item.code} — ${item.description} · ${formatQuantity(item.quantity)} ${item.unit}. As referências do item não mudam.`}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={saving} disabled={!valid} onClick={save}>Salvar vínculos</Button>
        </>
      }
    >
      <div className="grid gap-2">
        <AllocationsEditor rows={rows} options={options} target={target} unit={item.unit} onChange={setRows} />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  )
}
