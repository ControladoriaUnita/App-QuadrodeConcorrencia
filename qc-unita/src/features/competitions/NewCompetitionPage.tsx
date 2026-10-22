/**
 * Nova concorrência: os insumos são escolhidos na MESMA tela do orçamento (Item → composição →
 * insumos), marcando o que entra e quanto será consumido de cada linha (% → verba puxada).
 * Os IPs de planejamento do QC saem das linhas marcadas.
 */
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Decimal } from '@shared/domain/decimal'
import { Alert, Button, Card, CardHeader, Field, Input, Skeleton } from '@/components/ui'
import { formatBRL } from '@/utils/format'
import { freeShare, pulledValue } from '@/features/works/BudgetLinesTable'
import { BudgetTree } from '@/features/works/BudgetTree'
import { useBudgetLines, useBudgetStructure } from '@/features/works/api'
import { BudgetIncompleteAlert, useBudgetReadiness } from '@/features/works/BudgetReadiness'
import { workPath } from '@/features/works/currentWork'
import { useWorkModel, WorkHeader, WorkPageSkeleton } from '@/features/works/WorkHeader'
import { useCreateCompetition } from './api'

export function NewCompetitionPage() {
  const { workId = '' } = useParams()
  const navigate = useNavigate()
  const { q, data, ov } = useWorkModel(workId)
  const lines = useBudgetLines(workId, {}, !!data?.work.currentBudgetId)
  const structure = useBudgetStructure(workId, !!data?.work.currentBudgetId)
  const create = useCreateCompetition()
  const readiness = useBudgetReadiness(structure.data, lines.data)
  const blocked = !readiness?.ready
  const [title, setTitle] = useState('')
  const [requestedOn, setRequestedOn] = useState(new Date().toISOString().slice(0, 10))
  const [selection, setSelection] = useState<Map<string, string>>(new Map())
  const [touched, setTouched] = useState(false)

  const chosen = useMemo(() => (lines.data ?? []).filter((l) => selection.has(l.id)), [lines.data, selection])
  const pulled = Decimal.sum(chosen.map((l) => pulledValue(l, selection.get(l.id)!)))
  const over = chosen.filter((l) => Decimal.from(selection.get(l.id)!).gt(freeShare(l)))
  const zero = chosen.filter((l) => !Decimal.from(selection.get(l.id)!).isPositive())
  /** IPs do QC: pela verba puxada (o de maior valor é o principal) */
  const packageCodes = useMemo(() => {
    const by = new Map<string, Decimal>()
    for (const l of chosen) if (l.packageCode) by.set(l.packageCode, (by.get(l.packageCode) ?? Decimal.ZERO).plus(pulledValue(l, selection.get(l.id)!)))
    return [...by.entries()].sort((a, b) => b[1].compare(a[1])).map(([k]) => k)
  }, [chosen, selection])
  const titleError = touched && title.trim().length < 3 ? 'Descreva o objeto da concorrência' : null

  if (q.error) return <Alert tone="error" title="Não foi possível carregar a obra">{(q.error as Error).message}</Alert>
  if (!data || !ov) return <WorkPageSkeleton />
  if (!data.work.currentBudgetId) {
    return (
      <Alert tone="warning" title="Obra sem orçamento">
        Importe o orçamento antes de criar concorrências.
      </Alert>
    )
  }

  const submit = async () => {
    setTouched(true)
    if (blocked || title.trim().length < 3 || !selection.size || over.length || zero.length) return
    const r = await create.mutateAsync({
      workId,
      title: title.trim(),
      requestedOn,
      packageCodes: packageCodes.length ? packageCodes : undefined,
      lineIds: [...selection.keys()],
      lineShares: Object.fromEntries(selection),
    })
    navigate(`${workPath.competition(workId, r.competitionId)}?aba=vinculos`)
  }

  return (
    <div className="pb-16">
      <WorkHeader section="Nova concorrência" data={data} ov={ov} strip={false} />
      {readiness && !readiness.ready && <BudgetIncompleteAlert readiness={readiness} className="mb-3" />}

      <Card className="mb-3">
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-[1fr_11rem]">
          <Field label="Objeto da concorrência" required error={titleError}>
            <Input autoFocus placeholder="Ex.: Fornecimento e instalação de esquadrias de alumínio" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Data da solicitação" required>
            <Input type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Insumos e quanto será consumido"
          description="Marque no orçamento os insumos desta contratação. Em cada linha, o “% a consumir” define a verba puxada (padrão: o que ainda está livre). Marcar um Item ou composição marca todos os insumos abaixo; o % digitado nele vale para todos."
        />
        {lines.isLoading || structure.isLoading ? (
          <div className="grid gap-2 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : (
          <BudgetTree
            structure={structure.data ?? { budgetId: '', groups: [], activities: [] }}
            lines={lines.data ?? []}
            selection={{ value: selection, onChange: setSelection }}
            maxHeight="calc(100dvh - 22rem)"
          />
        )}
      </Card>

      {(over.length > 0 || zero.length > 0 || create.error || (touched && !selection.size)) && (
        <div className="mt-3 grid gap-2">
          {touched && !selection.size && <Alert tone="warning">Marque ao menos um insumo do orçamento.</Alert>}
          {over.length > 0 && <Alert tone="error">{over.length} insumo(s) com % acima do saldo livre. Ajuste o “% a consumir”.</Alert>}
          {zero.length > 0 && <Alert tone="warning">{zero.length} insumo(s) marcado(s) com 0%. Informe o percentual ou desmarque.</Alert>}
          {create.error && <Alert tone="error">{(create.error as Error).message}</Alert>}
        </div>
      )}

      {/* Barra de ação fixa: resumo do que vai para o QC */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 shadow-overlay backdrop-blur">
        <div className="tabular flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 lg:px-6 2xl:px-10">
          <span className="text-sm text-text-muted">
            <strong className="text-text">{selection.size.toLocaleString('pt-BR')}</strong> insumo(s) ·{' '}
            {packageCodes.length ? `${packageCodes.length} IP(s): ${packageCodes.slice(0, 4).join(', ')}${packageCodes.length > 4 ? '…' : ''}` : 'nenhum IP'}
          </span>
          <span className="text-sm">
            Verba puxada <strong className="text-primary">{formatBRL(pulled)}</strong>
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={() => navigate(workPath.competitions(workId))}>Cancelar</Button>
            <Button variant="primary" icon={<Check className="size-4" />} loading={create.isPending} disabled={blocked || (!!selection.size && (over.length > 0 || zero.length > 0))} onClick={submit}>
              Criar concorrência
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
