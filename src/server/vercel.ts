import type { IncomingMessage, ServerResponse } from 'node:http'
import { finished } from 'node:stream/promises'
import { waitUntil } from '@vercel/functions'
import { attachDatabasePool } from '@vercel/functions/db-connections'
import type pg from 'pg'
import type { Logger } from 'pino'
import { bundled } from './bundled.ts'
import { ConfigError, loadConfig } from './config/env.ts'
import { relayOutbox } from './modules/notifications/index.ts'
import { createLogger } from './observability/logger.ts'
import { createService, logConfiguration, ServiceError, type Service } from './service.ts'

/**
 * The service as a Vercel function (docs/vercel.md): the same service as main.ts, answering one
 * request at a time. It never listens on a port and never starts the job runner or the outbox
 * relay's listener, because an instance is frozen between requests. Instead, after each change
 * through the API it relays the outbox once (waitUntil keeps the instance up until that is done),
 * so the inbox items a change makes still arrive. Only /api/v1 and /health reach it (vercel.json),
 * so it serves no MCP server.
 */

/** What this entry sets when the environment does not. */
export const vercelDefaults = {
  // Vercel's edge writes X-Forwarded-For itself, so each caller counts against a limit of its own.
  HEED_TRUSTED_PROXIES: 'vercel',
  // Agents sign in to the MCP server, which is not served here.
  HEED_LOGIN_SERVER: 'off',
}

/**
 * Connections per instance. Several instances run at once, each with a pool, so a small one keeps
 * the total under what the database's connection pooler takes (Neon's pooled address).
 */
export const POOL_MAX = 5

/** What the function needs from Vercel's runtime (@vercel/functions), so tests can stand in for it. */
export interface VercelRuntime {
  /** Keeps the instance up after the response until the promise settles. */
  waitUntil(promise: Promise<unknown>): void
  /** Releases the pool's idle connections before the instance is frozen. */
  attachDatabasePool(pool: pg.Pool): void
}

type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

const reads = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Whether a request may have changed something: any method but a read, under /api/. */
function isChange(request: IncomingMessage): boolean {
  return !reads.has(request.method ?? 'GET') && (request.url ?? '').startsWith('/api/')
}

export function createVercelHandler(
  environment: Record<string, string | undefined>,
  runtime: VercelRuntime,
): Handler {
  let starting: Promise<{ service: Service; logger: Logger }> | undefined
  async function start() {
    const config = loadConfig({ ...vercelDefaults, ...environment })
    const logger = createLogger({ level: config.logLevel })
    logConfiguration(config, logger)
    const service = await createService(config, logger, {
      mcp: false,
      ...(bundled ? { devPeople: bundled.people } : {}),
      pool: { max: POOL_MAX, attach: (pool) => runtime.attachDatabasePool(pool) },
    })
    await service.app.ready()
    return { service, logger }
  }

  return async (request, response) => {
    let started
    try {
      started = await (starting ??= start())
    } catch (error) {
      // The next request tries again. A configuration error names each bad setting, never a value.
      starting = undefined
      if (error instanceof ConfigError || error instanceof ServiceError)
        console.error(error.message)
      else console.error(error)
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
      response.end(
        JSON.stringify({
          code: 'UNAVAILABLE',
          message: 'The service could not start. Its log says why.',
        }),
      )
      return
    }
    const { service, logger } = started
    if (isChange(request))
      runtime.waitUntil(
        finished(response)
          .catch(() => undefined)
          .then(() => relayOutbox(service.database))
          .catch((error: unknown) => logger.error({ err: error }, 'outbox relay failed')),
      )
    service.app.server.emit('request', request, response)
  }
}

export default createVercelHandler(process.env, { waitUntil, attachDatabasePool })
