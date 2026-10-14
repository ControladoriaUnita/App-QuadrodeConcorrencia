import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BudgetImportInput,
  BudgetLineUsageDTO,
  BudgetStructureDTO,
  CreateWorkFromUauInput,
  CreateWorkInput,
  PlanningCodeDTO,
  RefreshSheetBudgetInput,
  SetBudgetGroupNameInput,
  SetLinePlanningInput,
  WorkDTO,
  WorkListDTO,
  WorkMaterialDTO,
  WorkOverviewDTO,
  WorkSetupOptionsDTO,
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

/** Vínculos de planejamento (IPs) da obra: UAU, ou o orçamento importado */
export const usePlanningCodes = (workId: string, enabled = true) =>
  useQuery({
    queryKey: ['planning-codes', workId],
    queryFn: () => api<WorkListDTO<PlanningCodeDTO>>(`/works/${workId}/planning-codes`),
    enabled: !!workId && enabled,
    staleTime: 5 * 60_000,
  })

/** Insumos da obra (para criar insumos no mapa): UAU, ou o orçamento importado */
export const useWorkMaterials = (workId: string, enabled = true) =>
  useQuery({
    queryKey: ['work-materials', workId],
    queryFn: () => api<WorkListDTO<WorkMaterialDTO>>(`/works/${workId}/work-materials`),
    enabled: !!workId && enabled,
    staleTime: 5 * 60_000,
  })

/** IP escolhido à mão para uma linha do orçamento */
export function useSetLinePlanning(workId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SetLinePlanningInput) => api<{ changed: number }>(`/works/${workId}/budget-lines/planning`, { method: 'PUT', body: input }),
    onSuccess: () => BUDGET_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  })
}

/** Nome de um Item da EAP do orçamento */
export function useSetBudgetGroupName(workId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SetBudgetGroupNameInput) => api(`/works/${workId}/budget-groups`, { method: 'PUT', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget-structure', workId] }),
  })
}

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
/** Empresas → obras → orçamentos da planilha (com nomes da UAU). A 1ª leitura da planilha pode demorar. */
export const useWorkSetupOptions = (enabled = true) =>
  useQuery({
    queryKey: ['work-setup', 'options'],
    queryFn: () => api<WorkSetupOptionsDTO>('/work-setup/options'),
    enabled,
    staleTime: 5 * 60_000,
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
      qc.invalidateQueries({ queryKey: ['work-setup'] })
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

/** Obras arquivadas (só quem gerencia obras) */
export const useArchivedWorks = (enabled = true) =>
  useQuery({ queryKey: ['works', 'arquivadas'], queryFn: () => api<WorkDTO[]>('/works?arquivadas=1'), enabled })

/** Arquiva (true) ou desarquiva (false) a obra: sai das listas, nada é apagado */
export function useSetWorkArchived(workId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (archived: boolean) => api<{ archived: boolean }>(`/works/${workId}/archive`, { method: 'PUT', body: { archived } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['works'] })
      qc.invalidateQueries({ queryKey: ['work-overview', workId] })
    },
  })
}
