/**
 * Abstração do ERP (UAU / Senior).
 *
 * Executada exclusivamente no servidor (Vercel Functions). O frontend nunca
 * conhece endpoints nem credenciais do ERP. Todos os valores decimais chegam
 * como string para evitar float.
 */

export interface ErpWork {
  erpId: string
  code: string
  name: string
  clientName?: string | null
  city?: string | null
  state?: string | null
  status: 'not_started' | 'active' | 'completed' | 'archived'
  costCenter?: string | null
}

export interface ErpSupplier {
  erpId: string
  legalName: string
  tradeName?: string | null
  taxId: string // somente dígitos
  contactName?: string | null
  phone?: string | null
  email?: string | null
  cndValidUntil?: string | null
  city?: string | null
  state?: string | null
  active: boolean
}

export interface ErpMaterial {
  erpId?: string
  code: string
  description: string
  unit: string
}

export interface ErpBudget {
  erpId: string
  workErpId: string
  version: number
  description: string
  baseDate: string | null
  groups: { wbs: string; description: string }[]
  activities: { wbs: string; code: string | null; description: string; unit: string | null; quantity: string; unitCost: string }[]
  items: {
    activityWbs: string
    materialCode: string
    quantity: string
    unitCost: string
    packageCode: string | null
    packageDescription: string | null
    /** Chave estável da linha (calculada se ausente) */
    lineKey?: string
    /** Custo total oficial da linha; se ausente, quantidade × unitário */
    total?: string
  }[]
  materials: ErpMaterial[]
}

export interface ErpContractPayload {
  contractRequestId: string
  workErpId: string
  supplierErpId: string
  contractTypeCode: string
  startOn: string
  endOn: string
  items: { materialCode: string; quantity: string; unitPrice: string }[]
}

export interface ERPProvider {
  readonly name: 'mock' | 'uau' | 'senior'
  getWorks(): Promise<ErpWork[]>
  getWork(erpId: string): Promise<ErpWork | null>
  getBudget(workErpId: string): Promise<ErpBudget | null>
  getSuppliers(params?: { updatedSince?: string }): Promise<ErpSupplier[]>
  getMaterials(): Promise<ErpMaterial[]>
  /** Envio futuro de contrato aprovado ao ERP; retorna o id do contrato no ERP. */
  pushContract(payload: ErpContractPayload): Promise<{ erpContractId: string }>
}

export class ErpNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`Provider ERP "${provider}" ainda não implementado — aguardando documentação oficial da API.`)
    this.name = 'ErpNotConfiguredError'
  }
}
