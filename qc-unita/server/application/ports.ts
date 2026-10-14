/**
 * Portas (interfaces) dos repositórios. Casos de uso dependem apenas destas
 * interfaces; implementações: memória (dev/testes) e Supabase (produção).
 */
import type {
  AttachmentDTO,
  AttachmentEntity,
  BudgetLineDTO,
  BudgetImportInput,
  BudgetStructureDTO,
  CreateWorkInput,
  CommitmentCategory,
  LinkCommitmentDTO,
  MaterialPageDTO,
  MaterialQuery,
  ApprovalDTO,
  AuditLogDTO,
  BudgetPackageDTO,
  CompetitionDetailDTO,
  CompetitionListItemDTO,
  CompetitionStatus,
  ContractItemReferenceDTO,
  ContractListItemDTO,
  ContractProjectDTO,
  ContractRequestDTO,
  ContractRequestStatus,
  AddendumKind,
  AddendumStatus,
  ContractTypeDTO,
  IntegrationLogDTO,
  ProfileRefDTO,
  QcItemOrigin,
  RevisionStatus,
  SupplierDTO,
  UauWorkKeyDTO,
  UpdateItemInput,
  UpdateSupplierTermsInput,
  WorkDTO,
} from '../../shared/contracts'
import type { ApprovalInstance, ApprovalStepConfig } from '../../shared/domain/approval/approval-flow'
import type { BudgetSheetEntry, BudgetSheetKey, SheetBudget } from '../../shared/domain/budget/budget-sheet'
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

/** Insumo referência a criar: um insumo do orçamento com as linhas puxadas */
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
  /** Insumos referência (do orçamento) da revisão inicial */
  references: AggregatedInput[]
}

/** Insumo do mapa (real, de contrato) a criar */
export interface NewQcItem {
  materialId: string | null
  code: string
  description: string
  unit: string
  quantity: string
  origin: QcItemOrigin
  planningCode: string | null
  planningDescription: string | null
  referenceIds: string[]
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

/** Obra criada a partir da UAU: id no ERP e chaves da UAU/planilha de orçamentos */
export interface NewWorkOrigin {
  erpId: string
  uau: UauWorkKeyDTO
}

export interface IdentityRepository {
  /** Resolve o ator a partir do id autenticado (perfil + papéis + permissões). */
  loadActor(userId: string): Promise<Actor | null>
  listPeople(): Promise<ProfileRefDTO[]>
}

export interface CatalogRepository {
  listWorks(): Promise<WorkDTO[]>
  /** Cadastro de obra (manual, ou escolhida na lista da UAU com `origin`); retorna o id */
  createWork(input: CreateWorkInput, actorId: string, origin?: NewWorkOrigin): Promise<string>
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
  /** Insumo do cadastro pelo código (null se não existir) */
  findMaterialIdByCode(code: string): Promise<string | null>
  /** Cadastro de insumos: IPs (código "IP…") ou os demais, com busca por código ou descrição */
  listMaterials(query: MaterialQuery): Promise<MaterialPageDTO>
  /**
   * IP escolhido à mão para uma linha do orçamento (pela chave da linha); null volta ao IP da planilha.
   * A leitura das linhas já devolve o IP manual (vale também para as próximas versões importadas).
   * Retorna o IP efetivo da linha, ou null se a linha não existe no orçamento vigente.
   */
  setLinePlanning(workId: string, lineKey: string, planning: { code: string; description: string | null } | null): Promise<{ code: string | null; description: string | null } | null>
  /**
   * Nome de um Item da EAP dado no app (pelo código do item); null volta ao nome da planilha.
   * Vale para todas as versões do orçamento da obra. Retorna false se o item não existe no orçamento vigente.
   */
  setBudgetGroupName(workId: string, wbs: string, description: string | null): Promise<boolean>
}

export interface CompetitionRepository {
  list(filter: { workId?: string; status?: CompetitionStatus }): Promise<CompetitionListItemDTO[]>
  nextCode(workId: string): Promise<string>
  create(data: NewCompetition, actorId: string): Promise<{ competitionId: string; revisionId: string; referenceIds: string[] }>
  getData(competitionId: string, revisionId?: string): Promise<CompetitionData | null>
  getRevisionRef(revisionId: string): Promise<{ competitionId: string; workId: string; status: RevisionStatus; number: number; frozenAt: string | null } | null>
  updateCompetition(id: string, patch: { engineeringOwnerId?: string | null; procurementOwnerId?: string | null; status?: CompetitionStatus; currentRevisionId?: string }): Promise<void>
  updateRevision(revisionId: string, patch: Record<string, unknown>): Promise<void>
  updateItem(itemId: string, patch: UpdateItemInput): Promise<void>
  addSupplier(revisionId: string, supplier: SupplierDTO, sortOrder: number): Promise<string>
  updateSupplier(competitionSupplierId: string, patch: UpdateSupplierTermsInput): Promise<void>
  removeSupplier(competitionSupplierId: string): Promise<void>
  upsertPrices(revisionId: string, prices: { competitionSupplierId: string; itemId: string; unitPrice: string | null; notes?: string | null }[]): Promise<void>
  persistComputed(revisionId: string, computed: ComputedPersistence): Promise<void>
  cloneRevision(revisionId: string, reason: string): Promise<string>
  /** Inclui insumos referência (com suas linhas do orçamento) numa revisão existente */
  addReferences(revisionId: string, references: AggregatedInput[]): Promise<string[]>
  /** Remove um insumo referência (linhas e ligações com os insumos do mapa juntas) */
  removeReference(referenceId: string): Promise<void>
  /** Substitui as linhas do orçamento de um insumo referência */
  setReferenceLinks(revisionId: string, referenceId: string, links: NewLink[]): Promise<void>
  /** Inclui insumos do mapa (reais), já ligados às referências */
  addItems(revisionId: string, items: NewQcItem[]): Promise<string[]>
  /** Substitui as referências de um insumo do mapa */
  setItemReferences(revisionId: string, itemId: string, referenceIds: string[]): Promise<void>
  /** Remove um insumo do mapa (preços e ligações juntos) */
  removeItem(itemId: string): Promise<void>
  /** IP das linhas puxadas pelos QCs em rascunho da obra (revisões congeladas guardam o IP da aprovação) */
  setDraftLinksPlanning(workId: string, lineKey: string, planning: { code: string | null; description: string | null }): Promise<void>
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
  /**
   * Grava por CNPJ (adota cadastro manual com o mesmo CNPJ), sem apagar CND/telefone já preenchidos.
   * `deactivateMissing`: leitura completa → inativa fornecedores do ERP que não vieram nela.
   */
  upsertSuppliers(suppliers: ErpSupplier[], opts?: { deactivateMissing?: boolean }): Promise<{ upserted: number; deactivated: number }>
  upsertMaterials(materials: ErpMaterial[]): Promise<number>
  /** Cria/atualiza a versão do orçamento da obra; retorna o id do orçamento. */
  upsertBudget(budget: ErpBudget): Promise<{ budgetId: string; lines: number }>
}

export type BudgetImportSource = 'excel' | 'sharepoint'

/** Importação de orçamento (Excel ou planilha do SharePoint) — cria nova versão vigente; escrita server-side (service_role). */
export interface BudgetWriter {
  importBudget(
    workId: string,
    input: BudgetImportInput,
    meta: {
      actorId: string
      source?: BudgetImportSource
      /** Planilha do SharePoint: guarda na obra o orçamento usado (empresa, obra e nº) */
      sheet?: BudgetSheetKey
    },
  ): Promise<{ budgetId: string; version: number; lines: number }>
}

/** Orçamentos da aba BD_Orcamento (Excel no SharePoint, ou exemplo no modo demonstração) */
export interface BudgetSheetSource {
  readonly name: 'sharepoint' | 'mock'
  /** Nome da aba (para o nome do "arquivo" da versão importada) */
  readonly sheetName: string
  /** Orçamentos disponíveis na aba (um por empresa + obra + nº) */
  listBudgets(): Promise<BudgetSheetEntry[]>
  /** Orçamento completo e estruturado (lança erro claro se não existir) */
  loadBudget(key: BudgetSheetKey): Promise<SheetBudget>
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
  /** Insumos referência usados no QC (para a solicitação mostrar) */
  references: ContractItemReferenceDTO[]
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
  /** Com sinal: positivo no aditivo, negativo no distrato */
  quantityDelta: string
  unitPrice: string
  /** Vínculos de planejamento (IP), com o mesmo sinal do item */
  allocations: { packageCode: string; locationCode: string | null; quantity: string }[]
}

export interface AddendumContent {
  /** Fixado na criação (saveAddendum ignora) */
  kind: AddendumKind
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

// ----------------------------------------------------------------------------- anexos
export interface AttachmentRecord extends Omit<AttachmentDTO, 'canDelete'> {
  storagePath: string
}

export interface AttachmentRepository {
  list(filter: { workId: string; entityType?: AttachmentEntity; entityId?: string }): Promise<AttachmentRecord[]>
  get(id: string): Promise<AttachmentRecord | null>
  create(data: Omit<AttachmentRecord, 'id' | 'uploadedBy' | 'uploadedAt'>, actorId: string): Promise<string>
  delete(id: string): Promise<void>
}

/** Binários dos anexos (Supabase Storage em produção; memória no modo demonstração) */
export interface FileStorage {
  /** URL assinada para o navegador enviar o arquivo com PUT */
  createUploadUrl(path: string, mimeType: string): Promise<{ uploadUrl: string; headers: Record<string, string> }>
  /** URL assinada de download (curta duração) */
  createDownloadUrl(path: string, fileName: string): Promise<string>
  /** Tamanho do objeto, ou null se ainda não foi enviado */
  stat(path: string): Promise<{ size: number | null } | null>
  remove(path: string): Promise<void>
}

export interface Repositories {
  identity: IdentityRepository
  attachments: AttachmentRepository
  storage: FileStorage
  contracts: ContractRepository
  catalog: CatalogRepository
  competitions: CompetitionRepository
  approvals: ApprovalRepository
  audit: AuditRepository
  integrationLogs: IntegrationLogRepository
  erpWriter: ErpSyncWriter
  budgetWriter: BudgetWriter
}
