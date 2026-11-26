/**
 * Nova concorrência: os insumos são escolhidos na MESMA tela do orçamento (Item → composição →
 * insumos), marcando o que entra e quanto será consumido de cada linha (% → verba puxada).
 * Não há caixa de marcação: digitar o % na linha a coloca no QC (vazio ou 0 tira).
 * Os IPs de planejamento do QC saem das linhas escolhidas.
 * O pedido (material ou mão de obra, origem e diretor) escolhe o fluxo de aprovação.
 * "Ocultar campos" esconde objeto, tipo e origem do pedido para dar espaço à árvore de % a consumir.
 */
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, Eye, EyeOff } from 'lucide-react'
import { REQUEST_KIND_LABEL, REQUEST_ORIGIN_LABEL } from '@shared/domain/approval/flows'
import { Decimal } from '@shared/domain/decimal'
import { Alert, Button, Card, CardHeader, Field, Input, Skeleton } from '@/components/ui'
import { formatBRL } from '@/utils/format'
import { freeShare, pulledValue } from '@/features/works/BudgetLinesTable'
import { BudgetTree } from '@/features/works/BudgetTree'
import { useBudgetLines, useBudgetStructure } from '@/features/works/api'
import { BudgetIncompleteAlert, useBudgetReadiness } from '@/features/works/BudgetReadiness'
import { workPath } from '@/features/works/currentWork'
import { useWorkModel, WorkHeader, WorkPageSkeleton } from '@/features/works/WorkHeader'
import { emptyRequest, RequestFields, requestComplete, type RequestValue } from '@/features/approvals/RequestFields'
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
  const [request, setRequest] = useState<RequestValue>(emptyRequest)
  /** Objeto, tipo e origem do pedido ocultos (mais espaço para o % a consumir) */
  const [compact, setCompact] = useState(false)

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
    // Campo oculto com pendência: volta a mostrar para o aviso aparecer
    if (title.trim().length < 3 || !request.requestKind || !request.origin) setCompact(false)
    if (blocked || title.trim().length < 3 || !requestComplete(request) || !selection.size || over.length || zero.length) return
    const r = await create.mutateAsync({
      workId,
      title: title.trim(),
      requestedOn,
      packageCodes: packageCodes.length ? packageCodes : undefined,
      lineIds: [...selection.keys()],
      lineShares: Object.fromEntries(selection),
      requestKind: request.requestKind || null,
      origin: request.origin || null,
      directorId: request.directorId || null,
    })
    navigate(`${workPath.competition(workId, r.competitionId)}?aba=vinculos`)
  }

  return (
    <div className="pb-16">
      <WorkHeader section="Nova concorrência" data={data} ov={ov} strip={false} />
      {readiness && !readiness.ready && <BudgetIncompleteAlert readiness={readiness} className="mb-3" />}

      <Card className="mb-3">
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-[1fr_11rem_auto]">
          {compact ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-700">Objeto, tipo e origem do pedido (ocultos)</span>
              <p className="flex h-10 min-w-0 items-center text-sm text-text-muted">
                <span className="truncate" title={title.trim() || undefined}>
                  {[
                    title.trim() || 'Sem objeto',
                    request.requestKind ? REQUEST_KIND_LABEL[request.requestKind] : 'Tipo não escolhido',
                    request.origin ? REQUEST_ORIGIN_LABEL[request.origin] : 'Origem não escolhida',
                  ].join(' · ')}
                </span>
              </p>
            </div>
          ) : (
            <Field label="Objeto da concorrência" required error={titleError}>
              <Input autoFocus placeholder="Ex.: Fornecimento e instalação de esquadrias de alumínio" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          )}
          <Field label="Data da solicitação" required>
            <Input type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1.5">
            {/* Rótulo invisível: alinha o botão com os campos ao lado */}
            <span className="hidden text-sm font-medium sm:invisible sm:block" aria-hidden>
              Campos
            </span>
            <Button
              className="sm:w-44"
              icon={compact ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              aria-pressed={compact}
              onClick={() => setCompact((v) => !v)}
            >
              {compact ? 'Mostrar campos' : 'Ocultar campos'}
            </Button>
          </div>
        </div>
        <div className="border-t border-border px-4 py-3">
          <RequestFields value={request} onChange={setRequest} touched={touched} hideKindAndOrigin={compact} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Insumos e quanto será consumido"
          description="Digite o “% a consumir” direto na linha do orçamento: a linha entra no QC e o % define a verba puxada (o campo mostra o % ainda livre). Vazio ou 0 tira a linha. No Item ou composição, o % digitado vale para todos os insumos abaixo."
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
          {touched && !selection.size && <Alert tone="warning">Informe o % a consumir de ao menos um insumo do orçamento.</Alert>}
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
