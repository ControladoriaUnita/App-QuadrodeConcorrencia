/**
 * Tela inicial da obra: o orçamento na estrutura da planilha, com o que já está comprometido
 * em concorrências. É daqui que o fluxo começa (importar orçamento → nova concorrência).
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FileSpreadsheet, Plus } from 'lucide-react'
import { Alert, Button, Card, CardHeader, EmptyState, Skeleton } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useBudgetLines, useBudgetStructure } from './api'
import { BudgetImportDialog } from './BudgetImportDialog'
import { BudgetTree } from './BudgetTree'
import { workPath } from './currentWork'
import { useWorkModel, WorkHeader, WorkPageSkeleton } from './WorkHeader'

export function BudgetPage() {
  const { workId = '' } = useParams()
  const navigate = useNavigate()
  const { can } = useAuth()
  const { q, data, ov } = useWorkModel(workId)
  const [importing, setImporting] = useState(false)
  const [params, setParams] = useSearchParams()
  const hasBudget = !!data?.work.currentBudgetId
  const lines = useBudgetLines(workId, {}, hasBudget)
  const structure = useBudgetStructure(workId, hasBudget)

  // Obra recém-criada: abre a importação do orçamento
  useEffect(() => {
    if (params.get('importar') === '1') {
      setImporting(true)
      setParams((p) => (p.delete('importar'), p), { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (q.error) return <Alert tone="error" title="Não foi possível carregar a obra">{(q.error as Error).message}</Alert>
  if (!data || !ov) return <WorkPageSkeleton />

  const importButton = can('budget.import') && (
    <Button variant={hasBudget ? 'secondary' : 'primary'} icon={<FileSpreadsheet className="size-4" />} onClick={() => setImporting(true)}>
      {hasBudget ? 'Importar nova versão (Excel)' : 'Importar orçamento (Excel)'}
    </Button>
  )

  return (
    <div>
      <WorkHeader
        section="Orçamento"
        data={data}
        ov={ov}
        strip={hasBudget}
        actions={
          <>
            {importButton}
            {can('competition.create') && hasBudget && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate(workPath.newCompetition(workId))}>
                Nova concorrência
              </Button>
            )}
          </>
        }
      />

      {!hasBudget ? (
        <Card>
          <EmptyState
            title="Obra sem orçamento"
            description="O fluxo começa pelo orçamento: importe a planilha do orçamento analítico (ou sincronize com o ERP) para montar as concorrências."
            action={importButton}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Orçamento da obra"
            description="Estrutura da planilha: Item → composição → insumos com Vínculo PL. “Comprometido em” mostra o % de cada QC (revisão efetiva); “Livre”, o que resta."
          />
          {lines.isLoading || structure.isLoading ? (
            <div className="grid gap-2 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : (
            <BudgetTree structure={structure.data ?? { budgetId: '', groups: [], activities: [] }} lines={lines.data ?? []} maxHeight="calc(100dvh - 19rem)" />
          )}
        </Card>
      )}

      <BudgetImportDialog open={importing} work={data.work} onClose={() => setImporting(false)} />
    </div>
  )
}
