/**
 * Hooks de dados (TanStack Query) das concorrências.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AuditLogDTO,
  BudgetPackageDTO,
  CompetitionDetailDTO,
  CompetitionListItemDTO,
  CreateCompetitionInput,
  DecideApprovalInput,
  SetItemLinksInput,
  SupplierDTO,
  UpdateItemInput,
  UpdateRevisionInput,
  UpdateSupplierTermsInput,
  UpsertPricesInput,
  WorkDTO,
} from '@shared/contracts'
import { api } from '@/lib/api'

export const keys = {
  list: (workId?: string) => ['competitions', workId ?? 'all'] as const,
  detail: (id: string, revisionId?: string) => ['competition', id, revisionId ?? 'current'] as const,
  audit: (id: string) => ['competition-audit', id] as const,
}

export const useWorks = () => useQuery({ queryKey: ['works'], queryFn: () => api<WorkDTO[]>('/works') })
export const usePackages = (workId: string | undefined) =>
  useQuery({ queryKey: ['packages', workId], queryFn: () => api<BudgetPackageDTO[]>(`/works/${workId}/packages`), enabled: !!workId })
export const useSuppliers = (search = '') =>
  useQuery({ queryKey: ['suppliers', search], queryFn: () => api<SupplierDTO[]>(`/suppliers${search ? `?search=${encodeURIComponent(search)}` : ''}`) })

export const useCompetitions = (workId?: string) =>
  useQuery({ queryKey: keys.list(workId), queryFn: () => api<CompetitionListItemDTO[]>(`/competitions${workId ? `?workId=${workId}` : ''}`) })

export const useCompetition = (id: string, revisionId?: string) =>
  useQuery({
    queryKey: keys.detail(id, revisionId),
    queryFn: () => api<CompetitionDetailDTO>(`/competitions/${id}${revisionId ? `?revisionId=${revisionId}` : ''}`),
  })

export const useAudit = (id: string, enabled: boolean) =>
  useQuery({ queryKey: keys.audit(id), queryFn: () => api<AuditLogDTO[]>(`/competitions/${id}/audit`), enabled })

function useInvalidate(competitionId: string) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['competition', competitionId] })
    qc.invalidateQueries({ queryKey: ['competitions'] })
    qc.invalidateQueries({ queryKey: keys.audit(competitionId) })
    qc.invalidateQueries({ queryKey: ['work-overview'] })
    qc.invalidateQueries({ queryKey: ['works'] })
  }
}

export function useCreateCompetition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCompetitionInput) => api<{ competitionId: string; revisionId: string }>('/competitions', { method: 'POST', body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['competitions'] })
      qc.invalidateQueries({ queryKey: ['work-overview'] })
      qc.invalidateQueries({ queryKey: ['works'] })
    },
  })
}

export function useQcMutations(competitionId: string, revisionId: string) {
  const qc = useQueryClient()
  const invalidate = useInvalidate(competitionId)
  const base = `/revisions/${revisionId}`
  const opts = { onSuccess: invalidate }

  return {
    updateRevision: useMutation({ mutationFn: (b: UpdateRevisionInput) => api(base, { method: 'PATCH', body: b }), ...opts }),
    updateItem: useMutation({
      mutationFn: ({ itemId, ...b }: UpdateItemInput & { itemId: string }) => api(`${base}/items/${itemId}`, { method: 'PATCH', body: b }),
      ...opts,
    }),
    addSupplier: useMutation({ mutationFn: (supplierId: string) => api(`${base}/suppliers`, { method: 'POST', body: { supplierId } }), ...opts }),
    updateSupplier: useMutation({
      mutationFn: ({ id, ...b }: UpdateSupplierTermsInput & { id: string }) => api(`${base}/suppliers/${id}`, { method: 'PATCH', body: b }),
      ...opts,
    }),
    removeSupplier: useMutation({ mutationFn: (id: string) => api(`${base}/suppliers/${id}`, { method: 'DELETE' }), ...opts }),
    upsertPrices: useMutation({
      mutationFn: (b: UpsertPricesInput) => api(`${base}/prices`, { method: 'PUT', body: b }),
      // Atualização otimista: o domínio recalcula a melhor condição no cliente imediatamente
      onMutate: async (b) => {
        const key = ['competition', competitionId]
        await qc.cancelQueries({ queryKey: key })
        const snapshots = qc.getQueriesData<CompetitionDetailDTO>({ queryKey: key })
        for (const [k, d] of snapshots) {
          if (!d || d.revision.id !== revisionId) continue
          const prices = [...d.prices]
          for (const p of b.prices) {
            const i = prices.findIndex((x) => x.itemId === p.itemId && x.competitionSupplierId === p.competitionSupplierId)
            const row = { competitionSupplierId: p.competitionSupplierId, itemId: p.itemId, unitPrice: p.unitPrice, notes: p.notes ?? prices[i]?.notes ?? null }
            if (i >= 0) prices[i] = row
            else prices.push(row)
          }
          qc.setQueryData(k, { ...d, prices })
        }
        return { snapshots }
      },
      onError: (_e, _b, ctx) => ctx?.snapshots.forEach(([k, d]) => qc.setQueryData(k, d)),
      onSettled: invalidate,
    }),
    setOverride: useMutation({
      mutationFn: (b: { itemId: string; competitionSupplierId: string | null; reason?: string }) => api(`${base}/overrides`, { method: 'PUT', body: b }),
      ...opts,
    }),
    submit: useMutation({ mutationFn: () => api<{ steps: number }>(`${base}/submit`, { method: 'POST' }), ...opts }),
    setLinks: useMutation({
      mutationFn: ({ itemId, links }: { itemId: string } & SetItemLinksInput) => api(`${base}/items/${itemId}/links`, { method: 'PUT', body: { links } }),
      ...opts,
      onSuccess: () => {
        opts.onSuccess?.()
        qc.invalidateQueries({ queryKey: ['budget-lines'] })
      },
    }),
    addLines: useMutation({
      mutationFn: (selection: Map<string, string>) =>
        api<{ createdItems: number; mergedItems: number }>(`${base}/lines`, {
          method: 'POST',
          body: { lineIds: [...selection.keys()], shares: Object.fromEntries(selection) },
        }),
      onSuccess: () => {
        invalidate()
        qc.invalidateQueries({ queryKey: ['budget-lines'] })
      },
    }),
    removeItem: useMutation({ mutationFn: (itemId: string) => api(`${base}/items/${itemId}`, { method: 'DELETE' }), ...opts }),
    decide: useMutation({ mutationFn: (b: DecideApprovalInput) => api<{ outcome: string }>(`${base}/approvals`, { method: 'POST', body: b }), ...opts }),
  }
}

export function useCreateRevision(competitionId: string) {
  const invalidate = useInvalidate(competitionId)
  return useMutation({
    mutationFn: (reason: string) => api<{ revisionId: string }>(`/competitions/${competitionId}/revisions`, { method: 'POST', body: { reason } }),
    onSuccess: invalidate,
  })
}
