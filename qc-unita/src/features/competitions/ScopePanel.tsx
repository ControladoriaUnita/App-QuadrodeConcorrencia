/**
 * Escopo e distribuição por item: % material, % equipamento, % retenção, escopo e observações de contrato.
 * Alimenta a distribuição da Solicitação de Contrato (§1.6).
 */
import { useState } from 'react'
import type { CompetitionDetailDTO, UpdateItemInput } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { computeDistribution } from '@shared/domain/contract/distribution'
import type { QcMap } from '@shared/domain/competition/qc-map'
import { Card, CardHeader, DecimalInput } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatPercent, formatQuantity } from '@/utils/format'

export function ScopePanel({ detail, map, onUpdate }: { detail: CompetitionDetailDTO; map: QcMap; onUpdate: (itemId: string, patch: UpdateItemInput) => void }) {
  const editable = detail.can.edit
  const dist = computeDistribution(
    map.items.map((i) => ({
      total: map.bestByItem.get(i.id)?.totalPrice ?? Decimal.ZERO,
      pctMaterial: i.pctMaterial,
      pctEquipment: i.pctEquipment,
    })),
  )
  const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap'
  const td = 'border-b border-border px-3 py-1.5 align-top'

  return (
    <Card>
      <CardHeader
        title="Escopo e distribuição do contrato"
        description={
          <span className="tabular">
            Distribuição ponderada pela melhor condição — Material {formatPercent(dist.pctMaterial, 1)} · Equipamento {formatPercent(dist.pctEquipment, 1)} · MDO/Serviço{' '}
            {formatPercent(dist.pctService, 1)}
          </span>
        }
      />
      <div className="max-h-[calc(100dvh-12rem)] overflow-auto">
        <table className="tabular w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={cn(th, 'text-left')}>Insumo</th>
              <th className={cn(th, 'text-right')}>Quant. orçada</th>
              <th className={cn(th, 'w-24 text-right')}>% Mat.</th>
              <th className={cn(th, 'w-24 text-right')}>% Equip.</th>
              <th className={cn(th, 'w-24 text-right')}>% Ret.</th>
              <th className={cn(th, 'min-w-72 text-left')}>Escopo dos serviços</th>
              <th className={cn(th, 'min-w-56 text-left')}>Obs. contratos</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((i) => (
              <tr key={i.id} className="hover:bg-ink-50">
                <td className={cn(td, 'max-w-80')}>
                  <p className="truncate font-medium" title={i.description}>{i.description}</p>
                  <p className="text-[11px] leading-4 text-text-muted">{i.code}</p>
                </td>
                <td className={cn(td, 'text-right text-text-muted')}>{formatQuantity(i.budgetQuantity)} {i.unit}</td>
                {(['pctMaterial', 'pctEquipment', 'pctRetention'] as const).map((k) => (
                  <td key={k} className={cn(td, 'px-1')}>
                    <DecimalInput
                      value={i[k]}
                      scale="ratio"
                      fractionDigits={1}
                      allowEmpty={false}
                      disabled={!editable}
                      gridColumn={k}
                      aria-label={`${k} de ${i.code}`}
                      onCommit={(v) => v !== null && onUpdate(i.id, { [k]: v })}
                    />
                  </td>
                ))}
                <td className={td}>
                  <TextCell value={i.scopeDescription} disabled={!editable} onCommit={(v) => onUpdate(i.id, { scopeDescription: v })} label={`Escopo de ${i.code}`} />
                </td>
                <td className={td}>
                  <TextCell value={i.contractNotes} disabled={!editable} onCommit={(v) => onUpdate(i.id, { contractNotes: v })} label={`Observação de ${i.code}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function TextCell({ value, onCommit, disabled, label }: { value: string | null; onCommit: (v: string | null) => void; disabled: boolean; label: string }) {
  const [text, setText] = useState(value ?? '')
  return (
    <input
      aria-label={label}
      value={text}
      disabled={disabled}
      placeholder="—"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = text.trim() || null
        if (v !== (value ?? null)) onCommit(v)
      }}
      className="h-8 w-full rounded-control border border-transparent bg-transparent px-2 text-sm placeholder:text-ink-300 hover:border-border focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:hover:border-transparent"
    />
  )
}
