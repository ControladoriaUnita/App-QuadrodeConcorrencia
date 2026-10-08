import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BudgetImportInput, BudgetLineUsageDTO, BudgetStructureDTO, CreateWorkInput, WorkOverviewDTO } from '@shared/contracts'
import { api } from '@/lib/api'

export const useWorkOverview = (workId: string) =>
  useQuery({ queryKey: ['work-overview', workId], queryFn: () => api<WorkOverviewDTO>(`/works/${workId}/overview`), enabled: !!workId })

export interface BudgetLinesFilter {
  packages?: string[]
  excludeCompetitionId?: string
}

/** Linhas do orçamento vigente da obra com o comprometido por concorrência. */
export const useBudgetLines = (workId: string, filter: BudgetLinesFilter = {}, enabled = true) => {
  const qs = new URLSearchParams()
  if (filter.packages?.length) qs.set('packages', filter.packages.join(','))
  if (filter.excludeCompetitionId) qs.set('excludeCompetitionId', filter.excludeCompetitionId)
  return useQuery({
    queryKey: ['budget-lines', workId, filter.packages?.join(',') ?? '', filter.excludeCompetitionId ?? ''],
    queryFn: () => api<BudgetLineUsageDTO[]>(`/works/${workId}/budget-lines${qs.size ? `?${qs}` : ''}`),
    enabled: !!workId && enabled,
    staleTime: 30_000,
  })
}

/** Grupos (Item) e composições do orçamento vigente — estrutura da planilha. */
export const useBudgetStructure = (workId: string, enabled = true) =>
  useQuery({
    queryKey: ['budget-structure', workId],
    queryFn: () => api<BudgetStructureDTO | null>(`/works/${workId}/budget-structure`),
    enabled: !!workId && enabled,
    staleTime: 60_000,
  })

export function useImportBudget(workId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BudgetImportInput) => api<{ budgetId: string; version: number; lines: number; total: string }>(`/works/${workId}/budget-import`, { method: 'POST', body }),
    onSuccess: () => {
      for (const k of ['works', 'work-overview', 'budget-lines', 'budget-structure', 'packages', 'competition']) qc.invalidateQueries({ queryKey: [k] })
    },
  })
}

export function useCreateWork() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateWorkInput) => api<{ id: string }>('/works', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['works'] }),
  })
}
