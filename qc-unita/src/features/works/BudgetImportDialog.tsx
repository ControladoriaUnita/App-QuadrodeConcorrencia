/**
 * Importação do orçamento da obra a partir do Excel.
 * A planilha é lida no navegador e interpretada pelo domínio (shared/domain/budget/excel-import);
 * o servidor revalida tudo antes de gravar uma nova versão vigente.
 */
import { useState } from 'react'
import { FileSpreadsheet, Upload } from 'lucide-react'
import type { WorkDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { findHeader, parseBudgetSheet, type BudgetImportResult, type Cell } from '@shared/domain/budget/excel-import'
import { Alert, Button, Dialog, Kpi, Spinner } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatBRL, formatVariation } from '@/utils/format'
import { useImportBudget } from './api'

type Parsed = BudgetImportResult & { fileName: string; sheetName: string }

export function BudgetImportDialog({ open, work, onClose }: { open: boolean; work: WorkDTO; onClose: () => void }) {
  const mutation = useImportBudget(work.id)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [done, setDone] = useState<{ version: number; lines: number } | null>(null)

  const reset = () => {
    setParsed(null)
    setError(null)
    setDone(null)
    mutation.reset()
  }

  const onFile = async (file: File | undefined) => {
    reset()
    if (!file) return
    if (!/\.xlsx$/i.test(file.name)) return setError('Envie um arquivo .xlsx.')
    setParsing(true)
    try {
      const { default: readXlsxFile } = await import('read-excel-file/browser')
      const sheets = (await readXlsxFile(file)) as { sheet: string; data: Cell[][] }[]
      // Preferência pela aba "Orçamento"; senão, a primeira com o cabeçalho esperado
      const sheet =
        sheets.find((s) => s.sheet.toLowerCase().startsWith('orçamento') && findHeader(s.data)) ?? sheets.find((s) => findHeader(s.data))
      if (!sheet) throw new Error('Nenhuma aba com o cabeçalho do orçamento (ITEM · SERVIÇO · DESCRIÇÕES · QNT · CUSTO UNITÁRIO · CUSTO TOTAL) foi encontrada.')
      setParsed({ ...parseBudgetSheet(sheet.data), fileName: file.name, sheetName: sheet.sheet })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  // Resumo da prévia: por IP quando a planilha tem Vínculo PL; senão por Item de 1º nível (como a planilha)
  const byPackage = !!parsed?.packages.length
  const summary = !parsed
    ? []
    : byPackage
      ? [...parsed.packages].sort((a, b) => Decimal.from(b.total).compare(a.total)).map((p) => ({ code: p.packageCode, description: p.description, lines: p.lines, total: p.total }))
      : parsed.groups
          .filter((g) => !g.wbs.includes('.'))
          .map((g) => {
            const own = parsed.lines.filter((l) => l.activityWbs === g.wbs || l.activityWbs.startsWith(`${g.wbs}.`))
            return { code: g.wbs, description: g.description, lines: own.length, total: Decimal.sum(own.map((l) => l.total)).toDb() }
          })
  const current = Decimal.from(work.currentBudgetTotal ?? '0')
  const diff = parsed && !current.isZero() ? Decimal.from(parsed.total).minus(current).div(current, 6) : null

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      width="min(94vw, 52rem)"
      title="Importar orçamento (Excel)"
      description="Use o orçamento analítico (colunas ITEM_PLA · ITEM · SERVIÇO · DESCRIÇÕES · UNID. · QNT · CUSTO UNITÁRIO · CUSTO TOTAL). Itens, composições e insumos entram na mesma estrutura da planilha. A importação cria uma nova versão vigente; QCs existentes continuam vinculados às suas linhas."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => (reset(), onClose())}>
            {done ? 'Fechar' : 'Cancelar'}
          </Button>
          {!done && (
            <Button
              variant="primary"
              icon={<Upload className="size-4" />}
              disabled={!parsed}
              loading={mutation.isPending}
              onClick={async () => {
                if (!parsed) return
                const { fileName, sheetName, groups, activities, lines, materials } = parsed
                const r = await mutation.mutateAsync({ fileName, sheetName, groups, activities, lines, materials })
                setDone(r)
              }}
            >
              Importar como nova versão
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4">
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-border bg-ink-50 px-6 py-8 text-center transition-colors hover:border-primary/50',
            parsing && 'pointer-events-none opacity-70',
          )}
        >
          {parsing ? <Spinner className="text-primary" /> : <FileSpreadsheet className="size-8 text-primary" aria-hidden />}
          <span className="text-sm font-medium text-text">{parsed ? parsed.fileName : 'Selecione o arquivo .xlsx do orçamento'}</span>
          <span className="text-xs text-text-muted">{parsed ? `Aba “${parsed.sheetName}” · cabeçalho na linha ${parsed.sheetHeaderRow}` : 'O arquivo é lido no seu computador; só os dados interpretados são enviados.'}</span>
          <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>

        {error && <Alert tone="error" title="Não foi possível ler o orçamento">{error}</Alert>}
        {mutation.error && <Alert tone="error" title="Importação recusada">{(mutation.error as Error).message}</Alert>}
        {done && (
          <Alert tone="success" title={`Orçamento v${done.version} importado e vigente`}>
            {done.lines} linhas gravadas. O painel da obra já considera o novo orçamento.
          </Alert>
        )}

        {parsed && !done && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Total do orçamento" value={formatBRL(parsed.total)} hint={diff ? `${formatVariation(diff)} vs. vigente` : undefined} />
              <Kpi label="Linhas de insumo" value={parsed.lines.length.toLocaleString('pt-BR')} />
              <Kpi label="Composições" value={parsed.activities.length.toLocaleString('pt-BR')} hint={`${parsed.groups.length} grupos da EAP`} />
              {parsed.packages.length > 0 ? (
                <Kpi label="IPs de planejamento" value={parsed.packages.length} />
              ) : (
                <Kpi
                  label="Custo raso da planilha"
                  value={formatBRL(parsed.declaredTotal ?? parsed.compositionsTotal)}
                  hint={`Σ composições ${formatBRL(parsed.compositionsTotal)}`}
                />
              )}
            </div>
            {parsed.warnings.length > 0 && (
              <Alert tone="warning" title="Avisos">
                <ul className="list-disc pl-5">{parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </Alert>
            )}
            <div className="max-h-64 overflow-auto rounded-card border border-border">
              <table className="tabular w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-xs font-semibold text-text-muted">
                    <th className="sticky top-0 border-b border-border bg-ink-50 px-3 py-2 text-left">{byPackage ? 'IP' : 'Item'}</th>
                    <th className="sticky top-0 border-b border-border bg-ink-50 px-3 py-2 text-left">Descrição</th>
                    <th className="sticky top-0 border-b border-border bg-ink-50 px-3 py-2 text-right">Insumos</th>
                    <th className="sticky top-0 border-b border-border bg-ink-50 px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((p) => (
                    <tr key={p.code}>
                      <td className="border-b border-border px-3 py-1.5 font-medium">{p.code}</td>
                      <td className="border-b border-border px-3 py-1.5">{p.description}</td>
                      <td className="border-b border-border px-3 py-1.5 text-right">{p.lines}</td>
                      <td className="border-b border-border px-3 py-1.5 text-right whitespace-nowrap">{formatBRL(p.total)}</td>
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
