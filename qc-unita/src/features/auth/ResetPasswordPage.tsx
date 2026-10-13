import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { Alert, Button, Field, Input, Spinner } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { AuthLayout } from './AuthLayout'

const MIN_LENGTH = 8

/**
 * Destino do link de convite e do "esqueci minha senha". O Supabase abre a sessão
 * a partir do link; aqui a pessoa define a nova senha.
 */
export function ResetPasswordPage() {
  const { recovering, sessionEmail, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_LENGTH) return setError(`Use pelo menos ${MIN_LENGTH} caracteres.`)
    if (password !== confirm) return setError('As duas senhas não são iguais.')
    setLoading(true)
    try {
      await updatePassword(password)
      navigate('/', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (sessionEmail === undefined)
    return (
      <AuthLayout title="Nova senha">
        <div className="flex justify-center py-6 text-primary">
          <Spinner />
        </div>
      </AuthLayout>
    )

  // Sem sessão: o link expirou ou já foi usado
  if (!sessionEmail)
    return (
      <AuthLayout title="Link inválido ou expirado">
        <Alert tone="warning">Peça um novo link em “Esqueci minha senha”. Cada link vale uma vez e por pouco tempo.</Alert>
        <Link to="/entrar" className="mt-4 block">
          <Button className="w-full">Voltar para o login</Button>
        </Link>
      </AuthLayout>
    )

  return (
    <AuthLayout title="Defina sua senha" description={recovering ? `Para ${sessionEmail}.` : `Você está conectado como ${sessionEmail}.`}>
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Nova senha" hint={`Pelo menos ${MIN_LENGTH} caracteres.`}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </Field>
        <Field label="Repita a nova senha">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" loading={loading} icon={<KeyRound className="size-4" />}>
          Salvar nova senha
        </Button>
      </form>
    </AuthLayout>
  )
}
