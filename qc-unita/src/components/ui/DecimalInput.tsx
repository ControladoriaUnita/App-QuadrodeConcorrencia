import { useEffect, useState, type KeyboardEvent } from 'react'
import { Decimal } from '@shared/domain/decimal'
import { formatDecimal } from '@/utils/format'
import { cn } from '@/utils/cn'

interface Props {
  /** Valor canônico ("1234.5600") ou null */
  value: string | null
  onCommit: (value: string | null) => void
  fractionDigits?: number
  /** Converte o digitado antes de salvar (ex.: percentual 12,5 → 0.125) */
  scale?: 'ratio' | 'plain'
  allowEmpty?: boolean
  disabled?: boolean
  className?: string
  'aria-label'?: string
  placeholder?: string
  /** Remove zeros à direita além de 2 casas (quantidades) */
  trimZeros?: boolean
  /** Agrupa células para navegação com Enter/↑/↓ */
  gridColumn?: string
  /** Valor máximo aceito (canônico; para scale="ratio", 1 = 100%) */
  max?: string
  /** Sufixo exibido dentro do campo (ex.: "%") */
  suffix?: string
  /** Aceita valores negativos (ex.: quantidade aditiva de redução) */
  allowNegative?: boolean
}

/**
 * Entrada numérica pt-BR sem float: aceita "1.234,56", "1234,56", "R$ 150.000".
 * Exibe formatado quando fora de foco; Enter confirma e desce para a linha seguinte.
 */
export function DecimalInput({ value, onCommit, fractionDigits = 2, scale = 'plain', allowEmpty = true, disabled, className, placeholder = '—', gridColumn, trimZeros, suffix, max, allowNegative, ...aria }: Props) {
  const toDisplay = (v: string | null) => {
    if (v === null || v === '') return ''
    const d = scale === 'ratio' ? Decimal.from(v).times(100) : Decimal.from(v)
    const s = formatDecimal(d, fractionDigits)
    return trimZeros ? s.replace(/(,\d{2}\d*?)0+$/, '$1') : s
  }
  const [text, setText] = useState(toDisplay(value))
  /** Motivo da recusa; enquanto houver, o texto digitado fica no campo (senão voltava calado ao valor anterior) */
  const [error, setError] = useState<string | null>(null)
  const invalid = error !== null
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused && !invalid) setText(toDisplay(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, invalid])

  const commit = () => {
    const raw = text.trim()
    if (raw === '') {
      setError(null)
      if (!allowEmpty) return setText(toDisplay(value))
      if (value !== null) onCommit(null)
      return
    }
    let d: Decimal
    try {
      d = Decimal.parseBR(raw)
    } catch {
      return setError('Valor inválido — use o formato 1.234,56')
    }
    if (d.isNegative() && !allowNegative) return setError('Valor negativo não é aceito')
    if (scale === 'ratio') d = d.div(100, 6)
    if (max !== undefined && d.gt(max)) return setError(`Valor inválido — máximo ${toDisplay(max)}${suffix ?? ''}`)
    setError(null)
    const canonical = d.round(scale === 'ratio' ? 6 : 4).toFixed()
    if (value === null || !Decimal.from(value).eq(canonical)) onCommit(canonical)
    setText(toDisplay(canonical))
  }

  const move = (e: KeyboardEvent<HTMLInputElement>, dir: 1 | -1) => {
    if (!gridColumn) return
    const all = Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-grid-col="${gridColumn}"]`))
    const next = all[all.indexOf(e.currentTarget) + dir]
    if (next) {
      e.preventDefault()
      next.focus()
      next.select()
    }
  }

  const input = (
    <input
      type="text"
      inputMode="decimal"
      data-grid-col={gridColumn}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      title={error ?? undefined}
      onFocus={(e) => {
        setFocused(true)
        e.currentTarget.select()
      }}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
          move(e, 1)
        } else if (e.key === 'ArrowDown') move(e, 1)
        else if (e.key === 'ArrowUp') move(e, -1)
        else if (e.key === 'Escape') {
          setText(toDisplay(value))
          setError(null)
          e.currentTarget.blur()
        }
      }}
      className={cn(
        'tabular h-8 w-full rounded-control border border-transparent bg-transparent px-2 text-right text-sm text-text placeholder:text-ink-300',
        'hover:border-border focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20',
        'disabled:cursor-default disabled:hover:border-transparent',
        invalid && 'border-error bg-error-soft',
        suffix && 'pr-6',
        className,
      )}
      {...aria}
    />
  )
  if (!suffix) return input
  return (
    <span className="relative block">
      {input}
      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-text-muted" aria-hidden>
        {suffix}
      </span>
    </span>
  )
}
