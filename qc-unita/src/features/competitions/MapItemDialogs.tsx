/**
 * Diálogos do mapa de cotação:
 *  - Adicionar insumo: da lista de insumos da obra (UAU) ou livre, com quantidade e as referências usadas.
 *  - Editar insumo: referências ligadas, IP manual (ou herdado) e, para insumos criados no mapa, a identificação.
 */
import { useMemo, useState } from 'react'
import type { AddQcItemInput, CompetitionDetailDTO, QcItemDTO, UpdateItemInput } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import type { QcMap } from '@shared/domain/competition/qc-map'
import { Alert, Button, Combobox, DecimalInput, Dialog, Field, Input, SegmentedControl } from '@/components/ui'
import { usePlanningCodes, useWorkMaterials } from '@/features/works/api'
import { planningOptions } from '@/features/works/planning'
import { cn } from '@/utils/cn'
import { formatBRL, formatPercent, formatQuantity } from '@/utils/format'
import { fold, matchesTerms, searchTerms } from '@/utils/search'

type Planning = { code: string; description: string | null } | null

/** Verba somada de um conjunto de referências */
const budgetOf = (map: QcMap, ids: string[]) => Decimal.sum(ids.map((id) => map.referenceBudget.get(id) ?? Decimal.ZERO))

/** Lista de insumos referência com busca e marcação (verba e onde já são usados) */
function ReferencePicker({ detail, map, value, onChange, exceptItemId }: { detail: CompetitionDetailDTO; map: QcMap; value: string[]; onChange: (ids: string[]) => void; exceptItemId?: string }) {
  const [q, setQ] = useState('')
  const codeOf = useMemo(() => new Map(detail.items.map((i) => [i.id, i.code])), [detail.items])
  const terms = searchTerms(q)
  const refs = detail.references.filter((r) => matchesTerms(fold(`${r.code} ${r.description}`), terms))
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div className="grid gap-2">
      <Input placeholder="Buscar referência por código ou descrição…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar insumo referência" />
      <ul className="max-h-64 overflow-auto rounded-control border border-border">
        {refs.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">Nenhum insumo referência encontrado.</li>}
        {refs.map((r) => {
          const usedBy = (map.referenceUsage.get(r.id) ?? []).filter((id) => id !== exceptItemId).map((id) => codeOf.get(id))
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
                <span className="tabular shrink-0 text-xs text-text-muted">{formatBRL(budgetOf(map, [r.id]))}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-text-muted">
        {value.length} referência(s) marcada(s) · verba {formatBRL(budgetOf(map, value))}. Uma referência usada em vários insumos tem a verba rateada pelo valor contratado de cada um.
      </p>
    </div>
  )
}

/** IP manual: lista de IPs da obra; vazio = herdar das referências */
function PlanningField({ workId, value, onChange }: { workId: string; value: Planning; onChange: (v: Planning) => void }) {
  const codes = usePlanningCodes(workId)
  const options = useMemo(
    () => [{ value: '', label: 'Herdar das referências', hint: 'IPs das linhas do orçamento, pela verba' }, ...planningOptions(codes.data?.items ?? [], value)],
    [codes.data, value],
  )
  return (
    <Field label="Vínculo de planejamento (IP)" hint={codes.data?.warning ?? (codes.data?.source === 'uau' ? 'IPs da obra na UAU.' : undefined)}>
      <Combobox
        options={options}
        value={value?.code ?? ''}
        loading={codes.isLoading}
        onChange={(code) => onChange(code ? { code, description: codes.data?.items.find((x) => x.code === code)?.description ?? value?.description ?? null } : null)}
        aria-label="Vínculo de planejamento"
      />
    </Field>
  )
}

interface AddProps {
  open: boolean
  detail: CompetitionDetailDTO
  map: QcMap
  saving: boolean
  onClose: () => void
  onAdd: (input: AddQcItemInput) => Promise<unknown>
}

/** O formulário nasce limpo a cada abertura */
export function AddItemDialog(props: AddProps) {
  return props.open ? <AddItemForm {...props} /> : null
}

function AddItemForm({ detail, map, saving, onClose, onAdd }: AddProps) {
  const workId = detail.competition.workId
  const materials = useWorkMaterials(workId)
  const [free, setFree] = useState(false)
  const [materialCode, setMaterialCode] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [unit, setUnit] = useState('')
  const [quantity, setQuantity] = useState<string | null>(null)
  const [refs, setRefs] = useState<string[]>([])
  const [planning, setPlanning] = useState<Planning>(null)
  const [touched, setTouched] = useState(false)

  const options = useMemo(
    () => (materials.data?.items ?? []).map((m) => ({ value: m.code, label: `${m.code} — ${m.description}`, hint: m.unit, keywords: m.code })),
    [materials.data],
  )
  const fromList = !free && !!materialCode
  const valid = !!quantity && code.trim().length > 0 && description.trim().length >= 2 && unit.trim().length > 0

  return (
    <Dialog
      open
      onClose={onClose}
      width="min(96vw, 46rem)"
      title="Adicionar insumo ao mapa"
      description="Insumo real (de contrato) que os fornecedores vão cotar. Ligue-o aos insumos referência para comparar com o orçado."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={async () => {
              setTouched(true)
              if (!valid) return
              await onAdd({
                materialCode: fromList ? materialCode : null,
                code: code.trim(), description: description.trim(), unit: unit.trim(), quantity: quantity!,
                referenceIds: refs, planningCode: planning?.code ?? null, planningDescription: planning?.description ?? null,
              })
              onClose()
            }}
          >
            Adicionar insumo
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <SegmentedControl
          label="Origem do insumo"
          items={[{ key: 'obra', label: 'Insumo da obra' }, { key: 'livre', label: 'Insumo livre' }]}
          value={free ? 'livre' : 'obra'}
          onChange={(k) => setFree(k === 'livre')}
        />
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
                if (m) {
                  setCode(m.code)
                  setDescription(m.description)
                  setUnit(m.unit)
                }
              }}
              aria-label="Insumo da obra"
            />
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-[9rem_1fr_6rem_8rem]">
          <Field label="Código" required error={touched && !code.trim() ? 'Informe' : null}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={fromList} />
          </Field>
          <Field label="Descrição" required error={touched && description.trim().length < 2 ? 'Informe' : null}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={fromList} />
          </Field>
          <Field label="Unid." required error={touched && !unit.trim() ? 'Informe' : null}>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} disabled={fromList} />
          </Field>
          <Field label="Quantidade" required error={touched && !quantity ? 'Informe' : null}>
            <DecimalInput value={quantity} onCommit={setQuantity} fractionDigits={4} trimZeros placeholder="0,00" aria-label="Quantidade" />
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

interface EditProps {
  item: QcItemDTO | null
  detail: CompetitionDetailDTO
  map: QcMap
  saving: boolean
  onClose: () => void
  onSave: (itemId: string, referenceIds: string[] | null, patch: UpdateItemInput | null) => Promise<unknown>
}

export function EditItemDialog({ item, ...props }: EditProps) {
  return item ? <EditItemForm key={item.id} item={item} {...props} /> : null
}

function EditItemForm({ item, detail, map, saving, onClose, onSave }: EditProps & { item: QcItemDTO }) {
  const manual = item.origin === 'manual'
  const editable = detail.can.edit
  const [refs, setRefs] = useState(item.referenceIds)
  const [planning, setPlanning] = useState<Planning>(item.planningCode ? { code: item.planningCode, description: item.planningDescription } : null)
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
                <span>{formatQuantity(a.quantity)} {item.unit} · {formatPercent(a.share, 1)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  )
}
