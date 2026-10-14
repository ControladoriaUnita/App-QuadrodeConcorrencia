import type { PlanningCodeDTO } from '@shared/contracts'
import type { ComboboxOption } from '@/components/ui'

/** Opções de IP para o Combobox; o IP atual entra mesmo se não estiver na lista da obra */
export function planningOptions(codes: PlanningCodeDTO[], current?: { code: string | null; description: string | null } | null): ComboboxOption[] {
  const options = codes.map((c) => ({ value: c.code, label: `${c.code} — ${c.description}`, keywords: c.code }))
  if (current?.code && !options.some((o) => o.value === current.code)) {
    options.unshift({ value: current.code, label: `${current.code} — ${current.description ?? ''}`, keywords: current.code })
  }
  return options
}
