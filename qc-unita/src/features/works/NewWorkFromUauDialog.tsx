/**
 * Nova obra a partir da UAU: Empresa → Obra (obras ativas da UAU) → Orçamento (planilha de
 * orçamentos do SharePoint). A obra é criada já com o orçamento completo importado.
 * O cadastro manual continua disponível como alternativa ("Cadastrar sem a UAU").
 */
import { useEffect, useMemo, useState } from 'react'
import type { CreateWorkFromUauInput } from '@shared/contracts'
import { Alert, Button, Combobox, Dialog, Field, Input, Select, type ComboboxOption } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { useCreateWorkFromUau, useUauCompanies, useUauWorks, type SheetBudgetImportResult } from './api'
import { sameCompany, SheetBudgetField, type SheetBudgetChoice } from './SheetBudgetField'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (result: SheetBudgetImportResult) => void
  /** Troca para o cadastro manual */
  onManual: () => void
}

export function NewWorkFromUauDialog({ open, onClose, onCreated, onManual }: Props) {
  const companies = useUauCompanies(open)
  const works = useUauWorks(open)
  const create = useCreateWorkFromUau()
  const [company, setCompany] = useState<string | null>(null)
  const [work, setWork] = useState<string | null>(null)
  const [budget, setBudget] = useState<SheetBudgetChoice | null>(null)
  const [clientName, setClientName] = useState('')
  const [status, setStatus] = useState<'not_started' | 'active'>('active')

  useEffect(() => {
    if (!open) return
    setCompany(null)
    setWork(null)
    setBudget(null)
    setClientName('')
    setStatus('active')
    create.reset()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const companyOptions = useMemo<ComboboxOption[]>(() => {
    const count = new Map<string, number>()
    for (const w of works.data ?? []) count.set(w.company, (count.get(w.company) ?? 0) + 1)
    return (companies.data ?? []).map((c) => ({
      value: c.code,
      label: `${c.code} — ${c.name}`,
      hint: works.data ? `${count.get(c.code) ?? 0} obra(s) ativa(s)` : undefined,
    }))
  }, [companies.data, works.data])

  const workOptions = useMemo<ComboboxOption[]>(
    () =>
      (works.data ?? [])
        .filter((w) => company && sameCompany(w.company, company))
        .map((w) => ({
          value: w.code,
          label: `${w.code} — ${w.name}`,
          disabled: !!w.existingWorkId,
          aside: w.existingWorkId ? 'já cadastrada' : undefined,
        })),
    [works.data, company],
  )
  const workName = works.data?.find((w) => company && sameCompany(w.company, company) && w.code === work)?.name

  const error = create.error as ApiError | null
  const ready = !!(company && work && budget)

  const submit = async () => {
    if (!company || !work || !budget) return
    const input: CreateWorkFromUauInput = {
      company,
      work,
      budget: budget.budget,
      ...(sameCompany(budget.sheetCompany, company) ? {} : { sheetCompany: budget.sheetCompany }),
      clientName: clientName.trim() || null,
      status,
    }
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
      title="Nova obra da UAU"
      description="Escolha a empresa e a obra cadastradas na UAU e o orçamento na planilha de orçamentos. A obra já abre com o orçamento completo."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onManual}>
            Cadastrar sem a UAU
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
        {error && <Alert tone="error" title="Não foi possível criar a obra" className="sm:col-span-2">{error.message}</Alert>}
        <Field label="Empresa (UAU)" required error={companies.error ? (companies.error as Error).message : null} className="sm:col-span-2">
          <Combobox
            options={companyOptions}
            value={company}
            onChange={(c) => {
              if (c === company) return
              setCompany(c)
              setWork(null)
              setBudget(null)
            }}
            loading={companies.isLoading}
            loadingText="Carregando empresas…"
            placeholder="Buscar empresa por código ou nome"
          />
        </Field>
        <Field
          label="Obra (UAU)"
          required
          error={works.error ? (works.error as Error).message : null}
          hint={company && works.data && !workOptions.length ? 'Nenhuma obra ativa desta empresa na UAU.' : undefined}
          className="sm:col-span-2"
        >
          <Combobox
            options={workOptions}
            value={work}
            onChange={(w) => {
              if (w === work) return
              setWork(w)
              setBudget(null)
            }}
            disabled={!company}
            loading={!!company && works.isLoading}
            loadingText="Carregando obras…"
            placeholder={company ? 'Buscar obra por código ou nome' : 'Escolha a empresa primeiro'}
          />
        </Field>
        <SheetBudgetField workCode={work} company={company} value={budget} onChange={setBudget} className="sm:col-span-2" />
        <Field label="Cliente / SPE" hint="Opcional">
          <Input value={clientName} maxLength={200} onChange={(e) => setClientName(e.target.value)} />
        </Field>
        <Field label="Situação">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Ativa (em obra)</option>
            <option value="not_started">Não iniciada</option>
          </Select>
        </Field>
        {workName && budget && (
          <p className="text-xs text-text-muted sm:col-span-2">
            Será criada a obra <span className="font-medium text-ink-700">{work} — {workName}</span> com o orçamento {budget.budget} da planilha.
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
