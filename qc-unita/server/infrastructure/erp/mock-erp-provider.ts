/**
 * MockERPProvider — dados de exemplo enquanto a documentação oficial do UAU/Senior
 * não está disponível. O orçamento usa um recorte real da aba "Orçamento" da planilha
 * de QC (pacotes de terraplenagem, pavimentação, contrapiso, impermeabilização,
 * revestimentos, esquadrias, pintura e grua).
 */
import budgetFixture from './fixtures/budget-sample.json'
import type { ERPProvider, ErpBudget, ErpContractPayload, ErpMaterial, ErpSupplier, ErpWork } from './erp-provider'

const WORKS: ErpWork[] = [
  { erpId: 'UAU-OBRA-2041', code: '2041', name: 'Residencial Alpha', clientName: 'SPE Alpha Empreendimentos', city: 'São Paulo', state: 'SP', status: 'active', costCenter: 'CC-2041' },
  { erpId: 'UAU-OBRA-2055', code: '2055', name: 'Edifício Vila Nova', clientName: 'SPE Vila Nova', city: 'São Paulo', state: 'SP', status: 'active', costCenter: 'CC-2055' },
  { erpId: 'UAU-OBRA-1980', code: '1980', name: 'Condomínio Jardins BH', clientName: 'SPE Jardins', city: 'Belo Horizonte', state: 'MG', status: 'completed', costCenter: 'CC-1980' },
]

const SUPPLIERS: ErpSupplier[] = [
  { erpId: 'F-1001', legalName: 'Terra Forte Terraplenagem Ltda', tradeName: 'Terra Forte', taxId: '12345678000190', contactName: 'Marcos Lima', phone: '(11) 4002-1001', email: 'comercial@terraforte.example', cndValidUntil: '2027-03-31', city: 'São Paulo', state: 'SP', active: true },
  { erpId: 'F-1002', legalName: 'Pavimenta Engenharia e Obras Ltda', tradeName: 'Pavimenta', taxId: '23456789000101', contactName: 'Ana Souza', phone: '(11) 4002-1002', email: 'propostas@pavimenta.example', cndValidUntil: '2026-12-15', city: 'Guarulhos', state: 'SP', active: true },
  { erpId: 'F-1003', legalName: 'Construtora Horizonte Serviços Ltda', tradeName: 'Horizonte', taxId: '34567890000112', contactName: 'Paulo Reis', phone: '(11) 4002-1003', email: 'orcamentos@horizonte.example', cndValidUntil: '2026-09-30', city: 'Osasco', state: 'SP', active: true },
  { erpId: 'F-1004', legalName: 'Impermax Impermeabilizações Ltda', tradeName: 'Impermax', taxId: '45678901000123', contactName: 'Clara Nunes', phone: '(11) 4002-1004', email: 'vendas@impermax.example', cndValidUntil: '2027-01-20', city: 'São Paulo', state: 'SP', active: true },
  { erpId: 'F-1005', legalName: 'Alumax Esquadrias de Alumínio Ltda', tradeName: 'Alumax', taxId: '56789012000134', contactName: 'Rafael Prado', phone: '(11) 4002-1005', email: 'comercial@alumax.example', cndValidUntil: '2027-05-10', city: 'Barueri', state: 'SP', active: true },
  { erpId: 'F-1006', legalName: 'Cor & Arte Pinturas Ltda', tradeName: 'Cor & Arte', taxId: '67890123000145', contactName: 'Juliana Melo', phone: '(11) 4002-1006', email: 'contato@corearte.example', cndValidUntil: '2026-11-05', city: 'São Paulo', state: 'SP', active: true },
  { erpId: 'F-1007', legalName: 'Içar Locação de Equipamentos S.A.', tradeName: 'Içar Gruas', taxId: '78901234000156', contactName: 'Diego Alves', phone: '(11) 4002-1007', email: 'locacao@icar.example', cndValidUntil: '2027-02-28', city: 'Jundiaí', state: 'SP', active: true },
  { erpId: 'F-1008', legalName: 'Mineira Obras e Serviços Ltda', tradeName: 'Mineira Obras', taxId: '89012345000167', contactName: 'Tiago Rocha', phone: '(31) 4002-1008', email: 'obras@mineira.example', cndValidUntil: '2026-10-31', city: 'Belo Horizonte', state: 'MG', active: true },
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
}
