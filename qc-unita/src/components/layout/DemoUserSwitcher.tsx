import { useQuery } from '@tanstack/react-query'
import { UserRound } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'

/** Modo demonstração: alterna o usuário para exercitar papéis e o fluxo de aprovação. */
export function DemoUserSwitcher() {
  const { user, switchDemoUser } = useAuth()
  const users = useQuery({ queryKey: ['demo-users'], queryFn: () => api<{ id: string; fullName: string }[]>('/demo-users'), staleTime: Infinity })
  if (!users.data) return null
  return (
    <label className="flex items-center gap-2 rounded-control bg-white/10 px-2 py-1 text-xs text-ink-200">
      <UserRound className="size-3.5" aria-hidden />
      <span className="hidden md:inline">Demonstração — entrar como</span>
      <select
        value={user?.id ?? ''}
        onChange={(e) => switchDemoUser(e.target.value)}
        className="rounded bg-transparent text-xs font-medium text-white focus:outline-none [&>option]:text-text"
      >
        {users.data.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName}
          </option>
        ))}
      </select>
    </label>
  )
}
