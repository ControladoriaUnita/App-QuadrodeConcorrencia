/**
 * Leitura dos tokens em runtime (gráficos, canvas). Nunca duplicar hex em componentes.
 */
const TOKENS = ['primary', 'secondary', 'info', 'success', 'warning', 'error', 'ink-200', 'ink-400', 'text-muted'] as const
export type ColorToken = (typeof TOKENS)[number]

export function resolveColors(): Record<ColorToken, string> {
  const css = getComputedStyle(document.documentElement)
  return Object.fromEntries(TOKENS.map((t) => [t, css.getPropertyValue(`--color-${t}`).trim()])) as Record<ColorToken, string>
}

/** Ordem de séries (DESIGN_SYSTEM §9) */
export const SERIES_ORDER: ColorToken[] = ['primary', 'secondary', 'info', 'success', 'ink-400']
