import { describe, expect, it } from 'vitest'
import { serviceKeyProblem } from './client'

const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`

describe('chave do service client', () => {
  it('aceita a secreta e a service_role', () => {
    expect(serviceKeyProblem('sb_secret_abc')).toBeNull()
    expect(serviceKeyProblem(` "${jwt('service_role')}" `)).toBeNull()
  })
  it('explica quando colaram a chave pública', () => {
    expect(serviceKeyProblem('sb_publishable_abc')).toMatch(/chave pública/)
    expect(serviceKeyProblem(jwt('anon'))).toMatch(/"anon"/)
    expect(serviceKeyProblem('https://x.supabase.co')).toMatch(/não parece/)
  })
})
