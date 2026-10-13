/**
 * Escolhe a fonte de orçamentos (aba BD_Orcamentos) pelo ambiente:
 *  - credenciais do Microsoft Graph (tenant + client + segredo ou credencial federada da Vercel) → SharePoint;
 *  - sem credenciais no modo demonstração (DATA_SOURCE=memory) → exemplo em memória;
 *  - sem credenciais com DATA_SOURCE=supabase → erro claro com as variáveis que faltam (nunca os valores).
 */
import { AppError } from '../../application/context'
import type { BudgetSheetSource } from '../../application/ports'
import { envOption, envValue } from '../env'
import { GraphClient, type SheetRef } from '../microsoft-graph/graph-client'
import { GraphBudgetSheetSource } from './graph-budget-sheet'
import { MockBudgetSheetSource } from './mock-budget-sheet'

export { GraphBudgetSheetSource } from './graph-budget-sheet'
export { MockBudgetSheetSource } from './mock-budget-sheet'

/** Planilha de orçamentos padrão (SharePoint da Unità) */
export const BUDGET_SHEET_DEFAULTS: SheetRef = {
  driveId: 'b!S3La9JidLE6c3ZTf28lb-loVt7u-9xdEoIsaVk0BY_mFzM2JIEI7SoDCfFHuzgqQ',
  itemId: '01UQIHIUQQC7IHA3D5WFHKTF6TMWDHIWVI',
  sheet: 'BD_Orcamentos',
}

export function budgetSheetRef(env: NodeJS.ProcessEnv = process.env): SheetRef {
  return {
    driveId: envValue('BUDGET_SHEET_DRIVE_ID', env) ?? BUDGET_SHEET_DEFAULTS.driveId,
    itemId: envValue('BUDGET_SHEET_ITEM_ID', env) ?? BUDGET_SHEET_DEFAULTS.itemId,
    sheet: envValue('BUDGET_SHEET_NAME', env) ?? BUDGET_SHEET_DEFAULTS.sheet,
  }
}

/**
 * Token OIDC da Vercel: nas funções ele chega no cabeçalho x-vercel-oidc-token de cada requisição
 * (VERCEL_OIDC_TOKEN só existe no build e no `vercel env pull`). O router guarda o mais recente.
 */
let oidcToken: string | null = null
export function rememberOidcToken(token: string | null) {
  if (token) oidcToken = token
}

export function createBudgetSheetSource(env: NodeJS.ProcessEnv = process.env): BudgetSheetSource {
  const tenantId = envValue('MS_GRAPH_TENANT_ID', env)
  const clientId = envValue('MS_GRAPH_CLIENT_ID', env)
  const clientSecret = envValue('MS_GRAPH_CLIENT_SECRET', env)
  // Na Vercel o token OIDC da implantação serve de prova (credencial federada no Entra ID)
  const federated = env.VERCEL === '1' || !!envValue('VERCEL_OIDC_TOKEN', env)

  if (tenantId && clientId && (clientSecret || federated)) {
    const client = new GraphClient({ tenantId, clientId, clientSecret, federatedAssertion: () => oidcToken ?? envValue('VERCEL_OIDC_TOKEN', env) })
    return new GraphBudgetSheetSource(client, budgetSheetRef(env))
  }
  if (envOption('DATA_SOURCE', env) !== 'supabase') return new MockBudgetSheetSource()

  const missing = [
    !tenantId && 'MS_GRAPH_TENANT_ID',
    !clientId && 'MS_GRAPH_CLIENT_ID',
    !clientSecret && !federated && 'MS_GRAPH_CLIENT_SECRET (ou credencial federada da Vercel)',
  ].filter(Boolean)
  throw new AppError(
    'SHAREPOINT_NOT_CONFIGURED',
    `A leitura da planilha de orçamentos (SharePoint) não está configurada no servidor. Faltam: ${missing.join(', ')}.`,
    503,
  )
}

let cached: BudgetSheetSource | null = null

/** Mantém a fonte (token e índice da planilha em cache) entre requisições na mesma instância. */
export function getBudgetSheetSource(env: NodeJS.ProcessEnv = process.env): BudgetSheetSource {
  return (cached ??= createBudgetSheetSource(env))
}
