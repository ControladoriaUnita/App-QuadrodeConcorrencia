import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import logoWhite from '@/assets/brand/logo-unita-white.png'
import { Button } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { cn } from '@/utils/cn'
import { DemoUserSwitcher } from './DemoUserSwitcher'

const NAV = [
  { to: '/obras', label: 'Obras e concorrências' },
  { to: '/fornecedores', label: 'Fornecedores' },
  { to: '/integracao', label: 'Integração ERP', permission: 'integration.read' },
]

/** Header grafite fixo (56px) com borda laranja de 2px — DESIGN_SYSTEM §7. */
export function AppShell() {
  const { user, demo, signOut, can } = useAuth()
  const roleLabel = user?.roles.map((r) => r.roleName).join(' · ')

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b-2 border-primary bg-secondary">
        <div className="flex h-14 items-center gap-6 px-4 lg:px-6 2xl:px-10">
          <NavLink to="/obras" className="shrink-0" aria-label="Início">
            <img src={logoWhite} alt="Unità Engenharia" className="h-7" />
          </NavLink>
          <nav className="flex min-w-0 gap-1 overflow-x-auto" aria-label="Principal">
            {NAV.filter((n) => !n.permission || can(n.permission)).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-control px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                    isActive ? 'bg-white/10 text-white' : 'text-ink-300 hover:text-white',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {demo && <DemoUserSwitcher />}
            {user && (
              <div className="hidden text-right leading-tight sm:block">
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
