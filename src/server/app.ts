import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import { API_PREFIX } from '../contract/index.ts'
import { systemClock, type Clock } from './clock.ts'
import type { Database } from './db/database.ts'
import { registerApiRoutes } from './http/api.ts'
import { registerHealthRoutes } from './http/health.ts'
import { registerMetricsRoutes } from './http/metrics.ts'
import { registerRateLimit } from './http/rate-limit.ts'
import { createDraftTool } from './mcp/draft-tool.ts'
import { createServingReads } from './mcp/reads.ts'
import { registerMcpRoutes, type McpDependencies } from './mcp/gateway.ts'
import { registerOidcRoutes } from './http/oidc.ts'
import {
  createDevSignIn,
  type DevPerson,
  type OidcSignIn,
  type SignIn,
} from './modules/auth/index.ts'
import {
  createWorkspaceSources,
  noSecretStore,
  ConnectorRegistry,
  type WorkspaceSources,
} from './modules/connectors/index.ts'
import type { JobRunner } from './modules/jobs/index.ts'
import { createModelPort, type ModelPort } from './modules/models/index.ts'
import { registerLoginRoutes, type LoginServer } from './modules/oauth/index.ts'
import type { PageReader } from './modules/web/index.ts'
import { createMetrics, operationOf, type Metrics } from './observability/metrics.ts'

/** The security headers on every answer that does not set its own (docs/self-hosting.md). */
export const SECURITY_HEADERS: readonly (readonly [string, string])[] = [
  ['content-security-policy', "default-src 'none'; frame-ancestors 'none'"],
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'DENY'],
  ['referrer-policy', 'no-referrer'],
]

export interface AppDependencies {
  database: Database
  mcp?: McpDependencies & { close?: () => Promise<void> }
  jobs: JobRunner
  /**
   * The definition sources this server reads, so Sources shows how each is configured. Without
   * them it says this server reads none.
   */
  sources?: Pick<ConnectorRegistry, 'list'>
  /**
   * The sources administrators add in Sources, with the secret store that keeps their tokens.
   * Defaults to none kept: a source without a secret can still be added.
   */
  workspaceSources?: WorkspaceSources
  logger: FastifyBaseLogger
  /** The service's "today" and "now". Defaults to the system clock. */
  clock?: Clock
  devPeople?: readonly DevPerson[]
  /**
   * How people sign in (CL_AUTH): the composition root builds it. Defaults to the dev picker over
   * `devPeople`.
   */
  signIn?: SignIn
  /** The language model for evaluations. Defaults to the scripted mock. */
  models?: ModelPort
  origins?: readonly string[]
  nodeEnv?: string
  /** The process's counters. Defaults to a new set. */
  metrics?: Metrics
  /** `CL_METRICS_TOKEN`: the bearer token `/metrics` asks for. Without one it is off. */
  metricsToken?: string
  /** The built-in login server for a person's own AI client (FR-403). Without one it is off. */
  login?: LoginServer
  /** Opens a web page for the assistant's read_source. Defaults to the public web only. */
  readPage?: PageReader
  /**
   * The proxies whose X-Forwarded-For and X-Forwarded-Proto the service believes
   * (CL_TRUSTED_PROXIES): a caller's address, which limits count by, is then the one they
   * forward. Defaults to none: the connection's peer.
   */
  trustedProxies?: readonly string[]
}

/** Builds the HTTP app without listening, so tests can drive it with `app.inject`. */
export function buildApp({
  database,
  jobs,
  sources,
  workspaceSources = createWorkspaceSources({
    secrets: noSecretStore,
    registry: new ConnectorRegistry([...(sources?.list() ?? [])]),
  }),
  logger,
  mcp,
  clock = systemClock(),
  devPeople = [],
  signIn: chosenSignIn,
  models = createModelPort({ mode: 'mock' }),
  origins = [],
  nodeEnv,
  metrics = createMetrics(),
  metricsToken,
  login,
  readPage,
  trustedProxies = [],
}: AppDependencies): FastifyInstance {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: trustedProxies.length ? [...trustedProxies] : false,
    // Every log line of a request carries its id (NFR-071). The id is always ours: a client's
    // own X-Request-Id is never trusted, so it cannot forge or inject log content.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  })
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id)
    // What the service answers is data, never a page to show or frame. A route that serves a
    // page (the login server's) sets its own policy, which these leave alone.
    for (const [name, value] of SECURITY_HEADERS)
      if (!reply.hasHeader(name)) reply.header(name, value)
    return payload
  })
  app.addHook('onResponse', async (request, reply) => {
    const template = request.routeOptions.url
    const route =
      operationOf(request) ??
      (template === undefined || template === `${API_PREFIX}/*` ? 'unmatched' : template)
    metrics.request(
      { method: request.method, route, status: reply.statusCode },
      reply.elapsedTime / 1000,
    )
  })
  app.addHook('onClose', (_instance, done) => {
    metrics.close()
    done()
  })

  registerRateLimit(app, { database, clock })
  registerHealthRoutes(app, database)
  registerMetricsRoutes(app, { metrics, token: metricsToken, database, jobs })
  const signIn = chosenSignIn ?? createDevSignIn(devPeople, nodeEnv)
  if (signIn.method === 'oidc')
    registerOidcRoutes(app, {
      signIn: signIn as OidcSignIn,
      webOrigin: origins[0] ?? 'http://localhost:5173',
    })
  if (mcp) {
    app.addHook('onClose', async () => {
      await mcp.close?.()
    })
    // An agent's draft is written as the person on the application's database (FR-121); the
    // serving pool only reads.
    registerMcpRoutes(
      app,
      {
        drafts: createDraftTool({ database, clock, web: origins[0] ?? null }),
        // Each delivered item's page in Heed, on the same address (FR-347).
        web: origins[0] ?? null,
        // What a domain's definition source has beyond the vocabulary, for find_context, read
        // as nobody.
        reads: createServingReads(database),
        ...mcp,
      },
      metrics,
    )
  }
  if (login) registerLoginRoutes(app, { login, database, identity: signIn, now: () => clock.now() })
  registerApiRoutes(app, {
    signIn,
    database,
    clock,
    origins,
    models,
    // The login server's resource is the MCP server's address, which its tokens are for.
    mcpAddress: mcp?.resource ?? login?.resource ?? null,
    login,
    jobs,
    sources,
    workspaceSources,
    ...(readPage ? { readPage } : {}),
  })

  app.addHook('onClose', async () => {
    await jobs.stop()
    await database.close()
  })

  return app
}
