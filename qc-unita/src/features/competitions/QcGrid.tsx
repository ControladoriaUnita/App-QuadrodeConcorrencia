/**
 * Mapa de cotação — grade estilo planilha (DESIGN_SYSTEM §8).
 * Itens no eixo Y, fornecedores no eixo X (R$ unit. / R$ total), melhor condição e
 * comparação com o orçado à direita; totais equalizados e resultado vs. orçamento no rodapé.
 */
import { Fragment, useMemo } from 'react'
import { AlertTriangle, Crown, Lock } from 'lucide-react'
import type { CompetitionDetailDTO, QcSupplierDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { lineTotal } from '@shared/domain/competition/best-condition'
import type { QcMap } from '@shared/domain/competition/qc-map'
import { Badge, DecimalInput } from '@/components/ui'
import { cn } from '@/utils/cn'
import { EMPTY, formatBRL, formatDecimal, formatPercent, formatQuantity, formatVariation } from '@/utils/format'
import { supplierStatus } from './status'

interface Props {
  detail: CompetitionDetailDTO
  map: QcMap
  today: string
  onPrice: (competitionSupplierId: string, itemId: string, unitPrice: string | null) => void
  onQuantity: (itemId: string, quantity: string) => void
}

const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-right text-xs font-semibold text-text-muted whitespace-nowrap'
const td = 'border-b border-border px-3 py-2 text-right whitespace-nowrap'
const stickyFirst = 'sticky left-0 z-[5] bg-surface'

function shortName(s: QcSupplierDTO) {
  return s.tradeName || s.legalName
}

export function QcGrid({ detail, map, today, onPrice, onQuantity }: Props) {
  const { items, suppliers, can } = detail
  const priceOf = useMemo(() => {
    const m = new Map(detail.prices.map((p) => [`${p.itemId}::${p.competitionSupplierId}`, p.unitPrice]))
    return (itemId: string, supplierId: string) => m.get(`${itemId}::${supplierId}`) ?? null
  }, [detail.prices])
  const supplierById = new Map(suppliers.map((s) => [s.id, s]))
  const winnerCsId = suppliers.find((s) => s.supplierId === detail.revision.winnerSupplierId)?.id

  return (
    <div className="max-h-[calc(100dvh-8rem)] min-h-80 overflow-auto rounded-card border border-border bg-surface shadow-card">
      <table className="tabular w-full border-separate border-spacing-0 text-sm">
        <thead>
          {/* Linha 1: grupos */}
          <tr>
            <th rowSpan={2} className={cn(th, 'left-0 z-20 min-w-80 text-left')}>
              Insumo
            </th>
            <th rowSpan={2} className={cn(th, 'text-left')}>Un</th>
            <th rowSpan={2} className={cn(th, 'min-w-28')}>Quant.</th>
            <th colSpan={2} className={cn(th, 'border-l text-center')}>Orçado</th>
            {suppliers.map((s) => {
              const sum = map.summaryBySupplier.get(s.id)
              const cndExpired = s.cndValidUntil !== null && s.cndValidUntil < today
              const out = s.status === 'declined' || s.status === 'disqualified'
              return (
                <th
                  key={s.id}
                  colSpan={2}
                  className={cn(th, 'border-l text-center', sum?.rank === 1 && 'bg-cell-current-period text-primary', out && 'text-ink-400')}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    {s.id === winnerCsId && <Crown className="size-3.5 text-primary" aria-label="Vencedora indicada" />}
                    <span className="max-w-44 truncate" title={s.legalName}>
                      {shortName(s)}
                    </span>
                    {cndExpired && <AlertTriangle className="size-3.5 text-warning" aria-label="CND vencida" />}
                  </div>
                  <div className="mt-0.5 flex items-center justify-center gap-1 font-medium">
                    {sum?.rank ? <Badge tone={sum.rank === 1 ? 'primary' : 'neutral'}>{sum.rank}º</Badge> : null}
                    {out && <Badge tone={supplierStatus[s.status].tone}>{supplierStatus[s.status].label}</Badge>}
                  </div>
                </th>
              )
            })}
            <th colSpan={4} className={cn(th, 'border-l bg-success-soft text-center text-success')}>
              Melhor condição
            </th>
          </tr>
          {/* Linha 2: subcolunas */}
          <tr>
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
          {items.map((item) => {
            const domainItem = map.items.find((i) => i.id === item.id)!
            const best = map.bestByItem.get(item.id)
            const budgetUnit = Decimal.from(item.budgetUnitCost)
            return (
              <tr key={item.id} className="group">
                <td className={cn(td, stickyFirst, 'min-w-80 max-w-96 text-left group-hover:bg-ink-50')}>
                  <div className="flex items-baseline gap-2">
                    <span className="w-6 shrink-0 text-xs text-text-muted">{item.sortOrder}</span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text" title={item.description}>
                        {item.description}
                      </p>
                      <p className="text-[11px] leading-4 text-text-muted">{item.code}</p>
                    </div>
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
                      aria-label={`Quantidade equalizada de ${item.code}`}
                      onCommit={(v) => v !== null && onQuantity(item.id, v)}
                      className={cn(!Decimal.from(item.quantity).eq(item.budgetQuantity) && 'bg-cell-manual')}
                    />
                  ) : (
                    <span className="px-2">{formatQuantity(item.quantity)}</span>
                  )}
                </td>
                <td className={cn(td, 'border-l text-text-muted group-hover:bg-ink-50')}>{formatDecimal(item.budgetUnitCost)}</td>
                <td className={cn(td, 'text-text-muted group-hover:bg-ink-50')}>{formatDecimal(lineTotal(budgetUnit, Decimal.from(item.budgetQuantity)))}</td>

                {suppliers.map((s) => {
                  const unit = priceOf(item.id, s.id)
                  const isBest = best?.competitionSupplierId === s.id
                  const total = unit !== null && Decimal.from(unit).isPositive() ? lineTotal(Decimal.from(unit), domainItem.quantity) : null
                  const aboveBudget = unit !== null && Decimal.from(unit).gt(budgetUnit) && budgetUnit.isPositive()
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
            budget={formatBRL(map.budgetTotal)}
            cells={suppliers.map((s) => {
              const sum = map.summaryBySupplier.get(s.id)!
              return (
                <Fragment key={s.id}>
                  <td className={cn(td, 'border-l bg-ink-50 text-xs font-medium text-text-muted')}>
                    {sum.quotedItems}/{sum.totalItems} itens
                  </td>
                  <td className={cn(td, 'bg-ink-50', sum.rank === 1 && 'text-primary')}>{formatBRL(sum.total)}</td>
                </Fragment>
              )
            })}
            best={<td colSpan={4} className={cn(td, 'border-l bg-success-soft text-success')}>{formatBRL(map.mixTotal)}</td>}
          />
          <FooterRow
            label="Resultado QC / Orçamento"
            hint="Verba disponível − total"
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
  )
}

function FooterRow({ label, hint, budget, cells, best }: { label: string; hint?: string; budget: string; cells: React.ReactNode; best: React.ReactNode }) {
  return (
    <tr>
      <td className={cn(td, stickyFirst, 'bg-ink-50 text-left')} colSpan={1}>
        {label}
        {hint && <span className="block text-[11px] leading-4 font-normal text-text-muted">{hint}</span>}
      </td>
      <td className={cn(td, 'bg-ink-50')} colSpan={2} />
      <td className={cn(td, 'border-l bg-ink-50')} colSpan={2}>
        {budget}
      </td>
      {cells}
      {best}
    </tr>
  )
}
