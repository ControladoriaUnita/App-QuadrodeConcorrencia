import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  required?: boolean
  className?: string
  children: ReactElement<Record<string, unknown>>
}

/** Label + controle + hint/erro com aria-describedby (DESIGN_SYSTEM §6). */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId()
  const describedBy = error || hint ? `${id}-desc` : undefined
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required })
    : children
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-700">
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      {control}
      {(error || hint) && (
        <p id={describedBy} className={cn('text-xs', error ? 'text-error' : 'text-text-muted')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}
