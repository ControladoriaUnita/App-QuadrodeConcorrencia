import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BudgetImportInput,
  BudgetLineUsageDTO,
  BudgetStructureDTO,
  CreateWorkFromUauInput,
  CreateWorkInput,
  RefreshSheetBudgetInput,
  SheetBudgetDTO,
  UauCompanyDTO,
  UauWorkOptionDTO,
  WorkOverviewDTO,
} from '@shared/contracts'
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

/** Tudo o que depende do orçamento vigente da obra */
const BUDGET_KEYS = ['works', 'work-overview', 'budget-lines', 'budget-structure', 'packages', 'competition']

export function useImportBudget(workId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BudgetImportInput) => api<{ budgetId: string; version: number; lines: number; total: string }>(`/works/${workId}/budget-import`, { method: 'POST', body }),
    onSuccess: () => {
      for (const k of BUDGET_KEYS) qc.invalidateQueries({ queryKey: [k] })
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

// ----------------------------------------------------------------------------- obras da UAU e planilha de orçamentos (SharePoint)
const LIST_STALE = 5 * 60_000

export const useUauCompanies = (enabled = true) =>
  useQuery({ queryKey: ['uau', 'companies'], queryFn: () => api<UauCompanyDTO[]>('/uau/companies'), enabled, staleTime: LIST_STALE })

/** Obras ativas da UAU (existingWorkId preenchido quando a obra já está no QC) */
export const useUauWorks = (enabled = true) =>
  useQuery({ queryKey: ['uau', 'works'], queryFn: () => api<UauWorkOptionDTO[]>('/uau/works'), enabled, staleTime: LIST_STALE })

/** Orçamentos da obra na planilha (pode demorar: a planilha é grande) */
export const useSheetBudgets = (workCode: string | null) =>
  useQuery({
    queryKey: ['budget-sheet', 'budgets', workCode],
    queryFn: () => api<SheetBudgetDTO[]>(`/budget-sheet/budgets?${new URLSearchParams({ work: workCode ?? '' })}`),
    enabled: !!workCode,
    staleTime: LIST_STALE,
  })

/** Resultado da criação/atualização da obra a partir da planilha */
export interface SheetBudgetImportResult {
  id: string
  budget: { budgetId: string; version: number; lines: number }
  warnings: string[]
}

export function useCreateWorkFromUau() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateWorkFromUauInput) => api<SheetBudgetImportResult>('/works/from-uau', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['works'] })
      qc.invalidateQueries({ queryKey: ['uau', 'works'] })
    },
  })
}

export function useRefreshSheetBudget(workId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: RefreshSheetBudgetInput) => api<SheetBudgetImportResult>(`/works/${workId}/budget-sheet/refresh`, { method: 'POST', body }),
    onSuccess: () => {
      for (const k of BUDGET_KEYS) qc.invalidateQueries({ queryKey: [k] })
    },
  })
}
