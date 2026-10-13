import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuthError } from '@supabase/supabase-js'
import type { UserDTO } from '@shared/contracts'
import { api, getDemoUser, setDemoUser } from './api'
import { isDemoMode, supabase } from './supabase'

interface AuthState {
  user: UserDTO | null
  loading: boolean
  demo: boolean
  hasSession: boolean
  /** E-mail da sessão do Supabase; undefined = ainda verificando a sessão salva no navegador */
  sessionEmail: string | null | undefined
  /** Entrou pelo link de convite ou de "esqueci minha senha" e precisa definir uma nova */
  recovering: boolean
  can: (permission: string) => boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  switchDemoUser: (id: string) => void
}

const Ctx = createContext<AuthState | null>(null)

/** Mensagens do Supabase Auth em português (mesmas do app de Cadastro de Insumos). */
export function authErrorMessage(error: AuthError | Error): string {
  const msg = error.message
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha inválidos.'
  if (/email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado. Peça à Controladoria para confirmar seu usuário.'
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
  if (/password should be at least/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (/same.*password|different from the old/i.test(msg)) return 'A nova senha precisa ser diferente da atual.'
  if (/secret api key/i.test(msg)) return 'Configuração do servidor incorreta: a chave secreta do Supabase foi usada no navegador. Avise a Controladoria.'
  if (/fetch|network/i.test(msg)) return 'Sem conexão com o servidor de login. Verifique a internet.'
  return msg
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [hasSession, setHasSession] = useState(isDemoMode)
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(isDemoMode ? null : undefined)
  // Lido antes de o Supabase consumir o "#…type=recovery" da URL
  const [recovering, setRecovering] = useState(() => /[#&]type=(invite|recovery)/.test(window.location.hash))
  const [demoUser, setDemoUserState] = useState<string | null>(() => getDemoUser())

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session)
      setSessionEmail(data.session?.user.email ?? null)
    })
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setHasSession(!!session)
      setSessionEmail(session?.user.email ?? null)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
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
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(authErrorMessage(error))
  }, [])

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
    setRecovering(false)
    qc.clear()
  }, [qc])

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Login indisponível no modo demonstração.')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/redefinir-senha` })
    if (error) throw new Error(authErrorMessage(error))
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('Login indisponível no modo demonstração.')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw new Error(authErrorMessage(error))
    setRecovering(false)
  }, [])

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
    sessionEmail,
    recovering,
    can: (p) => !!user?.permissions.includes(p),
    signIn,
    signOut,
    requestPasswordReset,
    updatePassword,
    switchDemoUser,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth fora do AuthProvider')
  return v
}
