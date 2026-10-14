/**
 * Consulta UAU: o cadastro de insumos da UAU, sincronizado em Integração ERP, em duas visões:
 * vínculos de planejamento (insumos "IP…") e os demais insumos. Busca por código ou descrição.
 */
import { useEffect, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import type { MaterialQuery } from '@shared/contracts'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, Badge, Button, Card, EmptyState, Input, SegmentedControl, Skeleton } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { cn } from '@/utils/cn'
import { formatDateTime } from '@/utils/format'
import { useMaterials, useSyncMaterials } from './api'

type Kind = MaterialQuery['type']
const KINDS: { key: Kind; label: string }[] = [
  { key: 'ip', label: 'Vínculos de planejamento (IP)' },
  { key: 'insumo', label: 'Insumos' },
]
const PAGE = 100
/** Acima disso, a busca refina (o cadastro tem ~13 mil insumos) */
const MAX_SHOWN = 2000

export function UauCatalogPage() {
  const { can } = useAuth()
  const [kind, setKind] = useState<Kind>('ip')
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const materials = useMaterials({ type: kind, search, limit })
  const sync = useSyncMaterials()

  // Busca no servidor depois de uma pausa na digitação; nova busca volta à 1ª página
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(text.trim())
      setLimit(PAGE)
    }, 300)
    return () => clearTimeout(t)
  }, [text])

  const page = materials.data
  const th = 'border-b border-border bg-ink-50 px-3 py-2 text-xs font-semibold text-text-muted whitespace-nowrap text-left'
  const td = 'border-b border-border px-3 py-2'

  return (
    <div>
      <PageHeader
        eyebrow="Cadastros"
        title="Consulta UAU"
        description="Vínculos de planejamento (IPs) e insumos do cadastro da UAU. A lista vem da última sincronização em Integração ERP."
        actions={
          can('integration.run') && (
            <Button icon={<RefreshCw className="size-4" />} loading={sync.isPending} onClick={() => sync.mutate()}>
              Atualizar da UAU
            </Button>
          )
        }
      />
      {sync.error && <Alert tone="error" className="mb-3" title="Não foi possível atualizar da UAU">{(sync.error as Error).message}</Alert>}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <SegmentedControl
            label="Tipo"
            items={KINDS}
            value={kind}
            onChange={(k) => {
              setKind(k)
              setLimit(PAGE)
            }}
          />
          <div className="relative min-w-60 flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input aria-label="Buscar no cadastro" placeholder="Código ou descrição" className="pl-9" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <span className="tabular ml-auto text-sm text-text-muted">
            {page ? `${page.total.toLocaleString('pt-BR')} ${kind === 'ip' ? 'IP(s)' : 'insumo(s)'}` : ''}
            {page?.syncedAt && ` · sincronizado em ${formatDateTime(page.syncedAt)}`}
          </span>
        </div>
        {materials.error ? (
          <div className="p-5"><Alert tone="error">{(materials.error as Error).message}</Alert></div>
        ) : !page ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : !page.items.length ? (
          <EmptyState
            title={search ? 'Nada encontrado' : 'Cadastro ainda não sincronizado'}
            description={search ? 'Tente outro código ou parte da descrição.' : 'Sincronize os insumos da UAU em Integração ERP (escopo Insumos) ou use Atualizar da UAU.'}
          />
        ) : (
          <>
            <div className="max-h-[calc(100dvh-17rem)] overflow-auto">
              <table className="tabular w-full border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {['Código', 'Descrição', 'Unidade', 'Situação'].map((h) => <th key={h} className={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((m) => (
                    <tr key={m.code} className={cn('hover:bg-ink-50', !m.active && 'text-text-muted')}>
                      <td className={cn(td, 'w-32 font-medium whitespace-nowrap')}>{m.code}</td>
                      <td className={td}>{m.description}</td>
                      <td className={cn(td, 'w-24')}>{m.unit}</td>
                      <td className={cn(td, 'w-28')}>
                        <Badge tone={m.active ? 'success' : 'neutral'}>{m.active ? 'Ativo' : 'Inativo'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-2 text-sm text-text-muted">
              <span className="tabular">Mostrando {page.items.length.toLocaleString('pt-BR')} de {page.total.toLocaleString('pt-BR')}</span>
              {page.items.length < page.total &&
                (limit < MAX_SHOWN ? (
                  <Button size="sm" variant="ghost" loading={materials.isFetching} onClick={() => setLimit((l) => Math.min(MAX_SHOWN, l + PAGE * 5))}>
                    Mostrar mais
                  </Button>
                ) : (
                  <span>Use a busca para encontrar os demais</span>
                ))}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
