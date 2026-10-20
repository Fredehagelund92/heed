import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import type { Clock } from '../../src/server/clock.ts'
import type { Database } from '../../src/server/db/database.ts'
import { createLimiter } from '../../src/server/http/rate-limit.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from './idle-jobs.ts'

const start = Date.parse('2026-10-08T12:00:00Z')

describe('the request limiter', () => {
  it('counts per key in one-minute windows and says how long to wait', () => {
    let time = start
    const limit = createLimiter(() => new Date(time))
    const key = [{ key: 'a', limit: 2 }]
    expect([limit(key), limit(key), limit(key)]).toEqual([0, 0, 60])
    time += 20_500
    expect(limit(key)).toBe(40)
    expect(limit([{ key: 'b', limit: 2 }])).toBe(0)
    time = start + 60_000
    expect(limit(key)).toBe(0)
  })

  it('counts a request only when every key it names has room', () => {
    const limit = createLimiter(() => new Date(start))
    expect(limit([{ key: 'full', limit: 1 }])).toBe(0)
    expect(
      limit([
        { key: 'open', limit: 1 },
        { key: 'full', limit: 1 },
      ]),
    ).toBe(60)
    expect(limit([{ key: 'open', limit: 1 }])).toBe(0)
  })
})

const tokens = { maria: 'a'.repeat(64), jonas: 'b'.repeat(64) }
const sessions = new Map(
  Object.entries(tokens).map(([person, token]) => [
    createHash('sha256').update(token).digest('hex'),
    person,
  ]),
)
const cookie = (person: keyof typeof tokens) => `heed_session=${tokens[person]}`

/** Answers the limiter's two reads: the setting, and the person of a session. */
function fakeDatabase(state: { limits: unknown; down?: boolean }): Database {
  const database: Database = {
    transaction: (_person, work) => work(database),
    ping: () => Promise.resolve(),
    query: <Row>(sql: string, values?: unknown[]) => {
      if (state.down) return Promise.reject(new Error('connection refused'))
      if (sql.includes('limits.api_rate_per_minute'))
        return Promise.resolve([{ value: state.limits }] as Row[])
      // The limiter's own read of a session's person; the sign-in's finds nobody.
      if (sql.includes('auth.sessions') && sql.includes('"personId"')) {
        const person = sessions.get(String(values?.[0]))
        return Promise.resolve((person ? [{ personId: person }] : []) as Row[])
      }
      return Promise.resolve([] as Row[])
    },
    close: () => Promise.resolve(),
  }
  return database
}

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

function limitedApp(limits: unknown = { person: 3, ip: 2 }) {
  const state: { limits: unknown; down?: boolean } = { limits }
  const clock = { time: start }
  const fixed: Clock = { now: () => new Date(clock.time), today: () => '2026-10-08' }
  const app = buildApp({
    database: fakeDatabase(state),
    jobs: idleJobs(),
    logger: createLogger({ level: 'silent' }),
    clock: fixed,
  })
  close = () => app.close()
  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers })
  const statuses = async (n: number, url: string, headers?: Record<string, string>) => {
    const codes: number[] = []
    for (let i = 0; i < n; i++) codes.push((await get(url, headers)).statusCode)
    return codes
  }
  return { app, state, clock, get, statuses }
}

describe('the web API request limit', () => {
  it('answers 429 with a retry hint once an address before sign-in reaches its limit', async () => {
    const { get, statuses } = limitedApp()
    expect(await statuses(2, '/api/v1/auth/people')).toEqual([200, 200])
    const refused = await get('/api/v1/auth/people')
    expect(refused.statusCode).toBe(429)
    expect(refused.headers['retry-after']).toBe('60')
    expect(refused.headers['x-request-id']).toBeTruthy()
    expect(refused.json()).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: 'That was a lot at once. Try again in 60 seconds.',
      data: { retryAfterSeconds: 60 },
    })
  })

  it('counts every route under /api: unknown ones, operations and the assistant', async () => {
    const { app, statuses } = limitedApp()
    expect(await statuses(1, '/api/v1/no-such-operation')).toEqual([404])
    expect(await statuses(1, '/api/v1/operations')).toEqual([401])
    const chat = await app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      payload: { messages: [] },
    })
    expect(chat.statusCode).toBe(429)
    expect(await statuses(1, '/api/v1/operations')).toEqual([429])
  })

  it('never limits the health checks', async () => {
    const { statuses } = limitedApp({ person: 1, ip: 1 })
    expect(await statuses(5, '/health')).toEqual([200, 200, 200, 200, 200])
    expect(await statuses(5, '/health/ready')).toEqual([200, 200, 200, 200, 200])
  })

  it('counts each signed-in person on their own, apart from their address', async () => {
    const { statuses } = limitedApp()
    const maria = { cookie: cookie('maria') }
    expect(await statuses(4, '/api/v1/auth/people', maria)).toEqual([200, 200, 200, 429])
    expect(await statuses(3, '/api/v1/auth/people', { cookie: cookie('jonas') })).toEqual([
      200, 200, 200,
    ])
    expect(await statuses(2, '/api/v1/auth/people')).toEqual([200, 200])
    // A session that does not exist counts against the address.
    const unknown = { cookie: `heed_session=${'c'.repeat(64)}` }
    expect(await statuses(1, '/api/v1/auth/people', unknown)).toEqual([429])
  })

  it('opens a new window a minute later, and says how long is left until then', async () => {
    const { get, clock, statuses } = limitedApp()
    await statuses(2, '/api/v1/auth/people')
    clock.time += 45_000
    expect((await get('/api/v1/auth/people')).headers['retry-after']).toBe('15')
    clock.time += 15_000
    expect(await statuses(2, '/api/v1/auth/people')).toEqual([200, 200])
  })

  it("follows the administrator's setting within five seconds", async () => {
    const { state, clock, statuses } = limitedApp()
    expect(await statuses(3, '/api/v1/auth/people')).toEqual([200, 200, 429])
    state.limits = { person: 3, ip: 4 }
    expect(await statuses(1, '/api/v1/auth/people')).toEqual([429])
    clock.time += 5_000
    expect(await statuses(3, '/api/v1/auth/people')).toEqual([200, 200, 429])
  })

  it('uses the defaults when the setting is missing or invalid', async () => {
    const { statuses } = limitedApp({ person: 0, ip: 'many' })
    const codes = await statuses(121, '/api/v1/auth/people')
    expect(codes.slice(0, 120).every((code) => code === 200)).toBe(true)
    expect(codes[120]).toBe(429)
  })

  it('lets a request through when the database cannot say who is asking', async () => {
    const { state, statuses } = limitedApp({ person: 1, ip: 1 })
    state.down = true
    // The route answers for the database itself; the limit never turns it into a 429.
    expect(await statuses(3, '/api/v1/auth/people')).toEqual([500, 500, 500])
  })
})
