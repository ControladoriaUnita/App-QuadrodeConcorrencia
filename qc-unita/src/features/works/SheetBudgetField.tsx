/**
 * Campo "Orçamento" da planilha de orçamentos (SharePoint): os nº de orçamento (NumOrca_pla) da
 * empresa + obra escolhidas, com serviços, linhas e total. Com um único orçamento, ele já vem escolhido.
 */
import { useEffect, useMemo } from 'react'
import type { SheetBudgetOptionDTO } from '@shared/contracts'
import { Combobox, Field, type ComboboxOption } from '@/components/ui'
import { formatBRL } from '@/utils/format'

interface Props {
  /** Orçamentos da obra escolhida; null = obra ainda não escolhida */
  budgets: SheetBudgetOptionDTO[] | null
  value: string | null
  onChange: (budget: string | null) => void
  className?: string
}

export function SheetBudgetField({ budgets, value, onChange, className }: Props) {
  // Um único orçamento: já vem escolhido. Escolha que não existe na lista: limpa.
  useEffect(() => {
    if (!budgets) return
    if (value && budgets.some((b) => b.budget === value)) return
    onChange(budgets.length === 1 ? budgets[0]!.budget : null)
  }, [budgets, value]) // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo<ComboboxOption[]>(
    () =>
      (budgets ?? []).map((b) => ({
        value: b.budget,
        label: `Orçamento ${b.budget}`,
        hint: `${b.services.toLocaleString('pt-BR')} serviço(s) · ${b.lines.toLocaleString('pt-BR')} linha(s)`,
        aside: formatBRL(b.total),
      })),
    [budgets],
  )

  return (
    <Field
      label="Orçamento (SharePoint)"
      required
      hint={!budgets ? 'Escolha a obra para listar os orçamentos do SharePoint.' : undefined}
      className={className}
    >
      <Combobox
        options={options}
        value={value}
        onChange={onChange}
        disabled={!budgets?.length}
        placeholder={budgets ? 'Selecione o nº do orçamento' : 'Escolha a obra primeiro'}
        emptyText="Nenhum orçamento encontrado"
      />
    </Field>
  )
}
