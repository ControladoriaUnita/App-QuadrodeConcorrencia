/**
 * Diálogos do mapa de cotação:
 *  - Adicionar insumo: da lista de insumos da obra (UAU) ou livre, com quantidade e as referências usadas.
 *  - Editar insumo: referências ligadas, IP manual (ou herdado) e, para insumos criados no mapa, a identificação.
 */
import { useMemo, useState } from 'react'
import type { AddQcItemInput, CompetitionDetailDTO, QcItemDTO, UpdateItemInput } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import type { QcMap } from '@shared/domain/competition/qc-map'
import { Alert, Button, Combobox, Dialog, Field, Input } from '@/components/ui'
import { usePlanningCodes, useWorkMaterials } from '@/features/works/api'
import { cn } from '@/utils/cn'
import { formatBRL, formatQuantity } from '@/utils/format'

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Quantidade digitada no padrão brasileiro → decimal canônico (null se inválida) */
function parseQuantity(text: string): string | null {
  try {
    const d = Decimal.parseBR(text.trim())
    return d.isNegative() ? null : d.round(4).toDb()
  } catch {
    return null
  }
}

/** Lista de insumos referência com busca e marcação (verba e onde já são usados) */
function ReferencePicker({ detail, map, value, onChange, exceptItemId }: { detail: CompetitionDetailDTO; map: QcMap; value: string[]; onChange: (ids: string[]) => void; exceptItemId?: string }) {
  const [q, setQ] = useState('')
  const itemById = new Map(detail.items.map((i) => [i.id, i]))
  const terms = fold(q).split(/\s+/).filter(Boolean)
  const refs = detail.references.filter((r) => !terms.length || terms.every((t) => fold(`${r.code} ${r.description}`).includes(t)))
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div className="grid gap-2">
      <Input placeholder="Buscar referência por código ou descrição…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar insumo referência" />
      <ul className="max-h-64 overflow-auto rounded-control border border-border">
        {refs.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">Nenhum insumo referência encontrado.</li>}
        {refs.map((r) => {
          const usedBy = (map.referenceUsage.get(r.id) ?? []).filter((id) => id !== exceptItemId).map((id) => itemById.get(id)?.code).filter(Boolean)
          const checked = value.includes(r.id)
          return (
            <li key={r.id} className={cn('border-b border-border last:border-b-0', checked && 'bg-primary-soft/60')}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-1.5 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={checked} onChange={() => toggle(r.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.description}</span>
                  <span className="block text-xs text-text-muted">
                    {r.code} · {r.unit}
                    {usedBy.length ? ` · já usada em ${usedBy.join(', ')}` : ' · sem uso no mapa'}
                  </span>
                </span>
                <span className="tabular shrink-0 text-xs text-text-muted">{formatBRL(map.referenceBudget.get(r.id) ?? Decimal.ZERO)}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-text-muted">
        {value.length} referência(s) marcada(s) · verba {formatBRL(Decimal.sum(value.map((id) => map.referenceBudget.get(id) ?? Decimal.ZERO)))}. Uma referência usada em vários insumos tem a verba rateada pelo valor contratado de cada um.
      </p>
    </div>
  )
}

/** IP manual: lista de IPs da obra; vazio = herdar das referências */
function PlanningField({ workId, value, onChange }: { workId: string; value: { code: string; description: string | null } | null; onChange: (v: { code: string; description: string | null } | null) => void }) {
  const codes = usePlanningCodes(workId)
  const options = useMemo(
    () => [
      { value: '', label: 'Herdar das referências', hint: 'IPs das linhas do orçamento, pela verba' },
      ...(codes.data?.items ?? []).map((c) => ({ value: c.code, label: `${c.code} — ${c.description}`, keywords: c.code })),
    ],
    [codes.data],
  )
  return (
    <Field label="Vínculo de planejamento (IP)" hint={codes.data?.warning ?? (codes.data?.source === 'uau' ? 'IPs da obra na UAU.' : undefined)}>
      <Combobox
        options={value && !options.some((o) => o.value === value.code) ? [...options, { value: value.code, label: `${value.code} — ${value.description ?? ''}` }] : options}
        value={value?.code ?? ''}
        loading={codes.isLoading}
        onChange={(code) => {
          if (!code) return onChange(null)
          const c = codes.data?.items.find((x) => x.code === code)
          onChange({ code, description: c?.description ?? value?.description ?? null })
        }}
        aria-label="Vínculo de planejamento"
      />
    </Field>
  )
}

export function AddItemDialog({ open, detail, map, saving, onClose, onAdd }: {
  open: boolean
  detail: CompetitionDetailDTO
  map: QcMap
  saving: boolean
  onClose: () => void
  onAdd: (input: AddQcItemInput) => Promise<unknown>
}) {
  const workId = detail.competition.workId
  const materials = useWorkMaterials(workId, open)
  const [free, setFree] = useState(false)
  const [materialCode, setMaterialCode] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [unit, setUnit] = useState('')
  const [quantity, setQuantity] = useState('')
  const [refs, setRefs] = useState<string[]>([])
  const [planning, setPlanning] = useState<{ code: string; description: string | null } | null>(null)
  const [touched, setTouched] = useState(false)

  const reset = () => {
    setFree(false); setMaterialCode(null); setCode(''); setDescription(''); setUnit(''); setQuantity(''); setRefs([]); setPlanning(null); setTouched(false)
  }
  const close = () => (reset(), onClose())
  const options = useMemo(
    () => (materials.data?.items ?? []).map((m) => ({ value: m.code, label: `${m.code} — ${m.description}`, hint: m.unit, keywords: m.code })),
    [materials.data],
  )
  const qty = parseQuantity(quantity)
  const valid = !!qty && code.trim().length > 0 && description.trim().length >= 2 && unit.trim().length > 0

  return (
    <Dialog
      open={open}
      onClose={close}
      width="min(96vw, 46rem)"
      title="Adicionar insumo ao mapa"
      description="Insumo real (de contrato) que os fornecedores vão cotar. Ligue-o aos insumos referência para comparar com o orçado."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={close}>Cancelar</Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={async () => {
              setTouched(true)
              if (!valid) return
              await onAdd({
                materialCode: free ? null : materialCode,
                code: code.trim(), description: description.trim(), unit: unit.trim(), quantity: qty!,
                referenceIds: refs, planningCode: planning?.code ?? null, planningDescription: planning?.description ?? null,
              })
              close()
            }}
          >
            Adicionar insumo
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div role="radiogroup" aria-label="Origem do insumo" className="inline-flex w-fit rounded-control border border-border bg-surface p-0.5">
          {[{ k: false, l: 'Insumo da obra' }, { k: true, l: 'Insumo livre' }].map((o) => (
            <button
              key={o.l}
              type="button"
              role="radio"
              aria-checked={free === o.k}
              onClick={() => setFree(o.k)}
              className={cn('rounded-[calc(var(--radius-control)-2px)] px-3 py-1 text-sm font-medium', free === o.k ? 'bg-secondary text-white' : 'text-ink-600 hover:text-text')}
            >
              {o.l}
            </button>
          ))}
        </div>
        {!free && (
          <Field label="Insumo" hint={materials.data?.warning ?? (materials.data?.source === 'uau' ? 'Insumos do orçamento da obra na UAU.' : 'Insumos do orçamento importado.')}>
            <Combobox
              options={options}
              value={materialCode}
              loading={materials.isLoading}
              placeholder="Buscar insumo por código ou descrição…"
              maxResults={60}
              onChange={(c) => {
                const m = materials.data?.items.find((x) => x.code === c)
                setMaterialCode(c)
                if (m) { setCode(m.code); setDescription(m.description); setUnit(m.unit) }
              }}
              aria-label="Insumo da obra"
            />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-[9rem_1fr_6rem_8rem]">
          <Field label="Código" required error={touched && !code.trim() ? 'Informe' : null}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!free && !!materialCode} />
          </Field>
          <Field label="Descrição" required error={touched && description.trim().length < 2 ? 'Informe' : null}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={!free && !!materialCode} />
          </Field>
          <Field label="Unid." required error={touched && !unit.trim() ? 'Informe' : null}>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!free && !!materialCode} />
          </Field>
          <Field label="Quantidade" required error={touched && !qty ? 'Inválida' : null}>
            <Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0,00" />
          </Field>
        </div>
        <Field label="Insumos referência (comparação com o orçado)">
          <ReferencePicker detail={detail} map={map} value={refs} onChange={setRefs} />
        </Field>
        <PlanningField workId={workId} value={planning} onChange={setPlanning} />
        {!refs.length && !planning && <Alert tone="warning">Sem referência nem IP manual, o insumo fica pendente para o envio à aprovação.</Alert>}
      </div>
    </Dialog>
  )
}

export function EditItemDialog({ item, detail, map, saving, onClose, onSave }: {
  item: QcItemDTO | null
  detail: CompetitionDetailDTO
  map: QcMap
  saving: boolean
  onClose: () => void
  onSave: (itemId: string, referenceIds: string[] | null, patch: UpdateItemInput | null) => Promise<unknown>
}) {
  return item ? <EditItemForm key={item.id} item={item} detail={detail} map={map} saving={saving} onClose={onClose} onSave={onSave} /> : null
}

function EditItemForm({ item, detail, map, saving, onClose, onSave }: {
  item: QcItemDTO
  detail: CompetitionDetailDTO
  map: QcMap
  saving: boolean
  onClose: () => void
  onSave: (itemId: string, referenceIds: string[] | null, patch: UpdateItemInput | null) => Promise<unknown>
}) {
  const manual = item.origin === 'manual'
  const editable = detail.can.edit
  const [refs, setRefs] = useState(item.referenceIds)
  const [planning, setPlanning] = useState(item.planningCode ? { code: item.planningCode, description: item.planningDescription } : null)
  const [code, setCode] = useState(item.code)
  const [description, setDescription] = useState(item.description)
  const [unit, setUnit] = useState(item.unit)
  const allocations = map.allocationsByItem.get(item.id) ?? []

  const refsChanged = [...refs].sort().join() !== [...item.referenceIds].sort().join()
  const patch: UpdateItemInput = {}
  if ((planning?.code ?? null) !== item.planningCode) Object.assign(patch, { planningCode: planning?.code ?? null, planningDescription: planning?.description ?? null })
  if (manual && code.trim() !== item.code) patch.code = code.trim()
  if (manual && description.trim() !== item.description) patch.description = description.trim()
  if (manual && unit.trim() !== item.unit) patch.unit = unit.trim()
  const dirty = refsChanged || Object.keys(patch).length > 0

  return (
    <Dialog
      open
      onClose={onClose}
      width="min(96vw, 46rem)"
      title={`${item.code} — ${item.description}`}
      description={manual ? 'Insumo criado no mapa.' : 'Insumo preenchido a partir de uma referência (código e descrição seguem o orçamento).'}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>{editable ? 'Cancelar' : 'Fechar'}</Button>
          {editable && (
            <Button
              variant="primary"
              loading={saving}
              disabled={!dirty}
              onClick={async () => {
                await onSave(item.id, refsChanged ? refs : null, Object.keys(patch).length ? patch : null)
                onClose()
              }}
            >
              Salvar
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4">
        {manual && (
          <div className="grid gap-3 sm:grid-cols-[9rem_1fr_6rem]">
            <Field label="Código"><Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!editable} /></Field>
            <Field label="Descrição"><Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={!editable} /></Field>
            <Field label="Unid."><Input value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!editable} /></Field>
          </div>
        )}
        <Field label="Insumos referência (comparação com o orçado)">
          {editable ? (
            <ReferencePicker detail={detail} map={map} value={refs} onChange={setRefs} exceptItemId={item.id} />
          ) : (
            <p className="text-sm">{refs.map((id) => detail.references.find((r) => r.id === id)?.code).join(', ') || 'Nenhuma'}</p>
          )}
        </Field>
        {editable && <PlanningField workId={detail.competition.workId} value={planning} onChange={setPlanning} />}
        <div>
          <p className="mb-1 text-xs font-semibold text-text-muted">Vínculos para a solicitação de contrato (salvos)</p>
          <ul className="grid gap-0.5 text-sm">
            {allocations.map((a) => (
              <li key={a.packageCode ?? '-'} className="tabular flex justify-between gap-3">
                <span>{a.packageCode ?? 'Sem IP'}{a.packageDescription ? ` · ${a.packageDescription}` : ''}</span>
                <span>{formatQuantity(a.quantity)} {item.unit} · {(Number(a.share.toFixed(4)) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  )
}
