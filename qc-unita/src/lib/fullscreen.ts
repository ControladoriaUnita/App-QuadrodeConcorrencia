/**
 * Tela cheia, no mesmo esquema da apresentação de obras (TxC): o app inteiro ocupa a tela e o
 * mesmo botão volta ao normal (Esc também sai, pelo navegador).
 */
import { useEffect, useState } from 'react'

export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {
      // O navegador pode recusar (ex.: fora de um clique do usuário); nada a fazer
    })
  } else {
    void document.exitFullscreen()
  }
}

/** true enquanto o app está em tela cheia (acompanha também o Esc do navegador) */
export function useIsFullscreen(): boolean {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  return on
}
