import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/**
 * Cabeçalho compacto: eyebrow laranja (opcionalmente link de volta) → h1 → descrição; ações à direita.
 * Mantém a hierarquia do DESIGN_SYSTEM §7 ocupando pouca altura, para priorizar as áreas de preenchimento.
 */
export function PageHeader({
  eyebrow,
  backTo,
  title,
  description,
  actions,
  meta,
}: {
  eyebrow?: ReactNode
  /** Quando informado, o eyebrow vira o link de volta */
  backTo?: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        {eyebrow &&
          (backTo ? (
            <Link to={backTo} className="inline-flex items-center gap-1 text-xs font-semibold tracking-wider text-primary uppercase hover:underline">
              <ArrowLeft className="size-3.5" aria-hidden /> {eyebrow}
            </Link>
          ) : (
            <p className="text-xs font-semibold tracking-wider text-primary uppercase">{eyebrow}</p>
          ))}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold text-text">{title}</h1>
          {meta}
        </div>
        {description && <div className="mt-0.5 text-xs text-text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
