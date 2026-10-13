import type { ReactNode } from 'react'
import logo from '@/assets/brand/logo-unita.png'
import pattern from '@/assets/brand/pattern-un.png'
import { Card } from '@/components/ui'

/** Tela de entrada (DESIGN_SYSTEM §7), igual à do app de Cadastro de Insumos: fundo neutro, padrão "Diversos UN" a 7%, logo 48px, card max-w-md p-8. */
export function AuthLayout({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Padrão "Diversos UN" repetido na horizontal para cobrir toda a largura da parte inferior */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-repeat-x bg-[length:auto_100%] opacity-[0.07]"
        style={{ backgroundImage: `url(${pattern})` }}
      />
      <div className="relative w-full max-w-md">
        <img src={logo} alt="Unità Engenharia" className="mx-auto mb-8 h-12" />
        <Card className="p-8">
          <p className="text-xs font-semibold tracking-wider text-primary uppercase">Quadro de Concorrência</p>
          <h1 className="mt-1 text-xl font-semibold">{title}</h1>
          {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </div>
  )
}
