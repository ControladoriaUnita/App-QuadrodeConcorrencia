/**
 * Atualiza o orçamento da obra pela planilha de orçamentos (SharePoint): reimporta o orçamento
 * atual ou outro nº escolhido, gerando uma nova versão vigente.
 */
import { useEffect, useState } from 'react'
import type { RefreshSheetBudgetInput, UauWorkKeyDTO } from '@shared/contracts'
import { Alert, Button, Dialog } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { useRefreshSheetBudget, type SheetBudgetImportResult } from './api'
import { sameCompany, SheetBudgetField, type SheetBudgetChoice } from './SheetBudgetField'

const currentChoice = (uau: UauWorkKeyDTO): SheetBudgetChoice | null =>
  uau.budget ? { budget: uau.budget, sheetCompany: uau.sheetCompany ?? uau.company } : null

interface Props {
  open: boolean
  workId: string
  /** Chave da obra na UAU e orçamento atual */
  uau: UauWorkKeyDTO
  onClose: () => void
  onDone: (result: SheetBudgetImportResult) => void
}

export function SheetBudgetRefreshDialog({ open, workId, uau, onClose, onDone }: Props) {
  const refresh = useRefreshSheetBudget(workId)
  const [budget, setBudget] = useState<SheetBudgetChoice | null>(null)

  useEffect(() => {
    if (!open) return
    setBudget(currentChoice(uau))
    refresh.reset()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const error = refresh.error as ApiError | null
  const changed = !!budget && budget.budget !== uau.budget

  const submit = async () => {
    if (!budget) return
    const input: RefreshSheetBudgetInput = {
      budget: budget.budget,
      ...(sameCompany(budget.sheetCompany, uau.company) ? {} : { sheetCompany: budget.sheetCompany }),
    }
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
      title="Atualizar orçamento da planilha"
      description={`Reimporta o orçamento da obra ${uau.work} (empresa ${uau.company}) da planilha de orçamentos do SharePoint. Uma nova versão do orçamento passa a ser a vigente.`}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!budget} loading={refresh.isPending} onClick={submit}>
            {changed ? `Importar orçamento ${budget.budget}` : 'Atualizar orçamento'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {error && <Alert tone="error" title="Não foi possível atualizar o orçamento">{error.message}</Alert>}
        <SheetBudgetField workCode={uau.work} company={uau.company} value={budget} onChange={setBudget} />
        {changed && uau.budget && (
          <Alert tone="warning">
            A obra hoje usa o orçamento {uau.budget}. Ao confirmar, o orçamento {budget.budget} passa a ser o vigente.
          </Alert>
        )}
      </div>
    </Dialog>
  )
}
