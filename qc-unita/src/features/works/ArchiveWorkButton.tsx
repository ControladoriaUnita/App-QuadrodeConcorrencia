/**
 * Arquivar / desarquivar obra (administrador). Arquivar tira a obra das listas sem apagar nada:
 * orçamento, concorrências, contratos e histórico continuam como estão.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, ArchiveRestore } from 'lucide-react'
import type { WorkDTO } from '@shared/contracts'
import { Button, ConfirmDialog } from '@/components/ui'
import { useSetWorkArchived } from './api'

export function ArchiveWorkButton({ work }: { work: Pick<WorkDTO, 'id' | 'code' | 'name' | 'archivedAt'> }) {
  const navigate = useNavigate()
  const archive = useSetWorkArchived(work.id)
  const [confirming, setConfirming] = useState(false)

  if (work.archivedAt) {
    return (
      <Button icon={<ArchiveRestore className="size-4" />} loading={archive.isPending} onClick={() => archive.mutate(false)}>
        Desarquivar
      </Button>
    )
  }
  return (
    <>
      <Button variant="ghost" icon={<Archive className="size-4" />} onClick={() => setConfirming(true)}>
        Arquivar obra
      </Button>
      <ConfirmDialog
        open={confirming}
        title={`Arquivar a obra ${work.code}?`}
        description={`${work.name} sai das listas do app. Nada é apagado: orçamento, concorrências, contratos e histórico continuam guardados, e o administrador pode desarquivar na tela inicial (Arquivadas).`}
        confirmLabel="Arquivar"
        loading={archive.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          await archive.mutateAsync(true)
          setConfirming(false)
          navigate('/obras')
        }}
      />
    </>
  )
}
