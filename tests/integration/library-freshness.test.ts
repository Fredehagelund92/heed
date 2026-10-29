import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LibraryFreshness, LibraryIndex } from '../../src/contract/index.ts'
import { itemDisplayStatus, needsALook } from '../../src/domain/status.ts'
import { shiftDate } from '../../src/domain/validity.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { generateItems } from '../../db/seed/fixtures/items.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  Home's freshness counted back in time (GET /library/freshness) on the 1,500 seeded items. The
  seed seals its editions now, so the service's today is put two weeks ahead: every day counted
  then reads an edition sealed by its end, and the review dates and the ends of the generated
  items decide which items applied and which were current on each day. A source flag switched on
  between two of the days counts from its own day on.
*/

const { client, url } = testDatabase({ seeded: true })
const realToday = new Date().toISOString().slice(0, 10)
const today = shiftDate(realToday, 14)
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  clock: systemClock(today),
  devPeople: [{ email: 'per_maria@example.test', name: 'Maria Lindqvist', roles: [] }],
})
const items = generateItems()
let headers: Record<string, string> = {}

beforeAll(async () => {
  await client.query('reset role')
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'per_maria@example.test' },
  })
  expect(response.statusCode, response.body).toBe(200)
  headers = {
    origin: 'http://localhost',
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
  }
}, 120_000)
afterAll(() => app.close())

const freshness = async (weeks: number) => {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/library/freshness?weeks=${weeks}`,
    headers,
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<LibraryFreshness>()
}

/** What applied on a day and what of it was current, from the generated items. */
const expected = (day: string, flagged: ReadonlySet<string> = new Set()) => {
  const applying = items.filter((item) => {
    const status = itemDisplayStatus(item, day)
    return status !== 'retired' && status !== 'expired'
  })
  const current = applying.filter(
    (item) => !flagged.has(item.id) && !needsALook(itemDisplayStatus(item, day)),
  )
  return { day, applying: applying.length, current: current.length }
}

describe('the library’s freshness by week on PostgreSQL', () => {
  it('counts each day as it stood at its end: the edition sealed by then, its review dates', async () => {
    const counts = await freshness(3)
    expect(counts.today).toBe(today)
    expect(counts.days).toEqual([
      expected(realToday),
      expected(shiftDate(realToday, 7)),
      expected(today),
    ])
    const indexResponse = await app.inject({ method: 'GET', url: '/api/v1/library', headers })
    expect(indexResponse.statusCode, indexResponse.body).toBe(200)
    const index = indexResponse.json<LibraryIndex>()
    expect(index.today).toBe(today)
    const shown = index.items
      .map((item) => itemDisplayStatus(item, index.today))
      .filter((status) => status !== 'retired' && status !== 'expired')
    expect(counts.days.at(-1)).toEqual({
      day: today,
      applying: shown.length,
      current: shown.filter((status) => !needsALook(status)).length,
    })
    // Each row's trust is the same rule, so the list and the freshness agree.
    expect(counts.days.at(-1)).toEqual({
      day: today,
      applying: index.items.filter((item) => item.trust !== 'ended').length,
      current: index.items.filter((item) => item.trust === 'current').length,
    })
    // Review dates pass as the days go by, so fewer are current two weeks on.
    expect(counts.days[0]!.current).toBeGreaterThan(counts.days[2]!.current)
  })

  it('counts a source flag from the day it was switched on, not before', async () => {
    const item = items.find(
      (candidate) =>
        candidate.status === 'accepted' &&
        candidate.checkFlag === null &&
        !needsALook(itemDisplayStatus(candidate, today)) &&
        itemDisplayStatus(candidate, today) !== 'expired',
    )!
    // Switched on at the start of the day after the middle day counted.
    await client.query(
      `insert into overlay_events (kind, scope, item_id, flag, at)
       values ('flag_on', 'item', $1, 'needs_check', ($2::date)::timestamp at time zone 'UTC')`,
      [item.id, shiftDate(realToday, 8)],
    )
    const counts = await freshness(3)
    expect(counts.days).toEqual([
      expected(realToday),
      expected(shiftDate(realToday, 7)),
      expected(today, new Set([item.id])),
    ])
  })

  it('refuses a window outside 1 to 52 weeks', async () => {
    for (const weeks of [0, 53]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/library/freshness?weeks=${weeks}`,
        headers,
      })
      expect(response.statusCode).toBe(400)
    }
  })
})
