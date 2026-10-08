/**
 * Formulário da Solicitação de Contrato — seções da aba "Solic. Contrato":
 * 1. Informações gerais (dados iniciais, contratado, 2º contratado, tipo, distribuição, validade),
 * 3. Projetos, 4. Escopo técnico, 5. Materiais com faturamento direto, 6. Critérios de medição, Observações.
 */
import { useEffect, type ReactNode } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { Plus, Save, Trash2 } from 'lucide-react'
import type { ContractPartyDTO, ContractRequestDTO, UpdateContractRequestInput } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from '@/components/ui'
import { useSuppliers } from '@/features/competitions/api'
import { cn } from '@/utils/cn'
import { formatBRL, formatDate, formatPercent, formatRevision, formatTaxId } from '@/utils/format'

interface FormValues {
  contractTypeId: string
  secondSupplierId: string
  startOn: string
  endOn: string
  projects: { sheet: string; fileName: string; revision: string }[]
  scopeDefinitions: string
  directBillingMaterials: string
  measurementCriteria: string
  notes: string
}

const nul = (v: string) => (v.trim() === '' ? null : v.trim())

export function ContractForm({ c, saving, onSave }: { c: ContractRequestDTO; saving: boolean; onSave: (v: UpdateContractRequestInput) => void }) {
  const disabled = !c.can.edit
  const suppliers = useSuppliers()
  const defaults: FormValues = {
    contractTypeId: c.contractType.id,
    secondSupplierId: c.secondSupplier?.id ?? '',
    startOn: c.startOn,
    endOn: c.endOn,
    projects: c.projects,
    scopeDefinitions: c.scopeDefinitions ?? '',
    directBillingMaterials: c.directBillingMaterials ?? '',
    measurementCriteria: c.measurementCriteria ?? '',
    notes: c.notes ?? '',
  }
  const { register, handleSubmit, reset, watch, control, formState } = useForm<FormValues>({ defaultValues: defaults })
  const projects = useFieldArray({ control, name: 'projects' })
  const defaultsKey = JSON.stringify(defaults)
  useEffect(() => reset(defaults), [defaultsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const typeId = watch('contractTypeId')
  const directBilling = c.contractTypes.find((t) => t.id === typeId)?.directBilling ?? c.contractType.directBilling
  const issue = (field: string) => c.issues.find((i) => i.field === field)?.message

  const submit = handleSubmit((v) =>
    onSave({
      contractTypeId: v.contractTypeId,
      secondSupplierId: v.secondSupplierId || null,
      startOn: v.startOn,
      endOn: v.endOn,
      projects: v.projects.filter((p) => p.fileName.trim()).map((p) => ({ sheet: p.sheet.trim(), fileName: p.fileName.trim(), revision: p.revision.trim() })),
      scopeDefinitions: nul(v.scopeDefinitions),
      directBillingMaterials: nul(v.directBillingMaterials),
      measurementCriteria: nul(v.measurementCriteria),
      notes: nul(v.notes),
    }),
  )

  return (
    <form onSubmit={submit} className="grid gap-3">
      <Card>
        <CardHeader
          title="1. Informações gerais"
          description={`Gerada da ${formatRevision(c.revision.number)} aprovada de ${c.competition.code} em ${formatDate(c.createdAt.slice(0, 10))}${c.createdByName ? ` por ${c.createdByName}` : ''}`}
          actions={
            !disabled && (
              <Button type="submit" variant="primary" size="sm" icon={<Save className="size-4" />} loading={saving} disabled={!formState.isDirty}>
                Salvar
              </Button>
            )
          }
        />
        <CardBody className="grid gap-4">
          <Section title="1.1 Dados iniciais">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Obra" value={`${c.work.code} · ${c.work.name}`} />
              <Info label="Nº da solicitação de cotação" value={`${c.competition.code} · ${formatRevision(c.revision.number)}`} />
              <Info label="Solicitante" value={c.competition.procurementOwnerName ?? '—'} />
              <Info label="Verba orçamentária (QC)" value={formatBRL(c.budgetAmount)} numeric />
            </dl>
            <p className="mt-2 text-sm">
              <span className="text-text-muted">1.2 Objeto do contrato: </span>
              <span className="font-medium">{c.competition.title}</span>
            </p>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="1.3 Dados do contratado">
              <Party p={c.supplier} />
            </Section>
            <Section title="1.4 Dados do 2º contratado" hint="Caso haja faturamento por medição para mais de uma empresa.">
              <Field label="Fornecedor" error={issue('secondSupplierId')}>
                <Select disabled={disabled} {...register('secondSupplierId')}>
                  <option value="">Sem 2º contratado</option>
                  {(suppliers.data ?? [])
                    .filter((s) => s.id !== c.supplier.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>{s.tradeName || s.legalName} — {formatTaxId(s.taxId)}</option>
                    ))}
                </Select>
              </Field>
              {c.secondSupplier && <Party p={c.secondSupplier} className="mt-2" />}
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto]">
            <Section title="1.5 Tipo de contrato">
              <Select disabled={disabled} aria-label="Tipo de contrato" {...register('contractTypeId')}>
                {c.contractTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
                ))}
              </Select>
              {directBilling && <Badge tone="info" className="mt-1.5">Com faturamento direto — preencha a seção 5</Badge>}
            </Section>
            <Section title="1.6 Distribuição do contrato">
              <div className="tabular flex h-10 items-center gap-4 text-sm">
                <span>Material <strong>{formatPercent(c.pctMaterial, 1)}</strong></span>
                <span>Equipamento <strong>{formatPercent(c.pctEquipment, 1)}</strong></span>
                <span>MDO/Serviço <strong>{formatPercent(c.pctService, 1)}</strong></span>
              </div>
            </Section>
            <Section title="1.7 Validade do contrato">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Início" error={issue('startOn')}>
                  <Input type="date" disabled={disabled} {...register('startOn', { required: true })} />
                </Field>
                <Field label="Término" error={issue('endOn')}>
                  <Input type="date" disabled={disabled} {...register('endOn', { required: true })} />
                </Field>
              </div>
            </Section>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="3. Relação de projetos pertinentes à execução"
          actions={
            !disabled && (
              <Button size="sm" icon={<Plus className="size-4" />} onClick={() => projects.append({ sheet: '', fileName: '', revision: '' })}>
                Adicionar projeto
              </Button>
            )
          }
        />
        <CardBody className="py-3">
          {projects.fields.length === 0 ? (
            <p className="text-sm text-text-muted">Nenhum projeto informado.</p>
          ) : (
            <div className="grid gap-2">
              <div className="grid grid-cols-[8rem_1fr_6rem_2rem] gap-2 text-xs font-semibold text-text-muted">
                <span>Nº da folha</span>
                <span>Nome do arquivo</span>
                <span>Revisão</span>
                <span />
              </div>
              {projects.fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[8rem_1fr_6rem_2rem] items-center gap-2">
                  <Input className="h-9" disabled={disabled} aria-label="Nº da folha" {...register(`projects.${i}.sheet`)} />
                  <Input className="h-9" disabled={disabled} aria-label="Nome do arquivo" {...register(`projects.${i}.fileName`)} />
                  <Input className="h-9" disabled={disabled} aria-label="Revisão" {...register(`projects.${i}.revision`)} />
                  {!disabled && (
                    <button type="button" className="rounded-control p-1.5 text-ink-500 hover:bg-error-soft hover:text-error" aria-label="Remover projeto" onClick={() => projects.remove(i)}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="grid gap-4 lg:grid-cols-2">
          <Field label="4. Escopo e definições técnicas para execução dos serviços" className="lg:col-span-2">
            <Textarea rows={4} disabled={disabled} {...register('scopeDefinitions')} />
          </Field>
          <Field
            label="5. Materiais faturados diretamente à contratante"
            hint={directBilling ? 'Obrigatório para contratos com faturamento direto (CTD04/CTD10).' : 'Somente para contratos com faturamento direto (CTD04/CTD10).'}
            error={issue('directBillingMaterials')}
          >
            <Textarea rows={4} disabled={disabled || !directBilling} {...register('directBillingMaterials')} />
          </Field>
          <Field label="6. Critérios de medição" hint="Critérios, datas e fluxos da medição dos serviços." required error={issue('measurementCriteria')}>
            <Textarea rows={4} disabled={disabled} {...register('measurementCriteria')} />
          </Field>
          <Field label="Observações" className="lg:col-span-2">
            <Textarea rows={2} disabled={disabled} {...register('notes')} />
          </Field>
        </CardBody>
      </Card>
    </form>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-700 uppercase">{title}</h4>
      {hint && <p className="-mt-1 mb-1.5 text-xs text-text-muted">{hint}</p>}
      {children}
    </section>
  )
}

function Info({ label, value, numeric }: { label: string; value: ReactNode; numeric?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={cn('truncate font-medium', numeric && 'tabular')}>{value}</dd>
    </div>
  )
}

function Party({ p, className }: { p: ContractPartyDTO; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-2 rounded-control bg-ink-50 px-3 py-2 text-sm sm:grid-cols-2', className)}>
      <div className="sm:col-span-2">
        <dt className="text-xs text-text-muted">Razão social</dt>
        <dd className="font-medium">{p.legalName}{p.tradeName && <span className="font-normal text-text-muted"> · {p.tradeName}</span>}</dd>
      </div>
      <Info label="CNPJ" value={formatTaxId(p.taxId)} numeric />
      <Info label="Contato" value={p.contactName ?? '—'} />
      <Info label="Tel/Cel" value={p.phone ?? '—'} />
      <Info label="E-mail" value={p.email ?? '—'} />
      <Info label="Validade CND" value={formatDate(p.cndValidUntil)} />
      <Info label="Código no ERP" value={p.erpId ?? '—'} />
    </dl>
  )
}
