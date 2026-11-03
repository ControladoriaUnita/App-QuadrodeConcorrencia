/**
 * Simulado (administrador): apaga as concorrências e contratos da obra (o orçamento fica) e cria uma
 * concorrência em cada estágio do app, a partir do orçamento dela. Os cenários rodam um a um (cada
 * chamada cabe no tempo da função), com o andamento na tela.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CircleDashed, FlaskConical, Loader2 } from 'lucide-react'
import type { WorkDTO } from '@shared/contracts'
import { Alert, Button, Dialog, Field, Input } from '@/components/ui'
import { api } from '@/lib/api'
import { useSimulationScenarios } from './api'

type Step = { status: 'pending' | 'running' | 'ok' | 'error'; code?: string; competitionId?: string; message?: string }

export function SimulationButton({ work }: { work: Pick<WorkDTO, 'id' | 'code' | 'name'> }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [steps, setSteps] = useState<Record<string, Step>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const scenarios = useSimulationScenarios(work.id, open)

  const close = () => {
    if (phase === 'running') return
    setOpen(false)
    setCode('')
    setPhase('idle')
    setSteps({})
    setFailure(null)
  }

  const run = async () => {
    const list = scenarios.data ?? []
    setFailure(null)
    setPhase('running')
    setSteps(Object.fromEntries(list.map((s) => [s.key, { status: 'pending' } as Step])))
    try {
      await api(`/works/${work.id}/simulation/reset`, { method: 'POST', body: { confirmCode: code } })
    } catch (err) {
      setFailure((err as Error).message)
      setPhase('idle')
      return
    }
    for (const s of list) {
      setSteps((prev) => ({ ...prev, [s.key]: { status: 'running' } }))
      try {
        const r = await api<{ code: string; competitionId: string }>(`/works/${work.id}/simulation/run`, { method: 'POST', body: { scenario: s.key } })
        setSteps((prev) => ({ ...prev, [s.key]: { status: 'ok', code: r.code, competitionId: r.competitionId } }))
      } catch (err) {
        // Um cenário que não cabe no orçamento (ex.: alçada da Diretoria) não impede os demais
        setSteps((prev) => ({ ...prev, [s.key]: { status: 'error', message: (err as Error).message } }))
      }
    }
    for (const key of [['competitions'], ['contracts'], ['works'], ['work-overview', work.id]]) qc.invalidateQueries({ queryKey: key })
    setPhase('done')
  }

  const ok = Object.values(steps).filter((s) => s.status === 'ok').length
  return (
    <>
      <Button variant="ghost" icon={<FlaskConical className="size-4" />} onClick={() => setOpen(true)}>
        Gerar simulado
      </Button>
      <Dialog
        open={open}
        onClose={close}
        width="min(92vw, 42rem)"
        title={`Simulado na obra ${work.code}`}
        description={
          phase === 'done'
            ? `${ok} de ${scenarios.data?.length ?? 0} cenários gerados.`
            : 'Apaga as concorrências, contratos, aditivos e anexos desta obra (a obra e o orçamento ficam) e cria uma concorrência em cada estágio, a partir do orçamento dela.'
        }
        footer={
          phase === 'done' ? (
            <Button variant="primary" className="ml-auto" onClick={close}>
              Fechar
            </Button>
          ) : (
            <>
              <Button variant="ghost" className="mr-auto" disabled={phase === 'running'} onClick={close}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                icon={<FlaskConical className="size-4" />}
                loading={phase === 'running'}
                disabled={code.trim() !== work.code || !scenarios.data?.length}
                onClick={run}
              >
                Apagar e gerar
              </Button>
            </>
          )
        }
      >
        {scenarios.error && <Alert tone="error">{(scenarios.error as Error).message}</Alert>}
        <ol className="grid gap-1.5 text-sm" aria-label="Cenários do simulado">
          {(scenarios.data ?? []).map((s) => {
            const st = steps[s.key]
            return (
              <li key={s.key} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  {st?.status === 'ok' ? (
                    <CheckCircle2 className="size-4 text-success" aria-label="Gerado" />
                  ) : st?.status === 'error' ? (
                    <AlertTriangle className="size-4 text-warning" aria-label="Não gerado" />
                  ) : st?.status === 'running' ? (
                    <Loader2 className="size-4 animate-spin text-primary" aria-label="Gerando" />
                  ) : (
                    <CircleDashed className="size-4 text-ink-300" aria-hidden />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="text-text">{s.label}</span>
                  {st?.status === 'ok' && st.competitionId && (
                    <>
                      {' · '}
                      <Link className="font-semibold text-primary hover:underline" to={`/obras/${work.id}/qc/${st.competitionId}`} onClick={close}>
                        {st.code}
                      </Link>
                    </>
                  )}
                  {st?.status === 'error' && <span className="block text-xs text-warning">{st.message}</span>}
                </span>
              </li>
            )
          })}
        </ol>
        {phase === 'idle' && (
          <Field label={`Digite o número da obra (${work.code}) para confirmar`} className="mt-4">
            <Input value={code} autoComplete="off" onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        {failure && <Alert tone="error" className="mt-3">{failure}</Alert>}
      </Dialog>
    </>
  )
}
