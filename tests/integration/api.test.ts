import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedPersonId } from '../../db/seed/bulk.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { createHttpApi } from '../../src/web/api/http-api.ts'
import type { PersonalLists } from '../../src/web/api/client.ts'
import { generateItems } from '../../db/seed/fixtures/items.ts'
import { describeContextApi } from '../conformance/context-api.ts'
import { describeContextApiAgents } from '../conformance/context-api-agents.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The front end's http binding against the real service and PostgreSQL 18, with the same 1,500
  generated items as the mock. The conformance suite is the one the mock passes (tests/unit).
*/

const { client, url } = testDatabase({ seeded: true })
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  clock: systemClock('2026-10-07'),
  devPeople: [{ email: 'per_maria@example.test', name: 'Maria Lindqvist', roles: [] }],
})

// Favourites and recent items stay in the browser; the service never sees them.
const personal: PersonalLists = {
  listFavorites: () => [],
  setFavorite: () => [],
  listRecent: () => [],
  recordVisit: () => [],
}
let api: ReturnType<typeof createHttpApi> | undefined

beforeAll(async () => {
  await client.query('reset role')
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: address, host: new URL(address).host, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'per_maria@example.test' },
  })
  expect(response.statusCode).toBe(200)
  const cookie = response.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  api = createHttpApi({
    baseUrl: `${address}/api/v1`,
    personal,
    fetch: (request, init) => {
      const headers = new Headers(
        init?.headers ?? (request instanceof Request ? request.headers : undefined),
      )
      headers.set('cookie', cookie)
      // A browser sends its origin with every POST, such as the picker's pasted-list read and Try it.
      headers.set('origin', address)
      return fetch(request, { ...init, headers })
    },
  })
}, 120_000)
afterAll(() => app.close())

describeContextApi('http binding on PostgreSQL', () => api!, { personId: seedPersonId })
describeContextApiAgents('http binding on PostgreSQL', () => api!)

describe('the library API on PostgreSQL', () => {
  it('reads as the application role, which cannot change content', async () => {
    const database = apiDatabase(url)
    try {
      const [row] = await database.query<{ role: string }>('select current_user as role')
      expect(row?.role).toBe('context_layer_api')
      await expect(database.query("update item_versions set title = 'Changed'")).rejects.toThrow(
        /permission denied/,
      )
    } finally {
      await database.close()
    }
  })

  it('withholds an item whose audience is a group (groups are parked: everyone or nothing)', async () => {
    const [item] = generateItems(1)
    const id = item!.id
    expect(await api!.getItem(id)).not.toBeNull()
    await client.query('alter table item_versions disable trigger user')
    await client.query(
      "update item_versions set audience_groups = '{finance}' where item_id = $1",
      [id],
    )
    await client.query('alter table item_versions enable trigger user')
    try {
      expect(await api!.getItem(id)).toBeNull()
      expect(await api!.getItemLinks(id)).toBeNull()
      expect(await api!.getItemHistory(id)).toEqual([])
      expect((await api!.listLibrary()).items.some((row) => row.id === id)).toBe(false)
      expect((await api!.listItems({ limit: 1000 })).total).toBe(1499)
    } finally {
      await client.query('alter table item_versions disable trigger user')
      await client.query('update item_versions set audience_groups = null where item_id = $1', [id])
      await client.query('alter table item_versions enable trigger user')
    }
  })

  it('signs nobody in when the dev person does not exist', async () => {
    const stranger = buildApp({
      database: apiDatabase(url),
      jobs: idleJobs(),
      logger: createLogger({ level: 'silent' }),
    })
    try {
      const response = await stranger.inject({ method: 'GET', url: '/api/v1/library' })
      expect(response.statusCode).toBe(401)
    } finally {
      await stranger.close()
    }
  })
})
