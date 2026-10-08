import { ErpNotConfiguredError, type ERPProvider } from './erp-provider'
import { MockERPProvider } from './mock-erp-provider'

export * from './erp-provider'
export { MockERPProvider } from './mock-erp-provider'

/**
 * Esqueleto dos providers reais. Implementar quando a documentação oficial
 * (endpoints, autenticação, paginação, limites) estiver disponível.
 * Credenciais via ERP_BASE_URL / ERP_API_KEY — somente server-side.
 */
class PendingERPProvider implements ERPProvider {
  constructor(readonly name: 'uau' | 'senior') {}
  private fail(): never {
    throw new ErpNotConfiguredError(this.name)
  }
  getWorks() { return Promise.reject(new ErpNotConfiguredError(this.name)) }
  getWork() { return Promise.reject(new ErpNotConfiguredError(this.name)) }
  getBudget() { return Promise.reject(new ErpNotConfiguredError(this.name)) }
  getSuppliers() { return Promise.reject(new ErpNotConfiguredError(this.name)) }
  getMaterials() { return Promise.reject(new ErpNotConfiguredError(this.name)) }
  pushContract(): Promise<{ erpContractId: string }> { return this.fail() }
}

let cached: ERPProvider | null = null

export function getErpProvider(env: NodeJS.ProcessEnv = process.env): ERPProvider {
  if (cached) return cached
  const kind = (env.ERP_PROVIDER ?? 'mock').toLowerCase()
  cached = kind === 'uau' || kind === 'senior' ? new PendingERPProvider(kind) : new MockERPProvider()
  return cached
}
