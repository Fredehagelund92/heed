import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RatingCounts } from '../../src/contract/quality.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, servingEdition } from './fixtures.ts'
import { apiDatabase, tableContents, testDatabase, transaction } from './support.ts'

/*
  A person rates an assistant answer (FR-712) over HTTP, as the thumbs under an answer do. The
  rating is stored like give_feedback's verdict (FR-309): the verdict, the domain of the answer's
  metrics on the live edition and the hour, and nothing else. No row, history entry or log line
  names the person, their session or the question (FR-602, FR-613). Each person has a tighter
  limit of their own (FR-408). Health reads the counts per domain for its owners and
  administrators, hiding small ones (FR-614).
*/

const { client, url } = testDatabase()
const logs: string[] = []
const devPeople = Object.keys(people).map((name) => ({
  name,
  email: `${name}@example.test`,
  roles: [],
}))
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({
    level: 'trace',
    destination: {
      write(line: string) {
        logs.push(line)
      },
    },
  }),
  jobs: idleJobs(),
  clock: systemClock(),
  devPeople,
})

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const rate = (who: Who | null, payload: object) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/assistant/ratings',
    headers: who ? headers[who] : { origin: 'http://localhost' },
    payload,
  })
const counts = async (who: Who, query = '') => {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/quality/ratings${query}`,
    headers: headers[who],
  })
  return response
}

let limitVersion = 1
const setLimit = (person: number) =>
  client.query(
    `insert into settings_versions (key, version, value, reason)
     values ('limits.assistant_ratings_per_minute', $1, $2, 'test')`,
    [++limitVersion, JSON.stringify({ person })],
  )

/** Every stored rating, as the table holds it. */
async function stored() {
  const { rows } = await client.query<{ verdict: string; area: string | null }>(
    'select verdict::text, area_id as area from assistant_ratings order by verdict, area_id nulls last',
  )
  return rows
}

beforeAll(async () => {
  await foundation(client)
  for (const name of Object.keys(people) as Who[]) {
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
  // Before an edition is live a rating still counts, about no domain.
  expect(
    (await rate('author', { verdict: 'helpful', metrics: ['metric:orders'] })).statusCode,
  ).toBe(200)
  await transaction(client, () => servingEdition(client))
  // Room for every step below; the limit itself has its own test.
  await setLimit(1000)
})
afterAll(() => app.close())

describe('rating an answer', () => {
  it('needs a signed-in person', async () => {
    expect((await rate(null, { verdict: 'helpful' })).statusCode).toBe(401)
  })

  it("counts the verdict in the domain of the answer's metrics, or in none", async () => {
    await client.query('delete from assistant_ratings')
    const ok = async (payload: object) => {
      const response = await rate('author', payload)
      expect(response.statusCode, response.body).toBe(200)
      expect(response.json()).toEqual({ counted: true })
    }
    await ok({ verdict: 'helpful', metrics: ['metric:orders'] })
    await ok({ verdict: 'wrong', metrics: ['metric:orders'] })
    // No metrics, or only ones the live edition does not know: about no one domain.
    await ok({ verdict: 'helpful' })
    await ok({ verdict: 'wrong', metrics: ['metric:nothing_like_this'] })
    expect(await stored()).toEqual([
      { verdict: 'helpful', area: 'finance' },
      { verdict: 'helpful', area: null },
      { verdict: 'wrong', area: 'finance' },
      { verdict: 'wrong', area: null },
    ])
  })

  it('keeps only the verdict, a domain and the hour, with a random id', async () => {
    const { rows } = await client.query<{ version: number; timestamp: unknown; rounded: boolean }>(
      `select uuid_extract_version(id) as version, uuid_extract_timestamp(id) as timestamp,
              created_hour = date_trunc('hour', created_hour, 'UTC') as rounded
         from assistant_ratings`,
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row).toEqual({ version: 4, timestamp: null, rounded: true })
  })

  it('refuses a question, an answer, a note, a person or any other field, and other verdicts', async () => {
    const before = await stored()
    for (const payload of [
      { verdict: 'helpful', question: 'Why did orders drop in Norway?' },
      { verdict: 'helpful', answer: 'Orders fell because Norway closed.' },
      { verdict: 'wrong', note: 'The total looks off.' },
      { verdict: 'wrong', personId: people.author },
      { verdict: 'wrong', scope: { metrics: ['metric:orders'] } },
      { verdict: 'missing' },
      { verdict: 'unclear' },
      {},
      { verdict: 'helpful', metrics: 'metric:orders' },
      { verdict: 'helpful', metrics: Array.from({ length: 11 }, (_, i) => `metric:m${i}`) },
      { verdict: 'helpful', metrics: ['x'.repeat(161)] },
    ]) {
      const response = await rate('author', payload)
      expect(response.statusCode, JSON.stringify(payload)).toBe(400)
    }
    expect(await stored()).toEqual(before)
  })

  it('records no person: not in any table, the history or a log line', async () => {
    const before = await tableContents(client, ['auth.sessions'])
    logs.length = 0
    const response = await rate('stranger', { verdict: 'wrong', metrics: ['metric:orders'] })
    expect(response.statusCode, response.body).toBe(200)
    const after = await tableContents(client, ['auth.sessions'])
    const changed = after.filter((line) => !before.includes(line))
    // The one table that changed is the ratings', by one row.
    expect(changed.map((line) => line.split(' ')[0])).toEqual(['public.assistant_ratings'])
    const added = changed.join('\n')
    const traces = [
      people.stranger,
      'stranger@example.test',
      'stranger',
      headers.stranger!.cookie!.split('=').slice(1).join('='),
      headers.stranger!['x-heed-csrf']!,
    ]
    for (const trace of traces) expect(added).not.toContain(trace)
    expect(logs.length).toBeGreaterThan(0)
    for (const trace of traces)
      expect(
        logs.filter((line) => line.includes(trace)),
        `${trace} in a log line`,
      ).toEqual([])
  })

  it("limits each person's ratings per minute, with a retry hint, and leaves others alone", async () => {
    await setLimit(2)
    try {
      expect((await rate('admin', { verdict: 'helpful' })).statusCode).toBe(200)
      expect((await rate('admin', { verdict: 'helpful' })).statusCode).toBe(200)
      const limited = await rate('admin', { verdict: 'helpful' })
      expect(limited.statusCode, limited.body).toBe(429)
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
      expect(limited.json<{ data: { retryAfterSeconds: number } }>().data.retryAfterSeconds).toBe(
        Number(limited.headers['retry-after']),
      )
      expect((await rate('owner', { verdict: 'helpful' })).statusCode).toBe(200)
    } finally {
      await setLimit(1000)
    }
  })
})

describe('the ratings in Health', () => {
  const week = (weeksAgo: number) =>
    client
      .query<{ week: string }>(
        `select (date_trunc('week', now() at time zone 'UTC') - make_interval(weeks => $1))::date::text as week`,
        [weeksAgo],
      )
      .then(({ rows }) => rows[0]!.week)
  let thisWeek: string
  let lastWeek: string

  beforeAll(async () => {
    thisWeek = await week(0)
    lastWeek = await week(1)
    await client.query('delete from assistant_ratings')
    // This week: six good answers and two wrong ones about Finance, three about no one domain.
    // Last week: one good answer about Finance, which stays hidden.
    await client.query(
      `insert into assistant_ratings (verdict, area_id)
       select v::feedback_verdict, a from (values ('helpful','finance'),('helpful','finance'),('helpful','finance'),
         ('helpful','finance'),('helpful','finance'),('helpful','finance'),('wrong','finance'),('wrong','finance'),
         ('helpful',null),('helpful',null),('wrong',null)) r(v, a)`,
    )
    await client.query(
      `insert into assistant_ratings (verdict, area_id, created_hour)
       values ('helpful', 'finance', date_trunc('hour', now() - interval '1 week', 'UTC'))`,
    )
  })

  it("shows an owner their domain's weeks, small counts hidden with the total", async () => {
    const response = await counts('owner', '?weeks=2')
    expect(response.statusCode, response.body).toBe(200)
    const body = response.json<RatingCounts>()
    expect(body.minimumCount).toBe(5)
    expect(body.rows).toEqual([
      { area: 'finance', week: lastWeek, helpful: null, wrong: 0, total: null },
      { area: 'finance', week: thisWeek, helpful: 6, wrong: null, total: null },
    ])
  })

  it('shows an administrator every domain, and the answers about no one domain', async () => {
    const body = (await counts('admin', '?weeks=1')).json<RatingCounts>()
    expect(body.rows).toEqual([
      { area: 'finance', week: thisWeek, helpful: 6, wrong: null, total: null },
      { area: 'marketing', week: thisWeek, helpful: 0, wrong: 0, total: 0 },
      { area: null, week: thisWeek, helpful: null, wrong: null, total: null },
    ])
    // One domain asked for: no row about no one domain.
    expect((await counts('admin', '?area=finance&weeks=1')).json<RatingCounts>().rows).toEqual([
      { area: 'finance', week: thisWeek, helpful: 6, wrong: null, total: null },
    ])
  })

  it('never lets two periods be subtracted to uncover a hidden week', async () => {
    // Each week is a cell of its own: asking for more weeks adds cells, never a sum that
    // includes a hidden one, so last week's single rating cannot be worked out.
    const two = (await counts('owner', '?weeks=2')).json<RatingCounts>().rows
    const one = (await counts('owner', '?weeks=1')).json<RatingCounts>().rows
    const eight = (await counts('owner')).json<RatingCounts>().rows
    expect(one).toEqual(two.slice(1))
    expect(eight.slice(-2)).toEqual(two)
    expect(eight).toHaveLength(8)
    for (const row of eight)
      for (const count of [row.helpful, row.wrong, row.total])
        expect(count === null || count === 0 || count >= 5).toBe(true)
  })

  it('shows a total once every count of the week does', async () => {
    const setMinimum = (minimum: number) =>
      client.query(
        `insert into settings_versions (key, version, value, reason)
         select key, version + 1, $1, 'test' from settings_current where key = 'privacy.min_count'`,
        [JSON.stringify(minimum)],
      )
    await setMinimum(2)
    try {
      const body = (await counts('owner', '?weeks=1')).json<RatingCounts>()
      expect(body.rows).toEqual([
        { area: 'finance', week: thisWeek, helpful: 6, wrong: 2, total: 8 },
      ])
    } finally {
      await setMinimum(5)
    }
  })

  it('is for owners, deputies and administrators only', async () => {
    expect((await counts('author')).statusCode).toBe(403)
    expect((await counts('stranger')).statusCode).toBe(403)
    expect((await counts('owner', '?area=marketing')).statusCode).toBe(403)
  })
})
