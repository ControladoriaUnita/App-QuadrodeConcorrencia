/**
 * Camada HTTP (controllers finos). Converte Request → caso de uso → Response.
 * Uma única Vercel Function (api/router.ts) atende todas as rotas /api/*.
 */
import { z, ZodError, type ZodTypeAny } from 'zod'
import {
  addSupplierSchema,
  createCompetitionSchema,
  createWorkSchema,
  createRevisionSchema,
  decideApprovalSchema,
  erpSyncSchema,
  overrideSchema,
  addLinesSchema,
  budgetImportSchema,
  setItemLinksSchema,
  updateItemSchema,
  updateRevisionSchema,
  updateSupplierTermsSchema,
  upsertPricesSchema,
  cancelContractSchema,
  createContractRequestSchema,
  decideAddendumSchema,
  saveAddendumSchema,
  signContractSchema,
  updateContractItemSchema,
  updateContractRequestSchema,
  type ApiErrorBody,
} from '../../shared/contracts'
import { AppError, toAppError, type RequestContext } from '../application/context'
import type { Repositories } from '../application/ports'
import * as catalog from '../application/use-cases/catalog'
import * as contracts from '../application/use-cases/contracts'
import * as qc from '../application/use-cases/competitions'
import * as works from '../application/use-cases/works'
import { syncFromErp } from '../application/use-cases/erp-sync'
import { getErpProvider } from '../infrastructure/erp'
import { DEMO_USERS } from '../infrastructure/memory/seed'
import { dataSource, openSession } from '../infrastructure/repositories'

type Params = Record<string, string>
type Handler = (a: { req: Request; url: URL; params: Params; repos: Repositories; ctx: RequestContext; body: () => Promise<unknown> }) => Promise<unknown>

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
  status?: number
}

const routes: Route[] = []
function route(method: string, path: string, handler: Handler, status = 200) {
  const keys: string[] = []
  const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$')
  routes.push({ method, pattern, keys, handler, status })
}

const parse = <S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> => schema.parse(data)
const uuidParam = z.string().uuid()

// ----------------------------------------------------------------------------- rotas
route('GET', '/me', async ({ ctx }) => ({ user: catalog.me(ctx), dataSource: dataSource() }))
route('GET', '/works', async ({ repos, ctx }) => works.listWorksWithSummary(repos, ctx))
route('GET', '/works/:id/budget-lines', async ({ repos, ctx, params, url }) =>
  works.listBudgetLinesUsage(repos, ctx, parse(uuidParam, params.id), {
    packages: url.searchParams.get('packages')?.split(',').filter(Boolean),
    search: url.searchParams.get('search') ?? undefined,
    excludeCompetitionId: url.searchParams.get('excludeCompetitionId') ?? undefined,
  }),
)
route('POST', '/works', async ({ repos, ctx, body }) => works.createWork(repos, ctx, parse(createWorkSchema, await body())), 201)
route('GET', '/works/:id/budget-structure', async ({ repos, ctx, params }) => works.getBudgetStructure(repos, ctx, parse(uuidParam, params.id)))
route('POST', '/works/:id/budget-import', async ({ repos, ctx, params, body }) =>
  works.importBudget(repos, ctx, parse(uuidParam, params.id), parse(budgetImportSchema, await body())), 201)
route('GET', '/works/:id/overview', async ({ repos, ctx, params }) => works.getWorkOverview(repos, ctx, parse(uuidParam, params.id)))
route('GET', '/works/:id/packages', async ({ repos, ctx, params }) => catalog.listPackages(repos, ctx, parse(uuidParam, params.id)))
route('GET', '/suppliers', async ({ repos, ctx, url }) => catalog.listSuppliers(repos, ctx, url.searchParams.get('search') ?? undefined))
route('GET', '/contract-types', async ({ repos }) => catalog.listContractTypes(repos))

route('GET', '/competitions', async ({ repos, ctx, url }) =>
  qc.listCompetitions(repos, ctx, { workId: url.searchParams.get('workId') ?? undefined }),
)
route('POST', '/competitions', async ({ repos, ctx, body }) => qc.createCompetition(repos, ctx, parse(createCompetitionSchema, await body())), 201)
route('GET', '/competitions/:id', async ({ repos, ctx, params, url }) =>
  qc.getCompetition(repos, ctx, parse(uuidParam, params.id), url.searchParams.get('revisionId') ?? undefined),
)
route('GET', '/competitions/:id/audit', async ({ repos, ctx, params }) => qc.listAudit(repos, ctx, parse(uuidParam, params.id)))
route('POST', '/competitions/:id/revisions', async ({ repos, ctx, params, body }) =>
  qc.createRevision(repos, ctx, parse(uuidParam, params.id), parse(createRevisionSchema, await body()).reason), 201)

route('PATCH', '/revisions/:rid', async ({ repos, ctx, params, body }) => {
  await qc.updateRevision(repos, ctx, parse(uuidParam, params.rid), parse(updateRevisionSchema, await body()))
  return { ok: true }
})
route('PATCH', '/revisions/:rid/items/:itemId', async ({ repos, ctx, params, body }) => {
  await qc.updateItem(repos, ctx, parse(uuidParam, params.rid), parse(uuidParam, params.itemId), parse(updateItemSchema, await body()))
  return { ok: true }
})
route('PUT', '/revisions/:rid/items/:itemId/links', async ({ repos, ctx, params, body }) => {
  await qc.setItemLinks(repos, ctx, parse(uuidParam, params.rid), parse(uuidParam, params.itemId), parse(setItemLinksSchema, await body()))
  return { ok: true }
})
route('POST', '/revisions/:rid/lines', async ({ repos, ctx, params, body }) => {
  const input = parse(addLinesSchema, await body())
  return qc.addLines(repos, ctx, parse(uuidParam, params.rid), input.lineIds, input.shares)
})
route('DELETE', '/revisions/:rid/items/:itemId', async ({ repos, ctx, params }) => {
  await qc.removeItem(repos, ctx, parse(uuidParam, params.rid), parse(uuidParam, params.itemId))
  return { ok: true }
})
route('POST', '/revisions/:rid/suppliers', async ({ repos, ctx, params, body }) =>
  qc.addSupplier(repos, ctx, parse(uuidParam, params.rid), parse(addSupplierSchema, await body()).supplierId), 201)
route('PATCH', '/revisions/:rid/suppliers/:csId', async ({ repos, ctx, params, body }) => {
  await qc.updateSupplier(repos, ctx, parse(uuidParam, params.rid), parse(uuidParam, params.csId), parse(updateSupplierTermsSchema, await body()))
  return { ok: true }
})
route('DELETE', '/revisions/:rid/suppliers/:csId', async ({ repos, ctx, params }) => {
  await qc.removeSupplier(repos, ctx, parse(uuidParam, params.rid), parse(uuidParam, params.csId))
  return { ok: true }
})
route('PUT', '/revisions/:rid/prices', async ({ repos, ctx, params, body }) =>
  qc.upsertPrices(repos, ctx, parse(uuidParam, params.rid), parse(upsertPricesSchema, await body())))
route('PUT', '/revisions/:rid/overrides', async ({ repos, ctx, params, body }) => {
  const input = parse(overrideSchema, await body())
  await qc.setBestOverride(repos, ctx, parse(uuidParam, params.rid), input)
  return { ok: true }
})
route('POST', '/revisions/:rid/submit', async ({ repos, ctx, params }) => qc.submitRevision(repos, ctx, parse(uuidParam, params.rid)))
route('POST', '/revisions/:rid/approvals', async ({ repos, ctx, params, body }) =>
  qc.decideApproval(repos, ctx, parse(uuidParam, params.rid), parse(decideApprovalSchema, await body())))

// Solicitação de contrato e aditivos
route('GET', '/contracts', async ({ repos, ctx, url }) =>
  contracts.listContracts(repos, ctx, {
    workId: url.searchParams.get('workId') ?? undefined,
    competitionId: url.searchParams.get('competitionId') ?? undefined,
  }),
)
route('POST', '/contracts', async ({ repos, ctx, body }) =>
  contracts.createContractRequest(repos, ctx, parse(createContractRequestSchema, await body()).competitionId), 201)
route('GET', '/contracts/:id', async ({ repos, ctx, params }) => contracts.getContract(repos, ctx, parse(uuidParam, params.id)))
route('PATCH', '/contracts/:id', async ({ repos, ctx, params, body }) => {
  await contracts.updateContractRequest(repos, ctx, parse(uuidParam, params.id), parse(updateContractRequestSchema, await body()))
  return { ok: true }
})
route('PATCH', '/contracts/:id/items/:itemId', async ({ repos, ctx, params, body }) => {
  await contracts.updateContractItem(repos, ctx, parse(uuidParam, params.id), parse(uuidParam, params.itemId), parse(updateContractItemSchema, await body()))
  return { ok: true }
})
route('POST', '/contracts/:id/submit', async ({ repos, ctx, params }) => contracts.submitContractRequest(repos, ctx, parse(uuidParam, params.id)))
route('POST', '/contracts/:id/cancel', async ({ repos, ctx, params, body }) =>
  contracts.cancelContractRequest(repos, ctx, parse(uuidParam, params.id), parse(cancelContractSchema, await body()).reason))
route('POST', '/contracts/:id/erp-push', async ({ repos, ctx, params }) => contracts.pushContractToErp(repos, getErpProvider(), ctx, parse(uuidParam, params.id)))
route('POST', '/contracts/:id/sign', async ({ repos, ctx, params, body }) =>
  contracts.signContract(repos, ctx, parse(uuidParam, params.id), parse(signContractSchema, await body())))
route('POST', '/contracts/:id/addenda', async ({ repos, ctx, params, body }) =>
  contracts.createAddendum(repos, ctx, parse(uuidParam, params.id), parse(saveAddendumSchema, await body())), 201)
route('PUT', '/addenda/:aid', async ({ repos, ctx, params, body }) => {
  await contracts.saveAddendum(repos, ctx, parse(uuidParam, params.aid), parse(saveAddendumSchema, await body()))
  return { ok: true }
})
route('DELETE', '/addenda/:aid', async ({ repos, ctx, params }) => {
  await contracts.deleteAddendum(repos, ctx, parse(uuidParam, params.aid))
  return { ok: true }
})
route('POST', '/addenda/:aid/submit', async ({ repos, ctx, params }) => contracts.submitAddendum(repos, ctx, parse(uuidParam, params.aid)))
route('POST', '/addenda/:aid/decide', async ({ repos, ctx, params, body }) =>
  contracts.decideAddendum(repos, ctx, parse(uuidParam, params.aid), parse(decideAddendumSchema, await body())))

route('GET', '/integration/logs', async ({ repos, ctx }) => catalog.listIntegrationLogs(repos, ctx))
route('POST', '/integration/erp-sync', async ({ repos, ctx, body }) => {
  const input = parse(erpSyncSchema, await body())
  return syncFromErp(repos, getErpProvider(), { ...ctx, origin: 'erp_sync' }, input)
})

// ----------------------------------------------------------------------------- dispatcher
function json(data: unknown, status: number, correlationId: string) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-correlation-id': correlationId, 'cache-control': 'no-store' },
  })
}

function errorResponse(err: AppError, correlationId: string) {
  const body: ApiErrorBody = { error: { code: err.code, message: err.message, details: err.details, correlationId } }
  return json(body, err.status, correlationId)
}

function resolvePath(url: URL): string {
  // Na Vercel o rewrite envia /api/router?__path=<resto>; localmente a URL chega como /api/<resto>
  const fromRewrite = url.searchParams.get('__path')
  if (fromRewrite !== null) return '/' + fromRewrite.replace(/^\/+/, '')
  return url.pathname.replace(/^\/api/, '') || '/'
}

export async function handle(req: Request): Promise<Response> {
  const correlationId = req.headers.get('x-correlation-id')?.slice(0, 64) || globalThis.crypto.randomUUID()
  const url = new URL(req.url)
  const path = resolvePath(url)

  try {
    if (path === '/health') return json({ ok: true, dataSource: dataSource(), time: new Date().toISOString() }, 200, correlationId)

    if (dataSource() === 'memory' && process.env.VERCEL_ENV === 'production' && process.env.ALLOW_DEMO_MODE !== 'true') {
      throw new AppError('DEMO_DISABLED', 'Modo demonstração desabilitado em produção. Configure DATA_SOURCE=supabase.', 503)
    }
    if (path === '/demo-users') {
      if (dataSource() !== 'memory') throw new AppError('NOT_FOUND', 'Rota inexistente.', 404)
      return json(DEMO_USERS.map(({ id, fullName, roles }) => ({ id, fullName, roles })), 200, correlationId)
    }

    const match = routes
      .filter((r) => r.method === req.method)
      .map((r) => ({ r, m: r.pattern.exec(path) }))
      .find((x) => x.m)
    if (!match) {
      const exists = routes.some((r) => r.pattern.test(path))
      throw new AppError(exists ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', exists ? 'Método não permitido.' : 'Rota inexistente.', exists ? 405 : 404)
    }

    const origin = req.headers.get('x-audit-origin') === 'api' ? 'api' : 'ui'
    const session = await openSession(
      { authorization: req.headers.get('authorization'), demoUser: req.headers.get('x-demo-user') },
      { correlationId, origin },
    )
    if (!session) throw new AppError('UNAUTHENTICATED', 'Sessão inválida ou expirada. Entre novamente.', 401)

    const ctx: RequestContext = { correlationId, origin, actor: session.actor, now: () => new Date() }
    const params = Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m![i + 1]!)]))
    const body = async () => {
      try {
        return await req.json()
      } catch {
        throw new AppError('INVALID_JSON', 'Corpo da requisição inválido.', 400)
      }
    }
    const result = await match.r.handler({ req, url, params, repos: session.repos, ctx, body })
    return json(result ?? { ok: true }, match.r.status ?? 200, correlationId)
  } catch (err) {
    if (err instanceof ZodError) {
      return errorResponse(new AppError('VALIDATION', 'Dados inválidos.', 422, err.flatten()), correlationId)
    }
    const appErr = toAppError(err)
    if (appErr.status >= 500) console.error(`[${correlationId}]`, err)
    return errorResponse(appErr, correlationId)
  }
}
