import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Building2, LogOut } from 'lucide-react'
import logoWhite from '@/assets/brand/logo-unita-white.png'
import { Button } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { cn } from '@/utils/cn'
import { useWorks } from '@/features/competitions/api'
import { useCurrentWorkId, workPath } from '@/features/works/currentWork'
import { DemoUserSwitcher } from './DemoUserSwitcher'

interface NavItem {
  label: string
  /** Destino; null = depende de uma obra selecionada */
  to: string | null
  /** Prefixos de rota que deixam a aba ativa */
  match: RegExp
  permission?: string
}

/**
 * Header grafite fixo (56px) com borda laranja de 2px — DESIGN_SYSTEM §7.
 * Abas na ordem do fluxo de criação: Orçamento → Concorrências → Fornecedores → Contratos e aditivos → Integração.
 */
export function AppShell() {
  const { user, demo, signOut, can } = useAuth()
  const roleLabel = user?.roles.map((r) => r.roleName).join(' · ')
  const workId = useCurrentWorkId()
  const works = useWorks()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const known = works.data?.some((w) => w.id === workId)
  const wid = known ? workId : null

  const nav: NavItem[] = [
    { label: 'Orçamento', to: wid && workPath.budget(wid), match: /^\/obras\/[^/]+\/orcamento/ },
    { label: 'Concorrências', to: wid && workPath.competitions(wid), match: /^\/obras\/[^/]+\/(concorrencias|qc)|^\/concorrencias/ },
    { label: 'Fornecedores', to: '/fornecedores', match: /^\/fornecedores/ },
    { label: 'Consulta UAU', to: '/consulta-uau', match: /^\/consulta-uau/, permission: 'budget.read' },
    { label: 'De-para', to: '/de-para', match: /^\/de-para/, permission: 'catalog.manage' },
    { label: 'Contratos e aditivos', to: wid && workPath.contracts(wid), match: /^\/obras\/[^/]+\/contratos/, permission: 'contract.read' },
    { label: 'Integração ERP', to: '/integracao', match: /^\/integracao/, permission: 'integration.read' },
  ]

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b-2 border-primary bg-secondary">
        <div className="flex h-14 items-center gap-4 px-4 lg:px-6 2xl:px-10">
          <NavLink to="/" className="shrink-0" aria-label="Início">
            <img src={logoWhite} alt="Unità Engenharia" className="h-7" />
          </NavLink>

          {/* Obra em uso: as abas abaixo trabalham sobre ela */}
          <label className="flex min-w-0 shrink items-center gap-2 rounded-control bg-white/10 pl-2.5 text-sm text-white">
            <Building2 className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="sr-only">Obra</span>
            <select
              aria-label="Obra"
              className="h-8 max-w-48 min-w-0 cursor-pointer truncate bg-transparent pr-2 font-medium text-white outline-none [&>option]:text-text"
              value={wid ?? ''}
              onChange={(e) => {
                const id = e.target.value
                if (!id) return navigate('/obras')
                // Mantém a aba atual ao trocar de obra
                const tab = /\/(concorrencias|qc)/.test(pathname) ? workPath.competitions(id) : /\/contratos/.test(pathname) ? workPath.contracts(id) : workPath.budget(id)
                navigate(tab)
              }}
            >
              <option value="">{works.isLoading ? 'Carregando…' : 'Todas as obras…'}</option>
              {works.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
          </label>

          <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" aria-label="Principal">
            {nav
              .filter((n) => !n.permission || can(n.permission))
              .map((n, i) => {
                const active = n.match.test(pathname)
                const content = (
                  <>
                    <span className={cn('tabular mr-1.5 text-[11px]', active ? 'text-primary' : 'text-ink-500')}>{i + 1}</span>
                    {n.label}
                  </>
                )
                const cls = 'inline-flex items-center rounded-control px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors'
                return n.to ? (
                  <NavLink key={n.label} to={n.to} aria-current={active ? 'page' : undefined} className={cn(cls, active ? 'bg-white/10 text-white' : 'text-ink-300 hover:text-white')}>
                    {content}
                  </NavLink>
                ) : (
                  <span key={n.label} className={cn(cls, 'cursor-not-allowed text-ink-500')} title="Selecione uma obra">
                    {content}
                  </span>
                )
              })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            {demo && <DemoUserSwitcher />}
            {user && (
              <div className="hidden text-right leading-tight 2xl:block">
                <p className="text-sm font-semibold text-white">{user.fullName}</p>
                <p className="text-xs text-ink-400">{roleLabel}</p>
              </div>
            )}
            {!demo && (
              <Button variant="inverse" size="sm" icon={<LogOut className="size-4" />} onClick={signOut}>
                Sair
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="px-4 pt-4 pb-8 lg:px-6 2xl:px-10">
        <Outlet />
      </main>
    </div>
  )
}
