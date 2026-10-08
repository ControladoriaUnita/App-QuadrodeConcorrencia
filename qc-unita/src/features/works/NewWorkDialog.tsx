/**
 * Cadastro manual de obra (obras do ERP chegam pela sincronização). Depois de criada,
 * a obra abre com a importação do orçamento (Excel) pronta.
 */
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { CreateWorkInput } from '@shared/contracts'
import { Alert, Button, Dialog, Field, Input, Select } from '@/components/ui'
import type { ApiError } from '@/lib/api'
import { useCreateWork } from './api'

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']

const formSchema = z
  .object({
    code: z.string().trim().min(1, 'Informe o nº da obra').max(20).regex(/^[\w.-]+$/, 'Use letras, números, ponto ou hífen'),
    name: z.string().trim().min(3, 'Informe o nome da obra').max(200),
    clientName: z.string().trim().max(200),
    city: z.string().trim().max(100),
    state: z.string(),
    costCenter: z.string().trim().max(40),
    status: z.enum(['not_started', 'active']),
    startedOn: z.string(),
    finishedOn: z.string(),
  })
  .refine((v) => !v.startedOn || !v.finishedOn || v.finishedOn >= v.startedOn, { path: ['finishedOn'], message: 'O término deve ser posterior ao início' })
type FormValues = z.infer<typeof formSchema>

const empty: FormValues = { code: '', name: '', clientName: '', city: '', state: '', costCenter: '', status: 'not_started', startedOn: '', finishedOn: '' }
const nul = (v: string) => (v.trim() === '' ? null : v.trim())

export function NewWorkDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const create = useCreateWork()
  const { register, handleSubmit, reset, formState } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: empty })
  useEffect(() => {
    if (open) {
      reset(empty)
      create.reset()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const e = formState.errors
  const error = create.error as ApiError | null

  const submit = handleSubmit(async (v) => {
    const input: CreateWorkInput = {
      code: v.code.trim(),
      name: v.name.trim(),
      clientName: nul(v.clientName),
      city: nul(v.city),
      state: nul(v.state),
      costCenter: nul(v.costCenter),
      status: v.status,
      startedOn: nul(v.startedOn),
      finishedOn: nul(v.finishedOn),
    }
    const { id } = await create.mutateAsync(input)
    onCreated(id)
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="min(94vw, 40rem)"
      title="Nova obra"
      description="Cadastro manual. Obras do ERP são criadas pela sincronização. Em seguida você importa o orçamento (Excel)."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>Criar obra</Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
        {error && (
          <Alert tone="error" title={error.message} className="sm:col-span-4">
            {error.code === 'VALIDATION' && 'Confira os campos destacados.'}
          </Alert>
        )}
        <Field label="Nº da obra" required error={e.code?.message}>
          <Input autoFocus placeholder="2060" {...register('code')} />
        </Field>
        <Field label="Nome da obra" required error={e.name?.message} className="sm:col-span-3">
          <Input placeholder="Residencial …" {...register('name')} />
        </Field>
        <Field label="Cliente / SPE" className="sm:col-span-2">
          <Input {...register('clientName')} />
        </Field>
        <Field label="Centro de custo" className="sm:col-span-2">
          <Input {...register('costCenter')} />
        </Field>
        <Field label="Cidade" className="sm:col-span-3">
          <Input {...register('city')} />
        </Field>
        <Field label="UF">
          <Select {...register('state')}>
            <option value="">—</option>
            {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </Select>
        </Field>
        <Field label="Situação" className="sm:col-span-2">
          <Select {...register('status')}>
            <option value="not_started">Não iniciada</option>
            <option value="active">Ativa (em obra)</option>
          </Select>
        </Field>
        <Field label="Início previsto">
          <Input type="date" {...register('startedOn')} />
        </Field>
        <Field label="Término previsto" error={e.finishedOn?.message}>
          <Input type="date" {...register('finishedOn')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
