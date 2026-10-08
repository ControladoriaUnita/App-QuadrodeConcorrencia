import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import logo from '@/assets/brand/logo-unita.png'
import pattern from '@/assets/brand/pattern-un.png'
import { Alert, Button, Card, Field, Input } from '@/components/ui'
import { useAuth } from '@/lib/auth'

/** Tela de entrada: fundo neutro, padrão "Diversos UN" a 7%, logo 48px, card max-w-md p-8. */
export function LoginPage() {
  const { signIn, hasSession } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  if (hasSession) return <Navigate to="/obras" replace />

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-background px-4 py-12">
      <img src={pattern} alt="" aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-32 max-w-none opacity-[0.07]" />
      <div className="relative w-full max-w-md">
        <img src={logo} alt="Unità Engenharia" className="mx-auto mb-8 h-12" />
        <Card className="p-8">
          <h1 className="text-xl font-semibold">Quadro de Concorrência</h1>
          <p className="mt-1 text-sm text-text-muted">Entre com seu e-mail corporativo.</p>
          <form
            className="mt-6 grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setLoading(true)
              setError(null)
              try {
                await signIn(email, password)
              } catch (err) {
                setError((err as Error).message)
              } finally {
                setLoading(false)
              }
            }}
          >
            <Field label="E-mail">
              <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Senha">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            {error && <Alert tone="error">{error}</Alert>}
            <Button type="submit" variant="primary" loading={loading} className="mt-2">
              Entrar
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
