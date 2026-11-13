/** Hooks de dados (TanStack Query) dos fluxos de aprovação e diretores. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApprovalConfigDTO, SaveApprovalFlowInput, SaveDirectorInput } from '@shared/contracts'
import { api } from '@/lib/api'

const key = ['approval-config'] as const

export const useApprovalConfig = () => useQuery({ queryKey: key, queryFn: () => api<ApprovalConfigDTO>('/approval-config'), staleTime: 60_000 })

export function useApprovalConfigMutations() {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: key })
  return {
    saveFlow: useMutation({
      mutationFn: ({ id, ...b }: SaveApprovalFlowInput & { id: string | null }) =>
        api<{ id: string }>(id ? `/approval-flows/${id}` : '/approval-flows', { method: id ? 'PUT' : 'POST', body: b }),
      onSuccess,
    }),
    deleteFlow: useMutation({ mutationFn: (id: string) => api(`/approval-flows/${id}`, { method: 'DELETE' }), onSuccess }),
    saveDirector: useMutation({
      mutationFn: ({ id, ...b }: SaveDirectorInput & { id: string | null }) =>
        api<{ id: string }>(id ? `/approval-directors/${id}` : '/approval-directors', { method: id ? 'PUT' : 'POST', body: b }),
      onSuccess,
    }),
  }
}
