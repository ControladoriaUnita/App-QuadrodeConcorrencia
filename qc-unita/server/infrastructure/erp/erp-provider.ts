/**
 * Abstração do ERP (UAU / Senior).
 *
 * Executada exclusivamente no servidor (Vercel Functions). O frontend nunca
 * conhece endpoints nem credenciais do ERP. Todos os valores decimais chegam
 * como string para evitar float.
 */
import { AppError } from '../../application/context'

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

/** Empresa do ERP (lista para escolher a obra) */
export interface ErpCompany {
  code: string
  name: string
}

/** Obra ativa do ERP para escolher ao criar a obra no QC (não é sincronização) */
export interface ErpWorkOption {
  company: string
  code: string
  name: string
}

/** Operações de leitura/envio; usadas para saber o que cada provider já implementa. */
export type ErpOperation = 'works' | 'suppliers' | 'materials' | 'budget' | 'pushContract'

export interface ERPProvider {
  readonly name: 'mock' | 'uau' | 'senior'
  /**
   * O que o provider já implementa (ausente = tudo). A sincronização "Tudo" pula o que
   * não está aqui em vez de falhar; pedir um escopo não suportado diretamente dá erro claro.
   */
  readonly supports?: ReadonlySet<ErpOperation>
  getWorks(): Promise<ErpWork[]>
  getWork(erpId: string): Promise<ErpWork | null>
  getBudget(workErpId: string): Promise<ErpBudget | null>
  getSuppliers(params?: { updatedSince?: string }): Promise<ErpSupplier[]>
  getMaterials(): Promise<ErpMaterial[]>
  /** Envio futuro de contrato aprovado ao ERP; retorna o id do contrato no ERP. */
  pushContract(payload: ErpContractPayload): Promise<{ erpContractId: string }>
  /** Listas para o seletor de "Nova obra" (empresas e obras ativas), ordenadas */
  listCompanies(): Promise<ErpCompany[]>
  listWorkOptions(): Promise<ErpWorkOption[]>
}

export class ErpNotConfiguredError extends AppError {
  constructor(provider: string, detail?: string) {
    super('ERP_NOT_CONFIGURED', detail ?? `Provider ERP "${provider}" ainda não implementado — aguardando documentação oficial da API.`, 501)
    this.name = 'ErpNotConfiguredError'
  }
}

/** Ordem das listas do seletor: empresa (numérica) e código da obra */
export const byCompanyAndCode = (a: ErpWorkOption, b: ErpWorkOption) =>
  Number(a.company) - Number(b.company) || a.company.localeCompare(b.company) || a.code.localeCompare(b.code)

export const erpSupports = (erp: ERPProvider, op: ErpOperation) => !erp.supports || erp.supports.has(op)
