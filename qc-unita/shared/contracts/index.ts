/**
 * Contratos da API (DTOs + schemas Zod) compartilhados entre UI e servidor.
 * Valores decimais trafegam SEMPRE como string ("1234.5600").
 */
import { z } from 'zod'

// ----------------------------------------------------------------------------- primitivos
export const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d{1,14}(\.\d{1,6})?$/, 'Número inválido (use ponto como separador decimal)')
export const ratioString = decimalString.refine((v) => Number(v) >= 0 && Number(v) <= 1, 'Percentual deve estar entre 0 e 1')
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (aaaa-mm-dd)')
export const uuid = z.string().uuid()

export type RevisionStatus = 'draft' | 'in_approval' | 'approved' | 'rejected' | 'superseded'
export type CompetitionStatus = 'open' | 'in_approval' | 'approved' | 'contracted' | 'cancelled'
export type SupplierParticipation = 'invited' | 'responded' | 'declined' | 'disqualified'

// ----------------------------------------------------------------------------- leitura
export interface UserDTO {
  id: string
  fullName: string
  email: string | null
  roles: { roleId: string; roleKey: string; roleName: string; workId: string | null }[]
  permissions: string[]
}

export interface WorkDTO {
  id: string
  code: string
  name: string
  clientName: string | null
  city: string | null
  state: string | null
  status: 'draft' | 'not_started' | 'active' | 'completed' | 'archived'
  erpId: string | null
  erpSyncedAt: string | null
  /** Chave da obra na UAU e orçamento escolhido (obras criadas pela planilha de orçamentos) */
  uau: UauWorkKeyDTO | null
  currentBudgetId: string | null
  currentBudgetTotal: string | null
  /** Metadados da versão vigente do orçamento */
  currentBudget?: BudgetVersionDTO | null
  summary?: WorkSummaryDTO
}

export interface BudgetVersionDTO {
  id: string
  version: number
  source: 'manual' | 'erp' | 'excel' | 'sharepoint'
  fileName: string | null
  importedAt: string | null
  importedByName: string | null
  lines: number
  total: string
}

export interface SupplierDTO {
  id: string
  legalName: string
  tradeName: string | null
  taxId: string
  contactName: string | null
  phone: string | null
  email: string | null
  cndValidUntil: string | null
  city: string | null
  state: string | null
  erpId: string | null
}

export interface BudgetPackageDTO {
  packageCode: string
  description: string
  total: string
  inputs: number
}

export interface ContractTypeDTO {
  id: string
  code: string
  name: string
  /** Com faturamento direto (CTD04/CTD10): exige a lista de materiais faturados à contratante */
  directBilling?: boolean
}

export interface ProfileRefDTO {
  id: string
  fullName: string
}

export interface CompetitionListItemDTO {
  id: string
  code: string
  title: string
  workId: string
  workCode: string
  workName: string
  status: CompetitionStatus
  packageCode: string | null
  requestedOn: string
  revisionNumber: number
  revisionStatus: RevisionStatus
  budgetAmount: string
  winnerTotal: string | null
  bestMixTotal: string | null
  suppliersCount: number
  updatedAt: string
}

export interface QcItemDTO {
  id: string
  sortOrder: number
  materialId: string | null
  code: string
  description: string
  unit: string
  budgetQuantity: string
  budgetUnitCost: string
  quantity: string
  scopeDescription: string | null
  contractNotes: string | null
  pctMaterial: string
  pctEquipment: string
  pctRetention: string
}

export interface QcSupplierDTO {
  id: string
  supplierId: string
  sortOrder: number
  status: SupplierParticipation
  legalName: string
  tradeName: string | null
  taxId: string
  contactName: string | null
  phone: string | null
  email: string | null
  cndValidUntil: string | null
  deliveryTerms: string | null
  paymentTerms: string | null
  readjustmentTerms: string | null
  notes: string | null
  strengths: string | null
  weaknesses: string | null
  proposalRef: string | null
  proposalReceivedOn: string | null
  proposalValidUntil: string | null
}

export interface QcPriceDTO {
  competitionSupplierId: string
  itemId: string
  unitPrice: string | null
  notes: string | null
}

export interface BestOverrideDTO {
  itemId: string
  competitionSupplierId: string
  reason: string
}

export interface RevisionDTO {
  id: string
  number: number
  status: RevisionStatus
  reason: string | null
  serviceStartOn: string | null
  serviceEndOn: string | null
  budgetAmount: string
  budgetUsedAmount: string
  budgetAdjustmentAmount: string
  engineeringNotes: string | null
  procurementNotes: string | null
  contractTypeId: string | null
  winnerSupplierId: string | null
  winnerJustification: string | null
  submittedAt: string | null
  decidedAt: string | null
  frozenAt: string | null
  snapshotHash: string | null
  createdAt: string
}

export interface ApprovalDTO {
  stepOrder: number
  stepName: string
  roleId: string
  roleName: string
  status: 'pending' | 'approved' | 'rejected' | 'skipped'
  decidedById: string | null
  decidedByName: string | null
  decidedAt: string | null
  comment: string | null
}

// ----------------------------------------------------------------------------- vínculos de planejamento
export type CommitmentCategory = 'contracted' | 'in_approval' | 'quoting'

/** Linha do orçamento: insumo de uma composição, com seu vínculo de planejamento (IP) */
export interface BudgetLineDTO {
  id: string
  lineKey: string
  activityWbs: string
  activityCode: string | null
  activityDescription: string
  materialId: string
  code: string
  description: string
  unit: string
  packageCode: string | null
  packageDescription: string | null
  quantity: string
  unitCost: string
  total: string
  /** Composição auxiliar de onde o insumo veio (aberta linha a linha), ou null para insumo direto */
  aux: AuxCompositionDTO | null
}

export interface AuxCompositionDTO {
  code: string
  description: string
  unit: string | null
  /** Quantidade da auxiliar por unidade do serviço */
  coefficient: string
  unitCost: string
}

/** Estrutura do orçamento como na planilha: grupos "Item" da EAP e composições (CPU/CPO) */
export interface BudgetStructureDTO {
  budgetId: string
  groups: { wbs: string; description: string }[]
  activities: { wbs: string; code: string | null; description: string; unit: string | null; quantity: string; unitCost: string; total: string }[]
}

/** Linha do orçamento com o que já está comprometido em concorrências da obra */
export interface BudgetLineUsageDTO extends BudgetLineDTO {
  committedQuantity: string
  balanceQuantity: string
  /** Percentual da linha já comprometido em concorrências (0..1+) */
  committedShare: string
  /** Percentual livre (1 − comprometido; pode ser negativo) */
  balanceShare: string
  /** Verba já puxada da linha */
  committedValue: string
  usage: { competitionId: string; competitionCode: string; category: CommitmentCategory; quantity: string; share: string; budgetValue: string }[]
}

/** Amarração de um item do QC a uma linha do orçamento */
export interface QcLinkDTO {
  id: string
  itemId: string
  activityItemId: string | null
  lineKey: string | null
  materialId: string
  packageCode: string | null
  packageDescription: string | null
  quantity: string
  /** Percentual da linha comprometido por este vínculo (0..1) */
  share: string
  /** Verba puxada da linha = custo total da linha × percentual */
  budgetValue: string
  budgetUnitCost: string
  awardedUnitPrice: string | null
  awardedTotal: string | null
}

/** Compromisso de outras concorrências da obra (revisão efetiva) */
export interface LinkCommitmentDTO {
  competitionId: string
  category: CommitmentCategory
  packageCode: string | null
  materialId: string
  lineKey: string | null
  quantity: string
  /** Σ percentual da linha comprometido (0..1) */
  share: string
  /** Σ verba puxada */
  budgetValue: string
  /** Σ valor contratado/estimado */
  amount: string
}

export interface WorkCompetitionDTO extends CompetitionListItemDTO {
  /** Revisão que conta no consumo: última aprovada; senão a corrente */
  effectiveRevisionNumber: number
  category: CommitmentCategory
  committedTotal: string
}

export interface WorkOverviewDTO {
  work: WorkDTO
  budgetTotal: string
  packages: BudgetPackageDTO[]
  competitions: WorkCompetitionDTO[]
  links: LinkCommitmentDTO[]
}

export interface WorkSummaryDTO {
  budgetTotal: string
  contracted: string
  inApproval: string
  quoting: string
  competitions: number
}

export interface CompetitionDetailDTO {
  competition: {
    id: string
    code: string
    title: string
    description: string | null
    status: CompetitionStatus
    packageCode: string | null
    requestedOn: string
    workId: string
    workCode: string
    workName: string
    budgetId: string
    engineeringOwner: ProfileRefDTO | null
    procurementOwner: ProfileRefDTO | null
  }
  revision: RevisionDTO
  revisions: Pick<RevisionDTO, 'id' | 'number' | 'status' | 'decidedAt' | 'createdAt' | 'reason'>[]
  items: QcItemDTO[]
  suppliers: QcSupplierDTO[]
  prices: QcPriceDTO[]
  overrides: BestOverrideDTO[]
  approvals: ApprovalDTO[]
  /** Vínculos item × insumo × vínculo de planejamento desta revisão */
  links: QcLinkDTO[]
  /** Linhas do orçamento vigente relevantes ao QC (IPs e insumos tocados) — base do consolidador */
  budgetLines: BudgetLineDTO[]
  /** Compromissos das demais concorrências da obra */
  otherCommitments: LinkCommitmentDTO[]
  contractTypes: ContractTypeDTO[]
  people: ProfileRefDTO[]
  /** O usuário atual pode editar/enviar/decidir nesta revisão */
  can: { edit: boolean; editPrices: boolean; submit: boolean; decide: boolean; createRevision: boolean }
}

export interface AuditLogDTO {
  id: number
  occurredAt: string
  userId: string | null
  userName: string | null
  entity: string
  entityId: string | null
  action: 'insert' | 'update' | 'delete'
  field: string | null
  oldValue: unknown
  newValue: unknown
  revisionId: string | null
  origin: string
  correlationId: string | null
}

export interface IntegrationLogDTO {
  id: string
  correlationId: string
  provider: string
  operation: string
  direction: 'inbound' | 'outbound'
  integrationId: string | null
  status: 'started' | 'success' | 'partial' | 'error'
  startedAt: string
  finishedAt: string | null
  recordsProcessed: number
  recordsFailed: number
  message: string | null
}

// ----------------------------------------------------------------------------- escrita
export const createCompetitionSchema = z
  .object({
    workId: uuid,
    title: z.string().trim().min(3, 'Descreva o objeto').max(200),
    description: z.string().trim().max(2000).optional(),
    /** IPs de planejamento do QC (um ou vários) */
    packageCodes: z.array(z.string().trim().min(1).max(30)).max(100).optional(),
    /** Linhas do orçamento selecionadas (linha a linha). Se omitido, todas as linhas dos IPs com saldo. */
    lineIds: z.array(uuid).max(5000).optional(),
    /** Percentual de cada linha a comprometer (0..1). Ausente = saldo livre da linha. */
    lineShares: z.record(uuid, ratioString).optional(),
    materialCodes: z.array(z.string().trim().min(1)).max(500).optional(),
    requestedOn: isoDate.optional(),
  })
  .refine((v) => v.packageCodes?.length || v.lineIds?.length || v.materialCodes?.length, {
    message: 'Selecione ao menos um IP de planejamento ou linhas do orçamento',
    path: ['packageCodes'],
  })
export type CreateCompetitionInput = z.infer<typeof createCompetitionSchema>

export const updateRevisionSchema = z
  .object({
    serviceStartOn: isoDate.nullable(),
    serviceEndOn: isoDate.nullable(),
    budgetUsedAmount: decimalString,
    budgetAdjustmentAmount: decimalString,
    engineeringNotes: z.string().max(4000).nullable(),
    procurementNotes: z.string().max(4000).nullable(),
    contractTypeId: uuid.nullable(),
    winnerSupplierId: uuid.nullable(),
    winnerJustification: z.string().max(4000).nullable(),
    engineeringOwnerId: uuid.nullable(),
    procurementOwnerId: uuid.nullable(),
  })
  .partial()
export type UpdateRevisionInput = z.infer<typeof updateRevisionSchema>

export const updateItemSchema = z
  .object({
    quantity: decimalString,
    scopeDescription: z.string().max(4000).nullable(),
    contractNotes: z.string().max(4000).nullable(),
    pctMaterial: ratioString,
    pctEquipment: ratioString,
    pctRetention: ratioString,
  })
  .partial()
export type UpdateItemInput = z.infer<typeof updateItemSchema>

export const setItemLinksSchema = z.object({
  links: z
    .array(
      z
        .object({
          activityItemId: uuid,
          /** Percentual da linha (0..1) — define verba e quantidade */
          share: ratioString.optional(),
          quantity: decimalString.refine((v) => !v.startsWith('-'), 'Quantidade não pode ser negativa').optional(),
        })
        .refine((l) => l.share !== undefined || l.quantity !== undefined, 'Informe o percentual ou a quantidade da linha'),
    )
    .max(200),
})
export type SetItemLinksInput = z.infer<typeof setItemLinksSchema>

export const addLinesSchema = z.object({
  lineIds: z.array(uuid).min(1).max(5000),
  shares: z.record(uuid, ratioString).optional(),
})

// Cadastro manual de obra (obras do ERP chegam pela sincronização)
export const createWorkSchema = z
  .object({
    code: z.string().trim().min(1, 'Informe o nº da obra').max(20).regex(/^[\w.-]+$/, 'Use letras, números, ponto ou hífen'),
    name: z.string().trim().min(3, 'Informe o nome da obra').max(200),
    clientName: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    state: z.string().trim().toUpperCase().length(2, 'UF com 2 letras').nullable().optional(),
    costCenter: z.string().trim().max(40).nullable().optional(),
    status: z.enum(['not_started', 'active']).default('not_started'),
    startedOn: isoDate.nullable().optional(),
    finishedOn: isoDate.nullable().optional(),
  })
  .refine((w) => !w.startedOn || !w.finishedOn || w.finishedOn >= w.startedOn, { path: ['finishedOn'], message: 'O término deve ser posterior ao início' })
export type CreateWorkInput = z.infer<typeof createWorkSchema>

// ----------------------------------------------------------------------------- nova obra pela planilha de orçamentos
/*
 * A aba "BD_Orcamento" (SharePoint) diz quais orçamentos existem: Empresa_pla · Obra_pla · NumOrca_pla.
 * A empresa e a obra são os códigos da UAU (o mesmo código de obra pode existir em mais de uma
 * empresa); a UAU só completa os nomes.
 */

/** Orçamento disponível na planilha para uma empresa + obra */
export interface SheetBudgetOptionDTO {
  budget: string
  services: number
  lines: number
  total: string
}

export interface WorkSetupWorkDTO {
  code: string
  /** Nome na UAU (null quando a obra não está entre as ativas da UAU) */
  name: string | null
  /** Obra já cadastrada no QC */
  existingWorkId: string | null
  budgets: SheetBudgetOptionDTO[]
}

export interface WorkSetupCompanyDTO {
  code: string
  /** Nome na UAU (null quando a UAU não respondeu ou não tem a empresa) */
  name: string | null
  works: WorkSetupWorkDTO[]
}

/** Empresas → obras → orçamentos que existem na planilha, com os nomes da UAU */
export interface WorkSetupOptionsDTO {
  companies: WorkSetupCompanyDTO[]
  warnings: string[]
}

/** Chave da obra na UAU e orçamento da planilha em uso */
export interface UauWorkKeyDTO {
  company: string
  work: string
  budget: string | null
}

export const createWorkFromUauSchema = z.object({
  /** Empresa_pla / código da empresa na UAU */
  company: z.string().trim().min(1).max(10),
  /** Obra_pla / código da obra na UAU */
  work: z.string().trim().min(1).max(20),
  /** NumOrca_pla */
  budget: z.string().trim().min(1).max(10),
  clientName: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['not_started', 'active']).default('active'),
})
export type CreateWorkFromUauInput = z.input<typeof createWorkFromUauSchema>
export type CreateWorkFromUauData = z.infer<typeof createWorkFromUauSchema>

export const refreshSheetBudgetSchema = z.object({
  /** Outro nº de orçamento da mesma empresa + obra; sem ele, reimporta o atual */
  budget: z.string().trim().min(1).max(10).optional(),
})
export type RefreshSheetBudgetInput = z.infer<typeof refreshSheetBudgetSchema>

// Importação do orçamento (Excel) — estrutura produzida por shared/domain/budget/excel-import.ts
const qty = decimalString
const auxCompositionSchema = z.object({
  code: z.string().min(1).max(40),
  description: z.string().max(1000),
  unit: z.string().max(20).nullable(),
  /** Coeficientes da UAU podem ter até 8 casas */
  coefficient: z.string().trim().regex(/^\d{1,10}(\.\d{1,8})?$/, 'Coeficiente inválido'),
  unitCost: decimalString,
})
export const budgetImportSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  sheetName: z.string().trim().max(100),
  groups: z.array(z.object({ wbs: z.string().max(40), description: z.string().max(500) })).max(20000),
  activities: z
    .array(z.object({ wbs: z.string().min(1).max(40), code: z.string().max(40).nullable(), description: z.string().max(1000), unit: z.string().max(20).nullable(), quantity: qty, unitCost: qty }))
    .max(50000),
  lines: z
    .array(
      z.object({
        lineKey: z.string().min(1).max(200),
        sourceRow: z.number().int().nonnegative(),
        activityWbs: z.string().min(1).max(40),
        materialCode: z.string().min(1).max(40),
        quantity: qty,
        unitCost: qty,
        total: qty,
        packageCode: z.string().max(30).nullable(),
        packageDescription: z.string().max(500).nullable(),
        aux: auxCompositionSchema.nullable().optional(),
      }),
    )
    .min(1)
    .max(100000),
  materials: z.array(z.object({ code: z.string().min(1).max(40), description: z.string().max(1000), unit: z.string().max(20) })).max(100000),
})
export type BudgetImportInput = z.infer<typeof budgetImportSchema>

export const addSupplierSchema = z.object({ supplierId: uuid })

export const updateSupplierTermsSchema = z
  .object({
    status: z.enum(['invited', 'responded', 'declined', 'disqualified']),
    deliveryTerms: z.string().max(2000).nullable(),
    paymentTerms: z.string().max(2000).nullable(),
    readjustmentTerms: z.string().max(2000).nullable(),
    notes: z.string().max(4000).nullable(),
    strengths: z.string().max(4000).nullable(),
    weaknesses: z.string().max(4000).nullable(),
    proposalRef: z.string().max(100).nullable(),
    proposalReceivedOn: isoDate.nullable(),
    proposalValidUntil: isoDate.nullable(),
  })
  .partial()
export type UpdateSupplierTermsInput = z.infer<typeof updateSupplierTermsSchema>

export const upsertPricesSchema = z.object({
  prices: z
    .array(
      z.object({
        competitionSupplierId: uuid,
        itemId: uuid,
        unitPrice: decimalString.nullable(),
        notes: z.string().max(1000).nullable().optional(),
      }),
    )
    .min(1)
    .max(5000),
})
export type UpsertPricesInput = z.infer<typeof upsertPricesSchema>

export const overrideSchema = z.object({
  itemId: uuid,
  competitionSupplierId: uuid.nullable(), // null remove o override
  reason: z.string().trim().max(1000).optional(),
})

export const createRevisionSchema = z.object({
  reason: z.string().trim().min(5, 'Explique o motivo da nova revisão').max(1000),
})

export const decideApprovalSchema = z.object({
  stepOrder: z.number().int().positive(),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(2000).nullable().optional(),
})
export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>

export const erpSyncSchema = z.object({
  scope: z.enum(['works', 'suppliers', 'materials', 'budget', 'all']),
  workId: uuid.optional(),
})
export type ErpSyncInput = z.infer<typeof erpSyncSchema>

// ----------------------------------------------------------------------------- solicitação de contrato e aditivos
export type ContractRequestStatus = 'draft' | 'submitted' | 'sent_to_erp' | 'signed' | 'cancelled'
export type AddendumStatus = 'draft' | 'submitted' | 'approved' | 'rejected'
/** Aditivo (soma) ou distrato (subtrai) */
export type AddendumKind = 'addendum' | 'termination'

/** Vínculo de quantidade do item contratado (Vínculo PL) */
export interface ContractAllocationDTO {
  packageCode: string | null
  locationCode: string | null
  quantity: string
  /** quantidade × R$ unitário do item */
  amount: string
}

export interface ContractItemDTO {
  id: string
  competitionItemId: string | null
  materialId: string | null
  code: string
  description: string
  specification: string | null
  unit: string
  quantity: string
  unitPrice: string
  totalPrice: string
  pctRetention: string
  pctMaterial: string
  pctEquipment: string
  allocations: ContractAllocationDTO[]
}

export interface ContractProjectDTO {
  sheet: string
  fileName: string
  revision: string
}

export interface ContractPartyDTO {
  id: string
  legalName: string
  tradeName: string | null
  taxId: string
  contactName: string | null
  phone: string | null
  email: string | null
  cndValidUntil: string | null
  erpId: string | null
}

/** Vínculo de planejamento (IP) de um item do aditivo/distrato; quantidade com o sinal do item */
export interface AddendumAllocationDTO {
  packageCode: string
  locationCode: string | null
  quantity: string
}

export interface AddendumItemDTO {
  id: string
  contractItemId: string | null
  code: string
  description: string
  unit: string
  /** Com sinal: positivo no aditivo, negativo no distrato */
  quantityDelta: string
  unitPrice: string
  totalDelta: string
  allocations: AddendumAllocationDTO[]
}

export interface AddendumDTO {
  id: string
  kind: AddendumKind
  number: number
  reason: string
  requestedOn: string
  newEndOn: string | null
  status: AddendumStatus
  totalDelta: string
  submittedAt: string | null
  decidedAt: string | null
  decidedByName: string | null
  decisionComment: string | null
  createdAt: string
  items: AddendumItemDTO[]
}

export interface ContractListItemDTO {
  id: string
  code: string
  status: ContractRequestStatus
  workId: string
  competitionId: string
  competitionCode: string
  competitionTitle: string
  revisionNumber: number
  supplierName: string
  totalAmount: string
  /** Σ aditivos aprovados */
  addendaTotal: string
  startOn: string
  endOn: string
  erpContractId: string | null
  updatedAt: string
}

export interface ContractRequestDTO {
  id: string
  code: string
  status: ContractRequestStatus
  work: { id: string; code: string; name: string; erpId: string | null }
  competition: { id: string; code: string; title: string; requestedOn: string; procurementOwnerName: string | null }
  revision: { id: string; number: number; frozenAt: string | null; snapshotHash: string | null }
  supplier: ContractPartyDTO
  secondSupplier: ContractPartyDTO | null
  contractType: ContractTypeDTO & { directBilling: boolean }
  startOn: string
  endOn: string
  totalAmount: string
  pctMaterial: string
  pctEquipment: string
  pctService: string
  /** Verba do QC na revisão aprovada */
  budgetAmount: string
  availableAmount: string
  erpContractId: string | null
  projects: ContractProjectDTO[]
  scopeDefinitions: string | null
  directBillingMaterials: string | null
  measurementCriteria: string | null
  notes: string | null
  submittedAt: string | null
  submittedByName: string | null
  sentToErpAt: string | null
  signedOn: string | null
  cancelReason: string | null
  createdAt: string
  createdByName: string | null
  items: ContractItemDTO[]
  addenda: AddendumDTO[]
  contractTypes: ContractTypeDTO[]
  /** Pendências para envio (somente em rascunho) */
  issues: { field: string; message: string }[]
  can: { manage: boolean; edit: boolean; submit: boolean; cancel: boolean; pushToErp: boolean; sign: boolean; addendum: boolean; decideAddendum: boolean }
}

export const createContractRequestSchema = z.object({ competitionId: uuid })

const projectSchema = z.object({
  sheet: z.string().trim().max(40),
  fileName: z.string().trim().min(1, 'Informe o nome do arquivo').max(255),
  revision: z.string().trim().max(20),
})

export const updateContractRequestSchema = z
  .object({
    contractTypeId: uuid,
    secondSupplierId: uuid.nullable(),
    startOn: isoDate,
    endOn: isoDate,
    projects: z.array(projectSchema).max(200),
    scopeDefinitions: z.string().max(8000).nullable(),
    directBillingMaterials: z.string().max(8000).nullable(),
    measurementCriteria: z.string().max(8000).nullable(),
    notes: z.string().max(4000).nullable(),
  })
  .partial()
export type UpdateContractRequestInput = z.infer<typeof updateContractRequestSchema>

export const updateContractItemSchema = z
  .object({ specification: z.string().max(2000).nullable(), pctRetention: ratioString })
  .partial()
export type UpdateContractItemInput = z.infer<typeof updateContractItemSchema>

export const cancelContractSchema = z.object({ reason: z.string().trim().min(5, 'Explique o motivo do cancelamento').max(1000) })
export const signContractSchema = z.object({ signedOn: isoDate, erpContractId: z.string().trim().max(60).optional() })

/** Quantidade digitada: sempre positiva; o sinal vem do tipo (aditivo +, distrato −). */
const positiveQuantity = decimalString.refine((v) => !v.startsWith('-') && !/^0+(\.0+)?$/.test(v), 'Informe uma quantidade maior que zero')

const addendumAllocationSchema = z.object({
  packageCode: z.string().trim().min(1, 'Informe o IP').max(40),
  locationCode: z.string().trim().max(40).nullable().optional(),
  quantity: positiveQuantity,
})

const addendumItemSchema = z.union([
  z.object({
    contractItemId: uuid,
    quantity: positiveQuantity,
    /** Só no aditivo; o distrato usa o preço contratado */
    unitPrice: decimalString.optional(),
    allocations: z.array(addendumAllocationSchema).max(100),
  }),
  z.object({
    contractItemId: z.null().optional(),
    code: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(500),
    unit: z.string().trim().min(1).max(20),
    quantity: positiveQuantity,
    unitPrice: decimalString,
    allocations: z.array(addendumAllocationSchema).max(100),
  }),
])
export type AddendumItemInput = z.infer<typeof addendumItemSchema>

export const saveAddendumSchema = z.object({
  /** Só na criação; depois o tipo não muda */
  kind: z.enum(['addendum', 'termination']).default('addendum'),
  reason: z.string().trim().min(5, 'Descreva o motivo').max(2000),
  requestedOn: isoDate.optional(),
  newEndOn: isoDate.nullable().optional(),
  items: z.array(addendumItemSchema).max(500),
})
/** Corpo enviado pela tela (kind opcional) */
export type SaveAddendumInput = z.input<typeof saveAddendumSchema>
/** Corpo já validado no servidor */
export type SaveAddendumData = z.infer<typeof saveAddendumSchema>

export const decideAddendumSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(2000).nullable().optional(),
})

// ----------------------------------------------------------------------------- erros
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; correlationId: string }
}

// ----------------------------------------------------------------------------- anexos
/** Onde o anexo está pendurado (mesma lista do check em public.attachments) */
export const ATTACHMENT_ENTITIES = ['work', 'budget', 'competition', 'competition_revision', 'supplier_proposal', 'supplier', 'contract_request', 'contract_addendum'] as const
export type AttachmentEntity = (typeof ATTACHMENT_ENTITIES)[number]
export const ATTACHMENT_CATEGORIES = ['proposal', 'memorial', 'addendum', 'supplier_document', 'contract', 'other'] as const
export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number]
/** Mesmo limite e tipos do bucket qc-attachments (007_storage.sql) */
export const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
export const ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/zip',
  'text/csv',
] as const

export interface AttachmentDTO {
  id: string
  workId: string
  entityType: AttachmentEntity
  entityId: string
  category: AttachmentCategory
  fileName: string
  mimeType: string | null
  sizeBytes: number | null
  description: string | null
  competitionSupplierId: string | null
  uploadedBy: ProfileRefDTO | null
  uploadedAt: string
  /** Quem pede pode remover (dono enquanto não congelado, ou administrador) */
  canDelete: boolean
}

const attachmentMeta = {
  workId: uuid,
  entityType: z.enum(ATTACHMENT_ENTITIES),
  entityId: uuid,
  category: z.enum(ATTACHMENT_CATEGORIES).default('other'),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(ATTACHMENT_MIME_TYPES, { errorMap: () => ({ message: 'Tipo de arquivo não aceito (PDF, imagem, Excel, Word, ZIP ou CSV).' }) }),
  sizeBytes: z.number().int().positive().max(ATTACHMENT_MAX_BYTES, 'Arquivo acima de 50 MB.'),
  description: z.string().trim().max(500).nullable().optional(),
  competitionSupplierId: uuid.nullable().optional(),
}
export const requestUploadSchema = z.object(attachmentMeta)
export type RequestUploadInput = z.infer<typeof requestUploadSchema>

/** Autorização de envio: o navegador faz PUT do arquivo direto no Storage */
export interface UploadTicketDTO {
  storagePath: string
  uploadUrl: string
  headers: Record<string, string>
}

export const confirmUploadSchema = z.object({ ...attachmentMeta, storagePath: z.string().min(10).max(600) })
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>
