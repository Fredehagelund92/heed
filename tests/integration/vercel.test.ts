import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { localRoles } from '../../src/server/db/roles.ts'
import { createVercelHandler } from '../../src/server/vercel.ts'
import { testDatabase } from './support.ts'

/**
 * The Vercel function on a real database. It never listens for the outbox, so the inbox items a
 * change makes arrive because it relays once after each change through the API.
 */

const { client, url } = testDatabase()
const waited: Promise<unknown>[] = []
const pools: pg.Pool[] = []
let server: Server
let base: string

beforeAll(async () => {
  const handler = createVercelHandler(
    {
      // As the service connects: under the API role.
      DATABASE_URL: `${url}?options=${encodeURIComponent(`-c role=${localRoles.api}`)}`,
      LOG_LEVEL: 'silent',
    },
    {
      waitUntil: (promise) => void waited.push(promise),
      attachDatabasePool: (pool) => void pools.push(pool),
    },
  )
  server = createServer((request, response) => void handler(request, response))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await Promise.all(pools.map((pool) => pool.end()))
})

const unrelayed = async () =>
  (
    await client.query<{ n: number }>(
      'select count(*)::int as n from outbox_events where relayed_at is null',
    )
  ).rows[0]!.n

describe('the Vercel function on the database', () => {
  it('is ready once the database answers', async () => {
    const response = await fetch(`${base}/health/ready`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ checks: { database: 'ok' } })
  })

  it('relays what is waiting in the outbox after a change, not after a read', async () => {
    await client.query(
      "insert into outbox_events (topic, aggregate_type, aggregate_id) values ('edition.published', 'edition', 'vercel')",
    )
    await fetch(`${base}/api/v1/auth/people`)
    expect(waited).toHaveLength(0)
    expect(await unrelayed()).toBe(1)
    // The function does not know what a change wrote, so every change relays, even a refused one.
    const response = await fetch(`${base}/api/v1/auth/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(waited).toHaveLength(1)
    await waited[0]
    expect(await unrelayed()).toBe(0)
  })
})
