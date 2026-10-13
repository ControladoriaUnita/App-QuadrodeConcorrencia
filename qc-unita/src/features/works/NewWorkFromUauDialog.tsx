/**
 * Nova obra pela planilha de orçamentos: Empresa → Obra → Orçamento.
 * As três listas vêm da aba BD_Orcamentos (Empresa_pla · Obra_pla · NumOrca_pla), que usa os códigos
 * da UAU; os nomes vêm da UAU. A obra é criada já com o orçamento completo importado.
 * O cadastro manual continua disponível como alternativa ("Cadastrar sem a planilha").
 */
import { useEffect, useMemo, useState } from 'react'
import type { CreateWorkFromUauInput, WorkSetupCompanyDTO, WorkSetupWorkDTO } from '@shared/contracts'
import { Alert, Button, Combobox, Dialog, Field, Input, Select, type ComboboxOption } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { useCreateWorkFromUau, useWorkSetupOptions, type SheetBudgetImportResult } from './api'
import { SheetBudgetField } from './SheetBudgetField'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (result: SheetBudgetImportResult) => void
  /** Troca para o cadastro manual */
  onManual: () => void
}

/** "71 — TEEN 5MS3 SPE LTDA" (ou só o código, quando a UAU não trouxe o nome) */
const labelOf = (o: { code: string; name: string | null }) => (o.name ? `${o.code} — ${o.name}` : o.code)

export function NewWorkFromUauDialog({ open, onClose, onCreated, onManual }: Props) {
  const options = useWorkSetupOptions(open)
  const create = useCreateWorkFromUau()
  const [companyCode, setCompanyCode] = useState<string | null>(null)
  const [workCode, setWorkCode] = useState<string | null>(null)
  const [budget, setBudget] = useState<string | null>(null)
  const [clientName, setClientName] = useState('')
  const [status, setStatus] = useState<'not_started' | 'active'>('active')

  useEffect(() => {
    if (!open) return
    setCompanyCode(null)
    setWorkCode(null)
    setBudget(null)
    setClientName('')
    setStatus('active')
    create.reset()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const companies = options.data?.companies ?? []
  const company: WorkSetupCompanyDTO | undefined = companies.find((c) => c.code === companyCode)
  const work: WorkSetupWorkDTO | undefined = company?.works.find((w) => w.code === workCode)

  const companyOptions = useMemo<ComboboxOption[]>(
    () =>
      companies.map((c) => ({
        value: c.code,
        label: labelOf(c),
        hint: `${c.works.length} obra(s) com orçamento na planilha`,
      })),
    [companies],
  )
  const workOptions = useMemo<ComboboxOption[]>(
    () =>
      (company?.works ?? []).map((w) => ({
        value: w.code,
        label: labelOf(w),
        hint: `${w.budgets.length} orçamento(s)`,
        disabled: !!w.existingWorkId,
        aside: w.existingWorkId ? 'já cadastrada' : undefined,
      })),
    [company],
  )

  const error = (create.error ?? options.error) as ApiError | null
  const ready = !!(company && work && budget && !work.existingWorkId)

  const submit = async () => {
    if (!ready) return
    const input: CreateWorkFromUauInput = { company: company.code, work: work.code, budget, clientName: clientName.trim() || null, status }
    try {
      onCreated(await create.mutateAsync(input))
    } catch {
      /* o erro aparece no alerta do diálogo */
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="min(94vw, 42rem)"
      title="Nova obra"
      description="Escolha a empresa, a obra e o orçamento da planilha de orçamentos (SharePoint). A obra já abre com o orçamento completo."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onManual}>
            Cadastrar sem a planilha
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!ready} loading={create.isPending} onClick={submit}>
            Criar obra
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {error && (
          <Alert tone="error" title={create.error ? 'Não foi possível criar a obra' : 'Não foi possível ler a planilha de orçamentos'} className="sm:col-span-2">
            {error.message}
          </Alert>
        )}
        {options.data?.warnings.map((w) => (
          <Alert key={w} tone="warning" className="sm:col-span-2">{w}</Alert>
        ))}
        <Field
          label="Empresa"
          required
          hint={options.isLoading ? 'Lendo a planilha de orçamentos… pode levar alguns segundos.' : undefined}
          className="sm:col-span-2"
        >
          <Combobox
            options={companyOptions}
            value={companyCode}
            onChange={(c) => {
              if (c === companyCode) return
              setCompanyCode(c)
              setWorkCode(null)
              setBudget(null)
            }}
            loading={options.isLoading}
            loadingText="Carregando empresas…"
            placeholder="Buscar empresa por código ou nome"
          />
        </Field>
        <Field label="Obra" required className="sm:col-span-2">
          <Combobox
            options={workOptions}
            value={workCode}
            onChange={(w) => {
              if (w === workCode) return
              setWorkCode(w)
              setBudget(null)
            }}
            disabled={!company}
            placeholder={company ? 'Buscar obra por código ou nome' : 'Escolha a empresa primeiro'}
          />
        </Field>
        <SheetBudgetField budgets={work?.budgets ?? null} value={budget} onChange={setBudget} className="sm:col-span-2" />
        <Field label="Cliente / SPE" hint="Opcional">
          <Input value={clientName} maxLength={200} onChange={(e) => setClientName(e.target.value)} />
        </Field>
        <Field label="Situação">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Ativa (em obra)</option>
            <option value="not_started">Não iniciada</option>
          </Select>
        </Field>
        {ready && (
          <p className="text-xs text-text-muted sm:col-span-2">
            Será criada a obra <span className="font-medium text-ink-700">{labelOf(work)}</span> da empresa {company.code}, com o orçamento {budget} da planilha.
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
