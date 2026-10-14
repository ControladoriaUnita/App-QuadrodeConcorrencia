/**
 * Vínculos e insumos do QC, em duas visões:
 *  1. Vínculos de planejamento: consolidado por IP — orçado do vínculo × outros QCs × este QC × saldo;
 *     ao abrir um IP, os insumos referência e os insumos do mapa que caem nele.
 *  2. Insumos referência: os insumos do orçamento puxados pelo QC. Para cada um, as linhas do
 *     orçamento e o PERCENTUAL de cada linha comprometido (verba = custo total da linha × %),
 *     o consolidado do insumo na obra e em quais insumos do mapa ele é usado.
 */
import { Fragment, useMemo, useState } from 'react'
import { ChevronRight, ListPlus, Trash2, Unlink } from 'lucide-react'
import type { CompetitionDetailDTO, SetReferenceLinesInput } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { consolidate } from '@shared/domain/planning/links'
import type { QcMap } from '@shared/domain/competition/qc-map'
import { Badge, Button, Card, CardHeader, ConfirmDialog, ConsumptionMeter, DecimalInput, Dialog, Skeleton } from '@/components/ui'
import { freeShare, pulledValue } from '@/features/works/BudgetLinesTable'
import { BudgetTree } from '@/features/works/BudgetTree'
import { useBudgetLines, useBudgetStructure } from '@/features/works/api'
import { cn } from '@/utils/cn'
import { EMPTY, formatBRL, formatDecimal, formatPercent, formatQuantity } from '@/utils/format'

type LinkInput = SetReferenceLinesInput['links'][number]

interface Props {
  detail: CompetitionDetailDTO
  map: QcMap
  saving: boolean
  adding: boolean
  onSaveLines: (referenceId: string, links: LinkInput[]) => void
  onAddLines: (selection: Map<string, string>, fillMap: boolean) => Promise<unknown>
  onRemoveReference: (referenceId: string) => void
}

type View = 'vinculos' | 'referencias'
const VIEWS: { key: View; label: string }[] = [
  { key: 'vinculos', label: 'Vínculos de planejamento' },
  { key: 'referencias', label: 'Insumos referência' },
]

const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
const td = 'border-b border-border px-3 py-2 whitespace-nowrap'

export function LinksPanel({ detail, map, saving, adding, onSaveLines, onAddLines, onRemoveReference }: Props) {
  const [view, setView] = useState<View>('referencias')
  const [picking, setPicking] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const cons = useMemo(() => consolidate(detail.budgetLines, map.links, detail.otherCommitments), [detail.budgetLines, detail.otherCommitments, map.links])
  const pulledTotal = Decimal.sum(detail.links.map((l) => l.budgetValue))
  const unused = detail.references.filter((r) => !map.referenceUsage.get(r.id)?.length)

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
        {unused.length > 0 && <Badge tone="warning">{unused.length} referência(s) sem uso no mapa de cotação</Badge>}
        <span className="tabular ml-auto text-sm text-text-muted">
          {detail.references.length} insumo(s) referência · verba puxada <span className="font-semibold text-text">{formatBRL(pulledTotal)}</span>
        </span>
      </div>

      {view === 'vinculos' && <PlanningView detail={detail} map={map} packages={cons.byPackage} />}

      {view === 'referencias' && (
        <ReferencesView
          detail={detail}
          map={map}
          byMaterial={new Map(cons.byMaterial.map((m) => [m.materialId, m]))}
          saving={saving}
          onSaveLines={onSaveLines}
          onAdd={() => setPicking(true)}
          onRemove={setRemoving}
        />
      )}

      <LinePickerDialog
        open={picking}
        detail={detail}
        adding={adding}
        onClose={() => setPicking(false)}
        onAdd={async (selection, fillMap) => {
          await onAddLines(selection, fillMap)
          setPicking(false)
        }}
      />
      <ConfirmDialog
        open={!!removing}
        title="Remover insumo referência?"
        description="As linhas do orçamento dele voltam a ficar livres para outros QCs, e os insumos do mapa ligados a ele deixam de usá-lo na comparação."
        confirmLabel="Remover referência"
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) onRemoveReference(removing)
          setRemoving(null)
        }}
      />
    </div>
  )
}

// ----------------------------------------------------------------------------- vínculos de planejamento
function PlanningView({ detail, map, packages }: { detail: CompetitionDetailDTO; map: QcMap; packages: ReturnType<typeof consolidate>['byPackage'] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (code: string) => setOpen((s) => (s.has(code) ? (s.delete(code), new Set(s)) : new Set(s.add(code))))
  const refById = new Map(detail.references.map((r) => [r.id, r]))
  const itemById = new Map(detail.items.map((i) => [i.id, i]))

  return (
    <Card>
      <CardHeader
        title="Consolidado por vínculo de planejamento"
        description="Orçado do vínculo inteiro × contratações de outros QCs × este QC. Abra um IP para ver os insumos referência e os insumos do mapa que caem nele."
      />
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
            {packages.map((p) => {
              const isOpen = open.has(p.packageCode)
              const refs = [...new Set(detail.links.filter((l) => l.packageCode === p.packageCode).map((l) => l.referenceId))]
              const items = detail.items.filter((i) => (map.allocationsByItem.get(i.id) ?? []).some((a) => a.packageCode === p.packageCode))
              return (
                <Fragment key={p.packageCode}>
                  <tr className="cursor-pointer hover:bg-ink-50" onClick={() => toggle(p.packageCode)}>
                    <td className={td}>
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className={cn('size-4 text-ink-400 transition-transform', isOpen && 'rotate-90')} aria-hidden />
                        <div>
                          <p className="font-medium">{p.description}</p>
                          <p className="text-[11px] leading-4 text-text-muted">{p.packageCode} · {refs.length} referência(s) · {items.length} insumo(s) do mapa</p>
                        </div>
                      </div>
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
                  {isOpen && (
                    <tr>
                      <td colSpan={7} className="border-b border-border bg-ink-50/50 px-10 py-3">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-semibold text-text-muted">Insumos referência (orçamento)</p>
                            <ul className="grid gap-1 text-sm">
                              {refs.map((rid) => {
                                const r = refById.get(rid)
                                const verba = Decimal.sum(detail.links.filter((l) => l.referenceId === rid && l.packageCode === p.packageCode).map((l) => l.budgetValue))
                                return (
                                  <li key={rid} className="flex justify-between gap-3">
                                    <span className="min-w-0 truncate">{r?.code} · {r?.description}</span>
                                    <span className="tabular shrink-0">{formatBRL(verba)}</span>
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-semibold text-text-muted">Insumos do mapa (contrato)</p>
                            {items.length ? (
                              <ul className="grid gap-1 text-sm">
                                {items.map((i) => {
                                  const a = map.allocationsByItem.get(i.id)!.find((x) => x.packageCode === p.packageCode)!
                                  return (
                                    <li key={i.id} className="flex justify-between gap-3">
                                      <span className="min-w-0 truncate">{itemById.get(i.id)?.code} · {i.description}{i.planningCode && <Badge tone="neutral" className="ml-1">IP manual</Badge>}</span>
                                      <span className="tabular shrink-0">{formatQuantity(a.quantity)} {i.unit} · {formatPercent(a.share, 0)}</span>
                                    </li>
                                  )
                                })}
                              </ul>
                            ) : (
                              <p className="text-sm text-text-muted">Nenhum insumo do mapa neste IP.</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-5 py-2 text-xs text-text-muted">
        Barra: <span className="font-medium text-text">sólido</span> = outros QCs · <span className="font-medium text-text">hachurado</span> = este QC (valor da vencedora indicada ou melhor condição, distribuído pela verba das linhas).
      </p>
    </Card>
  )
}

// ----------------------------------------------------------------------------- insumos referência
function ReferencesView({
  detail, map, byMaterial, saving, onSaveLines, onAdd, onRemove,
}: {
  detail: CompetitionDetailDTO
  map: QcMap
  byMaterial: Map<string, ReturnType<typeof consolidate>['byMaterial'][number]>
  saving: boolean
  onSaveLines: (referenceId: string, links: LinkInput[]) => void
  onAdd: () => void
  onRemove: (referenceId: string) => void
}) {
  const [onlyUnused, setOnlyUnused] = useState(false)
  const lineByKey = useMemo(() => new Map(detail.budgetLines.map((l) => [l.lineKey, l])), [detail.budgetLines])
  const othersByLine = useMemo(() => {
    const m = new Map<string, { share: Decimal; value: Decimal }>()
    for (const o of detail.otherCommitments) {
      if (!o.lineKey) continue
      const e = m.get(o.lineKey) ?? { share: Decimal.ZERO, value: Decimal.ZERO }
      m.set(o.lineKey, { share: e.share.plus(o.share), value: e.value.plus(o.budgetValue) })
    }
    return m
  }, [detail.otherCommitments])
  const itemById = new Map(detail.items.map((i) => [i.id, i]))
  const editable = detail.can.edit
  const refs = onlyUnused ? detail.references.filter((r) => !map.referenceUsage.get(r.id)?.length) : detail.references

  return (
    <Card>
      <CardHeader
        title="Insumos referência"
        description="Insumos do orçamento puxados por este QC. Em cada linha, o % comprometido define a verba. A verba é a régua de economia ou estouro dos insumos do mapa ligados a ela."
        actions={
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" className="size-4 accent-primary" checked={onlyUnused} onChange={(e) => setOnlyUnused(e.target.checked)} />
              Somente sem uso no mapa
            </label>
            {editable && (
              <Button variant="primary" size="sm" icon={<ListPlus className="size-4" />} onClick={onAdd}>
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
              <th className={cn(th, 'w-36 text-right')}>Qtd. puxada</th>
              <th className={cn(th, 'text-right')}>Verba puxada</th>
              <th className={cn(th, 'text-right')}>R$ contratado</th>
              <th className={cn(th, 'w-10')} />
            </tr>
          </thead>
          <tbody>
            {refs.map((ref) => {
              const own = detail.links.filter((l) => l.referenceId === ref.id)
              const verba = map.referenceBudget.get(ref.id) ?? Decimal.ZERO
              const qty = Decimal.sum(own.map((l) => l.quantity))
              const usedBy = (map.referenceUsage.get(ref.id) ?? []).map((id) => itemById.get(id)).filter((i): i is NonNullable<typeof i> => !!i)
              const mat = byMaterial.get(ref.materialId)
              // Mantém o % das demais linhas ao editar uma delas
              const current = (): LinkInput[] => own.filter((l) => !!l.activityItemId).map((l) => ({ activityItemId: l.activityItemId!, share: l.share }))
              const save = (links: LinkInput[]) => onSaveLines(ref.id, links)
              return (
                <Fragment key={ref.id}>
                  <tr className="bg-ink-50/60">
                    <td colSpan={5} className={cn(td, 'whitespace-normal')}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-text">{ref.description}</span>
                        <span className="text-xs text-text-muted">{ref.code} · {ref.unit}</span>
                        {usedBy.length ? (
                          <span className="inline-flex flex-wrap items-center gap-1 text-xs text-text-muted">
                            usado em
                            {usedBy.map((i) => <Badge key={i.id} tone="primary" title={i.description}>{i.code}</Badge>)}
                          </span>
                        ) : (
                          <Badge tone="warning">Sem uso no mapa</Badge>
                        )}
                      </div>
                      {mat && (
                        <p className="mt-0.5 text-[11px] leading-4 text-text-muted">
                          Na obra: orçado {formatQuantity(mat.budgetQuantity)} {ref.unit} ({formatBRL(mat.budgetTotal)}) · outros QCs {formatQuantity(mat.othersQuantity)} ·{' '}
                          <span className={cn(mat.balanceQuantity.isNegative() && 'font-semibold text-error')}>saldo {formatQuantity(mat.balanceQuantity)}</span>
                        </p>
                      )}
                    </td>
                    <td className={cn(td, 'text-right')}>
                      <span className="font-semibold">{formatQuantity(qty)}</span>
                      <span className="block text-[11px] leading-4 text-text-muted">{ref.unit}</span>
                    </td>
                    <td className={cn(td, 'text-right')}>
                      <span className="font-semibold">{formatBRL(verba)}</span>
                      <span className="block text-[11px] leading-4 text-text-muted">verba da referência</span>
                    </td>
                    <td colSpan={2} className={cn(td, 'text-right')}>
                      {editable && (
                        <Button size="sm" variant="ghost" aria-label="Remover insumo referência" icon={<Trash2 className="size-4" />} disabled={saving} onClick={() => onRemove(ref.id)} />
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
                            aria-label={`% da linha ${idx + 1} de ${ref.code}`}
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
                            aria-label={`Quantidade puxada ${idx + 1} de ${ref.code}`}
                            onCommit={(v) => v !== null && save(current().map((c) => (c.activityItemId === l.activityItemId ? { activityItemId: c.activityItemId, quantity: v } : c)))}
                          />
                        </td>
                        <td className={cn(td, 'text-right whitespace-nowrap font-medium')}>{formatBRL(l.budgetValue)}</td>
                        <td className={cn(td, 'text-right whitespace-nowrap font-medium')}>
                          {value?.awardedTotal ? formatBRL(value.awardedTotal) : EMPTY}
                          {value?.awardedUnitPrice && <span className="block text-[11px] leading-4 font-normal text-text-muted">{formatDecimal(value.awardedUnitPrice)} / {ref.unit}</span>}
                        </td>
                        <td className={cn(td, 'px-1 text-right')}>
                          {editable && own.length > 1 && (
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
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** Seletor de linhas do orçamento da obra (todas as IPs), com o comprometido por outros QCs. */
function LinePickerDialog({ open, detail, adding, onClose, onAdd }: { open: boolean; detail: CompetitionDetailDTO; adding: boolean; onClose: () => void; onAdd: (selection: Map<string, string>, fillMap: boolean) => void }) {
  const lines = useBudgetLines(detail.competition.workId, { excludeCompetitionId: detail.competition.id }, open)
  const structure = useBudgetStructure(detail.competition.workId, open)
  const [selection, setSelection] = useState<Map<string, string>>(new Map())
  const [fillMap, setFillMap] = useState(true)
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
      width="min(98vw, 110rem)"
      title="Adicionar linhas do orçamento"
      description="Escolha linhas de qualquer IP de planejamento e o % de cada uma a comprometer (verba puxada). Linhas de um insumo que já é referência viram linhas dela; as demais criam referências novas. Linhas já neste QC aparecem esmaecidas."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={close}>Cancelar</Button>
          <label className="inline-flex items-center gap-2 self-center text-sm text-ink-700">
            <input type="checkbox" className="size-4 accent-primary" checked={fillMap} onChange={(e) => setFillMap(e.target.checked)} />
            Criar também os insumos no mapa
          </label>
          <span className="tabular self-center text-sm text-text-muted">{selection.size} linha(s) · verba puxada {formatBRL(pulled)}</span>
          <Button variant="primary" disabled={!selection.size || invalid} loading={adding} onClick={() => onAdd(selection, fillMap)}>
            Adicionar ao QC
          </Button>
        </>
      }
    >
      {lines.isLoading || structure.isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : (
        <div className="-mx-6 border-y border-border">
          <BudgetTree
            structure={structure.data ?? { budgetId: '', groups: [], activities: [] }}
            lines={lines.data ?? []}
            selection={{ value: selection, onChange: setSelection, disabledIds: inQc }}
            initialOnlyBalance
            maxHeight="55vh"
          />
        </div>
      )}
    </Dialog>
  )
}
