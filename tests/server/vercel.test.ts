import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type pg from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { heedVersion } from '../../src/server/version.ts'
import { createVercelHandler, POOL_MAX, type VercelRuntime } from '../../src/server/vercel.ts'

/**
 * The Vercel function's handler (src/server/vercel.ts) on a local HTTP server, as Vercel's runtime
 * hands it each request. Needs no database: one that cannot be reached is enough to see what the
 * handler does around the app.
 */

const unreachable = 'postgres://127.0.0.1:1/context_layer_none'

let server: Server | undefined
afterEach(async () => {
  await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined))
  server = undefined
  vi.restoreAllMocks()
})

async function serve(environment: Record<string, string | undefined>) {
  const waited: Promise<unknown>[] = []
  const pools: pg.Pool[] = []
  const runtime: VercelRuntime = {
    waitUntil: (promise) => void waited.push(promise),
    attachDatabasePool: (pool) => void pools.push(pool),
  }
  // The handler reads the environment at each start, so a test can change it between requests.
  environment.LOG_LEVEL ??= 'silent'
  const handler = createVercelHandler(environment, runtime)
  server = createServer((request, response) => void handler(request, response))
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, waited, pools }
}

describe('the Vercel function', () => {
  it('answers health, with a small pool handed to Vercel once', async () => {
    const { base, pools } = await serve({ DATABASE_URL: unreachable })
    const response = await fetch(`${base}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', service: 'heed', version: heedVersion })
    await fetch(`${base}/health`)
    expect(pools).toHaveLength(1)
    expect(pools[0]!.options.max).toBe(POOL_MAX)
  })

  it('serves no MCP server and no login server for agents', async () => {
    const { base } = await serve({ DATABASE_URL: unreachable })
    expect((await fetch(`${base}/mcp`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${base}/.well-known/oauth-authorization-server`)).status).toBe(404)
  })

  it('relays the outbox after a change through the API, and not after a read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { base, waited } = await serve({ DATABASE_URL: unreachable })
    await fetch(`${base}/health`)
    await fetch(`${base}/api/v1/auth/people`)
    expect(waited).toHaveLength(0)
    await fetch(`${base}/api/v1/auth/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(waited).toHaveLength(1)
    // A relay that cannot reach the database is logged; the instance is not left waiting on it.
    await expect(waited[0]).resolves.toBeUndefined()
  })

  it('answers 503 while it cannot start, and starts once the settings are right', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const environment: Record<string, string | undefined> = {
      DATABASE_URL: unreachable,
      HEED_TRUSTED_PROXIES: 'vercel,10.0.0.0/8',
    }
    const { base } = await serve(environment)
    const refused = await fetch(`${base}/health`)
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({
      code: 'UNAVAILABLE',
      message: 'The service could not start. Its log says why.',
    })
    // The log names the setting, never a value of another.
    expect(String(errors.mock.calls[0]![0])).toContain(
      'HEED_TRUSTED_PROXIES: Expected vercel alone',
    )
    environment.HEED_TRUSTED_PROXIES = 'vercel'
    expect((await fetch(`${base}/health`)).status).toBe(200)
  })
})
