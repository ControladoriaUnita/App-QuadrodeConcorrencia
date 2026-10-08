import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UserDTO } from '@shared/contracts'
import { api, getDemoUser, setDemoUser } from './api'
import { isDemoMode, supabase } from './supabase'

interface AuthState {
  user: UserDTO | null
  loading: boolean
  demo: boolean
  hasSession: boolean
  can: (permission: string) => boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  switchDemoUser: (id: string) => void
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [hasSession, setHasSession] = useState(isDemoMode)
  const [demoUser, setDemoUserState] = useState<string | null>(() => getDemoUser())

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session)
      qc.invalidateQueries()
    })
    return () => data.subscription.unsubscribe()
  }, [qc])

  const me = useQuery({
    queryKey: ['me', isDemoMode ? demoUser : 'session'],
    queryFn: () => api<{ user: UserDTO }>('/me'),
    enabled: hasSession,
    retry: false,
  })

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos.' : error.message)
  }, [])

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
    qc.clear()
  }, [qc])

  const switchDemoUser = useCallback(
    (id: string) => {
      setDemoUser(id)
      setDemoUserState(id)
      qc.invalidateQueries()
    },
    [qc],
  )

  const user = me.data?.user ?? null
  const value: AuthState = {
    user,
    loading: hasSession && me.isLoading,
    demo: isDemoMode,
    hasSession,
    can: (p) => !!user?.permissions.includes(p),
    signIn,
    signOut,
    switchDemoUser,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth fora do AuthProvider')
  return v
}
