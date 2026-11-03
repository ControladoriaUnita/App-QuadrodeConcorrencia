/**
 * MockERPProvider — dados de exemplo enquanto a documentação oficial do UAU/Senior
 * não está disponível. O orçamento usa um recorte real da aba "Orçamento" da planilha
 * de QC (pacotes de terraplenagem, pavimentação, contrapiso, impermeabilização,
 * revestimentos, esquadrias, pintura e grua).
 */
import budgetFixture from './fixtures/budget-sample.json'
import { byCompanyAndCode, type ERPProvider, type ErpBudget, type ErpCompany, type ErpContractPayload, type ErpMaterial, type ErpSupplier, type ErpWork, type ErpWorkOption } from './erp-provider'

const WORKS: ErpWork[] = [
  { erpId: 'UAU-OBRA-2041', code: '2041', name: 'Residencial Alpha', clientName: 'SPE Alpha Empreendimentos', city: 'São Paulo', state: 'SP', status: 'active', costCenter: 'CC-2041' },
  { erpId: 'UAU-OBRA-2055', code: '2055', name: 'Edifício Vila Nova', clientName: 'SPE Vila Nova', city: 'São Paulo', state: 'SP', status: 'active', costCenter: 'CC-2055' },
  { erpId: 'UAU-OBRA-1980', code: '1980', name: 'Condomínio Jardins BH', clientName: 'SPE Jardins', city: 'Belo Horizonte', state: 'MG', status: 'completed', costCenter: 'CC-1980' },
]

// Empresas fictícias e a empresa de cada obra (seletor de "Nova obra")
const COMPANIES: ErpCompany[] = [
  { code: '1', name: 'Unità Engenharia (exemplo)' },
  { code: '2', name: 'Unità Incorporações (exemplo)' },
]
const COMPANY_OF: Record<string, string> = { '2041': '1', '2055': '1', '1980': '2' }
/** Obra que existe só no ERP: permite criar uma obra nova no modo demonstração */
const NEW_WORK_OPTIONS: ErpWorkOption[] = [{ company: '2', code: '2070', name: 'Residencial Beta' }]

/**
 * CND relativa à data de hoje: com datas fixas a semente quebrava quando uma CND vencia (a vencedora
 * do Contrapiso deixava de poder ir à aprovação). A Horizonte segue vencida de propósito.
 */
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

const SUPPLIERS: ErpSupplier[] = [
  { erpId: 'F-1001', legalName: 'Terra Forte Terraplenagem Ltda', tradeName: 'Terra Forte', taxId: '12345678000190', contactName: 'Marcos Lima', phone: '(11) 4002-1001', email: 'comercial@terraforte.example', cndValidUntil: inDays(150), city: 'São Paulo', state: 'SP', active: true },
  { erpId: 'F-1002', legalName: 'Pavimenta Engenharia e Obras Ltda', tradeName: 'Pavimenta', taxId: '23456789000101', contactName: 'Ana Souza', phone: '(11) 4002-1002', email: 'propostas@pavimenta.example', cndValidUntil: inDays(120), city: 'Guarulhos', state: 'SP', active: true },
  { erpId: 'F-1003', legalName: 'Construtora Horizonte Serviços Ltda', tradeName: 'Horizonte', taxId: '34567890000112', contactName: 'Paulo Reis', phone: '(11) 4002-1003', email: 'orcamentos@horizonte.example', cndValidUntil: inDays(-34), city: 'Osasco', state: 'SP', active: true },
  { erpId: 'F-1004', legalName: 'Impermax Impermeabilizações Ltda', tradeName: 'Impermax', taxId: '45678901000123', contactName: 'Clara Nunes', phone: '(11) 4002-1004', email: 'vendas@impermax.example', cndValidUntil: inDays(80), city: 'São Paulo', state: 'SP', active: true },
  { erpId: 'F-1005', legalName: 'Alumax Esquadrias de Alumínio Ltda', tradeName: 'Alumax', taxId: '56789012000134', contactName: 'Rafael Prado', phone: '(11) 4002-1005', email: 'comercial@alumax.example', cndValidUntil: inDays(190), city: 'Barueri', state: 'SP', active: true },
  { erpId: 'F-1006', legalName: 'Cor & Arte Pinturas Ltda', tradeName: 'Cor & Arte', taxId: '67890123000145', contactName: 'Juliana Melo', phone: '(11) 4002-1006', email: 'contato@corearte.example', cndValidUntil: inDays(20), city: 'São Paulo', state: 'SP', active: true },
  { erpId: 'F-1007', legalName: 'Içar Locação de Equipamentos S.A.', tradeName: 'Içar Gruas', taxId: '78901234000156', contactName: 'Diego Alves', phone: '(11) 4002-1007', email: 'locacao@icar.example', cndValidUntil: inDays(117), city: 'Jundiaí', state: 'SP', active: true },
  { erpId: 'F-1008', legalName: 'Mineira Obras e Serviços Ltda', tradeName: 'Mineira Obras', taxId: '89012345000167', contactName: 'Tiago Rocha', phone: '(31) 4002-1008', email: 'obras@mineira.example', cndValidUntil: inDays(60), city: 'Belo Horizonte', state: 'MG', active: true },
]

export class MockERPProvider implements ERPProvider {
  readonly name = 'mock' as const

  /** Simula latência de rede para exercitar estados de carregamento. */
  constructor(private readonly latencyMs = 0) {}

  private async delay() {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs))
  }

  async getWorks(): Promise<ErpWork[]> {
    await this.delay()
    return WORKS.map((w) => ({ ...w }))
  }

  async getWork(erpId: string): Promise<ErpWork | null> {
    await this.delay()
    return WORKS.find((w) => w.erpId === erpId) ?? null
  }

  async getBudget(workErpId: string): Promise<ErpBudget | null> {
    await this.delay()
    if (!WORKS.some((w) => w.erpId === workErpId)) return null
    const b = budgetFixture as Omit<ErpBudget, 'erpId' | 'workErpId' | 'version' | 'description' | 'baseDate'>
    return {
      erpId: `${workErpId}-ORC-1`,
      workErpId,
      version: 1,
      description: 'Orçamento executivo',
      baseDate: '2025-09-09',
      groups: b.groups,
      activities: b.activities,
      items: b.items,
      materials: b.materials,
    }
  }

  async getSuppliers(): Promise<ErpSupplier[]> {
    await this.delay()
    return SUPPLIERS.map((s) => ({ ...s }))
  }

  async getMaterials(): Promise<ErpMaterial[]> {
    await this.delay()
    return (budgetFixture as { materials: ErpMaterial[] }).materials
  }

  async pushContract(payload: ErpContractPayload): Promise<{ erpContractId: string }> {
    await this.delay()
    return { erpContractId: `MOCK-CT-${payload.contractRequestId.slice(0, 8).toUpperCase()}` }
  }

  async listCompanies(): Promise<ErpCompany[]> {
    await this.delay()
    return COMPANIES.map((c) => ({ ...c }))
  }

  async listWorkOptions(): Promise<ErpWorkOption[]> {
    await this.delay()
    return [...WORKS.map((w) => ({ company: COMPANY_OF[w.code] ?? '1', code: w.code, name: w.name })), ...NEW_WORK_OPTIONS].sort(byCompanyAndCode)
  }
}
