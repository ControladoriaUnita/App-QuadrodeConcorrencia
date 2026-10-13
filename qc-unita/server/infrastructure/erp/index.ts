import { envOption, envValue } from '../env'
import { ErpNotConfiguredError, type ERPProvider } from './erp-provider'
import { MockERPProvider } from './mock-erp-provider'
import { UauERPProvider } from './uau/uau-erp-provider'

export * from './erp-provider'
export { MockERPProvider } from './mock-erp-provider'
export { UauERPProvider } from './uau/uau-erp-provider'

const UAU_VARS = ['UAU_BASE_URL', 'UAU_INTEGRATION_TOKEN', 'UAU_LOGIN', 'UAU_PASSWORD'] as const

/** Provider UAU com credenciais do ambiente (só servidor). Lista as variáveis que faltam, nunca os valores. */
export function createUauProvider(env: NodeJS.ProcessEnv = process.env): UauERPProvider {
  const missing = UAU_VARS.filter((k) => !envValue(k, env))
  if (missing.length) {
    throw new ErpNotConfiguredError('uau', `ERP_PROVIDER=uau, mas faltam variáveis de ambiente no servidor: ${missing.join(', ')}.`)
  }
  return new UauERPProvider({
    baseUrl: envValue('UAU_BASE_URL', env)!,
    integrationToken: envValue('UAU_INTEGRATION_TOKEN', env)!,
    login: envValue('UAU_LOGIN', env)!,
    password: envValue('UAU_PASSWORD', env)!,
  })
}

let cached: ERPProvider | null = null

export function getErpProvider(env: NodeJS.ProcessEnv = process.env): ERPProvider {
  if (cached) return cached
  const kind = envOption('ERP_PROVIDER', env) || 'mock'
  // Senior: aguardando documentação oficial da API
  if (kind === 'senior') throw new ErpNotConfiguredError('senior')
  // Mantém o cliente (e o token da UAU) entre requisições na mesma instância
  cached = kind === 'uau' ? createUauProvider(env) : new MockERPProvider()
  return cached
}
