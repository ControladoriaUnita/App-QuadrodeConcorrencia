import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** tailwind-merge ciente dos tokens Unità (evita confundir text-text-muted com tamanho de fonte). */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'primary', 'primary-hover', 'primary-soft', 'primary-foreground', 'secondary', 'secondary-foreground',
        'background', 'surface', 'border', 'text', 'text-muted',
        'success', 'success-soft', 'warning', 'warning-soft', 'error', 'error-soft', 'info', 'info-soft',
        'cell-manual', 'cell-issued', 'cell-current-period',
        'consumption-contracted', 'consumption-approval', 'consumption-quoting',
        'ink-50', 'ink-100', 'ink-200', 'ink-300', 'ink-400', 'ink-500', 'ink-600', 'ink-700', 'ink-800', 'ink-900',
        'brand-orange', 'brand-orange-line', 'brand-black', 'brand-ink',
      ],
      radius: ['control', 'card'],
      shadow: ['card', 'overlay'],
      font: ['display', 'sans'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
