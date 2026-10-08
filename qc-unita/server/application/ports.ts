/**
 * Portas (interfaces) dos repositórios. Casos de uso dependem apenas destas
 * interfaces; implementações: memória (dev/testes) e Supabase (produção).
 */
import type {
  BudgetLineDTO,
  BudgetImportInput,
  BudgetStructureDTO,
  CreateWorkInput,
  CommitmentCategory,
  LinkCommitmentDTO,
  ApprovalDTO,
  AuditLogDTO,
  BudgetPackageDTO,
  CompetitionDetailDTO,
  CompetitionListItemDTO,
  CompetitionStatus,
  ContractListItemDTO,
  ContractProjectDTO,
  ContractRequestDTO,
  ContractRequestStatus,
  AddendumStatus,
  ContractTypeDTO,
  IntegrationLogDTO,
  ProfileRefDTO,
  RevisionStatus,
  SupplierDTO,
  UpdateItemInput,
  UpdateSupplierTermsInput,
  WorkDTO,
} from '../../shared/contracts'
import type { ApprovalInstance, ApprovalStepConfig } from '../../shared/domain/approval/approval-flow'
import type { ErpBudget, ErpMaterial, ErpSupplier, ErpWork } from '../infrastructure/erp/erp-provider'
import type { Actor } from './context'

export type CompetitionData = Omit<CompetitionDetailDTO, 'can' | 'budgetLines' | 'otherCommitments'>

export interface NewLink {
  /** Linha do orçamento vinculada */
  activityItemId: string
  lineKey: string
  materialId: string
  packageCode: string | null
  packageDescription: string | null
  quantity: string
  /** Percentual da linha comprometido (0..1) */
  share: string
  /** Verba puxada da linha */
  budgetValue: string
  budgetUnitCost: string
}

export interface AggregatedInput {
  materialId: string
  code: string
  description: string
  unit: string
  quantity: string
  unitCost: string
  total: string
  links: NewLink[]
}

export interface WorkCommitments {
  competitions: { competitionId: string; revisionId: string; revisionNumber: number; category: CommitmentCategory; awardedTotal: string }[]
  links: LinkCommitmentDTO[]
}

export interface NewCompetition {
  workId: string
  budgetId: string
  code: string
  title: string
  description: string | null
  packageCode: string | null
  requestedOn: string
  procurementOwnerId: string | null
  budgetAmount: string
  items: AggregatedInput[]
}

export interface RevisionStatusChange {
  status: RevisionStatus
  submittedAt?: string
  submittedBy?: string
  decidedAt?: string
  snapshot?: unknown
  snapshotHash?: string
  frozenAt?: string
}

export interface ComputedPersistence {
  priceTotals: { competitionSupplierId: string; itemId: string; totalPrice: string | null }[]
  proposalTotals: { competitionSupplierId: string; total: string }[]
  /** Valor contratado/estimado da revisão */
  awardedTotal?: string
  linkValues?: { linkId: string; awardedUnitPrice: string | null; awardedTotal: string | null }[]
  best: {
    itemId: string
    competitionSupplierId: string | null
    unitPrice: string | null
    totalPrice: string | null
    budgetTotal: string
    varianceAmount: string | null
    varianceRatio: string | null
    isOverride: boolean
    overrideReason: string | null
  }[]
}

export interface IdentityRepository {
  /** Resolve o ator a partir do id autenticado (perfil + papéis + permissões). */
  loadActor(userId: string): Promise<Actor | null>
  listPeople(): Promise<ProfileRefDTO[]>
}

export interface CatalogRepository {
  listWorks(): Promise<WorkDTO[]>
  /** Cadastro manual (source = manual); retorna o id */
  createWork(input: CreateWorkInput, actorId: string): Promise<string>
  getWork(id: string): Promise<WorkDTO | null>
  listSuppliers(search?: string): Promise<SupplierDTO[]>
  getSupplier(id: string): Promise<SupplierDTO | null>
  listContractTypes(): Promise<ContractTypeDTO[]>
  listPackages(budgetId: string): Promise<BudgetPackageDTO[]>
  /** Linhas do orçamento (opcionalmente filtradas por IPs) */
  listBudgetLines(budgetId: string, packages?: string[]): Promise<BudgetLineDTO[]>
  /** Grupos (Item) e composições do orçamento, na ordem da planilha */
  getBudgetStructure(budgetId: string): Promise<BudgetStructureDTO>
  /** Linhas por id (de qualquer versão do orçamento) */
  getBudgetLines(ids: string[]): Promise<BudgetLineDTO[]>
}

export interface CompetitionRepository {
  list(filter: { workId?: string; status?: CompetitionStatus }): Promise<CompetitionListItemDTO[]>
  nextCode(workId: string): Promise<string>
  create(data: NewCompetition, actorId: string): Promise<{ competitionId: string; revisionId: string }>
  getData(competitionId: string, revisionId?: string): Promise<CompetitionData | null>
  getRevisionRef(revisionId: string): Promise<{ competitionId: string; workId: string; status: RevisionStatus; number: number; frozenAt: string | null } | null>
  updateCompetition(id: string, patch: { engineeringOwnerId?: string | null; procurementOwnerId?: string | null; status?: CompetitionStatus; currentRevisionId?: string }): Promise<void>
  updateRevision(revisionId: string, patch: Record<string, unknown>): Promise<void>
  updateItem(itemId: string, patch: UpdateItemInput & { budgetQuantity?: string; budgetUnitCost?: string }): Promise<void>
  addSupplier(revisionId: string, supplier: SupplierDTO, sortOrder: number): Promise<string>
  updateSupplier(competitionSupplierId: string, patch: UpdateSupplierTermsInput): Promise<void>
  removeSupplier(competitionSupplierId: string): Promise<void>
  upsertPrices(revisionId: string, prices: { competitionSupplierId: string; itemId: string; unitPrice: string | null; notes?: string | null }[]): Promise<void>
  persistComputed(revisionId: string, computed: ComputedPersistence): Promise<void>
  cloneRevision(revisionId: string, reason: string): Promise<string>
  /** Inclui itens (com vínculos) numa revisão existente */
  addItems(revisionId: string, items: AggregatedInput[]): Promise<string[]>
  /** Remove um item (preços e vínculos juntos) */
  removeItem(itemId: string): Promise<void>
  /** Substitui os vínculos de planejamento de um item */
  setItemLinks(revisionId: string, itemId: string, links: NewLink[]): Promise<void>
  /** Revisões efetivas e compromissos por vínculo de todas as concorrências da obra */
  workCommitments(workId: string): Promise<WorkCommitments>
  setRevisionStatus(revisionId: string, change: RevisionStatusChange): Promise<void>
}

export interface ApprovalRepository {
  listSteps(): Promise<ApprovalStepConfig[]>
  listForRevision(revisionId: string): Promise<ApprovalDTO[]>
  createPlan(revisionId: string, plan: ApprovalInstance[]): Promise<void>
  saveDecision(revisionId: string, step: ApprovalInstance): Promise<void>
}

export interface AuditRepository {
  listForCompetition(competitionId: string, limit?: number): Promise<AuditLogDTO[]>
  /** Eventos de negócio adicionais (envio, decisão). Alterações de campo são capturadas por trigger no banco. */
  recordEvent(event: { entity: string; entityId: string; field: string; oldValue: unknown; newValue: unknown; revisionId?: string | null; workId?: string | null }): Promise<void>
}

export interface IntegrationLogRepository {
  start(entry: { correlationId: string; provider: string; operation: string; direction: 'inbound' | 'outbound'; triggeredBy: string | null; integrationId?: string | null }): Promise<string>
  finish(id: string, result: { status: 'success' | 'partial' | 'error'; recordsProcessed: number; recordsFailed: number; message?: string | null; errorDetail?: unknown; payloadSummary?: unknown }): Promise<void>
  list(limit?: number): Promise<IntegrationLogDTO[]>
}

/** Escrita de dados vindos do ERP (somente service_role). Nunca toca revisões de QC. */
export interface ErpSyncWriter {
  upsertWorks(works: ErpWork[]): Promise<number>
  upsertSuppliers(suppliers: ErpSupplier[]): Promise<number>
  upsertMaterials(materials: ErpMaterial[]): Promise<number>
  /** Cria/atualiza a versão do orçamento da obra; retorna o id do orçamento. */
  upsertBudget(budget: ErpBudget): Promise<{ budgetId: string; lines: number }>
}

/** Importação de orçamento (Excel) — cria nova versão vigente; escrita server-side (service_role). */
export interface BudgetWriter {
  importBudget(workId: string, input: BudgetImportInput, meta: { actorId: string }): Promise<{ budgetId: string; version: number; lines: number }>
}

// ----------------------------------------------------------------------------- contratos
export type ContractData = Omit<ContractRequestDTO, 'can' | 'contractTypes' | 'issues'>

export interface NewContractItem {
  competitionItemId: string
  materialId: string | null
  code: string
  description: string
  specification: string | null
  unit: string
  quantity: string
  unitPrice: string
  pctRetention: string
  pctMaterial: string
  pctEquipment: string
  allocations: { packageCode: string | null; quantity: string }[]
}

export interface NewContractRequest {
  competitionId: string
  revisionId: string
  supplierId: string
  contractTypeId: string
  code: string
  startOn: string
  endOn: string
  totalAmount: string
  pctMaterial: string
  pctEquipment: string
  pctService: string
  budgetAmount: string
  availableAmount: string
  scopeDefinitions: string | null
  notes: string | null
  items: NewContractItem[]
}

export interface ContractPatch {
  contractTypeId?: string
  secondSupplierId?: string | null
  startOn?: string
  endOn?: string
  projects?: ContractProjectDTO[]
  scopeDefinitions?: string | null
  directBillingMaterials?: string | null
  measurementCriteria?: string | null
  notes?: string | null
  status?: ContractRequestStatus
  submittedAt?: string
  submittedBy?: string
  sentToErpAt?: string
  erpContractId?: string | null
  signedOn?: string
  cancelReason?: string
}

export interface NewAddendumItem {
  contractItemId: string | null
  materialId: string | null
  code: string
  description: string
  unit: string
  quantityDelta: string
  unitPrice: string
}

export interface AddendumContent {
  reason: string
  requestedOn: string
  newEndOn: string | null
  totalDelta: string
  items: NewAddendumItem[]
}

export interface AddendumPatch {
  status: AddendumStatus
  submittedAt?: string
  submittedBy?: string
  decidedAt?: string
  decidedBy?: string
  decisionComment?: string | null
}

export interface ContractRepository {
  list(filter: { workId?: string; competitionId?: string }): Promise<ContractListItemDTO[]>
  get(id: string): Promise<ContractData | null>
  nextCode(workId: string, workCode: string): Promise<string>
  create(data: NewContractRequest, actorId: string): Promise<string>
  update(id: string, patch: ContractPatch): Promise<void>
  updateItem(contractId: string, itemId: string, patch: { specification?: string | null; pctRetention?: string }): Promise<void>
  createAddendum(contractId: string, number: number, content: AddendumContent, actorId: string): Promise<string>
  /** Substitui o conteúdo de um aditivo em rascunho */
  saveAddendum(addendumId: string, content: AddendumContent): Promise<void>
  updateAddendum(addendumId: string, patch: AddendumPatch): Promise<void>
  deleteAddendum(addendumId: string): Promise<void>
  getAddendumRef(addendumId: string): Promise<{ contractId: string; status: AddendumStatus } | null>
  /** Σ aditivos aprovados por concorrência da obra */
  approvedAddendaTotals(workId: string): Promise<{ competitionId: string; total: string }[]>
}

export interface Repositories {
  identity: IdentityRepository
  contracts: ContractRepository
  catalog: CatalogRepository
  competitions: CompetitionRepository
  approvals: ApprovalRepository
  audit: AuditRepository
  integrationLogs: IntegrationLogRepository
  erpWriter: ErpSyncWriter
  budgetWriter: BudgetWriter
}
