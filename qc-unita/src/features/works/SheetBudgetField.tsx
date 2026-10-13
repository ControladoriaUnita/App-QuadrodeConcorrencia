/**
 * Campo "Orçamento" da planilha de orçamentos (SharePoint): lista os orçamentos da obra
 * (nº, empresa como está na planilha, serviços, linhas e total). A empresa da planilha
 * (Empresa_pla) pode diferir da empresa da obra na UAU — nesse caso, um aviso discreto.
 */
import { useEffect, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { SheetBudgetDTO } from '@shared/contracts'
import { Combobox, Field, type ComboboxOption } from '@/components/ui'
import { formatBRL } from '@/utils/format'
import { useSheetBudgets } from './api'

export interface SheetBudgetChoice {
  budget: string
  /** Empresa do orçamento na planilha */
  sheetCompany: string
}

/** "01" e "1" são a mesma empresa */
const normCompany = (c: string) => c.trim().replace(/^0+(?=.)/, '')
export const sameCompany = (a: string, b: string) => normCompany(a) === normCompany(b)

const keyOf = (b: SheetBudgetChoice) => `${normCompany(b.sheetCompany)}|${b.budget.trim()}`
const choiceOf = (b: SheetBudgetDTO): SheetBudgetChoice => ({ budget: b.budget, sheetCompany: b.company })

interface Props {
  /** Código da obra (UAU); sem obra, o campo fica desabilitado */
  workCode: string | null
  /** Empresa da obra na UAU, para avisar quando a da planilha for outra */
  company: string | null
  value: SheetBudgetChoice | null
  onChange: (value: SheetBudgetChoice | null) => void
  className?: string
}

export function SheetBudgetField({ workCode, company, value, onChange, className }: Props) {
  const budgets = useSheetBudgets(workCode)
  const list = useMemo(() => budgets.data ?? [], [budgets.data])

  // Um único orçamento: já vem escolhido. Escolha que não existe mais na planilha: limpa.
  useEffect(() => {
    if (!budgets.data) return
    const found = value && list.some((b) => keyOf(choiceOf(b)) === keyOf(value))
    if (found) return
    if (list.length === 1) onChange(choiceOf(list[0]!))
    else if (value) onChange(null)
  }, [budgets.data, value && keyOf(value)]) // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo<ComboboxOption[]>(
    () =>
      list.map((b) => ({
        value: keyOf(choiceOf(b)),
        label: `Orçamento ${b.budget}`,
        hint: `Empresa ${b.company} na planilha · ${b.services.toLocaleString('pt-BR')} serviço(s) · ${b.lines.toLocaleString('pt-BR')} linha(s)`,
        aside: formatBRL(b.total),
        keywords: `empresa ${b.company}`,
      })),
    [list],
  )

  const otherCompany = value && company && !sameCompany(value.sheetCompany, company)
  const hint = !workCode
    ? 'Escolha a obra para listar os orçamentos da planilha.'
    : budgets.isLoading
      ? 'Lendo a planilha de orçamentos… pode levar alguns segundos.'
      : budgets.data && !list.length
        ? 'Nenhum orçamento desta obra na planilha de orçamentos.'
        : otherCompany
          ? (
              <span className="inline-flex items-center gap-1 text-warning">
                <AlertTriangle className="size-3" aria-hidden />
                Na planilha, este orçamento está na empresa {value.sheetCompany} (na UAU a obra é da empresa {company}).
              </span>
            )
          : null

  return (
    <Field label="Orçamento (planilha do SharePoint)" required error={budgets.error ? (budgets.error as Error).message : null} hint={hint} className={className}>
      <Combobox
        options={options}
        value={value ? keyOf(value) : null}
        onChange={(k) => {
          const b = list.find((x) => keyOf(choiceOf(x)) === k)
          if (b) onChange(choiceOf(b))
        }}
        disabled={!workCode || (!!budgets.data && !list.length)}
        loading={budgets.isLoading}
        loadingText="Carregando orçamentos…"
        placeholder={workCode ? 'Selecione o nº do orçamento' : 'Escolha a obra primeiro'}
        emptyText="Nenhum orçamento encontrado"
      />
    </Field>
  )
}
