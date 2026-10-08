import type { ReactNode } from 'react'
import symbol from '@/assets/brand/symbol-un-orange.png'

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <img src={symbol} alt="" className="h-8 opacity-30" />
      <h3 className="mt-4 font-sans text-base font-semibold text-text">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
