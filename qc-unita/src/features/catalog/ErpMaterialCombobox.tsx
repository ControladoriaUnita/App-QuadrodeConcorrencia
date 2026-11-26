/**
 * Busca no cadastro de insumos do ERP (UAU, sincronizado em Integração ERP): só deixa escolher
 * insumo que existe no cadastro. Busca no servidor (o cadastro tem ~13 mil insumos), com os
 * insumos e os IPs ativos.
 */
import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { MaterialDTO, MaterialPageDTO } from '@shared/contracts'
import { Combobox } from '@/components/ui'
import { api } from '@/lib/api'

const LIMIT = 60

const page = (type: 'insumo' | 'ip', search: string) => {
  const qs = new URLSearchParams({ type, limit: String(LIMIT) })
  if (search) qs.set('search', search)
  return api<MaterialPageDTO>(`/materials?${qs}`)
}

/** Insumos ativos do cadastro do ERP que batem com a busca (insumos primeiro, depois IPs) */
export const useErpMaterials = (search: string) =>
  useQuery({
    queryKey: ['materials', 'erp-pick', search],
    queryFn: async () => {
      const [insumos, ips] = await Promise.all([page('insumo', search), page('ip', search)])
      return [...insumos.items, ...ips.items].filter((m) => m.active)
    },
    placeholderData: keepPreviousData,
  })

interface Props {
  value: string | null
  onChange: (material: MaterialDTO) => void
  /** Insumo já escolhido (para mostrar o rótulo mesmo fora da busca atual) */
  selected?: MaterialDTO | null
  'aria-label': string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  id?: string
}

export function ErpMaterialCombobox({ value, onChange, selected, ...aria }: Props) {
  const [search, setSearch] = useState('')
  const q = useErpMaterials(search)
  const options = useMemo(() => {
    const items = q.data ?? []
    const all = selected && !items.some((m) => m.code === selected.code) ? [selected, ...items] : items
    return all.map((m) => ({ value: m.code, label: `${m.code} — ${m.description}`, hint: m.unit, keywords: m.code }))
  }, [q.data, selected])
  return (
    <Combobox
      {...aria}
      options={options}
      value={value}
      loading={q.isLoading}
      placeholder="Buscar no cadastro do ERP por código ou descrição…"
      emptyText="Nenhum insumo do cadastro do ERP encontrado"
      maxResults={LIMIT * 2}
      onQueryChange={setSearch}
      onChange={(code) => {
        const m = q.data?.find((x) => x.code === code) ?? (selected?.code === code ? selected : undefined)
        if (m) onChange(m)
      }}
    />
  )
}
