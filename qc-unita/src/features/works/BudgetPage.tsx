/**
 * Tela inicial da obra: o orçamento na estrutura da EAP, com o que já está comprometido
 * em concorrências. É daqui que o fluxo começa (importar orçamento → nova concorrência).
 * Obras vindas da UAU atualizam o orçamento pelo SharePoint e abrem o indireto pelo arquivo da obra.
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FileSpreadsheet, Plus, RefreshCw, X } from 'lucide-react'
import { Alert, Button, Card, CardHeader, EmptyState, Skeleton } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useBudgetLines, useBudgetStructure, usePlanningCodes, useSetBudgetGroupName, useSetLinePlanning, type SheetBudgetImportResult } from './api'
import { ArchiveWorkButton } from './ArchiveWorkButton'
import { BudgetImportDialog } from './BudgetImportDialog'
import { BudgetTree } from './BudgetTree'
import { workPath } from './currentWork'
import { IndirectImportDialog } from './IndirectImportDialog'
import { SheetBudgetRefreshDialog } from './SheetBudgetRefreshDialog'
import { useWorkModel, WorkHeader, WorkPageSkeleton } from './WorkHeader'

/** Estado de navegação: resultado da importação feita ao criar a obra pela UAU */
export interface BudgetPageState {
  sheetImport?: SheetBudgetImportResult
}

export function BudgetPage() {
  const { workId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { can } = useAuth()
  const { q, data, ov } = useWorkModel(workId)
  const [importing, setImporting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [importingIndirect, setImportingIndirect] = useState(false)
  const [sheetImport, setSheetImport] = useState<SheetBudgetImportResult | null>(() => (location.state as BudgetPageState | null)?.sheetImport ?? null)
  const [params, setParams] = useSearchParams()
  const hasBudget = !!data?.work.currentBudgetId
  const lines = useBudgetLines(workId, {}, hasBudget)
  const structure = useBudgetStructure(workId, hasBudget)
  const canPlan = can('budget.import')
  const planningCodes = usePlanningCodes(workId, hasBudget && canPlan)
  const setPlanning = useSetLinePlanning(workId)
  const renameGroup = useSetBudgetGroupName(workId)

  // Obra recém-criada (cadastro manual): abre a importação do orçamento
  useEffect(() => {
    if (params.get('importar') === '1') {
      setImporting(true)
      setParams((p) => (p.delete('importar'), p), { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // O aviso da criação vale uma vez: não reaparece ao recarregar/voltar
  useEffect(() => {
    if (location.state) navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (q.error) return <Alert tone="error" title="Não foi possível carregar a obra">{(q.error as Error).message}</Alert>
  if (!data || !ov) return <WorkPageSkeleton />

  const uau = data.work.uau
  const canImport = can('budget.import')
  const refreshButton = canImport && uau && (
    <Button variant={hasBudget ? 'secondary' : 'primary'} icon={<RefreshCw className="size-4" />} onClick={() => setRefreshing(true)}>
      {hasBudget ? 'Atualizar dados' : 'Importar do SharePoint'}
    </Button>
  )
  // Obras da UAU: o orçamento vem do SharePoint e o Excel abre o indireto; as demais importam o orçamento pelo Excel
  const importButton =
    canImport &&
    (uau ? (
      hasBudget && (
        <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => setImportingIndirect(true)}>
          Importar indireto (Excel)
        </Button>
      )
    ) : (
      <Button variant={hasBudget ? 'secondary' : 'primary'} icon={<FileSpreadsheet className="size-4" />} onClick={() => setImporting(true)}>
        {hasBudget ? 'Importar nova versão (Excel)' : 'Importar orçamento (Excel)'}
      </Button>
    ))

  return (
    <div>
      <WorkHeader
        section="Orçamento"
        data={data}
        ov={ov}
        strip={hasBudget}
        actions={
          <>
            {can('work.manage') && <ArchiveWorkButton work={data.work} />}
            {refreshButton}
            {importButton}
            {can('competition.create') && hasBudget && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate(workPath.newCompetition(workId))}>
                Nova concorrência
              </Button>
            )}
          </>
        }
      />

      {sheetImport && <SheetImportNotice result={sheetImport} onDismiss={() => setSheetImport(null)} />}

      {!hasBudget ? (
        <Card>
          <EmptyState
            title="Obra sem orçamento"
            description={
              uau
                ? 'O fluxo começa pelo orçamento: importe-o do SharePoint para montar as concorrências.'
                : 'O fluxo começa pelo orçamento: importe o orçamento analítico em Excel (ou sincronize com o ERP) para montar as concorrências.'
            }
            action={refreshButton || importButton}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Orçamento da obra"
            description="Estrutura do orçamento: Item → composição → composições auxiliares e insumos com Vínculo PL. Nomes e IPs vêm do De-para; clique no nome de um Item para renomeá-lo e no Vínculo PL de uma linha para escolher o IP (M = escolhido à mão). Use ▾ nos cabeçalhos para filtrar como no Excel."
          />
          {lines.isLoading || structure.isLoading ? (
            <div className="grid gap-2 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : (
            <BudgetTree
              structure={structure.data ?? { budgetId: '', groups: [], activities: [] }}
              lines={lines.data ?? []}
              maxHeight="calc(100dvh - 19rem)"
              onRenameGroup={canPlan ? (wbs, description) => renameGroup.mutateAsync({ wbs, description }) : undefined}
              planning={
                canPlan
                  ? {
                      options: planningCodes.data?.items ?? [],
                      loading: planningCodes.isLoading,
                      warning: planningCodes.data?.warning ?? null,
                      onSet: (line, value) => setPlanning.mutateAsync({ lineKey: line.lineKey, code: value?.code ?? null, description: value?.description ?? null }),
                    }
                  : undefined
              }
            />
          )}
        </Card>
      )}

      <BudgetImportDialog open={importing} work={data.work} onClose={() => setImporting(false)} />
      {uau && (
        <IndirectImportDialog
          open={importingIndirect}
          work={data.work}
          onClose={() => setImportingIndirect(false)}
          onDone={(result) => {
            setImportingIndirect(false)
            setSheetImport(result)
          }}
        />
      )}
      {uau && (
        <SheetBudgetRefreshDialog
          open={refreshing}
          workId={workId}
          uau={uau}
          onClose={() => setRefreshing(false)}
          onDone={(result) => {
            setRefreshing(false)
            setSheetImport(result)
          }}
        />
      )}
    </div>
  )
}

/** Resultado da atualização do orçamento: versão gerada e avisos do servidor (linhas ignoradas etc.). */
function SheetImportNotice({ result, onDismiss }: { result: SheetBudgetImportResult; onDismiss: () => void }) {
  const { budget, warnings } = result
  return (
    <Alert
      tone={warnings.length ? 'warning' : 'success'}
      className="mb-3"
      title={`Orçamento atualizado · versão ${budget.version} · ${budget.lines.toLocaleString('pt-BR')} linha(s)`}
      action={
        <button type="button" onClick={onDismiss} className="self-start rounded-control p-1 text-ink-500 hover:bg-ink-100" aria-label="Fechar aviso">
          <X className="size-4" />
        </button>
      }
    >
      {warnings.length > 0 && (
        <>
          <p>{warnings.length === 1 ? 'Atenção a este ponto da importação:' : `Atenção a ${warnings.length} pontos da importação:`}</p>
          <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </>
      )}
    </Alert>
  )
}
