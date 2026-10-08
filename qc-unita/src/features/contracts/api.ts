/**
 * Hooks de dados (TanStack Query) da Solicitação de Contrato e dos Aditivos.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ContractListItemDTO,
  ContractRequestDTO,
  SaveAddendumInput,
  UpdateContractItemInput,
  UpdateContractRequestInput,
} from '@shared/contracts'
import { api } from '@/lib/api'

export const contractKeys = {
  list: (filter: { workId?: string; competitionId?: string }) => ['contracts', filter.workId ?? '', filter.competitionId ?? ''] as const,
  detail: (id: string) => ['contract', id] as const,
}

export const useContracts = (filter: { workId?: string; competitionId?: string }, enabled = true) =>
  useQuery({
    queryKey: contractKeys.list(filter),
    queryFn: () => {
      const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => !!v) as [string, string][]).toString()
      return api<ContractListItemDTO[]>(`/contracts${qs ? `?${qs}` : ''}`)
    },
    enabled,
  })

export const useContract = (id: string) => useQuery({ queryKey: contractKeys.detail(id), queryFn: () => api<ContractRequestDTO>(`/contracts/${id}`) })

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['contract'] })
    qc.invalidateQueries({ queryKey: ['contracts'] })
    qc.invalidateQueries({ queryKey: ['competition'] })
    qc.invalidateQueries({ queryKey: ['competitions'] })
    qc.invalidateQueries({ queryKey: ['work-overview'] })
    qc.invalidateQueries({ queryKey: ['works'] })
  }
}

export function useCreateContract() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (competitionId: string) => api<{ id: string; code: string; excluded: number }>('/contracts', { method: 'POST', body: { competitionId } }),
    onSuccess: invalidate,
  })
}

export function useContractMutations(id: string) {
  const invalidate = useInvalidate()
  const opts = { onSuccess: invalidate }
  const base = `/contracts/${id}`
  return {
    update: useMutation({ mutationFn: (b: UpdateContractRequestInput) => api(base, { method: 'PATCH', body: b }), ...opts }),
    updateItem: useMutation({
      mutationFn: ({ itemId, ...b }: UpdateContractItemInput & { itemId: string }) => api(`${base}/items/${itemId}`, { method: 'PATCH', body: b }),
      ...opts,
    }),
    submit: useMutation({ mutationFn: () => api(`${base}/submit`, { method: 'POST' }), ...opts }),
    cancel: useMutation({ mutationFn: (reason: string) => api(`${base}/cancel`, { method: 'POST', body: { reason } }), ...opts }),
    pushToErp: useMutation({ mutationFn: () => api<{ erpContractId: string }>(`${base}/erp-push`, { method: 'POST' }), ...opts }),
    sign: useMutation({
      mutationFn: (b: { signedOn: string; erpContractId?: string }) => api(`${base}/sign`, { method: 'POST', body: b }),
      ...opts,
    }),
    createAddendum: useMutation({
      mutationFn: (b: SaveAddendumInput) => api<{ id: string; number: number }>(`${base}/addenda`, { method: 'POST', body: b }),
      ...opts,
    }),
    saveAddendum: useMutation({
      mutationFn: ({ addendumId, ...b }: SaveAddendumInput & { addendumId: string }) => api(`/addenda/${addendumId}`, { method: 'PUT', body: b }),
      ...opts,
    }),
    deleteAddendum: useMutation({ mutationFn: (addendumId: string) => api(`/addenda/${addendumId}`, { method: 'DELETE' }), ...opts }),
    submitAddendum: useMutation({ mutationFn: (addendumId: string) => api(`/addenda/${addendumId}/submit`, { method: 'POST' }), ...opts }),
    decideAddendum: useMutation({
      mutationFn: ({ addendumId, ...b }: { addendumId: string; decision: 'approved' | 'rejected'; comment?: string | null }) =>
        api(`/addenda/${addendumId}/decide`, { method: 'POST', body: b }),
      ...opts,
    }),
  }
}
