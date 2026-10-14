/**
 * Mapa de cotação — grade estilo planilha (DESIGN_SYSTEM §8).
 * Insumos do mapa (reais, de contrato) no eixo Y, fornecedores no eixo X (R$ unit. / R$ total),
 * melhor condição e comparação com o orçado das referências à direita; totais no rodapé.
 *
 * Os insumos são criados aqui ("Adicionar insumo") ou preenchidos a partir dos insumos referência.
 * Cada insumo mostra as referências ligadas (verba usada na comparação) e o IP (herdado ou manual).
 * As colunas de distribuição (% material, % equipamento, % retenção, especificação e observações)
 * alimentam a Solicitação de Contrato e podem ser recolhidas.
 */
import { Fragment, useMemo, useState } from 'react'
import { AlertTriangle, Columns3, Crown, Link2, ListPlus, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import type { AddQcItemInput, CompetitionDetailDTO, QcItemDTO, QcSupplierDTO, UpdateItemInput } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { lineTotal } from '@shared/domain/competition/best-condition'
import type { QcMap } from '@shared/domain/competition/qc-map'
import { computeDistribution } from '@shared/domain/contract/distribution'
import { Badge, Button, ConfirmDialog, DecimalInput, InlineTextInput } from '@/components/ui'
import { cn } from '@/utils/cn'
import { EMPTY, formatBRL, formatDecimal, formatPercent, formatQuantity, formatVariation } from '@/utils/format'
import { AddItemDialog, EditItemDialog } from './MapItemDialogs'
import { supplierStatus } from './status'

interface Props {
  detail: CompetitionDetailDTO
  map: QcMap
  today: string
  saving: boolean
  onPrice: (competitionSupplierId: string, itemId: string, unitPrice: string | null) => void
  onUpdateItem: (itemId: string, patch: UpdateItemInput) => void
  onAddItem: (input: AddQcItemInput) => Promise<unknown>
  onFill: () => void
  onSaveItem: (itemId: string, referenceIds: string[] | null, patch: UpdateItemInput | null) => Promise<unknown>
  onRemoveItem: (itemId: string) => void
}

const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-right text-xs font-semibold text-text-muted whitespace-nowrap'
const td = 'border-b border-border px-3 py-2 text-right whitespace-nowrap'
const stickyFirst = 'sticky left-0 z-[5] bg-surface'
const PCT = ['pctMaterial', 'pctEquipment', 'pctRetention'] as const
const PCT_LABEL = { pctMaterial: '% Mat.', pctEquipment: '% Equip.', pctRetention: '% Ret.' }

function shortName(s: QcSupplierDTO) {
  return s.tradeName || s.legalName
}

export function QcGrid({ detail, map, today, saving, onPrice, onUpdateItem, onAddItem, onFill, onSaveItem, onRemoveItem }: Props) {
  const { items, suppliers, can } = detail
  const [showDist, setShowDist] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<QcItemDTO | null>(null)
  const [removing, setRemoving] = useState<QcItemDTO | null>(null)
  const priceOf = useMemo(() => {
    const m = new Map(detail.prices.map((p) => [`${p.itemId}::${p.competitionSupplierId}`, p.unitPrice]))
    return (itemId: string, supplierId: string) => m.get(`${itemId}::${supplierId}`) ?? null
  }, [detail.prices])
  const supplierById = new Map(suppliers.map((s) => [s.id, s]))
  const refById = new Map(detail.references.map((r) => [r.id, r]))
  const domainItemById = useMemo(() => new Map(map.items.map((i) => [i.id, i])), [map.items])
  const winnerCsId = suppliers.find((s) => s.supplierId === detail.revision.winnerSupplierId)?.id
  const unused = map.unusedReferenceIds
  const dist = useMemo(
    () => computeDistribution(map.items.map((i) => ({ total: map.bestByItem.get(i.id)?.totalPrice ?? Decimal.ZERO, pctMaterial: i.pctMaterial, pctEquipment: i.pctEquipment }))),
    [map],
  )
  /** Colunas antes do orçado: insumo, unidade, quantidade, distribuição (se aberta) e IP */
  const lead = 4 + (showDist ? 5 : 0)

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {can.edit && (
          <>
            <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Adicionar insumo
            </Button>
            <Button
              size="sm"
              icon={<ListPlus className="size-4" />}
              disabled={!unused.length || saving}
              title={unused.length ? 'Cria um insumo no mapa para cada referência ainda sem uso' : 'Todas as referências já estão no mapa'}
              onClick={onFill}
            >
              Preencher com insumos referência{unused.length ? ` (${unused.length})` : ''}
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" icon={<Columns3 className="size-4" />} aria-pressed={showDist} onClick={() => setShowDist((v) => !v)}>
          {showDist ? 'Recolher distribuição' : 'Mostrar distribuição'}
        </Button>
        <span className="tabular ml-auto text-xs text-text-muted">
          Distribuição pela melhor condição: Material {formatPercent(dist.pctMaterial, 1)} · Equipamento {formatPercent(dist.pctEquipment, 1)} · MDO/Serviço {formatPercent(dist.pctService, 1)}
        </span>
      </div>

      <div className="max-h-[calc(100dvh-10rem)] min-h-80 overflow-auto rounded-card border border-border bg-surface shadow-card">
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead>
            {/* Linha 1: grupos */}
            <tr>
              <th rowSpan={2} className={cn(th, 'left-0 z-20 min-w-80 text-left')}>Insumo do mapa</th>
              <th rowSpan={2} className={cn(th, 'text-left')}>Un</th>
              <th rowSpan={2} className={cn(th, 'min-w-28')}>Quant.</th>
              {showDist && <th colSpan={5} className={cn(th, 'border-l text-center')}>Distribuição e escopo</th>}
              <th rowSpan={2} className={cn(th, 'border-l text-left')}>IP</th>
              <th colSpan={2} className={cn(th, 'border-l text-center')}>Orçado (referências)</th>
              {suppliers.map((s) => {
                const sum = map.summaryBySupplier.get(s.id)
                const cndExpired = s.cndValidUntil !== null && s.cndValidUntil < today
                const out = s.status === 'declined' || s.status === 'disqualified'
                return (
                  <th key={s.id} colSpan={2} className={cn(th, 'border-l text-center', sum?.rank === 1 && 'bg-cell-current-period text-primary', out && 'text-ink-400')}>
                    <div className="flex items-center justify-center gap-1.5">
                      {s.id === winnerCsId && <Crown className="size-3.5 text-primary" aria-label="Vencedora indicada" />}
                      <span className="max-w-44 truncate" title={s.legalName}>{shortName(s)}</span>
                      {cndExpired && <AlertTriangle className="size-3.5 text-warning" aria-label="CND vencida" />}
                    </div>
                    <div className="mt-0.5 flex items-center justify-center gap-1 font-medium">
                      {sum?.rank ? <Badge tone={sum.rank === 1 ? 'primary' : 'neutral'}>{sum.rank}º</Badge> : null}
                      {out && <Badge tone={supplierStatus[s.status].tone}>{supplierStatus[s.status].label}</Badge>}
                    </div>
                  </th>
                )
              })}
              <th colSpan={4} className={cn(th, 'border-l bg-success-soft text-center text-success')}>Melhor condição</th>
            </tr>
            {/* Linha 2: subcolunas */}
            <tr>
              {showDist && (
                <>
                  {PCT.map((k, i) => <th key={k} className={cn(th, 'top-[52px] w-20', i === 0 && 'border-l')}>{PCT_LABEL[k]}</th>)}
                  <th className={cn(th, 'top-[52px] min-w-56 text-left')}>Especificação</th>
                  <th className={cn(th, 'top-[52px] min-w-44 text-left')}>Obs. contratos</th>
                </>
              )}
              <th className={cn(th, 'top-[52px] border-l min-w-28')}>R$ unit.</th>
              <th className={cn(th, 'top-[52px] min-w-32')}>R$ total</th>
              {suppliers.map((s) => (
                <Fragment key={s.id}>
                  <th className={cn(th, 'top-[52px] border-l min-w-28')}>R$ unit.</th>
                  <th className={cn(th, 'top-[52px] min-w-32')}>R$ total</th>
                </Fragment>
              ))}
              <th className={cn(th, 'top-[52px] border-l min-w-32 text-left')}>Fornecedor</th>
              <th className={cn(th, 'top-[52px] min-w-28')}>R$ unit.</th>
              <th className={cn(th, 'top-[52px] min-w-32')}>R$ total</th>
              <th className={cn(th, 'top-[52px] min-w-24')}>vs. orçado</th>
            </tr>
          </thead>

          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={99} className="px-5 py-10 text-center text-sm text-text-muted">
                  O mapa está vazio. Adicione insumos ou preencha com os insumos referência.
                </td>
              </tr>
            )}
            {items.map((item) => {
              const domainItem = domainItemById.get(item.id)!
              const best = map.bestByItem.get(item.id)
              const budgetTotal = best?.budgetTotal ?? Decimal.ZERO
              const qty = domainItem.quantity
              const budgetUnit = qty.isPositive() ? budgetTotal.div(qty, 4) : Decimal.ZERO
              const group = map.groupOfItem.get(item.id)
              const shared = (group?.itemIds.length ?? 0) > 1
              const allocations = map.allocationsByItem.get(item.id) ?? []
              const ips = allocations.map((a) => a.packageCode).filter((p): p is string => !!p)
              const pending = qty.isPositive() && !item.referenceIds.length && !item.planningCode
              return (
                <tr key={item.id} className="group">
                  <td className={cn(td, stickyFirst, 'min-w-80 max-w-96 text-left group-hover:bg-ink-50')}>
                    <div className="flex items-start gap-2">
                      <span className="w-6 shrink-0 pt-0.5 text-xs text-text-muted">{item.sortOrder}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-text" title={item.description}>{item.description}</p>
                        <p className="flex flex-wrap items-center gap-1 text-[11px] leading-4 text-text-muted">
                          {item.code}
                          {item.origin === 'manual' && <Badge tone="info" className="px-1.5 py-0 text-[10px]">criado no mapa</Badge>}
                          <button
                            type="button"
                            onClick={() => setEditing(item)}
                            className={cn('inline-flex items-center gap-0.5 rounded px-1 hover:bg-ink-100', pending ? 'text-warning' : 'text-ink-600')}
                            title="Referências e IP do insumo"
                          >
                            <Link2 className="size-3" aria-hidden />
                            {item.referenceIds.length
                              ? item.referenceIds.map((r) => refById.get(r)?.code).filter(Boolean).slice(0, 3).join(', ') + (item.referenceIds.length > 3 ? ` +${item.referenceIds.length - 3}` : '')
                              : 'sem referência'}
                          </button>
                        </p>
                      </div>
                      {can.edit && (
                        <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <button type="button" className="rounded p-1 text-ink-500 hover:bg-ink-100" aria-label={`Editar ${item.code}`} onClick={() => setEditing(item)}>
                            <Pencil className="size-3.5" />
                          </button>
                          <button type="button" className="rounded p-1 text-ink-500 hover:bg-error-soft hover:text-error" aria-label={`Remover ${item.code}`} onClick={() => setRemoving(item)}>
                            <Trash2 className="size-3.5" />
                          </button>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={cn(td, 'text-left text-text-muted group-hover:bg-ink-50')}>{item.unit}</td>
                  <td className={cn(td, 'px-1 group-hover:bg-ink-50')}>
                    {can.edit ? (
                      <DecimalInput
                        value={item.quantity}
                        fractionDigits={4}
                        trimZeros
                        allowEmpty={false}
                        gridColumn="qty"
                        aria-label={`Quantidade de ${item.code}`}
                        onCommit={(v) => v !== null && onUpdateItem(item.id, { quantity: v })}
                      />
                    ) : (
                      <span className="px-2">{formatQuantity(item.quantity)}</span>
                    )}
                  </td>

                  {showDist && (
                    <>
                      {PCT.map((k, i) => (
                        <td key={k} className={cn(td, 'px-1 group-hover:bg-ink-50', i === 0 && 'border-l')}>
                          <DecimalInput
                            value={item[k]}
                            scale="ratio"
                            fractionDigits={1}
                            allowEmpty={false}
                            disabled={!can.edit}
                            gridColumn={k}
                            aria-label={`${PCT_LABEL[k]} de ${item.code}`}
                            onCommit={(v) => v !== null && onUpdateItem(item.id, { [k]: v })}
                          />
                        </td>
                      ))}
                      <td className={cn(td, 'px-1 text-left group-hover:bg-ink-50')}>
                        <InlineTextInput value={item.scopeDescription} disabled={!can.edit} label={`Especificação de ${item.code}`} onCommit={(v) => onUpdateItem(item.id, { scopeDescription: v })} />
                      </td>
                      <td className={cn(td, 'px-1 text-left group-hover:bg-ink-50')}>
                        <InlineTextInput value={item.contractNotes} disabled={!can.edit} label={`Observação de ${item.code}`} onCommit={(v) => onUpdateItem(item.id, { contractNotes: v })} />
                      </td>
                    </>
                  )}

                  <td className={cn(td, 'border-l text-left group-hover:bg-ink-50')}>
                    {item.planningCode ? (
                      <span className="inline-flex items-center gap-1" title={item.planningDescription ?? undefined}>
                        {item.planningCode}
                        <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">manual</Badge>
                      </span>
                    ) : ips.length ? (
                      <span title={allocations.map((a) => `${a.packageCode ?? 'Sem IP'}: ${formatPercent(a.share, 1)}`).join('\n')}>
                        {ips[0]}{ips.length > 1 && <span className="text-text-muted"> +{ips.length - 1}</span>}
                      </span>
                    ) : (
                      <span className={pending ? 'text-warning' : 'text-text-muted'}>{EMPTY}</span>
                    )}
                  </td>
                  <td className={cn(td, 'border-l text-text-muted group-hover:bg-ink-50')}>{budgetTotal.isZero() ? EMPTY : formatDecimal(budgetUnit)}</td>
                  <td className={cn(td, 'text-text-muted group-hover:bg-ink-50')}>
                    {budgetTotal.isZero() ? EMPTY : formatDecimal(budgetTotal)}
                    {shared && (
                      <span className="block text-[10px] leading-3 text-info" title={`Verba das referências rateada entre ${group!.itemIds.length} insumos pelo valor contratado. Orçado do grupo: ${formatBRL(group!.budget)}`}>
                        rateio · {group!.itemIds.length} insumos
                      </span>
                    )}
                  </td>

                  {suppliers.map((s) => {
                    const unit = priceOf(item.id, s.id)
                    const isBest = best?.competitionSupplierId === s.id
                    const total = unit !== null && Decimal.from(unit).isPositive() ? lineTotal(Decimal.from(unit), qty) : null
                    const aboveBudget = unit !== null && budgetUnit.isPositive() && Decimal.from(unit).gt(budgetUnit)
                    const cellBg = isBest ? 'bg-cell-issued' : 'group-hover:bg-ink-50'
                    return (
                      <Fragment key={s.id}>
                        <td className={cn(td, 'border-l px-1', cellBg)}>
                          {can.editPrices ? (
                            <DecimalInput
                              value={unit}
                              gridColumn={`p-${s.id}`}
                              aria-label={`Preço unitário de ${shortName(s)} para ${item.code}`}
                              onCommit={(v) => onPrice(s.id, item.id, v)}
                              className={cn(isBest && 'font-semibold text-success', aboveBudget && !isBest && 'text-error')}
                            />
                          ) : (
                            <span className={cn('px-2', isBest && 'font-semibold text-success', aboveBudget && !isBest && 'text-error')}>
                              {unit === null ? EMPTY : formatDecimal(unit)}
                            </span>
                          )}
                        </td>
                        <td className={cn(td, cellBg, isBest ? 'font-semibold text-success' : 'text-ink-700')}>{total ? formatDecimal(total) : EMPTY}</td>
                      </Fragment>
                    )
                  })}

                  <td className={cn(td, 'border-l text-left group-hover:bg-ink-50')}>
                    {best?.competitionSupplierId ? (
                      <span className="inline-flex items-center gap-1 font-medium text-text">
                        {shortName(supplierById.get(best.competitionSupplierId)!)}
                        {best.isOverride && (
                          <span title={`Escolha manual: ${best.overrideReason}`}>
                            <Lock className="size-3 text-warning" aria-label="Escolha manual" />
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-text-muted">Sem cotação</span>
                    )}
                  </td>
                  <td className={cn(td, 'group-hover:bg-ink-50')}>{best?.unitPrice ? formatDecimal(best.unitPrice) : EMPTY}</td>
                  <td className={cn(td, 'font-medium group-hover:bg-ink-50')}>{best?.totalPrice ? formatDecimal(best.totalPrice) : EMPTY}</td>
                  <td className={cn(td, 'group-hover:bg-ink-50')}>
                    {best?.varianceRatio ? (
                      <span className={cn('text-xs font-medium', best.varianceRatio.isNegative() ? 'text-error' : 'text-success')}>
                        {formatVariation(best.varianceRatio.neg())}
                      </span>
                    ) : (
                      EMPTY
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>

          <tfoot className="font-semibold">
            <FooterRow
              label="Total equalizado"
              before={lead}
              budget={formatBRL(map.budgetTotal)}
              cells={suppliers.map((s) => {
                const sum = map.summaryBySupplier.get(s.id)!
                return (
                  <Fragment key={s.id}>
                    <td className={cn(td, 'border-l bg-ink-50 text-xs font-medium text-text-muted')}>{sum.quotedItems}/{sum.totalItems} itens</td>
                    <td className={cn(td, 'bg-ink-50', sum.rank === 1 && 'text-primary')}>{formatBRL(sum.total)}</td>
                  </Fragment>
                )
              })}
              best={<td colSpan={4} className={cn(td, 'border-l bg-success-soft text-success')}>{formatBRL(map.mixTotal)}</td>}
            />
            <FooterRow
              label="Resultado QC / Orçamento"
              hint="Verba disponível − total"
              before={lead}
              budget={formatBRL(map.available)}
              cells={suppliers.map((s) => {
                const sum = map.summaryBySupplier.get(s.id)!
                const neg = sum.result.isNegative()
                return (
                  <Fragment key={s.id}>
                    <td className={cn(td, 'border-l bg-ink-50 text-xs', neg ? 'text-error' : 'text-success')}>{formatPercent(sum.resultRatio, 1)}</td>
                    <td className={cn(td, 'bg-ink-50', neg ? 'text-error' : 'text-success')}>{formatBRL(sum.result)}</td>
                  </Fragment>
                )
              })}
              best={
                <td colSpan={4} className={cn(td, 'border-l bg-success-soft', map.mixComparison.result.isNegative() ? 'text-error' : 'text-success')}>
                  {formatBRL(map.mixComparison.result)} · {formatPercent(map.mixComparison.resultRatio, 1)}
                </td>
              }
            />
          </tfoot>
        </table>
      </div>
      {unused.length > 0 && (
        <p className="text-xs text-warning">
          {unused.length} insumo(s) referência sem uso no mapa (verba {formatBRL(Decimal.sum(unused.map((id) => map.referenceBudget.get(id) ?? Decimal.ZERO)))}) — fora da comparação.
        </p>
      )}

      <AddItemDialog open={adding} detail={detail} map={map} saving={saving} onClose={() => setAdding(false)} onAdd={onAddItem} />
      <EditItemDialog item={editing} detail={detail} map={map} saving={saving} onClose={() => setEditing(null)} onSave={onSaveItem} />
      <ConfirmDialog
        open={!!removing}
        title="Remover insumo do mapa?"
        description={`${removing?.code} — ${removing?.description}: os preços lançados para ele nesta revisão serão excluídos. As referências continuam no QC.`}
        confirmLabel="Remover insumo"
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) onRemoveItem(removing.id)
          setRemoving(null)
        }}
      />
    </div>
  )
}

function FooterRow({ label, hint, before, budget, cells, best }: { label: string; hint?: string; before: number; budget: string; cells: React.ReactNode; best: React.ReactNode }) {
  return (
    <tr>
      <td className={cn(td, stickyFirst, 'bg-ink-50 text-left')}>
        {label}
        {hint && <span className="block text-[11px] leading-4 font-normal text-text-muted">{hint}</span>}
      </td>
      <td className={cn(td, 'bg-ink-50')} colSpan={before - 1} />
      <td className={cn(td, 'border-l bg-ink-50')} colSpan={2}>{budget}</td>
      {cells}
      {best}
    </tr>
  )
}
