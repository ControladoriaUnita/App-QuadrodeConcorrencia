/** Hooks de dados (TanStack Query) dos custos fora de escopo da obra. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OutOfScopeListDTO, SaveOutOfScopeInput } from '@shared/contracts'
import { api } from '@/lib/api'

const key = (workId: string) => ['out-of-scope', workId] as const

export const useOutOfScope = (workId: string) =>
  useQuery({ queryKey: key(workId), queryFn: () => api<OutOfScopeListDTO>(`/works/${workId}/out-of-scope`), enabled: !!workId })

export function useOutOfScopeMutations(workId: string) {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: key(workId) })
  const base = `/works/${workId}/out-of-scope`
  return {
    create: useMutation({ mutationFn: (b: SaveOutOfScopeInput) => api<{ id: string; number: number }>(base, { method: 'POST', body: b }), onSuccess }),
    update: useMutation({ mutationFn: ({ id, ...b }: SaveOutOfScopeInput & { id: string }) => api(`${base}/${id}`, { method: 'PUT', body: b }), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }), onSuccess }),
  }
}
