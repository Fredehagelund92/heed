import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ObsSummary } from '../../src/contract/observability.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, servingEdition } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Observability's Summary on the service (FR-620): the last whole calendar month or quarter, for
  administrators and, for their own domains, owners. Whole weeks come from the weekly counts
  (obs_weekly), every other day from the delivery records, and every number goes through one
  disclosure pass (FR-614). Today is Wednesday 4 November 2026: last month is October, the month
  before September, and the trend's last week starts on Monday 19 October.
*/

const { client, url } = testDatabase()
const today = '2026-11-04'
const devPeople: DevPerson[] = ['author', 'owner', 'admin', 'stranger'].map((name) => ({
  email: `${name}@example.test`,
  name,
  roles: [],
}))
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  devPeople,
  clock: systemClock(today),
})
const origin = 'http://localhost'
const sessions: Record<string, Record<string, string>> = {}

async function login(name: string) {
  if (sessions[name]) return sessions[name]
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  return (sessions[name] = {
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    origin,
  })
}
async function get(name: string, path: string) {
  return app.inject({
    method: 'GET',
    url: '/api/v1' + path,
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
  })
}
async function summary(name: string, query = '') {
  const response = await get(name, `/observability/summary${query}`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ObsSummary>()
}

type State = 'grounded' | 'partial' | 'conflict' | 'stale' | 'missing'
const topics: Record<string, string> = {}
let edition: string

async function topic(name: string, area: string, value: string) {
  const { rows } = await client.query<{ id: string }>(
    `insert into topics (key, area_id, metric_keys, value_keys, month)
     values ($1, $2, '{metric:orders}', $3, '2026-10-01') returning id::text`,
    [`${area}|metric:orders|${value}|2026-10`, area, [value]],
  )
  topics[name] = rows[0]!.id
}

/** `n` agent calls about a topic each day from `from` up to, not including, `to`. */
async function calls(name: string, from: string, to: string, state: State, n: number) {
  await client.query(
    `insert into deliveries (delivered_hour, client_label, caller, edition_seq, overlay_seq,
                             tool_schema_digest, topic_id, scope, status, answer_state)
     select d + interval '10 hours', 'claude-code', 'agent', $1, 0, 'digest', $2, '{}',
            case when $3 = 'missing' then 'no_match' else 'matched' end::delivery_status, $3
       from generate_series($4::timestamptz, $5::timestamptz - interval '1 day', interval '1 day') d,
            generate_series(1, $6)`,
    [edition, topics[name], state, `${from}T00:00:00Z`, `${to}T00:00:00Z`, n],
  )
}

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    edition = (await servingEdition(client)).edition
  })
  for (const [month, next] of [
    ['2026_07', '2026-08-01'],
    ['2026_08', '2026-09-01'],
    ['2026_09', '2026-10-01'],
    ['2026_10', '2026-11-01'],
    ['2026_11', '2026-12-01'],
  ] as const)
    await client.query(
      `create table if not exists deliveries_${month} partition of deliveries
         for values from ('${month.replace('_', '-')}-01 00:00Z') to ('${next} 00:00Z')`,
    )
  await client.query(
    `insert into vocab_terms (key, kind, parent_key) values
       ('val:market/poland', 'dimension_value', 'dim:market');
     insert into vocab_term_versions (term_key, version_no, name, content_digest) values
       ('val:market/norway', 1, 'Norway', sha256('no')), ('val:market/poland', 1, 'Poland', sha256('pl'))
     on conflict do nothing;`,
  )
  await topic('norway', 'finance', 'val:market/norway')
  await topic('poland', 'finance', 'val:market/poland')
  await topic('germany', 'marketing', 'val:market/norway')
  // From 3 August: Norway is mostly checked, Poland finds nothing; more is checked in October.
  await calls('norway', '2026-08-03', '2026-10-01', 'grounded', 10)
  await calls('norway', '2026-08-03', '2026-10-01', 'partial', 2)
  await calls('norway', '2026-10-01', '2026-11-04', 'grounded', 14)
  await calls('norway', '2026-10-01', '2026-11-04', 'stale', 1)
  await calls('poland', '2026-08-03', '2026-11-04', 'missing', 3)
  // Marketing is quiet: a few calls a week.
  await calls('germany', '2026-10-05', '2026-10-08', 'grounded', 2)
  await calls('germany', '2026-10-12', '2026-10-13', 'missing', 3)
  // The weekly counts, as the nightly job keeps them.
  await client.query(`select count(*) from cl_obs_weekly_rollup_due($1::date)`, [today])
  // Poland's questions found nothing: an open spot, with no draft yet.
  await client.query(
    `insert into gaps (topic_id, type, opened_by_case, first_seen) values ($1, 'missing', 1, '2026-08-05')`,
    [topics.poland],
  )
  // The serving edition was published after review on 14 October.
  await transaction(client, async () => {
    await client.query('alter table editions disable trigger user')
    await client.query(`update editions set created_at = '2026-10-14T09:00:00Z' where seq = $1`, [
      edition,
    ])
    await client.query('alter table editions enable trigger user')
  })
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

describe('Summary', () => {
  it('counts last month by how it was answered, against the month before', async () => {
    const s = await summary('admin')
    expect(s.state).toBe('normal')
    expect(s.now).toEqual({ start: '2026-10-01', end: '2026-11-01' })
    expect(s.before).toEqual({ start: '2026-09-01', end: '2026-10-01' })
    expect(s.last).toBe('2026-11-03')
    expect(s.complete).toBe(true)
    // October: 31 days of Norway (14 checked, 1 out of date) and Poland (3 not found), and
    // Marketing's 6 checked and 3 not found.
    expect(s.numbers).toEqual({
      asked: 31 * 18 + 9,
      checked: 31 * 14 + 6,
      warned: 31,
      missing: 31 * 3 + 3,
    })
    expect(s.previous).toEqual({ asked: 30 * 15, checked: 300, missing: 90 })
    expect(s.notCompared).toBeNull()
  })

  it('draws the 13 weeks up to the last one the month ends by, from the weekly counts', async () => {
    const s = await summary('admin')
    expect(s.weeks.map((w) => w.start)).toEqual([
      '2026-07-27',
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ])
    // Nothing was asked before 3 August: that week is not drawn at all.
    expect(s.weeks[0]).toMatchObject({ counted: false, checked: null })
    expect(s.weeks[1]).toMatchObject({ counted: true, checked: 70 })
    // The week of 28 September is three days of September and four of October.
    expect(s.weeks[9]).toMatchObject({ checked: 30 + 56 })
    expect(s.weeks[12]).toMatchObject({ checked: 98 })
  })

  it('reads a whole week from the weekly counts, and a piece of one from the records', async () => {
    // The weekly count of the week of 19 October says 7 more were checked than its records hold.
    await client.query(
      `update obs_weekly set calls = calls + 7
        where week = '2026-10-19' and area_id = 'finance' and answer_state = 'grounded'`,
    )
    try {
      const s = await summary('admin')
      expect(s.weeks[12]).toMatchObject({ checked: 98 + 7 })
      expect(s.numbers.checked).toBe(31 * 14 + 6 + 7)
    } finally {
      await client.query(
        `update obs_weekly set calls = calls - 7
          where week = '2026-10-19' and area_id = 'finance' and answer_state = 'grounded'`,
      )
    }
  })

  it('lists what is still open and what changed, with who approved it', async () => {
    const s = await summary('admin')
    expect(s.open.total).toBe(1)
    expect(s.open.spots).toEqual([
      expect.objectContaining({
        title: 'Orders in Poland',
        areaId: 'finance',
        firstSeen: '2026-08-05',
        // 93 found nothing about it in October: shown, it would give away Marketing's 3.
        missing: null,
        state: 'none',
        proposalId: null,
      }),
    ])
    expect((await summary('owner')).open.spots[0]!.missing).toBe(93)
    // One change is under the minimum, so its count is not given; none before is a 0, which is.
    expect(s.changes.total).toBeNull()
    expect(s.changes.before).toBe(0)
    expect(s.changes.latest).toEqual([
      expect.objectContaining({ title: 'A note', areaId: 'finance' }),
    ])
  })

  it('compares a quarter only from when agents first asked', async () => {
    const s = await summary('admin', '?period=quarter')
    expect(s.now).toEqual({ start: '2026-07-01', end: '2026-10-01' })
    expect(s.before).toEqual({ start: '2026-04-01', end: '2026-07-01' })
    expect(s.since).toBe('2026-08-03')
    expect(s.previous).toBeNull()
    expect(s.notCompared).toBe('started')
    expect(s.numbers.asked).toBe(59 * 15)
  })

  it('says the period before is not compared when its days are no longer all counted', async () => {
    // A week kept from before the records begin: the first days of April are not counted.
    await client.query(
      `insert into obs_weekly (week, area_id, answer_state, calls) values ('2026-03-30', 'finance', 'grounded', 40)`,
    )
    try {
      const s = await summary('admin', '?period=quarter')
      expect(s.since).toBe('2026-03-30')
      expect(s.notCompared).toBe('not_kept')
      expect(s.previous).toBeNull()
    } finally {
      await client.query(`delete from obs_weekly where week = '2026-03-30'`)
    }
  })

  it('shows an owner their own domains, and refuses someone who owns none', async () => {
    const s = await summary('owner')
    expect(s.numbers.asked).toBe(31 * 18)
    const narrowed = await summary('admin', '?areaId=finance')
    expect(narrowed.numbers).toEqual(s.numbers)
    expect((await get('author', '/observability/summary')).statusCode).toBe(403)
    expect((await get('owner', '/observability/summary?areaId=marketing')).statusCode).toBe(403)
  })

  it('hides a small count, and every count that would give one away', async () => {
    const s = await summary('admin', '?areaId=marketing')
    expect(s.state).toBe('normal')
    // Six checked and three not found in October.
    expect(s.numbers.asked).toBe(9)
    expect(s.numbers.missing).toBeNull()
    expect(s.hidden).toBeGreaterThan(0)
    const shown = [
      ...Object.values(s.numbers),
      ...Object.values(s.previous ?? {}),
      ...s.weeks.map((w) => w.checked),
      ...s.open.spots.map((o) => o.missing),
    ]
    for (const n of shown) if (n !== null) expect(n === 0 || n >= s.minimumCount).toBe(true)
  })

  it('is quiet under the minimum and empty before anything is asked', async () => {
    await client.query(
      `insert into areas (id, name) values ('tiny', 'Tiny'), ('unasked', 'Unasked')`,
    )
    await topic('tiny', 'tiny', 'val:market/norway')
    await calls('tiny', '2026-10-06', '2026-10-08', 'grounded', 2)
    const quiet = await summary('admin', '?areaId=tiny')
    expect(quiet.state).toBe('quiet')
    expect(quiet.numbers.asked).toBeNull()
    await client.query(
      `insert into area_assignments (area_id, person_id, role) values ('unasked', $1, 'owner')`,
      [people.stranger],
    )
    expect((await summary('stranger')).state).toBe('empty')
  })
})
