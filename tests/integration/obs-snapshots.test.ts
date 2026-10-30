import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  ObsSnapshot,
  ObsSnapshotItem,
  ObsSnapshotTake,
  ObsSummary,
} from '../../src/contract/observability.ts'
import { summaryWords } from '../../src/domain/obs-summary-words.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import type { JobContext } from '../../src/server/modules/jobs/index.ts'
import { snapshotJob } from '../../src/server/modules/observability/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, servingEdition } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Summary's monthly snapshots (FR-612, FR-620): the last whole month's Summary kept for good, for
  every domain together and for each domain, its counts already through the disclosure pass and
  its sentences said once. The nightly job takes them as no person; an administrator can take them
  at once. Today is Wednesday 4 November 2026, so the month kept is October.
*/

const { client, url } = testDatabase()
const today = '2026-11-04'
const clock = systemClock(today)
const database = apiDatabase(url)
const devPeople: DevPerson[] = ['author', 'owner', 'admin', 'stranger'].map((name) => ({
  email: `${name}@example.test`,
  name,
  roles: [],
}))
const app = buildApp({
  database,
  jobs: idleJobs(),
  logger: createLogger({ level: 'silent' }),
  devPeople,
  clock,
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
async function call(name: string, method: 'GET' | 'POST', path: string) {
  return app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
    ...(method === 'POST' ? { payload: {} } : {}),
  })
}
async function ok<T>(name: string, method: 'GET' | 'POST', path: string) {
  const response = await call(name, method, path)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
const list = (name: string, query = '') =>
  ok<ObsSnapshotItem[]>(name, 'GET', `/observability/snapshots${query}`)
const open = (name: string, id: string) =>
  ok<ObsSnapshot>(name, 'GET', `/observability/snapshots/${id}`)
const summary = (name: string, query = '') =>
  ok<ObsSummary>(name, 'GET', `/observability/summary${query}`)
const job = snapshotJob({ clock })
const run = () => job.run({ database } as JobContext)

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

/** Every number a snapshot's Summary shows. */
const numbersOf = (s: ObsSnapshot['summary']) => [
  ...Object.values(s.numbers),
  ...Object.values(s.previous ?? {}),
  ...s.weeks.map((w) => w.checked),
  s.changes.total,
  s.changes.before,
]

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
     on conflict do nothing;
     insert into areas (id, name) values ('unasked', 'Unasked'), ('old', 'Old');
     update areas set archived_at = now() where id = 'old';`,
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
  await client.query(`select count(*) from cl_obs_weekly_rollup_due($1::date)`, [today])
  // Poland's questions found nothing: an open spot, with no draft yet.
  await client.query(
    `insert into gaps (topic_id, type, opened_by_case, first_seen) values ($1, 'missing', 1, '2026-08-05')`,
    [topics.poland],
  )
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

describe('the snapshot job (observability.snapshot)', () => {
  it('keeps last month for every domain together and each domain agents asked about', async () => {
    expect(await run()).toEqual({ month: '2026-10-01', taken: 3 })
    const { rows } = await client.query<{ area: string | null; taken: string; starts: string }>(
      `select area_id as area, taken_on::text as taken, starts::text from obs_snapshots
        order by area_id nulls first`,
    )
    // Nothing was ever asked in Unasked, and Old is archived: neither has a snapshot.
    expect(rows).toEqual([
      { area: null, taken: today, starts: '2026-10-01' },
      { area: 'finance', taken: today, starts: '2026-10-01' },
      { area: 'marketing', taken: today, starts: '2026-10-01' },
    ])
  })

  it('takes nothing again: a month kept is never taken twice', async () => {
    const before = await client.query(`select id, summary from obs_snapshots order by id`)
    expect(await run()).toEqual({ month: '2026-10-01', taken: 0 })
    expect((await client.query(`select id, summary from obs_snapshots order by id`)).rows).toEqual(
      before.rows,
    )
  })

  it('keeps the counts the Summary shows and the sentences said over them', async () => {
    const [all] = await list('admin')
    expect(all).toEqual({
      id: all!.id,
      period: 'month',
      areaId: null,
      now: { start: '2026-10-01', end: '2026-11-01' },
      takenOn: today,
      state: 'normal',
    })
    const kept = await open('admin', all!.id)
    const live = await summary('admin')
    const { open: spots, changes, ...counts } = live
    expect(kept.summary).toEqual({
      ...counts,
      open: { total: spots.total },
      changes: { total: changes.total, before: changes.before },
    })
    const at = (day: string) => Date.parse(`${day}T00:00:00Z`)
    expect(kept.words).toEqual(
      summaryWords({
        ...kept.summary,
        now: { start: at(live.now.start), end: at(live.now.end) },
        before: { start: at(live.before.start), end: at(live.before.end) },
        since: at(live.since!),
      }),
    )
    expect(kept.words.sentences[0]).toBe(
      `Agents asked ${(31 * 18 + 9).toLocaleString('en-GB')} questions in October 2026 (450 in September 2026).`,
    )
  })

  it('keeps counts only: no topic, no item, nobody who approved, no count under the minimum', async () => {
    for (const item of await list('admin', '?areaId=marketing').then((m) =>
      list('admin').then((a) => [...a, ...m]),
    )) {
      const kept = await open('admin', item.id)
      const json = JSON.stringify(kept)
      expect(json).not.toMatch(/Poland|Norway|spots|latest|itemId|admin@|"by"/)
      for (const n of numbersOf(kept.summary))
        expect(n === null || n === 0 || n >= kept.summary.minimumCount, String(n)).toBe(true)
    }
    // Marketing's six checked and three not found in October: the three are hidden, never kept.
    const [marketing] = await list('admin', '?areaId=marketing')
    const kept = await open('admin', marketing!.id)
    expect(kept.summary.numbers).toMatchObject({ asked: 9, missing: null })
    expect(kept.summary.hidden).toBeGreaterThan(0)
  })

  it('stays as it was once the records it counted are gone', async () => {
    const [all] = await list('admin')
    const before = await open('admin', all!.id)
    await client.query(`create temporary table kept_october as
      select * from deliveries where delivered_hour >= '2026-10-01' and delivered_hour < '2026-11-01'`)
    await client.query(
      `delete from deliveries where delivered_hour >= '2026-10-01' and delivered_hour < '2026-11-01'`,
    )
    try {
      expect((await summary('admin')).numbers.asked).not.toBe(before.summary.numbers.asked)
      expect(await open('admin', all!.id)).toEqual(before)
    } finally {
      await client.query(`insert into deliveries select * from kept_october`)
      await client.query(`drop table kept_october`)
    }
  })
})

describe('reading snapshots', () => {
  it('lists every domain together for an administrator, and one domain asked for', async () => {
    expect((await list('admin')).map((s) => s.areaId)).toEqual([null])
    expect((await list('admin', '?areaId=finance')).map((s) => s.areaId)).toEqual(['finance'])
  })

  it("shows an owner their own domains' only, and refuses someone who owns none", async () => {
    expect((await list('owner')).map((s) => s.areaId)).toEqual(['finance'])
    expect(
      (await call('owner', 'GET', '/observability/snapshots?areaId=marketing')).statusCode,
    ).toBe(403)
    const [all] = await list('admin')
    const [marketing] = await list('admin', '?areaId=marketing')
    for (const id of [all!.id, marketing!.id])
      expect((await call('owner', 'GET', `/observability/snapshots/${id}`)).statusCode).toBe(404)
    expect((await call('author', 'GET', '/observability/snapshots')).statusCode).toBe(403)
    expect(
      (await call('admin', 'GET', `/observability/snapshots/${randomUUID()}`)).statusCode,
    ).toBe(404)
  })

  it('lets row security alone keep an owner to their own domains', async () => {
    const rows = await database.transaction(people.owner, (tx) =>
      tx.query<{ area: string | null }>(`select area_id as area from obs_snapshots`),
    )
    expect(rows).toEqual([{ area: 'finance' }])
  })
})

describe('taking a snapshot at once', () => {
  it('is for administrators, and takes only what is not kept yet', async () => {
    expect((await call('owner', 'POST', '/observability/snapshots')).statusCode).toBe(403)
    expect(await ok<ObsSnapshotTake>('admin', 'POST', '/observability/snapshots')).toEqual({
      now: { start: '2026-10-01', end: '2026-11-01' },
      taken: 0,
    })
    // A domain whose agents asked a few times in October: too few to count, kept as such.
    await client.query(`insert into areas (id, name) values ('tiny', 'Tiny')`)
    await topic('tiny', 'tiny', 'val:market/norway')
    await calls('tiny', '2026-10-06', '2026-10-08', 'grounded', 2)
    expect(await ok<ObsSnapshotTake>('admin', 'POST', '/observability/snapshots')).toMatchObject({
      taken: 1,
    })
    const [tiny] = await list('admin', '?areaId=tiny')
    expect(tiny).toMatchObject({ state: 'quiet', takenOn: today })
    const kept = await open('admin', tiny!.id)
    expect(kept.summary.numbers).toEqual({
      asked: null,
      checked: null,
      warned: null,
      missing: null,
    })
    expect(kept.words).toEqual({ sentences: [], caught: [], notes: [] })
  })
})

describe('the table', () => {
  it('refuses a day that does not start a month, and is never changed or deleted', async () => {
    await expect(
      client.query(
        `insert into obs_snapshots (period, starts, taken_on, summary) values ('month', '2026-09-02', '2026-10-01', '{}')`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      database.transaction(people.admin, (tx) =>
        tx.query(`update obs_snapshots set summary = '{}'`),
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      database.transaction(people.admin, (tx) => tx.query(`delete from obs_snapshots`)),
    ).rejects.toMatchObject({ code: '42501' })
    // The retention run leaves every snapshot.
    const count = async () =>
      (await client.query<{ n: number }>(`select count(*)::int as n from obs_snapshots`)).rows[0]!.n
    const before = await count()
    await client.query(`select cl_retention_run()`)
    expect(await count()).toBe(before)
  })
})
