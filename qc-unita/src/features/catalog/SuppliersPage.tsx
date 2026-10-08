import { useState } from 'react'
import { Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Card, EmptyState, Input, Skeleton } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatDate, formatTaxId } from '@/utils/format'
import { useSuppliers } from '@/features/competitions/api'

export function SuppliersPage() {
  const [search, setSearch] = useState('')
  const suppliers = useSuppliers(search)
  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
  const th = 'border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap text-left'
  const td = 'border-b border-border px-3 py-2.5'
  return (
    <div>
      <PageHeader eyebrow="Cadastros" title="Fornecedores" description="Mapa de fornecedores com dados cadastrais e validade da CND." />
      <Card>
        <div className="border-b border-border px-5 py-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input aria-label="Buscar fornecedor" placeholder="Razão social, fantasia ou CNPJ" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {suppliers.error ? (
          <div className="p-5"><Alert tone="error">{(suppliers.error as Error).message}</Alert></div>
        ) : suppliers.isLoading ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !suppliers.data?.length ? (
          <EmptyState title="Nenhum fornecedor encontrado" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabular w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {['Razão social', 'CNPJ/CPF', 'Contato', 'Cidade', 'Validade CND'].map((h) => <th key={h} className={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {suppliers.data.map((s) => {
                  const cnd = s.cndValidUntil
                  const tone = !cnd ? 'neutral' : cnd < today ? 'error' : cnd <= in30 ? 'warning' : 'success'
                  return (
                    <tr key={s.id} className="hover:bg-ink-50">
                      <td className={td}>
                        <p className="font-medium">{s.legalName}</p>
                        <p className="text-[11px] leading-4 text-text-muted">{s.tradeName ?? '—'}</p>
                      </td>
                      <td className={cn(td, 'whitespace-nowrap')}>{formatTaxId(s.taxId)}</td>
                      <td className={td}>
                        <p>{s.contactName ?? '—'}</p>
                        <p className="text-[11px] leading-4 text-text-muted">{[s.phone, s.email].filter(Boolean).join(' · ')}</p>
                      </td>
                      <td className={td}>{[s.city, s.state].filter(Boolean).join(' / ') || '—'}</td>
                      <td className={td}>
                        <Badge tone={tone}>{cnd ? `${formatDate(cnd)}${cnd < today ? ' · vencida' : ''}` : 'Não informada'}</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
