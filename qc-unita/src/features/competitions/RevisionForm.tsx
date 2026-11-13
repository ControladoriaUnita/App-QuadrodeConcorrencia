/**
 * Dados do QC: cronograma, verba, responsáveis, pedido (tipo, origem e diretor: escolhem o fluxo de
 * aprovação), tipo de contrato, vencedora e justificativa.
 * React Hook Form + Zod (o mesmo schema validado no servidor).
 */
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Save } from 'lucide-react'
import type { CompetitionDetailDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import type { QcMap } from '@shared/domain/competition/qc-map'
import { REQUEST_KIND_LABEL, REQUEST_ORIGIN_LABEL, type RequestKind, type RequestOrigin } from '@shared/domain/approval/flows'
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from '@/components/ui'
import { useApprovalConfig } from '@/features/approvals/api'
import { formatBRL, formatDate, formatDecimal } from '@/utils/format'

const moneyBR = z
  .string()
  .trim()
  .refine((v) => {
    if (v === '') return true
    try {
      Decimal.parseBR(v)
      return true
    } catch {
      return false
    }
  }, 'Valor inválido — use 1.234,56')

const formSchema = z
  .object({
    serviceStartOn: z.string(),
    serviceEndOn: z.string(),
    engineeringOwnerName: z.string().max(200),
    procurementOwnerName: z.string().max(200),
    requestKind: z.string(),
    origin: z.string(),
    directorId: z.string(),
    budgetUsedAmount: moneyBR,
    budgetAdjustmentAmount: moneyBR,
    contractTypeId: z.string(),
    winnerSupplierId: z.string(),
    winnerJustification: z.string().max(4000),
    engineeringNotes: z.string().max(4000),
    procurementNotes: z.string().max(4000),
  })
  .refine((v) => !v.serviceStartOn || !v.serviceEndOn || v.serviceEndOn >= v.serviceStartOn, {
    path: ['serviceEndOn'],
    message: 'O término deve ser posterior ao início.',
  })
type FormValues = z.infer<typeof formSchema>

const toBR = (v: string) => (Decimal.from(v).isZero() ? '' : formatDecimal(v, 2))
const fromBR = (v: string) => (v.trim() === '' ? '0' : Decimal.parseBR(v).toFixed())
const nul = (v: string) => (v === '' ? null : v)

export function RevisionForm({ detail, map, saving, onSave }: { detail: CompetitionDetailDTO; map: QcMap; saving: boolean; onSave: (v: Record<string, unknown>) => void }) {
  const r = detail.revision
  const c = detail.competition
  const disabled = !detail.can.edit
  const directors = useApprovalConfig().data?.directors ?? []

  const defaults: FormValues = {
    serviceStartOn: r.serviceStartOn ?? '',
    serviceEndOn: r.serviceEndOn ?? '',
    engineeringOwnerName: c.engineeringOwnerName ?? '',
    procurementOwnerName: c.procurementOwnerName ?? '',
    requestKind: c.requestKind ?? '',
    origin: c.origin ?? '',
    directorId: c.directorId ?? '',
    budgetUsedAmount: toBR(r.budgetUsedAmount),
    budgetAdjustmentAmount: toBR(r.budgetAdjustmentAmount),
    contractTypeId: r.contractTypeId ?? '',
    winnerSupplierId: r.winnerSupplierId ?? '',
    winnerJustification: r.winnerJustification ?? '',
    engineeringNotes: r.engineeringNotes ?? '',
    procurementNotes: r.procurementNotes ?? '',
  }
  const { register, handleSubmit, reset, formState } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: defaults })
  const defaultsKey = JSON.stringify(defaults)
  useEffect(() => reset(defaults), [defaultsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = handleSubmit((v) =>
    onSave({
      serviceStartOn: nul(v.serviceStartOn),
      serviceEndOn: nul(v.serviceEndOn),
      engineeringOwnerName: nul(v.engineeringOwnerName.trim()),
      procurementOwnerName: nul(v.procurementOwnerName.trim()),
      requestKind: nul(v.requestKind),
      origin: nul(v.origin),
      directorId: nul(v.directorId),
      budgetUsedAmount: fromBR(v.budgetUsedAmount),
      budgetAdjustmentAmount: fromBR(v.budgetAdjustmentAmount),
      contractTypeId: nul(v.contractTypeId),
      winnerSupplierId: nul(v.winnerSupplierId),
      winnerJustification: nul(v.winnerJustification),
      engineeringNotes: nul(v.engineeringNotes),
      procurementNotes: nul(v.procurementNotes),
    }),
  )
  const e = formState.errors

  return (
    <form onSubmit={submit} className="grid gap-3 xl:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader
          title="Dados da concorrência"
          description={`Solicitada em ${formatDate(c.requestedOn)} · Pacote ${c.packageCode ?? '—'}`}
          actions={
            !disabled && (
              <Button type="submit" variant="primary" size="sm" icon={<Save className="size-4" />} loading={saving} disabled={!formState.isDirty}>
                Salvar
              </Button>
            )
          }
        />
        <CardBody className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Início do serviço" error={e.serviceStartOn?.message}>
            <Input type="date" disabled={disabled} {...register('serviceStartOn')} />
          </Field>
          <Field label="Término do serviço" error={e.serviceEndOn?.message}>
            <Input type="date" disabled={disabled} {...register('serviceEndOn')} />
          </Field>
          <Field label="Engenheiro responsável" error={e.engineeringOwnerName?.message}>
            <Input disabled={disabled} placeholder="Nome do engenheiro" autoComplete="off" {...register('engineeringOwnerName')} />
          </Field>
          <Field label="Suprimentos responsável" error={e.procurementOwnerName?.message}>
            <Input disabled={disabled} placeholder="Nome do responsável" autoComplete="off" {...register('procurementOwnerName')} />
          </Field>
          <Field label="Tipo do pedido">
            <Select disabled={disabled} {...register('requestKind')}>
              <option value="">Não informado</option>
              {(Object.keys(REQUEST_KIND_LABEL) as RequestKind[]).map((k) => <option key={k} value={k}>{REQUEST_KIND_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Origem do pedido">
            <Select disabled={disabled} {...register('origin')}>
              <option value="">Não informada</option>
              {(Object.keys(REQUEST_ORIGIN_LABEL) as RequestOrigin[]).map((k) => <option key={k} value={k}>{REQUEST_ORIGIN_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Diretor aprovador" className="sm:col-span-2" hint="Tipo, origem e diretor escolhem o fluxo de aprovação do envio.">
            <Select disabled={disabled} {...register('directorId')}>
              <option value="">Não informado</option>
              {directors.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
            </Select>
          </Field>
          <Field label="Tipo de contrato" className="sm:col-span-2">
            <Select disabled={disabled} {...register('contractTypeId')}>
              <option value="">Selecione…</option>
              {detail.contractTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Empresa vencedora"
            className="sm:col-span-2"
            hint={
              map.chosen.suppliers.length
                ? 'Opcional: com cotação escolhida, as empresas são as escolhidas no mapa (uma solicitação de contrato por empresa).'
                : 'Total considerando a quantidade equalizada de todos os itens cotados.'
            }
          >
            <Select disabled={disabled} {...register('winnerSupplierId')}>
              <option value="">Selecione…</option>
              {detail.suppliers.map((s) => {
                const sum = map.summaryBySupplier.get(s.id)
                return (
                  <option key={s.id} value={s.supplierId}>
                    {s.tradeName || s.legalName} — {formatBRL(sum?.total)} {sum?.rank ? `(${sum.rank}º)` : sum?.complete === false ? '(proposta incompleta)' : ''}
                  </option>
                )
              })}
            </Select>
          </Field>
          <Field label="Justificativa da escolha" className="sm:col-span-2 lg:col-span-4">
            <Textarea disabled={disabled} rows={2} {...register('winnerJustification')} />
          </Field>
          <Field label="Observações da engenharia" className="sm:col-span-1 lg:col-span-2">
            <Textarea disabled={disabled} rows={2} {...register('engineeringNotes')} />
          </Field>
          <Field label="Observações de suprimentos" className="sm:col-span-1 lg:col-span-2">
            <Textarea disabled={disabled} rows={2} {...register('procurementNotes')} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Verba" description="Verba disponível = orçado − utilizada ± ajustes" />
        <CardBody className="grid gap-3">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-text-muted">Total orçado</dt>
            <dd className="tabular text-right font-medium">{formatBRL(r.budgetAmount)}</dd>
            <dt className="text-text-muted">Verba disponível</dt>
            <dd className="tabular text-right font-semibold">{formatBRL(map.available)}</dd>
          </dl>
          <Field label="Verba já utilizada (R$)" error={e.budgetUsedAmount?.message}>
            <Input inputMode="decimal" className="tabular text-right" placeholder="0,00" disabled={disabled} {...register('budgetUsedAmount')} />
          </Field>
          <Field label="Acréscimos / Reduções (R$)" hint="Use sinal negativo para reduções." error={e.budgetAdjustmentAmount?.message}>
            <Input inputMode="decimal" className="tabular text-right" placeholder="0,00" disabled={disabled} {...register('budgetAdjustmentAmount')} />
          </Field>
          {disabled && <Alert tone="info">Somente revisões em rascunho podem ser editadas.</Alert>}
        </CardBody>
      </Card>
    </form>
  )
}
