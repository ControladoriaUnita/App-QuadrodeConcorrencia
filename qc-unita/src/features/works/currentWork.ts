/**
 * Obra em uso: a da URL (/obras/:workId/...) ou, fora dela, a última aberta neste navegador.
 * Guardada só como conveniência (localStorage pode estar bloqueado — tudo funciona sem ele).
 */
import { useEffect } from 'react'
import { useMatch } from 'react-router-dom'

const KEY = 'qc.lastWorkId'

export function getLastWorkId(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLastWorkId(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch {
    /* sem armazenamento: segue sem lembrar a obra */
  }
}

/** Abas da obra, na ordem do fluxo: orçamento → concorrências → contratos. */
export const workPath = {
  budget: (id: string) => `/obras/${id}/orcamento`,
  competitions: (id: string) => `/obras/${id}/concorrencias`,
  newCompetition: (id: string) => `/obras/${id}/concorrencias/nova`,
  competition: (id: string, qcId: string) => `/obras/${id}/qc/${qcId}`,
  contracts: (id: string) => `/obras/${id}/contratos`,
  contract: (id: string, contractId: string) => `/obras/${id}/contratos/${contractId}`,
}

/** Obra da URL, lembrada como a última usada. */
export function useCurrentWorkId(): string | null {
  const m = useMatch('/obras/:workId/*')
  const fromUrl = m?.params.workId ?? null
  useEffect(() => {
    if (fromUrl) setLastWorkId(fromUrl)
  }, [fromUrl])
  return fromUrl ?? getLastWorkId()
}
