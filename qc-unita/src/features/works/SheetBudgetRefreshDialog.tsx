/**
 * Atualiza o orçamento da obra pela planilha de orçamentos (SharePoint): reimporta o orçamento
 * atual ou outro nº da mesma empresa + obra, gerando uma nova versão vigente.
 */
import { useEffect, useState } from 'react'
import type { RefreshSheetBudgetInput, UauWorkKeyDTO } from '@shared/contracts'
import { Alert, Button, Dialog } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { useRefreshSheetBudget, useWorkSetupOptions, type SheetBudgetImportResult } from './api'
import { SheetBudgetField } from './SheetBudgetField'

interface Props {
  open: boolean
  workId: string
  /** Chave da obra na UAU e orçamento atual */
  uau: UauWorkKeyDTO
  onClose: () => void
  onDone: (result: SheetBudgetImportResult) => void
}

export function SheetBudgetRefreshDialog({ open, workId, uau, onClose, onDone }: Props) {
  const options = useWorkSetupOptions(open)
  const refresh = useRefreshSheetBudget(workId)
  const [budget, setBudget] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setBudget(uau.budget)
    refresh.reset()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const budgets = options.data
    ? (options.data.companies.find((c) => c.code === uau.company)?.works.find((w) => w.code === uau.work)?.budgets ?? [])
    : null
  const error = (refresh.error ?? options.error) as ApiError | null
  const changed = !!budget && budget !== uau.budget

  const submit = async () => {
    if (!budget) return
    const input: RefreshSheetBudgetInput = { budget }
    try {
      onDone(await refresh.mutateAsync(input))
    } catch {
      /* o erro aparece no alerta do diálogo */
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="min(94vw, 38rem)"
      title="Atualizar dados do orçamento"
      description={`Reimporta o orçamento da obra ${uau.work} (empresa ${uau.company}) do SharePoint, com o de-para e o indireto aberto da obra. Uma nova versão do orçamento passa a ser a vigente.`}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!budget} loading={refresh.isPending} onClick={submit}>
            {changed ? `Importar orçamento ${budget}` : 'Atualizar orçamento'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {error && <Alert tone="error" title="Não foi possível atualizar o orçamento">{error.message}</Alert>}
        {options.isLoading && <p className="text-sm text-text-muted">Buscando os orçamentos no SharePoint… pode levar alguns segundos.</p>}
        <SheetBudgetField budgets={budgets} value={budget} onChange={setBudget} />
        {changed && uau.budget && (
          <Alert tone="warning">
            A obra hoje usa o orçamento {uau.budget}. Ao confirmar, o orçamento {budget} passa a ser o vigente.
          </Alert>
        )}
      </div>
    </Dialog>
  )
}
