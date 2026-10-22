/**
 * Hooks do de-para do orçamento (nome e IP por Item, IP por insumo do indireto).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BudgetMappingsDTO, SetIndirectMappingInput, SetItemMappingInput } from '@shared/contracts'
import { api } from '@/lib/api'

export const useBudgetMappings = () => useQuery({ queryKey: ['budget-mappings'], queryFn: () => api<BudgetMappingsDTO>('/budget-mappings') })

/** O nome do de-para aparece na leitura do orçamento: a estrutura das obras é recarregada */
function useSave<T>(path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: T) => api<{ ok: boolean }>(path, { method: 'PUT', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-mappings'] })
      qc.invalidateQueries({ queryKey: ['budget-structure'] })
    },
  })
}

export const useSetItemMapping = () => useSave<SetItemMappingInput>('/budget-mappings/items')
export const useSetIndirectMapping = () => useSave<SetIndirectMappingInput>('/budget-mappings/indirect')
