/**
 * Vínculos e insumos — consolidador do QC (linha a linha do orçamento), em três visões
 * alternáveis para que a área de preenchimento (amarração) ocupe a tela:
 *  1. Consolidado por vínculo de planejamento: orçado do vínculo × outros QCs × este QC × saldo.
 *  2. Consolidado por insumo: quantidade orçada na obra × outros QCs × este QC × saldo.
 *  3. Amarração dos itens: para cada item do QC, as linhas do orçamento vinculadas e o PERCENTUAL
 *     de cada linha comprometido por esta contratação — ele define a verba puxada (custo total da
 *     linha × %) e a quantidade vinculada (a soma deve fechar com a quantidade do item).
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ListPlus, Scale, Trash2, Unlink } from 'lucide-react'
import type { CompetitionDetailDTO, SetItemLinksInput } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { consolidate, rebalance } from '@shared/domain/planning/links'
import type { QcMap } from '@shared/domain/competition/qc-map'
import { Badge, Button, Card, CardHeader, ConfirmDialog, ConsumptionMeter, DecimalInput, Dialog, Skeleton } from '@/components/ui'
import { BudgetLinesTable, freeShare, pulledValue } from '@/features/works/BudgetLinesTable'
import { useBudgetLines } from '@/features/works/api'
import { cn } from '@/utils/cn'
import { EMPTY, formatBRL, formatDecimal, formatPercent, formatQuantity } from '@/utils/format'

type LinkInput = SetItemLinksInput['links'][number]

interface Props {
  detail: CompetitionDetailDTO
  map: QcMap
  saving: boolean
  adding: boolean
  onSave: (itemId: string, links: LinkInput[]) => void
  onAddLines: (selection: Map<string, string>) => Promise<unknown>
  onRemoveItem: (itemId: string) => void
  onItemQuantity: (itemId: string, quantity: string) => void
}

type View = 'amarracao' | 'vinculo' | 'insumo'
const VIEWS: { key: View; label: string }[] = [
  { key: 'amarracao', label: 'Amarração linha a linha' },
  { key: 'vinculo', label: 'Consolidado por vínculo' },
  { key: 'insumo', label: 'Consolidado por insumo' },
]

const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
const td = 'border-b border-border px-3 py-2 whitespace-nowrap'

export function LinksPanel({ detail, map, saving, adding, onSave, onAddLines, onRemoveItem, onItemQuantity }: Props) {
  const [view, setView] = useState<View>('amarracao')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [picking, setPicking] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const cons = useMemo(() => consolidate(detail.budgetLines, map.links, detail.otherCommitments), [detail.budgetLines, detail.otherCommitments, map.links])
  const lineByKey = useMemo(() => new Map(detail.budgetLines.map((l) => [l.lineKey, l])), [detail.budgetLines])
  const othersByLine = useMemo(() => {
    const m = new Map<string, { quantity: Decimal; share: Decimal; value: Decimal }>()
    for (const o of detail.otherCommitments) {
      if (!o.lineKey) continue
      const e = m.get(o.lineKey) ?? { quantity: Decimal.ZERO, share: Decimal.ZERO, value: Decimal.ZERO }
      m.set(o.lineKey, { quantity: e.quantity.plus(o.quantity), share: e.share.plus(o.share), value: e.value.plus(o.budgetValue) })
    }
    return m
  }, [detail.otherCommitments])
  const pulledTotal = Decimal.sum(detail.links.map((l) => l.budgetValue))

  const problems = detail.items.filter((i) => {
    const b = map.linkBalance.get(i.id)
    return b && (b.count === 0 || !b.diff.isZero())
  })
  const items = onlyIssues ? problems : detail.items
  const editable = detail.can.edit

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Visão" className="inline-flex rounded-control border border-border bg-surface p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="radio"
              aria-checked={view === v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'rounded-[calc(var(--radius-control)-2px)] px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors',
                view === v.key ? 'bg-secondary text-white' : 'text-ink-600 hover:text-text',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        {problems.length > 0 ? (
          <Badge tone="warning" icon={<AlertTriangle className="size-3" />}>
            {problems.length} item(ns) com vínculo pendente — a quantidade vinculada precisa fechar com a do QC
          </Badge>
        ) : (
          <Badge tone="success" icon={<CheckCircle2 className="size-3" />}>Todos os itens vinculados ao planejamento</Badge>
        )}
        <span className="tabular ml-auto text-sm text-text-muted">
          Verba puxada <span className="font-semibold text-text">{formatBRL(pulledTotal)}</span>
        </span>
      </div>

      {view === 'vinculo' && (
        <Card>
          <CardHeader title="Consolidado por vínculo de planejamento" description="Orçado do vínculo inteiro × contratações de outros QCs × este QC." />
          <div className="max-h-[calc(100dvh-13rem)] overflow-auto">
            <table className="tabular w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className={cn(th, 'text-left')}>Vínculo</th>
                  <th className={cn(th, 'text-right')}>Orçado</th>
                  <th className={cn(th, 'text-right')}>Verba puxada</th>
                  <th className={cn(th, 'text-right')}>Outros QCs</th>
                  <th className={cn(th, 'text-right')}>Este QC</th>
                  <th className={cn(th, 'text-right')}>Saldo</th>
                  <th className={cn(th, 'min-w-36 text-left')}>Consumo</th>
                </tr>
              </thead>
              <tbody>
                {cons.byPackage.map((p) => (
                  <tr key={p.packageCode} className="hover:bg-ink-50">
                    <td className={td}>
                      <p className="font-medium">{p.description}</p>
                      <p className="text-[11px] leading-4 text-text-muted">{p.packageCode}</p>
                    </td>
                    <td className={cn(td, 'text-right')}>{formatBRL(p.budgetTotal)}</td>
                    <td className={cn(td, 'text-right')}>
                      {formatBRL(p.thisBudget)}
                      <span className="block text-[11px] leading-4 text-text-muted">
                        {p.budgetTotal.isZero() ? EMPTY : `${formatPercent(p.thisBudget.div(p.budgetTotal, 6), 2)} do vínculo`}
                      </span>
                    </td>
                    <td className={cn(td, 'text-right text-ink-700')}>{p.othersAmount.isZero() ? EMPTY : formatBRL(p.othersAmount)}</td>
                    <td className={cn(td, 'text-right font-medium')}>{formatBRL(p.thisAmount)}</td>
                    <td className={cn(td, 'text-right', p.balance.isNegative() ? 'font-semibold text-error' : 'text-success')}>{formatBRL(p.balance)}</td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <ConsumptionMeter
                          className="flex-1"
                          size="sm"
                          showLegend={false}
                          values={{ budget: p.budgetTotal, contracted: p.othersAmount, inApproval: Decimal.ZERO, quoting: p.thisAmount }}
                        />
                        <span className={cn('w-12 text-right text-xs font-medium', p.balance.isNegative() && 'text-error')}>{formatPercent(p.consumption, 1)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-5 py-2 text-xs text-text-muted">
            Barra: <span className="font-medium text-text">sólido</span> = outros QCs · <span className="font-medium text-text">hachurado</span> = este QC (valor da vencedora indicada ou melhor condição).
          </p>
        </Card>
      )}

      {view === 'insumo' && (
        <Card>
          <CardHeader title="Consolidado por insumo" description="Quantidade orçada na obra (todos os vínculos) × já contratada × este QC." />
          <div className="max-h-[calc(100dvh-13rem)] overflow-auto">
            <table className="tabular w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className={cn(th, 'text-left')}>Insumo</th>
                  <th className={cn(th, 'text-right')}>Orçado</th>
                  <th className={cn(th, 'text-right')}>Outros QCs</th>
                  <th className={cn(th, 'text-right')}>Este QC</th>
                  <th className={cn(th, 'text-right')}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {cons.byMaterial.map((m) => (
                  <tr key={m.materialId} className="hover:bg-ink-50">
                    <td className={cn(td, 'max-w-72')}>
                      <p className="truncate font-medium" title={m.description}>{m.description}</p>
                      <p className="text-[11px] leading-4 text-text-muted">{m.code} · {m.unit}</p>
                    </td>
                    <td className={cn(td, 'text-right')}>
                      {formatQuantity(m.budgetQuantity)}
                      <span className="block text-[11px] leading-4 text-text-muted">{formatBRL(m.budgetTotal)}</span>
                    </td>
                    <td className={cn(td, 'text-right text-ink-700')}>{m.othersQuantity.isZero() ? EMPTY : formatQuantity(m.othersQuantity)}</td>
                    <td className={cn(td, 'text-right font-medium')}>{formatQuantity(m.thisQuantity)}</td>
                    <td className={cn(td, 'text-right', m.balanceQuantity.isNegative() ? 'font-semibold text-error' : 'text-success')}>
                      {formatQuantity(m.balanceQuantity)}
                      {m.balanceQuantity.isNegative() && <span className="block text-[11px] leading-4">acima do orçado</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {view === 'amarracao' && (
      <Card>
        <CardHeader
          title="Amarração linha a linha ao orçamento"
          description="Informe o % de cada linha que esta contratação compromete — ele define a verba puxada e a quantidade vinculada."
          actions={
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-ink-700">
                <input type="checkbox" className="size-4 accent-primary" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
                Somente pendências
              </label>
              {editable && (
                <Button variant="primary" size="sm" icon={<ListPlus className="size-4" />} onClick={() => setPicking(true)}>
                  Adicionar linhas do orçamento
                </Button>
              )}
            </div>
          }
        />
        <div className="max-h-[calc(100dvh-12rem)] min-h-80 overflow-auto">
          <table className="tabular w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={cn(th, 'text-left')}>IP de planejamento</th>
                <th className={cn(th, 'min-w-64 text-left')}>Linha do orçamento (EAP · composição)</th>
                <th className={cn(th, 'text-right')}>Linha no orçamento</th>
                <th className={cn(th, 'text-right')}>Outros QCs</th>
                <th className={cn(th, 'w-28 text-right')}>% da linha</th>
                <th className={cn(th, 'w-36 text-right')}>Qtd. vinculada</th>
                <th className={cn(th, 'text-right')}>Verba puxada</th>
                <th className={cn(th, 'text-right')}>R$ contratado</th>
                <th className={cn(th, 'w-10')} />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const own = detail.links.filter((l) => l.itemId === item.id)
                const bal = map.linkBalance.get(item.id)!
                const ok = bal.count > 0 && bal.diff.isZero()
                // Mantém o % das demais linhas ao editar uma delas
                const current = (): LinkInput[] => own.filter((l) => !!l.activityItemId).map((l) => ({ activityItemId: l.activityItemId!, share: l.share }))
                const itemPulled = Decimal.sum(own.map((l) => l.budgetValue))
                const save = (links: LinkInput[]) => onSave(item.id, links)
                const adjust = () => {
                  const q = rebalance(own.map((l) => Decimal.from(l.quantity)), Decimal.from(item.quantity))
                  save(own.map((l, i) => ({ activityItemId: l.activityItemId!, quantity: q[i]!.toFixed(4) })))
                }
                return (
                  <ItemBlock key={item.id}>
                    <tr className="bg-ink-50/60">
                      <td colSpan={5} className={cn(td, 'whitespace-normal')}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-text-muted">{item.sortOrder}</span>
                          <span className="font-semibold text-text">{item.description}</span>
                          <span className="text-xs text-text-muted">{item.code}</span>
                          {ok ? (
                            <Badge tone="success" icon={<CheckCircle2 className="size-3" />}>Vinculado</Badge>
                          ) : (
                            <Badge tone="warning" icon={<AlertTriangle className="size-3" />}>
                              {bal.count === 0 ? 'Sem vínculo' : `Diferença ${formatQuantity(bal.diff)} ${item.unit}`}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className={cn(td, 'text-right')}>
                        <span className="text-xs text-text-muted">QC </span>
                        <span className="font-semibold">{formatQuantity(item.quantity)}</span>
                        <span className="block text-[11px] leading-4 text-text-muted">vinculado {formatQuantity(bal.linked)}</span>
                      </td>
                      <td className={cn(td, 'text-right')}>
                        <span className="font-semibold">{formatBRL(itemPulled)}</span>
                        <span className="block text-[11px] leading-4 text-text-muted">verba do item</span>
                      </td>
                      <td colSpan={2} className={cn(td, 'text-right')}>
                        {editable && (
                          <div className="flex justify-end gap-1">
                            {bal.count > 0 && !bal.diff.isZero() && (
                              <>
                                <Button size="sm" variant="ghost" icon={<Scale className="size-4" />} disabled={saving} onClick={adjust} title="Redistribui a quantidade do item entre as linhas">
                                  Ajustar proporcional
                                </Button>
                                <Button size="sm" variant="ghost" disabled={saving} onClick={() => onItemQuantity(item.id, bal.linked.toFixed(4))} title="Quantidade do item = soma das linhas">
                                  Usar soma das linhas
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="ghost" aria-label="Remover item do QC" icon={<Trash2 className="size-4" />} disabled={saving} onClick={() => setRemoving(item.id)} />
                          </div>
                        )}
                      </td>
                    </tr>
                    {own.map((l, idx) => {
                      const line = l.lineKey ? lineByKey.get(l.lineKey) : undefined
                      const others = (l.lineKey && othersByLine.get(l.lineKey)) || null
                      const value = map.links.find((x) => x.id === l.id)
                      const share = Decimal.from(l.share)
                      const free = Decimal.from(1).minus(others?.share ?? Decimal.ZERO)
                      const over = share.gt(free)
                      return (
                        <tr key={l.id} className="hover:bg-ink-50">
                          <td className={cn(td, 'pl-6 whitespace-nowrap')}>
                            <p className="font-medium">{l.packageCode ?? 'Sem IP'}</p>
                            <p className="max-w-44 truncate text-[11px] leading-4 text-text-muted" title={l.packageDescription ?? undefined}>{l.packageDescription ?? EMPTY}</p>
                          </td>
                          <td className={cn(td, 'max-w-80')}>
                            {line ? (
                              <>
                                <p className="truncate" title={line.activityDescription}>{line.activityWbs} · {line.activityDescription}</p>
                                <p className="text-[11px] leading-4 text-text-muted">{line.code} · {line.description}</p>
                              </>
                            ) : (
                              <p className="text-xs text-warning">Linha não existe no orçamento vigente ({l.lineKey ?? 'sem chave'})</p>
                            )}
                          </td>
                          <td className={cn(td, 'text-right whitespace-nowrap')}>
                            {line ? (
                              <>
                                {formatBRL(line.total)}
                                <span className="block text-[11px] leading-4 text-text-muted">{formatQuantity(line.quantity)} {line.unit}</span>
                              </>
                            ) : EMPTY}
                          </td>
                          <td className={cn(td, 'text-right whitespace-nowrap text-ink-700')}>
                            {others ? (
                              <>
                                {formatPercent(others.share, 1)}
                                <span className="block text-[11px] leading-4 text-text-muted">{formatBRL(others.value)}</span>
                              </>
                            ) : EMPTY}
                          </td>
                          <td className={cn(td, 'px-1')}>
                            <DecimalInput
                              value={l.share}
                              scale="ratio"
                              suffix="%"
                              max="1"
                              allowEmpty={false}
                              disabled={!editable || saving || !l.activityItemId}
                              gridColumn="link-share"
                              aria-label={`% da linha ${idx + 1} de ${item.code}`}
                              onCommit={(v) => v !== null && save(current().map((c) => (c.activityItemId === l.activityItemId ? { activityItemId: c.activityItemId, share: v } : c)))}
                              className={cn('font-medium', over && 'text-error')}
                            />
                            {over && <p className="px-2 text-right text-[11px] leading-4 text-error">livre {formatPercent(Decimal.max(Decimal.ZERO, free), 1)}</p>}
                          </td>
                          <td className={cn(td, 'px-1')}>
                            <DecimalInput
                              value={l.quantity}
                              fractionDigits={4}
                              trimZeros
                              allowEmpty={false}
                              disabled={!editable || saving}
                              gridColumn="link-qty"
                              aria-label={`Quantidade vinculada ${idx + 1} de ${item.code}`}
                              onCommit={(v) => v !== null && save(current().map((c) => (c.activityItemId === l.activityItemId ? { activityItemId: c.activityItemId, quantity: v } : c)))}
                            />
                          </td>
                          <td className={cn(td, 'text-right whitespace-nowrap font-medium')}>{formatBRL(l.budgetValue)}</td>
                          <td className={cn(td, 'text-right whitespace-nowrap font-medium')}>
                            {value?.awardedTotal ? formatBRL(value.awardedTotal) : EMPTY}
                            {value?.awardedUnitPrice && <span className="block text-[11px] leading-4 font-normal text-text-muted">{formatDecimal(value.awardedUnitPrice)} / {item.unit}</span>}
                          </td>
                          <td className={cn(td, 'px-1 text-right')}>
                            {editable && (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label="Desvincular linha"
                                icon={<Unlink className="size-4" />}
                                disabled={saving}
                                onClick={() => save(current().filter((c) => c.activityItemId !== l.activityItemId))}
                              />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </ItemBlock>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      <LinePickerDialog
        open={picking}
        detail={detail}
        adding={adding}
        onClose={() => setPicking(false)}
        onAdd={async (selection) => {
          await onAddLines(selection)
          setPicking(false)
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title="Remover item do QC?"
        description="O item, seus preços lançados e os vínculos com o orçamento serão removidos desta revisão. As linhas voltam a ficar livres para outros QCs."
        confirmLabel="Remover item"
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) onRemoveItem(removing)
          setRemoving(null)
        }}
      />
    </div>
  )
}

/** Seletor de linhas do orçamento da obra (todas as IPs), com o comprometido por outros QCs. */
function LinePickerDialog({ open, detail, adding, onClose, onAdd }: { open: boolean; detail: CompetitionDetailDTO; adding: boolean; onClose: () => void; onAdd: (selection: Map<string, string>) => void }) {
  const lines = useBudgetLines(detail.competition.workId, { excludeCompetitionId: detail.competition.id }, open)
  const [selection, setSelection] = useState<Map<string, string>>(new Map())
  const close = () => (setSelection(new Map()), onClose())
  const chosen = (lines.data ?? []).filter((l) => selection.has(l.id))
  const pulled = Decimal.sum(chosen.map((l) => pulledValue(l, selection.get(l.id)!)))
  const invalid = chosen.some((l) => { const s = Decimal.from(selection.get(l.id)!); return !s.isPositive() || s.gt(freeShare(l)) })
  const inQc = useMemo(() => {
    const keys = new Set(detail.links.map((l) => l.lineKey))
    return new Set((lines.data ?? []).filter((l) => keys.has(l.lineKey)).map((l) => l.id))
  }, [lines.data, detail.links])
  return (
    <Dialog
      open={open}
      onClose={close}
      width="min(96vw, 84rem)"
      title="Adicionar linhas do orçamento"
      description="Escolha linhas de qualquer IP de planejamento e o % de cada uma a comprometer (verba puxada). Linhas de um insumo já presente no QC viram novos vínculos do item; as demais criam itens novos. Linhas já neste QC aparecem esmaecidas."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={close}>Cancelar</Button>
          <span className="tabular self-center text-sm text-text-muted">{selection.size} linha(s) · verba puxada {formatBRL(pulled)}</span>
          <Button variant="primary" disabled={!selection.size || invalid} loading={adding} onClick={() => onAdd(selection)}>
            Adicionar ao QC
          </Button>
        </>
      }
    >
      {lines.isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : (
        <div className="-mx-6 border-y border-border">
          <BudgetLinesTable
            lines={lines.data ?? []}
            selectable
            selection={selection}
            onSelectionChange={setSelection}
            disabledIds={inQc}
            initialOnlyBalance
            maxHeight="55vh"
          />
        </div>
      )}
    </Dialog>
  )
}

function ItemBlock({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
