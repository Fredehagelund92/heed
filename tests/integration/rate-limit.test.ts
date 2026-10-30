import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Setting } from '../../src/contract/index.ts'
import { buildApp } from '../../src/server/app.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/*
  The web API's request limit (FR-408) on PostgreSQL: real sessions decide whose count a request
  is, and an administrator changes both numbers through the settings API.
*/

const { client, url } = testDatabase()
const clock = { time: Date.parse('2026-10-08T12:00:00Z') }
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: { now: () => new Date(clock.time), today: () => '2026-10-08' },
  devPeople: ['admin', 'owner'].map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: name === 'admin' ? ['administrator' as const] : [],
  })),
})
const serving = servingPool(url, 1)
const headers: Record<string, Record<string, string>> = {}
const nextMinute = () => {
  clock.time += 60_000
}

beforeAll(async () => {
  await transaction(client, () => foundation(client))
  for (const name of ['admin', 'owner']) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `${name}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[name] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
})
afterAll(async () => {
  await app.close()
  await serving.end()
})

describe('the web API request limit on PostgreSQL', () => {
  it('starts from the defaults, an administrator setting like any other', async () => {
    const settings = (
      await app.inject({ method: 'GET', url: '/api/v1/settings', headers: headers.admin })
    ).json<Setting[]>()
    expect(settings.find((s) => s.key === 'limits.api_rate_per_minute')).toMatchObject({
      version: 1,
      value: { person: 600, ip: 120 },
      editable: true,
    })
  })

  it('limits each person to the changed setting, on every route including Ask', async () => {
    const change = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/limits.api_rate_per_minute',
      headers: headers.admin,
      payload: { version: 1, value: { person: 3, ip: 2 }, reason: 'Pilot limits' },
    })
    expect(change.statusCode, change.body).toBe(200)
    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/limits.api_rate_per_minute',
      headers: headers.admin,
      payload: { version: 2, value: { person: 0, ip: 2 }, reason: 'Too tight' },
    })
    expect(invalid.statusCode).toBe(422)
    // The setting reaches new requests within five seconds; a new minute starts every count.
    nextMinute()

    const owner = headers.owner!
    const codes = []
    codes.push((await app.inject({ method: 'GET', url: '/api/v1/me', headers: owner })).statusCode)
    codes.push(
      (await app.inject({ method: 'GET', url: '/api/v1/operations', headers: owner })).statusCode,
    )
    codes.push(
      (await app.inject({ method: 'GET', url: '/api/v1/inbox/feed', headers: owner })).statusCode,
    )
    const ask = await app.inject({
      method: 'POST',
      url: '/api/v1/ask/lookup',
      headers: owner,
      payload: { question: 'How did orders change?' },
    })
    expect(codes).toEqual([200, 403, 200])
    expect(ask.statusCode).toBe(429)
    expect(Number(ask.headers['retry-after'])).toBeGreaterThan(0)

    // Someone else, and the address before sign-in, keep their own counts.
    const admin = await app.inject({ method: 'GET', url: '/api/v1/me', headers: headers.admin })
    expect(admin.statusCode).toBe(200)
    const anonymous = []
    for (let i = 0; i < 3; i++)
      anonymous.push((await app.inject({ method: 'GET', url: '/api/v1/auth/people' })).statusCode)
    expect(anonymous).toEqual([200, 200, 429])

    nextMinute()
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/me', headers: owner })).statusCode,
    ).toBe(200)
  })
})

describe('the MCP person and client rates on PostgreSQL', () => {
  it('serves the defaults to the gateway and follows an administrator change', async () => {
    const source = createEditionSource(serving)
    expect((await source.policy('claude-code')).rates).toEqual({ person: 30, client: 120 })
    const path = '/api/v1/settings/limits.mcp_requests_per_minute'
    const invalid = await app.inject({
      method: 'PUT',
      url: path,
      headers: headers.admin,
      payload: { version: 1, value: { person: 10 }, reason: 'Person only' },
    })
    expect(invalid.statusCode).toBe(422)
    const change = await app.inject({
      method: 'PUT',
      url: path,
      headers: headers.admin,
      payload: { version: 1, value: { person: 10, client: 60 }, reason: 'Pilot limits' },
    })
    expect(change.statusCode, change.body).toBe(200)
    expect((await source.policy('claude-code')).rates).toEqual({ person: 10, client: 60 })
  })
})
