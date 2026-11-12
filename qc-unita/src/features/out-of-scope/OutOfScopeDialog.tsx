/**
 * Lançar / editar um custo fora de escopo: insumo (da obra ou livre), quantidade, custo unitário,
 * motivo e justificativa; Item da EAP e IP opcionais. Validação pelo mesmo schema da API.
 */
import { useMemo, useState } from 'react'
import type { OutOfScopeCategoryKey, OutOfScopeCostDTO, SaveOutOfScopeInput } from '@shared/contracts'
import { saveOutOfScopeSchema } from '@shared/contracts'
import { OUT_OF_SCOPE_CATEGORIES, outOfScopeCode, outOfScopeTotal } from '@shared/domain/budget/out-of-scope'
import { Alert, Button, Combobox, DecimalInput, Dialog, Field, Input, SegmentedControl, Select, Textarea } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { useBudgetStructure, usePlanningCodes, useWorkMaterials } from '@/features/works/api'
import { planningOptions } from '@/features/works/planning'
import { formatBRL } from '@/utils/format'

interface Props {
  workId: string
  /** null = novo lançamento */
  cost: OutOfScopeCostDTO | null
  saving: boolean
  error: ApiError | null
  onClose: () => void
  onSave: (input: SaveOutOfScopeInput) => Promise<unknown>
}

const today = () => new Date().toISOString().slice(0, 10)

export function OutOfScopeDialog({ workId, cost, saving, error, onClose, onSave }: Props) {
  const materials = useWorkMaterials(workId)
  const structure = useBudgetStructure(workId)
  const codes = usePlanningCodes(workId)

  const [free, setFree] = useState(cost ? !cost.code : false)
  const [code, setCode] = useState(cost?.code ?? '')
  const [description, setDescription] = useState(cost?.description ?? '')
  const [unit, setUnit] = useState(cost?.unit ?? '')
  const [quantity, setQuantity] = useState<string | null>(cost?.quantity ?? null)
  const [unitCost, setUnitCost] = useState<string | null>(cost?.unitCost ?? null)
  const [wbs, setWbs] = useState(cost?.wbs ?? '')
  const [planning, setPlanning] = useState(cost?.planningCode ? { code: cost.planningCode, description: cost.planningDescription } : null)
  const [category, setCategory] = useState<OutOfScopeCategoryKey | ''>(cost?.category ?? '')
  const [justification, setJustification] = useState(cost?.justification ?? '')
  const [requestedBy, setRequestedBy] = useState(cost?.requestedBy ?? '')
  const [occurredOn, setOccurredOn] = useState(cost?.occurredOn ?? today())
  const [touched, setTouched] = useState(false)

  const materialOptions = useMemo(
    () => (materials.data?.items ?? []).map((m) => ({ value: m.code, label: `${m.code} — ${m.description}`, hint: m.unit, keywords: m.code })),
    [materials.data],
  )
  const wbsOptions = useMemo(() => {
    const s = structure.data
    if (!s) return []
    const all = [
      ...s.groups.map((g) => ({ value: g.wbs, label: `${g.wbs} — ${g.description}`, hint: 'Item', keywords: g.wbs })),
      ...s.activities.map((a) => ({ value: a.wbs, label: `${a.wbs} — ${a.description}`, hint: a.code ?? 'Composição', keywords: `${a.wbs} ${a.code ?? ''}` })),
    ]
    return [{ value: '', label: 'Sem Item da EAP', keywords: '' }, ...all.sort((a, b) => a.value.localeCompare(b.value, 'pt-BR', { numeric: true }))]
  }, [structure.data])
  const ipOptions = useMemo(() => [{ value: '', label: 'Sem IP', keywords: '' }, ...planningOptions(codes.data?.items ?? [], planning)], [codes.data, planning])

  const input = {
    code: free ? (code.trim() || null) : code || null,
    description,
    unit,
    quantity: quantity ?? '',
    unitCost: unitCost ?? '',
    wbs: wbs || null,
    planningCode: planning?.code ?? null,
    planningDescription: planning?.description ?? null,
    category: category || undefined,
    justification,
    requestedBy: requestedBy.trim() || null,
    occurredOn,
  }
  const parsed = saveOutOfScopeSchema.safeParse(input)
  const empty: Record<string, string | null> = { quantity: quantity ? null : 'Informe a quantidade', unitCost: unitCost ? null : 'Informe o custo unitário', category: category ? null : 'Escolha o motivo' }
  const issue = (field: string) =>
    touched && !parsed.success ? (empty[field] ?? parsed.error.issues.find((i) => i.path[0] === field)?.message ?? null) : null
  const total = quantity && unitCost ? outOfScopeTotal(quantity, unitCost) : null
  const fromList = !free && !!code

  return (
    <Dialog
      open
      onClose={onClose}
      width="min(96vw, 48rem)"
      title={cost ? `Editar ${outOfScopeCode(cost.number)}` : 'Novo custo fora de escopo'}
      description="Item que não está previsto no orçamento da obra. Registre o motivo e a justificativa: o lançamento fica na auditoria."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={async () => {
              setTouched(true)
              if (!parsed.success) return
              try {
                await onSave(parsed.data)
                onClose()
              } catch {
                /* a recusa da API aparece no topo do diálogo */
              }
            }}
          >
            {cost ? 'Salvar' : 'Lançar custo'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {error && <Alert tone="error" title={error.message} />}
        <SegmentedControl
          label="Origem do insumo"
          items={[{ key: 'obra', label: 'Insumo cadastrado' }, { key: 'livre', label: 'Insumo livre' }]}
          value={free ? 'livre' : 'obra'}
          onChange={(k) => setFree(k === 'livre')}
        />
        {!free && (
          <Field label="Insumo" hint={materials.data?.warning ?? 'Busque pelo código ou pela descrição.'}>
            <Combobox
              options={materialOptions}
              value={code || null}
              loading={materials.isLoading}
              placeholder="Buscar insumo por código ou descrição…"
              maxResults={60}
              onChange={(c) => {
                const m = materials.data?.items.find((x) => x.code === c)
                setCode(c)
                if (m) {
                  setDescription(m.description)
                  setUnit(m.unit)
                }
              }}
              aria-label="Insumo cadastrado"
            />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_6rem]">
          <Field label="Código">
            <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={fromList} placeholder={free ? 'Opcional' : undefined} />
          </Field>
          <Field label="Descrição" required error={issue('description')}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Unid." required error={issue('unit')}>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_10rem]">
          <Field label="Quantidade" required error={issue('quantity')}>
            <DecimalInput value={quantity} onCommit={setQuantity} fractionDigits={4} trimZeros placeholder="0,00" aria-label="Quantidade" className="border-border bg-surface" />
          </Field>
          <Field label="Custo unitário (R$)" required error={issue('unitCost')}>
            <DecimalInput value={unitCost} onCommit={setUnitCost} placeholder="0,00" aria-label="Custo unitário" className="border-border bg-surface" />
          </Field>
          <Field label="Total">
            <p className="tabular flex h-8 items-center justify-end rounded-control bg-ink-50 px-2 text-sm font-semibold">{total ? formatBRL(total) : '—'}</p>
          </Field>
          <Field label="Data" required error={issue('occurredOn')}>
            <Input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Motivo" required error={issue('category')}>
            <Select value={category} onChange={(e) => setCategory(e.target.value as OutOfScopeCategoryKey)}>
              <option value="">Selecione…</option>
              {(Object.keys(OUT_OF_SCOPE_CATEGORIES) as OutOfScopeCategoryKey[]).map((k) => (
                <option key={k} value={k}>{OUT_OF_SCOPE_CATEGORIES[k]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Solicitado por" hint="Quem pediu ou apontou o custo (opcional).">
            <Input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
          </Field>
        </div>
        <Field label="Justificativa" required error={issue('justification')} hint="Por que o custo não estava previsto no orçamento.">
          <Textarea rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item da EAP (opcional)" hint="Onde o custo se encaixa no orçamento." error={issue('wbs')}>
            <Combobox options={wbsOptions} value={wbs} loading={structure.isLoading} maxResults={80} onChange={setWbs} aria-label="Item da EAP" />
          </Field>
          <Field label="Vínculo de planejamento (IP, opcional)" hint={codes.data?.warning ?? undefined}>
            <Combobox
              options={ipOptions}
              value={planning?.code ?? ''}
              loading={codes.isLoading}
              onChange={(c) => setPlanning(c ? { code: c, description: codes.data?.items.find((x) => x.code === c)?.description ?? planning?.description ?? null } : null)}
              aria-label="Vínculo de planejamento"
            />
          </Field>
        </div>
      </div>
    </Dialog>
  )
}
