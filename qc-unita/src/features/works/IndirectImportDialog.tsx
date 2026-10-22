/**
 * Importação do indireto aberto da obra (arquivo de custo indireto, Excel).
 * O arquivo é lido no navegador e interpretado pelo domínio (shared/domain/budget/indirect-import);
 * o servidor refaz os totais e grava uma nova versão do orçamento do SharePoint com o indireto
 * aberto no lugar do fechado. O indireto fica guardado e volta a cada "Atualizar dados".
 */
import { useState } from 'react'
import { FileSpreadsheet, Upload } from 'lucide-react'
import type { WorkDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { parseIndirectWorkbook, type IndirectBudget, type WorkbookSheet } from '@shared/domain/budget/indirect-import'
import { Alert, Button, Dialog, Kpi, Spinner } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { cn } from '@/utils/cn'
import { formatBRL, formatDateTime } from '@/utils/format'
import { useBudgetLines, useImportIndirect, useWorkIndirect, type SheetBudgetImportResult } from './api'

type Parsed = IndirectBudget & { fileName: string }

interface Props {
  open: boolean
  work: WorkDTO
  onClose: () => void
  onDone: (result: SheetBudgetImportResult) => void
}

export function IndirectImportDialog({ open, work, onClose, onDone }: Props) {
  const mutation = useImportIndirect(work.id)
  const current = useWorkIndirect(work.id, open)
  const lines = useBudgetLines(work.id, {}, open)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)

  const reset = () => {
    setParsed(null)
    setError(null)
    mutation.reset()
  }
  const close = () => {
    reset()
    onClose()
  }

  const onFile = async (file: File | undefined) => {
    reset()
    if (!file) return
    if (!/\.xlsx$/i.test(file.name)) return setError('Envie um arquivo .xlsx.')
    setParsing(true)
    try {
      const { default: readXlsxFile } = await import('read-excel-file/browser')
      const sheets = (await readXlsxFile(file)) as WorkbookSheet[]
      setParsed({ ...parseIndirectWorkbook(sheets), fileName: file.name })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  const submit = async () => {
    if (!parsed) return
    const { fileName, items, total, warnings } = parsed
    try {
      onDone(await mutation.mutateAsync({ fileName, items, total, warnings }))
      reset()
    } catch {
      /* o erro aparece no alerta do diálogo */
    }
  }

  // Valor de cada item hoje no orçamento (fechado, ou o indireto importado antes)
  const today = (wbs: string) => Decimal.sum((lines.data ?? []).filter((l) => l.activityWbs === wbs || l.activityWbs.startsWith(`${wbs}.`)).map((l) => l.total))
  const stored = current.data
  const th = 'sticky top-0 border-b border-border bg-ink-50 px-3 py-2'
  const td = 'border-b border-border px-3 py-1.5'

  return (
    <Dialog
      open={open}
      onClose={close}
      width="min(94vw, 56rem)"
      title="Importar indireto (Excel)"
      description="Use o arquivo de custo indireto da obra (aba “Total Indiretos” e uma aba por item). Cada item do indireto entra aberto, insumo a insumo, no lugar do valor fechado do orçamento. Os insumos já ligados a um IP no De-para entram vinculados. Uma nova versão do orçamento passa a ser a vigente."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={close}>Cancelar</Button>
          <Button variant="primary" icon={<Upload className="size-4" />} disabled={!parsed} loading={mutation.isPending} onClick={submit}>
            Importar indireto
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {stored && (
          <p className="text-sm text-text-muted">
            Indireto em uso: <span className="font-medium text-text">{stored.fileName}</span> · {formatBRL(stored.total)} · importado em {formatDateTime(stored.importedAt)}
            {stored.importedByName && ` por ${stored.importedByName}`}. Um arquivo novo substitui este.
          </p>
        )}
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-border bg-ink-50 px-6 py-8 text-center transition-colors hover:border-primary/50',
            parsing && 'pointer-events-none opacity-70',
          )}
        >
          {parsing ? <Spinner className="text-primary" /> : <FileSpreadsheet className="size-8 text-primary" aria-hidden />}
          <span className="text-sm font-medium text-text">{parsed ? parsed.fileName : 'Selecione o arquivo .xlsx do indireto'}</span>
          <span className="text-xs text-text-muted">O arquivo é lido no seu computador; só os itens e insumos são enviados.</span>
          <input type="file" accept=".xlsx" className="sr-only" aria-label="Arquivo do indireto" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>

        {error && <Alert tone="error" title="Não foi possível ler o indireto">{error}</Alert>}
        {mutation.error && <Alert tone="error" title="Importação recusada">{(mutation.error as ApiError).message}</Alert>}

        {parsed && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Kpi label="Total do indireto" value={formatBRL(parsed.total)} />
              <Kpi label="Itens" value={parsed.items.length} />
              <Kpi label="Insumos" value={parsed.items.reduce((n, i) => n + i.lines.length, 0).toLocaleString('pt-BR')} />
            </div>
            {parsed.warnings.length > 0 && (
              <Alert tone="warning" title="Avisos">
                <ul className="list-disc pl-5">{parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </Alert>
            )}
            <div className="max-h-72 overflow-auto rounded-card border border-border">
              <table className="tabular w-full border-separate border-spacing-0 text-sm" aria-label="Itens do indireto">
                <thead>
                  <tr className="text-xs font-semibold text-text-muted">
                    <th className={cn(th, 'text-left')}>Item</th>
                    <th className={cn(th, 'text-left')}>Descrição</th>
                    <th className={cn(th, 'text-right')}>Insumos</th>
                    <th className={cn(th, 'text-right')}>Indireto aberto</th>
                    <th className={cn(th, 'text-right')}>No orçamento hoje</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.items.map((i) => (
                    <tr key={i.wbs}>
                      <td className={cn(td, 'font-medium')}>{i.wbs}</td>
                      <td className={td}>{i.description}</td>
                      <td className={cn(td, 'text-right')}>{i.lines.length}</td>
                      <td className={cn(td, 'text-right whitespace-nowrap')}>{formatBRL(i.total)}</td>
                      <td className={cn(td, 'text-right whitespace-nowrap text-text-muted')}>{lines.data ? formatBRL(today(i.wbs)) : '…'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
