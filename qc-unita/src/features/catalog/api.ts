/**
 * Hooks do cadastro de insumos sincronizado da UAU (consulta de IPs e insumos).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { MaterialPageDTO, MaterialQuery } from '@shared/contracts'
import { api } from '@/lib/api'

/** Página do cadastro: IPs ou demais insumos, com busca */
export const useMaterials = (query: Pick<MaterialQuery, 'type' | 'search' | 'limit'>) => {
  const qs = new URLSearchParams({ type: query.type, limit: String(query.limit) })
  if (query.search) qs.set('search', query.search)
  return useQuery({
    queryKey: ['materials', query.type, query.search ?? '', query.limit],
    queryFn: () => api<MaterialPageDTO>(`/materials?${qs}`),
    placeholderData: keepPreviousData,
  })
}

/** Sincroniza o cadastro de insumos com a UAU (Integração ERP, escopo "Insumos") */
export function useSyncMaterials() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const r = await api<{ steps: { status: string; message?: string }[] }>('/integration/erp-sync', { method: 'POST', body: { scope: 'materials' } })
      // A sincronização responde 200 mesmo com etapa com erro: mostra a mensagem dela
      const failed = r.steps.find((s) => s.status === 'error')
      if (failed) throw new Error(failed.message ?? 'A UAU não respondeu. Tente de novo em instantes.')
      return r
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['materials'] })
      qc.invalidateQueries({ queryKey: ['planning-codes'] })
    },
  })
}
