import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: string
}

/** Modal com <dialog> nativo (DESIGN_SYSTEM §6 — ConfirmDialog). */
export function Dialog({ open, onClose, title, description, children, footer, width = 'min(92vw, 30rem)' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      style={{ width }}
      className="m-auto rounded-card border border-border bg-surface p-0 text-text shadow-overlay"
    >
      {open && (
        <>
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div>
              <h3 className="text-lg font-semibold">{title}</h3>
              {description && <p className="mt-1 text-sm text-ink-600">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded-control p-1 text-ink-500 hover:bg-ink-100" aria-label="Fechar">
              <X className="size-4" />
            </button>
          </div>
          {children && <div className="px-6 pb-5 text-sm text-ink-600">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-ink-50 px-6 py-3">{footer}</div>}
        </>
      )}
    </dialog>
  )
}

interface ConfirmProps {
  open: boolean
  title: ReactNode
  description?: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}

export function ConfirmDialog({ open, title, description, confirmLabel, tone = 'primary', loading, onConfirm, onCancel, children }: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} className="mr-auto">
            Cancelar
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
