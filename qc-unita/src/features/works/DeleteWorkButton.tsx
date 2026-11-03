/**
 * Excluir obra de vez (administrador): orçamentos, concorrências, contratos, aditivos e anexos.
 * Para confirmar, digita-se o número da obra. Não há como desfazer.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import type { WorkDTO } from '@shared/contracts'
import { Alert, Button, ConfirmDialog, Field, Input } from '@/components/ui'
import { useDeleteWork } from './api'

export function DeleteWorkButton({ work }: { work: Pick<WorkDTO, 'id' | 'code' | 'name'> }) {
  const navigate = useNavigate()
  const del = useDeleteWork(work.id)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const close = () => {
    setOpen(false)
    setCode('')
    del.reset()
  }

  return (
    <>
      <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setOpen(true)}>
        Excluir obra
      </Button>
      <ConfirmDialog
        open={open}
        title={`Excluir a obra ${work.code}?`}
        description={`${work.name} será apagada de vez, com orçamentos, concorrências, contratos, aditivos e anexos. Não há como desfazer: fica só o registro da exclusão na auditoria.`}
        confirmLabel="Excluir de vez"
        tone="danger"
        loading={del.isPending}
        confirmDisabled={code.trim() !== work.code}
        onCancel={close}
        onConfirm={async () => {
          await del.mutateAsync(code)
          close()
          navigate('/obras')
        }}
      >
        <Field label={`Digite o número da obra (${work.code}) para confirmar`}>
          <Input value={code} autoComplete="off" onChange={(e) => setCode(e.target.value)} />
        </Field>
        {code.trim() !== '' && code.trim() !== work.code && <p className="mt-2 text-sm text-error">O número não confere.</p>}
        {del.error && <Alert tone="error" className="mt-3">{(del.error as Error).message}</Alert>}
      </ConfirmDialog>
    </>
  )
}
