/**
 * Select pesquisável (padrão ARIA "combobox" com listbox): digita para filtrar, ↑/↓ navega,
 * Enter escolhe, Esc fecha. Mesmo visual do Input/Select. A lista usa posição fixa para não ser
 * cortada por diálogos ou cards com rolagem.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/utils/cn'
import { fold, matchesTerms, searchTerms } from '@/utils/search'
import { controlClass } from './Input'
import { Spinner } from './Spinner'

export interface ComboboxOption {
  value: string
  label: string
  /** Texto secundário (linha de baixo) */
  hint?: ReactNode
  /** Texto curto à direita (ex.: valor, situação) */
  aside?: ReactNode
  disabled?: boolean
  /** Termos extras para a busca, além do rótulo */
  keywords?: string
}

export interface ComboboxProps {
  options: ComboboxOption[]
  value: string | null
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  loadingText?: string
  emptyText?: string
  /** Máximo de opções desenhadas de uma vez (a busca refina o restante) */
  maxResults?: number
  /** Busca no servidor: recebe o texto digitado (as opções chegam já filtradas) */
  onQueryChange?: (query: string) => void
  className?: string
  id?: string
  required?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}


interface Popup {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Selecione…',
  disabled,
  loading,
  loadingText = 'Carregando…',
  emptyText = 'Nenhuma opção encontrada',
  maxResults = 100,
  onQueryChange,
  className,
  id: idProp,
  required,
  ...aria
}: ComboboxProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const listId = `${id}-list`
  const optionId = (i: number) => `${id}-opt-${i}`
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [popup, setPopup] = useState<Popup | null>(null)

  const selected = options.find((o) => o.value === value) ?? null
  const matches = useMemo(() => {
    const terms = searchTerms(query)
    if (!terms.length || onQueryChange) return options
    return options.filter((o) => matchesTerms(fold(`${o.label} ${o.keywords ?? ''}`), terms))
  }, [options, query, onQueryChange])
  useEffect(() => {
    if (!onQueryChange) return
    const t = setTimeout(() => onQueryChange(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query, onQueryChange])
  const shown = matches.slice(0, maxResults)

  const firstEnabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < shown.length; i += step) if (!shown[i]!.disabled) return i
    return -1
  }

  const openList = () => {
    if (disabled || open) return
    setQuery('')
    setOpen(true)
    const current = options.findIndex((o) => o.value === value)
    setActive(current >= 0 && current < maxResults ? current : -1)
  }
  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const choose = (o: ComboboxOption | undefined) => {
    if (!o || o.disabled) return
    onChange(o.value)
    close()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        if (!open) return openList()
        const step = e.key === 'ArrowDown' ? 1 : -1
        const next = firstEnabled(active < 0 ? (step === 1 ? 0 : shown.length - 1) : active + step, step)
        if (next >= 0) setActive(next)
        return
      }
      case 'Home':
      case 'End':
        if (!open) return
        e.preventDefault()
        setActive(e.key === 'Home' ? firstEnabled(0, 1) : firstEnabled(shown.length - 1, -1))
        return
      case 'Enter':
        if (!open) return
        e.preventDefault()
        // Sem opção destacada (acabou de digitar): escolhe a primeira que estiver disponível
        choose(shown[active >= 0 ? active : firstEnabled(0, 1)])
        return
      case 'Escape':
        // Não deixa o Esc fechar o diálogo que contém o campo
        if (open) {
          e.preventDefault()
          e.stopPropagation()
          close()
        }
        return
      case 'Tab':
        close()
    }
  }

  // Posição da lista (abaixo do campo; acima, quando não cabe) e reposiciona ao rolar/redimensionar
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom - 8
      const above = r.top - 8
      const up = below < 200 && above > below
      setPopup({
        left: r.left,
        width: r.width,
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        maxHeight: Math.min(320, up ? above : below),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  return (
    <div className={cn('relative', className)}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-busy={loading || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        placeholder={loading ? loadingText : selected ? selected.label : placeholder}
        value={open ? query : (selected?.label ?? '')}
        onChange={(e) => {
          if (!open) openList()
          setQuery(e.target.value)
          setActive(-1)
        }}
        onFocus={openList}
        onClick={openList}
        onBlur={close}
        onKeyDown={onKeyDown}
        className={cn(controlClass, 'h-10 truncate pr-9')}
        {...aria}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-400">
        {loading ? <Spinner className="size-4" /> : <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />}
      </span>
      {open && popup && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          style={{ position: 'fixed', left: popup.left, width: popup.width, top: popup.top, bottom: popup.bottom, maxHeight: popup.maxHeight }}
          className="z-50 overflow-auto rounded-control border border-border bg-surface py-1 text-sm shadow-overlay"
          // Mantém o foco no campo ao clicar na lista
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading ? (
            <li className="flex items-center gap-2 px-3 py-2 text-text-muted">
              <Spinner className="size-4" /> {loadingText}
            </li>
          ) : shown.length === 0 ? (
            <li className="px-3 py-2 text-text-muted">{emptyText}</li>
          ) : (
            shown.map((o, i) => (
              <li
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                onMouseMove={() => !o.disabled && active !== i && setActive(i)}
                onClick={() => choose(o)}
                className={cn(
                  'flex cursor-pointer items-start gap-3 px-3 py-1.5',
                  i === active && 'bg-primary-soft',
                  o.value === value && 'font-medium text-primary',
                  o.disabled && 'cursor-not-allowed opacity-55',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs font-normal text-text-muted">{o.hint}</span>}
                </span>
                {o.aside && <span className="shrink-0 text-xs font-normal text-text-muted">{o.aside}</span>}
              </li>
            ))
          )}
          {!loading && matches.length > shown.length && (
            <li className="border-t border-border px-3 py-1.5 text-xs text-text-muted">
              Mostrando {shown.length} de {matches.length} — digite para refinar
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
