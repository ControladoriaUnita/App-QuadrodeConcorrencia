/**
 * De-para do orçamento: a primeira visão de nomes e vínculos de planejamento (IPs) que toda obra
 * recebe ao montar o orçamento do SharePoint.
 *  - Itens do orçamento: nome do Item e IP replicado para tudo abaixo dele;
 *  - Indireto: IP de cada insumo do indireto aberto (pela descrição).
 * A lista já traz o que aparece nas obras e ainda falta no de-para. Nome e IP vão para as obras a
 * partir da próxima versão do orçamento ("Atualizar dados"); o nome do Item já aparece na hora.
 */
import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Search } from 'lucide-react'
import type { IndirectMappingRowDTO, ItemMappingRowDTO, PlanningCodeDTO, PlanningRefDTO } from '@shared/contracts'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, Combobox, EmptyState, Input, SegmentedControl, Skeleton, type ComboboxOption } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { cn } from '@/utils/cn'
import { fold, matchesTerms, searchTerms } from '@/utils/search'
import { planningOptions } from '@/features/works/planning'
import { useBudgetMappings, useSetIndirectMapping, useSetItemMapping } from './api'

type Tab = 'items' | 'indirect'
type Show = 'all' | 'missing'
const NO_IP = '__sem_ip__'

const th = 'sticky top-0 z-10 border-b border-border bg-ink-50 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-text-muted'
const td = 'border-b border-border px-3 py-1.5 align-middle'

export function MappingsPage() {
  const mappings = useBudgetMappings()
  const [tab, setTab] = useState<Tab>('items')
  const [show, setShow] = useState<Show>('all')
  const [text, setText] = useState('')
  const data = mappings.data
  const terms = searchTerms(text)
  const matches = (s: string) => matchesTerms(fold(s), terms)

  const items = (data?.items ?? []).filter(
    (i) => (show === 'all' || !i.planning) && matches(`${i.wbs} ${i.description ?? ''} ${i.suggestion ?? ''} ${i.planning?.code ?? ''}`),
  )
  const indirect = (data?.indirect ?? []).filter(
    (i) => (show === 'all' || !i.planning) && matches(`${i.description} ${i.items.join(' ')} ${i.planning?.code ?? ''}`),
  )

  return (
    <div>
      <PageHeader
        eyebrow="Cadastros"
        title="De-para do orçamento"
        description="Nomes dos Itens e vínculos de planejamento (IPs) que toda obra recebe ao trazer o orçamento do SharePoint. O IP de um Item vale para tudo abaixo dele; o de um insumo do indireto vale em todas as obras. Na obra, o nome do Item e o IP de cada linha continuam ajustáveis."
      />
      <Alert tone="info" className="mb-3">
        Os IPs entram nas obras na próxima versão do orçamento: use <strong>Atualizar dados</strong> no orçamento da obra. O nome dos Itens já aparece na hora.
      </Alert>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <SegmentedControl
            label="De-para"
            items={[
              { key: 'items', label: `Itens do orçamento${data ? ` (${data.items.length})` : ''}` },
              { key: 'indirect', label: `Indireto${data ? ` (${data.indirect.length})` : ''}` },
            ]}
            value={tab}
            onChange={setTab}
          />
          <SegmentedControl label="Mostrar" items={[{ key: 'all', label: 'Todos' }, { key: 'missing', label: 'Sem IP' }]} value={show} onChange={setShow} />
          <div className="relative min-w-60 flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input aria-label="Buscar no de-para" placeholder={tab === 'items' ? 'Código, nome ou IP' : 'Insumo, item ou IP'} className="pl-9" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>

        {mappings.error ? (
          <div className="p-5"><Alert tone="error">{(mappings.error as Error).message}</Alert></div>
        ) : !data ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : tab === 'items' ? (
          <ItemsTable rows={items} planningCodes={data.planningCodes} />
        ) : (
          <IndirectTable rows={indirect} planningCodes={data.planningCodes} />
        )}
      </Card>
    </div>
  )
}

// ----------------------------------------------------------------------------- Itens
function ItemsTable({ rows, planningCodes }: { rows: ItemMappingRowDTO[]; planningCodes: PlanningCodeDTO[] }) {
  const save = useSetItemMapping()
  const error = save.error as ApiError | null
  return (
    <>
      {error && <div className="px-5 pt-4"><Alert tone="error" title="Não foi possível salvar">{error.message}</Alert></div>}
      <NewItemForm />
      {!rows.length ? (
        <EmptyState title="Nenhum Item" description="Os Itens aparecem aqui quando as obras trazem o orçamento do SharePoint, ou inclua um código acima." />
      ) : (
        <div className="max-h-[calc(100dvh-22rem)] overflow-auto">
          <table className="tabular w-full border-separate border-spacing-0 text-sm" aria-label="De-para dos Itens">
            <thead>
              <tr>
                <th className={cn(th, 'w-28')}>Item</th>
                <th className={th}>Nome</th>
                <th className={cn(th, 'w-[26rem]')}>Vínculo PL (IP)</th>
                <th className={cn(th, 'w-20 text-right')}>Obras</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.wbs} className="hover:bg-ink-50">
                  <td className={cn(td, 'font-medium whitespace-nowrap')}>{r.wbs}</td>
                  <td className={td}>
                    <NameInput
                      row={r}
                      onSave={(description) =>
                        save.mutateAsync({ wbs: r.wbs, description, planningCode: r.planning?.code ?? null, planningDescription: r.planning?.description ?? null })
                      }
                    />
                  </td>
                  <td className={td}>
                    <PlanningPicker
                      label={`IP do item ${r.wbs}`}
                      value={r.planning}
                      codes={planningCodes}
                      onChange={(p) => save.mutateAsync({ wbs: r.wbs, description: r.description, planningCode: p?.code ?? null, planningDescription: p?.description ?? null })}
                    />
                  </td>
                  <td className={cn(td, 'text-right text-text-muted')}>{r.works || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/** Nome do Item: Enter ou sair do campo salva; vazio tira o nome do de-para. Sugere o nome mais usado nas obras. */
function NameInput({ row, onSave }: { row: ItemMappingRowDTO; onSave: (description: string | null) => Promise<unknown> }) {
  const [text, setText] = useState(row.description ?? '')
  const [saving, setSaving] = useState(false)
  const save = async (value: string) => {
    const next = value.trim() || null
    if (next === row.description) return
    setSaving(true)
    try {
      await onSave(next)
    } catch {
      setText(row.description ?? '')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={`Nome do item ${row.wbs}`}
        value={text}
        disabled={saving}
        placeholder={row.suggestion ?? 'Nome do Item'}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => save(text)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="h-8 w-full min-w-48 rounded-control border border-transparent bg-transparent px-2 hover:border-border focus:border-primary focus:bg-surface focus:ring-2 focus:ring-primary/20 focus:outline-none"
      />
      {!row.description && row.suggestion && (
        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => (setText(row.suggestion!), save(row.suggestion!))}>
          Usar nome das obras
        </Button>
      )}
    </div>
  )
}

/** Inclui no de-para um Item que ainda não apareceu nas obras */
function NewItemForm() {
  const save = useSetItemMapping()
  const [wbs, setWbs] = useState('')
  const [name, setName] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!wbs.trim() || !name.trim()) return
    try {
      await save.mutateAsync({ wbs: wbs.trim(), description: name.trim(), planningCode: null })
      setWbs('')
      setName('')
    } catch {
      /* o erro aparece abaixo */
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
      <Input aria-label="Código do novo Item" placeholder="Código (ex.: 02.06)" className="h-9 w-40" value={wbs} onChange={(e) => setWbs(e.target.value)} />
      <Input aria-label="Nome do novo Item" placeholder="Nome do Item" className="h-9 min-w-60 flex-1 sm:max-w-md" value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" size="sm" icon={<Plus className="size-4" />} loading={save.isPending} disabled={!wbs.trim() || !name.trim()}>
        Incluir Item
      </Button>
      {save.error && <span className="text-sm text-error">{(save.error as ApiError).message}</span>}
    </form>
  )
}

// ----------------------------------------------------------------------------- indireto
function IndirectTable({ rows, planningCodes }: { rows: IndirectMappingRowDTO[]; planningCodes: PlanningCodeDTO[] }) {
  const save = useSetIndirectMapping()
  const error = save.error as ApiError | null
  if (!rows.length) {
    return <EmptyState title="Nenhum insumo do indireto" description="Os insumos aparecem aqui quando uma obra importa o indireto (Importar indireto, no orçamento da obra)." />
  }
  return (
    <>
      {error && <div className="px-5 pt-4"><Alert tone="error" title="Não foi possível salvar">{error.message}</Alert></div>}
      <div className="max-h-[calc(100dvh-19rem)] overflow-auto">
        <table className="tabular w-full border-separate border-spacing-0 text-sm" aria-label="De-para do indireto">
          <thead>
            <tr>
              <th className={th}>Insumo do indireto</th>
              <th className={th}>Item no orçamento</th>
              <th className={cn(th, 'w-[26rem]')}>Vínculo PL (IP)</th>
              <th className={cn(th, 'w-20 text-right')}>Obras</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.description} className="hover:bg-ink-50">
                <td className={td}>{r.description}</td>
                <td className={cn(td, 'text-text-muted')}>
                  <div className="flex flex-wrap gap-1">{r.items.map((i) => <Badge key={i}>{i}</Badge>)}</div>
                </td>
                <td className={td}>
                  <PlanningPicker
                    label={`IP de ${r.description}`}
                    value={r.planning}
                    codes={planningCodes}
                    onChange={(p) => save.mutateAsync({ description: r.description, planningCode: p?.code ?? null, planningDescription: p?.description ?? null })}
                  />
                </td>
                <td className={cn(td, 'text-right text-text-muted')}>{r.works || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ----------------------------------------------------------------------------- IP
/** IP do cadastro da UAU; "Sem IP" tira o vínculo do de-para */
function PlanningPicker({ label, value, codes, onChange }: { label: string; value: PlanningRefDTO | null; codes: PlanningCodeDTO[]; onChange: (p: PlanningRefDTO | null) => Promise<unknown> }) {
  const [saving, setSaving] = useState(false)
  const options = useMemo<ComboboxOption[]>(
    () => [...(value ? [{ value: NO_IP, label: 'Sem IP (tirar do de-para)' }] : []), ...planningOptions(codes, value)],
    [codes, value],
  )
  const pick = async (code: string) => {
    if (code === (value?.code ?? null)) return
    setSaving(true)
    try {
      await onChange(code === NO_IP ? null : { code, description: codes.find((c) => c.code === code)?.description ?? null })
    } catch {
      /* o erro aparece acima da tabela */
    } finally {
      setSaving(false)
    }
  }
  return <Combobox options={options} value={value?.code ?? null} onChange={pick} loading={saving} placeholder="Escolher IP…" aria-label={label} />
}
