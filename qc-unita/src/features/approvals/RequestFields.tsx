/**
 * Pedido da concorrência: material ou mão de obra, origem (obra ou Suprimentos) e diretor aprovador
 * (RT, SR…). Os três escolhem o fluxo de aprovação, mostrado logo abaixo com as etapas.
 */
import type { RequestKind, RequestOrigin } from '@shared/contracts'
import { matchFlow, REQUEST_KIND_LABEL, REQUEST_ORIGIN_LABEL } from '@shared/domain/approval/flows'
import { Field, Select } from '@/components/ui'
import { useApprovalConfig } from './api'

export interface RequestValue {
  requestKind: RequestKind | ''
  origin: RequestOrigin | ''
  directorId: string
}

export const emptyRequest: RequestValue = { requestKind: '', origin: '', directorId: '' }
export const requestComplete = (v: RequestValue) => !!v.requestKind && !!v.origin && !!v.directorId

export function RequestFields({ value, onChange, touched }: { value: RequestValue; onChange: (v: RequestValue) => void; touched: boolean }) {
  const config = useApprovalConfig()
  const directors = (config.data?.directors ?? []).filter((d) => d.active)
  const flow = config.data
    ? matchFlow(config.data.flows, 'competition', {
        origin: value.origin || null,
        requestKind: value.requestKind || null,
        directorId: value.directorId || null,
      })
    : null
  const deviation = config.data
    ? matchFlow(config.data.flows, 'deviation', { origin: value.origin || null, requestKind: value.requestKind || null, directorId: value.directorId || null })
    : null
  const err = (ok: boolean, msg: string) => (touched && !ok ? msg : null)
  const set = (patch: Partial<RequestValue>) => onChange({ ...value, ...patch })

  return (
    <div className="grid gap-3">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tipo do pedido" required error={err(!!value.requestKind, 'Escolha material ou mão de obra')}>
          <Select value={value.requestKind} onChange={(e) => set({ requestKind: e.target.value as RequestKind | '' })}>
            <option value="">Selecione…</option>
            {(Object.keys(REQUEST_KIND_LABEL) as RequestKind[]).map((k) => <option key={k} value={k}>{REQUEST_KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Origem do pedido" required error={err(!!value.origin, 'Escolha quem abriu o pedido')}>
          <Select value={value.origin} onChange={(e) => set({ origin: e.target.value as RequestOrigin | '' })}>
            <option value="">Selecione…</option>
            {(Object.keys(REQUEST_ORIGIN_LABEL) as RequestOrigin[]).map((k) => <option key={k} value={k}>{REQUEST_ORIGIN_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Diretor aprovador" required error={err(!!value.directorId, 'Escolha o diretor que entra no fluxo')}>
          <Select value={value.directorId} onChange={(e) => set({ directorId: e.target.value })} disabled={config.isLoading}>
            <option value="">Selecione…</option>
            {directors.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
          </Select>
        </Field>
      </div>
      <p className="text-xs text-text-muted" aria-live="polite">
        {flow ? (
          <>
            <span className="font-semibold text-ink-700">Fluxo de aprovação: {flow.name}</span>
            {' · '}
            {flow.steps.filter((s) => s.active).map((s) => s.name + (s.minAmount ? ' (pela alçada)' : '')).join(' → ')}
            {deviation && ` · com desvio de custo ou quantidade no mapa, entra também: ${deviation.steps.filter((s) => s.active).map((s) => s.name).join(' → ')}`}
          </>
        ) : config.isLoading ? (
          'Carregando fluxos de aprovação…'
        ) : (
          'Nenhum fluxo de contratação configurado para este pedido: valem as etapas gerais de aprovação.'
        )}
      </p>
    </div>
  )
}
