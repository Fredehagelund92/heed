import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { gapDetectionJob } from '../../src/server/modules/gaps/index.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, people, publish, servingEdition, version } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

const { client, url } = testDatabase()
const database = apiDatabase(url)
const serving = servingPool(url, 2)
const store = createAnonymousStore(serving)
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
  clock: { now: () => new Date(), today: () => new Date().toISOString().slice(0, 10) },
})
let edition: string
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
async function api(name: string, method: 'GET' | 'POST', path: string, payload?: object) {
  return app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
}
const thisMonth = () => new Date().toISOString().slice(0, 7) + '-01'
const thisHour = () => new Date().toISOString().slice(0, 13) + ':00:00Z'

/**
 * A topic of its own for each test, so tests sharing the database never see each other's counts:
 * case 1 counts a scope over its months, so each topic has a metric of its own too.
 */
async function topic(options: { area?: string | null; metric?: string; month?: string } = {}) {
  const key = `test|${randomUUID()}`
  const result = await client.query<{ id: string }>(
    'insert into topics (key,area_id,metric_keys,value_keys,month) values ($1,$2,$3,$4,$5) returning id',
    [
      key,
      options.area === undefined ? 'finance' : options.area,
      [options.metric ?? `metric:orders_${randomUUID().slice(0, 8)}`],
      ['val:market/norway'],
      options.month ?? thisMonth(),
    ],
  )
  return result.rows[0]!.id
}
/** Partitions exist from the current month on; a test reaching back may need last month's. */
async function partitionFor(hour: string) {
  const start = hour.slice(0, 7) + '-01'
  const name = 'deliveries_' + start.slice(0, 7).replace('-', '_')
  const next = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 1))
    .toISOString()
    .slice(0, 10)
  await client.query(
    `create table if not exists ${name} partition of deliveries for values from ('${start} 00:00Z') to ('${next} 00:00Z')`,
  )
}
async function deliveries(
  topicId: string | null,
  n: number,
  options: { status?: string; caller?: string; items?: number; hour?: string } = {},
) {
  const ids: string[] = []
  if (options.hour) await partitionFor(options.hour)
  for (let i = 0; i < n; i++) {
    const result = await client.query<{ id: string }>(
      `insert into deliveries (delivered_hour,client_label,caller,edition_seq,overlay_seq,tool_schema_digest,topic_id,scope,status,delivered)
       values ($1,'claude-code',$2,$3,0,'digest',$4,'{}',$5,$6) returning id`,
      [
        options.hour ?? thisHour(),
        options.caller ?? 'agent',
        edition,
        topicId,
        options.status ?? 'no_match',
        JSON.stringify(
          Array.from({ length: options.items ?? 0 }, (_, rank) => ({ id: 'itm_x', v: 1, rank })),
        ),
      ],
    )
    ids.push(result.rows[0]!.id)
  }
  return ids
}
const gapsOf = async (topicId: string) =>
  (
    await client.query<{ id: string; type: string; status: string; opened_by_case: number }>(
      'select id, type, status, opened_by_case from gaps where topic_id=$1 order by created_at, id',
      [topicId],
    )
  ).rows
/** Summed over weeks, so a test running across a week boundary sees the same totals. */
const weekly = async (gapId: string) =>
  (
    await client.query<{ reports: number; no_item_calls: number }>(
      'select sum(reports)::int as reports, sum(no_item_calls)::int as no_item_calls from gap_weekly_counts where gap_id=$1',
      [gapId],
    )
  ).rows
const detect = () => gapDetectionJob.run({ database } as Parameters<typeof gapDetectionJob.run>[0])
async function setStatus(id: string, status: string) {
  await client.query(
    "update gaps set status=$2, status_since=date_trunc('hour', now(), 'UTC') where id=$1",
    [id, status],
  )
}

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    edition = (await servingEdition(client)).edition
  })
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await serving.end()
})

describe('week counts (FR-605)', () => {
  it('counts agent calls per topic, week and status, and only no-item calls as no-item', async () => {
    const t = await topic()
    await deliveries(t, 3, { status: 'no_match' })
    await deliveries(t, 2, { status: 'matched', items: 1 })
    await deliveries(t, 4, { status: 'no_match', caller: 'eval' })
    await deliveries(t, 1, { status: 'check_failed', caller: 'preview' })
    await deliveries(null, 2)
    const rows = await client.query(
      'select week::text, status, calls, no_item_calls from topic_week_counts where topic_id=$1 order by status',
      [t],
    )
    const monday = (
      await client.query<{ w: string }>(
        "select date_trunc('week', now() at time zone 'UTC')::date::text as w",
      )
    ).rows[0]!.w
    expect(rows.rows).toEqual([
      { week: monday, status: 'matched', calls: 2, no_item_calls: 0 },
      { week: monday, status: 'no_match', calls: 3, no_item_calls: 3 },
    ])
  })

  it('counts the deliveries the serving role writes through the anonymous store', async () => {
    await store.write([
      {
        kind: 'delivery',
        value: {
          id: randomUUID(),
          hour: new Date().toISOString().slice(0, 13) + ':00:00.000Z',
          client: 'claude-code',
          caller: 'agent',
          edition,
          overlay: '0',
          digest: 'digest',
          topic: {
            key: 'finance|metric:orders||2026-07',
            area: 'finance',
            metrics: ['metric:orders'],
            values: [],
            dimensions: [],
            month: '2026-07-01',
          },
          scope: null,
          status: 'no_match',
          state: 'missing',
          family: 'claude_code',
          delivered: [],
          withheld: [],
          cut: false,
          bytes: 10,
          duration: 1,
        },
      },
    ])
    const counted = await client.query(
      `select c.calls, c.no_item_calls from topic_week_counts c join topics t on t.id=c.topic_id
        where t.key='finance|metric:orders||2026-07'`,
    )
    expect(counted.rows).toEqual([{ calls: 1, no_item_calls: 1 }])
  })
})

describe('gap detection (FR-606, FR-609)', () => {
  it('opens a case 1 gap once agent no-match calls reach the threshold, and repeats safely', async () => {
    const below = await topic(),
      reached = await topic()
    await deliveries(below, 4)
    await deliveries(below, 3, { status: 'check_failed' })
    await deliveries(reached, 5)
    const first = await detect()
    expect(first.detected).toMatchObject({ case_1_no_item_topics: expect.any(Number) as number })
    expect(await gapsOf(below)).toEqual([])
    const [gap] = await gapsOf(reached)
    expect(gap).toMatchObject({ type: 'missing', status: 'open', opened_by_case: 1 })
    expect(await weekly(gap!.id)).toEqual([{ reports: 0, no_item_calls: 5 }])
    await detect()
    expect(await gapsOf(reached)).toHaveLength(1)
    expect(await weekly(gap!.id)).toEqual([{ reports: 0, no_item_calls: 5 }])
  })

  it('counts no-item calls about one scope across a month edge as one gap (FR-606 case 1)', async () => {
    const metric = `metric:edge_${randomUUID().slice(0, 8)}`
    const october = await topic({ metric, month: '2030-10-01' })
    const november = await topic({ metric, month: '2030-11-01' })
    const elsewhere = await topic({ metric, month: '2030-11-01', area: null })
    await deliveries(october, 3)
    await deliveries(november, 3)
    // Another domain's calls about the same metric are another scope.
    await deliveries(elsewhere, 4)
    await detect()
    // Three calls about 30 October and three about 1 November make one gap, on the latest month.
    expect(await gapsOf(october)).toEqual([])
    const [gap] = await gapsOf(november)
    expect(gap).toMatchObject({ type: 'missing', status: 'open', opened_by_case: 1 })
    expect(await weekly(gap!.id)).toEqual([{ reports: 0, no_item_calls: 6 }])
    expect(await gapsOf(elsewhere)).toEqual([])
    // More calls about October keep to the scope's one gap, and count in it.
    await deliveries(october, 2)
    await detect()
    expect(await gapsOf(october)).toEqual([])
    expect(await gapsOf(november)).toHaveLength(1)
    expect(await weekly(gap!.id)).toEqual([{ reports: 0, no_item_calls: 8 }])
    // Each month alone stays under the threshold: no gap without the month edge either way.
    const alone = await topic({ month: '2030-10-01' })
    await deliveries(alone, 4)
    await detect()
    expect(await gapsOf(alone)).toEqual([])
  })

  it('counts report_gap as case 2, one gap under simultaneous reports', async () => {
    const reply = await Promise.all(
      Array.from({ length: 6 }, () =>
        store.reportGap(
          {
            key: 'finance|metric:orders|val:market/norway|2026-06',
            area: 'finance',
            metrics: ['metric:orders'],
            values: ['val:market/norway'],
            dimensions: [],
            month: '2026-06-01',
          },
          'Missing market comparison.',
        ),
      ),
    )
    expect(new Set(reply).size).toBe(1)
    const gap = await client.query(
      'select opened_by_case, (select sum(reports)::int from gap_weekly_counts w where w.gap_id=g.id) as reports, (select count(*)::int from gap_notes n where n.gap_id=g.id) as notes from gaps g where id=$1',
      [reply[0]],
    )
    expect(gap.rows).toEqual([{ opened_by_case: 2, reports: 6, notes: 6 }])
  })

  it('never reopens a wont_fix gap by itself, but keeps counting what it sees', async () => {
    const t = await topic()
    await deliveries(t, 5)
    await detect()
    const [gap] = await gapsOf(t)
    await setStatus(gap!.id, 'wont_fix')
    await deliveries(t, 5, {
      hour: new Date(Date.now() + 3600_000).toISOString().slice(0, 13) + ':00:00Z',
    })
    await detect()
    expect(await gapsOf(t)).toEqual([{ ...gap, status: 'wont_fix' }])
    expect(await weekly(gap!.id)).toEqual([{ reports: 0, no_item_calls: 10 }])
  })

  it('keeps a resolved gap closed for earlier evidence and opens a new one for newer', async () => {
    const t = await topic()
    await deliveries(t, 5)
    await detect()
    const [gap] = await gapsOf(t)
    await setStatus(gap!.id, 'resolved')
    await detect()
    expect(await gapsOf(t)).toEqual([{ ...gap, status: 'resolved' }])
    await deliveries(t, 5, {
      hour: new Date(Date.now() + 3600_000).toISOString().slice(0, 13) + ':00:00Z',
    })
    await detect()
    const after = await gapsOf(t)
    // Both carry this hour; hour precision cannot order them.
    expect(after.map((g) => g.status).sort()).toEqual(['open', 'resolved'])
  })

  it('turns negative feedback into case 3 gaps and moves its note under row security', async () => {
    const t = await topic()
    const [wrong, missing, helpful] = await deliveries(t, 3, { status: 'matched', items: 1 })
    const [evaluated] = await deliveries(t, 1, { status: 'matched', items: 1, caller: 'eval' })
    for (const [delivery, verdict, note] of [
      [wrong, 'wrong', 'The closure date is wrong.'],
      [missing, 'missing', null],
      [helpful, 'helpful', 'Useful.'],
      [evaluated, 'wrong', null],
    ])
      await store.feedback(delivery!, verdict as 'wrong', 'claude-code', note ?? undefined)
    await detect()
    await detect()
    const gaps = await client.query(
      `select type, opened_by_case, (select sum(reports)::int from gap_weekly_counts w where w.gap_id=g.id) as reports,
              (select array_agg(note) from gap_notes n where n.gap_id=g.id) as notes
         from gaps g where topic_id=$1 order by type`,
      [t],
    )
    expect(gaps.rows).toEqual([
      { type: 'missing', opened_by_case: 3, reports: 1, notes: null },
      { type: 'incorrect', opened_by_case: 3, reports: 1, notes: ['The closure date is wrong.'] },
    ])
    const feedback = await client.query(
      'select verdict, note, gap_id is not null as linked from feedback where delivery_id = any($1) order by verdict, gap_id is not null desc',
      [[wrong, missing, helpful, evaluated]],
    )
    expect(feedback.rows).toEqual([
      { verdict: 'helpful', note: 'Useful.', linked: false },
      { verdict: 'wrong', note: null, linked: true },
      { verdict: 'wrong', note: null, linked: false },
      { verdict: 'missing', note: null, linked: true },
    ])
  })

  it('opens case 4 gaps on recent topics when a source definition changes', async () => {
    const recent = await topic({ metric: 'metric:orders' })
    const old = await topic({ metric: 'metric:orders', month: '2025-01-01' })
    const snapshot = async (minutesAgo: number, mark: string) => {
      const s = await client.query<{ id: string }>(
        "insert into connector_snapshots (connector_id,status,fetched_at) values ('demo','ok',now() - make_interval(mins => $1)) returning id",
        [minutesAgo],
      )
      await client.query(
        'insert into definition_marks (definition_ref,snapshot_id,change_mark) values ($1,$2,$3)',
        ['demo:orders', s.rows[0]!.id, mark],
      )
    }
    await snapshot(30, 'first')
    await snapshot(20, 'first')
    await detect()
    expect(await gapsOf(recent)).toEqual([])
    await snapshot(10, 'second')
    await detect()
    await detect()
    expect(await gapsOf(recent)).toEqual([
      { id: expect.any(String) as string, type: 'outdated', status: 'open', opened_by_case: 4 },
    ])
    expect(await gapsOf(old)).toEqual([])
  })

  it('keeps gap times to the hour and refuses a precise one', async () => {
    const t = await topic()
    const id = await client.query<{ id: string }>(
      "select cl_gap_touch($1,'missing',2::smallint,now()) as id",
      [t],
    )
    const gap = await client.query(
      `select created_at = date_trunc('hour', created_at, 'UTC') as created, status_since = date_trunc('hour', status_since, 'UTC') as since
         from gaps where id=$1`,
      [id.rows[0]!.id],
    )
    expect(gap.rows).toEqual([{ created: true, since: true }])
    await expect(
      client.query("update gaps set created_at = now() + interval '1 second' where id=$1", [
        id.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('verification by test (FR-610)', () => {
  it('records a resolving edition only on a resolved gap, and verification only with it', async () => {
    const created = await client.query<{ id: string }>(
      "select cl_gap_touch($1,'missing',2::smallint,now()) as id",
      [await topic()],
    )
    const id = created.rows[0]!.id
    // A gap resolved before Heed recorded the edition keeps none: unknown stays unknown.
    await setStatus(id, 'resolved')
    expect(
      (await client.query('select resolved_edition_seq, verified_at from gaps where id=$1', [id]))
        .rows,
    ).toEqual([{ resolved_edition_seq: null, verified_at: null }])
    await expect(
      client.query("update gaps set verified_at=date_trunc('hour', now(), 'UTC') where id=$1", [
        id,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    // The verification names its edition (0044): both or neither, never before the resolving one.
    for (const [resolvedSeq, verifiedSeq] of [
      [edition, null],
      [edition, String(Number(edition) - 1)],
    ])
      await expect(
        client.query(
          "update gaps set resolved_edition_seq=$2, verified_at=date_trunc('hour', now(), 'UTC'), verified_edition_seq=$3 where id=$1",
          [id, resolvedSeq, verifiedSeq],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    await client.query(
      "update gaps set resolved_edition_seq=$2, verified_at=date_trunc('hour', now(), 'UTC'), verified_edition_seq=$2 where id=$1",
      [id, edition],
    )
    // Leaving resolved must clear both, so the next resolution starts afresh.
    for (const status of ['open', 'proposal_made', 'wont_fix'])
      await expect(
        client.query('update gaps set status=$2 where id=$1', [id, status]),
        status,
      ).rejects.toMatchObject({ code: '23514' })
    await client.query(
      "update gaps set status='open', resolved_edition_seq=null, verified_at=null, verified_edition_seq=null where id=$1",
      [id],
    )
    await expect(
      client.query('update gaps set resolved_edition_seq=$2 where id=$1', [id, edition]),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('retention of notes (FR-612)', () => {
  it('clears feedback notes and deletes gap notes past the note period', async () => {
    const t = await topic()
    const gap = (
      await client.query<{ id: string }>(
        "select cl_gap_touch($1,'missing',2::smallint,now(),null,1,'Old note','report_gap') as id",
        [t],
      )
    ).rows[0]!.id
    await client.query(
      "update gap_notes set created_hour = date_trunc('hour', now() - interval '200 days', 'UTC') where gap_id=$1",
      [gap],
    )
    const old = await client.query<{ id: string }>(
      "insert into feedback (verdict,client_label,note,created_hour) values ('helpful','claude-code','Old feedback',date_trunc('hour', now() - interval '200 days', 'UTC')) returning id",
    )
    const fresh = await client.query<{ id: string }>(
      "insert into feedback (verdict,client_label,note) values ('helpful','claude-code','Fresh feedback') returning id",
    )
    const removed = await client.query<{ what: string; n: string }>(
      'select what, n from cl_retention_run()',
    )
    expect(Object.fromEntries(removed.rows.map((r) => [r.what, Number(r.n)]))).toMatchObject({
      gap_notes: 1,
      feedback_notes: 1,
    })
    const notes = await client.query('select id::text, note from feedback where id = any($1)', [
      [old.rows[0]!.id, fresh.rows[0]!.id],
    ])
    expect(
      Object.fromEntries(
        notes.rows.map((r: { id: string; note: string | null }) => [r.id, r.note]),
      ),
    ).toEqual({
      [old.rows[0]!.id]: null,
      [fresh.rows[0]!.id]: 'Fresh feedback',
    })
  })
})

describe('gaps over the API', () => {
  async function smallGap() {
    const t = await topic({ metric: 'metric:orders' })
    const id = (
      await client.query<{ id: string }>(
        "select cl_gap_touch($1,'missing',2::smallint,now(),null,1,'Needs a market comparison.','report_gap') as id",
        [t],
      )
    ).rows[0]!.id
    return { topic: t, id }
  }

  it('shows a small gap to the area owner and administrators only, notes included', async () => {
    const { id } = await smallGap()
    for (const name of ['owner', 'admin']) {
      const response = await api(name, 'GET', `/gaps/${id}`)
      expect(response.statusCode, response.body).toBe(200)
      expect(response.json()).toMatchObject({
        id,
        status: 'open',
        openedBy: 'report_gap',
        reports: 1,
        canManage: true,
        topic: {
          areaId: 'finance',
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
        },
        notes: [{ source: 'report_gap', note: 'Needs a market comparison.' }],
      })
    }
    expect((await api('stranger', 'GET', `/gaps/${id}`)).statusCode).toBe(404)
    const list = await api('stranger', 'GET', '/gaps?limit=200')
    expect(list.json<{ id: string }[]>().map((g) => g.id)).not.toContain(id)
  })

  async function shownGap() {
    const t = await topic({ metric: 'metric:orders' })
    await deliveries(t, 5)
    const id = (
      await client.query<{ id: string }>(
        "select cl_gap_touch($1,'missing',2::smallint,now(),null,5,'Needs a market comparison.','report_gap') as id",
        [t],
      )
    ).rows[0]!.id
    return { topic: t, id }
  }
  const weeksOf = async (name: string, id: string) =>
    (await api(name, 'GET', `/gaps/${id}`)).json<{
      reports: number | null
      noItemCalls: number | null
      weeks: object[]
    }>()

  it('shows a gap to anyone once a week reaches the minimum, without notes', async () => {
    const { id } = await shownGap()
    const response = await api('stranger', 'GET', `/gaps/${id}`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      id,
      canManage: false,
      notes: null,
      reports: 5,
      noItemCalls: null,
      weeks: [{ reports: 5, noItemCalls: 0 }],
    })
    expect(
      (await api('stranger', 'POST', `/gaps/${id}/status`, { status: 'wont_fix' })).statusCode,
    ).toBe(403)
    expect((await api('stranger', 'POST', `/gaps/${id}/notes`, { note: 'x' })).statusCode).toBe(403)
  })

  it('hides a topic asked about once a week for five weeks from readers, not from an owner', async () => {
    const t = await topic()
    const id = (
      await client.query<{ id: string }>(
        "select cl_gap_touch($1,'missing',2::smallint,now(),null,0) as id",
        [t],
      )
    ).rows[0]!.id
    for (let i = 0; i < 5; i++) {
      const week = new Date(Date.now() - i * 7 * 86_400_000).toISOString().slice(0, 13) + ':00:00Z'
      await deliveries(t, 1, { hour: week })
      await client.query("select cl_gap_touch($1,'missing',2::smallint,$2::timestamptz,null,1)", [
        t,
        week,
      ])
    }
    expect((await api('stranger', 'GET', `/gaps/${id}`)).statusCode).toBe(404)
    const list = await api('stranger', 'GET', '/gaps?limit=200')
    expect(list.json<{ id: string }[]>().map((g) => g.id)).not.toContain(id)
    for (const name of ['owner', 'admin']) {
      const detail = await weeksOf(name, id)
      expect(detail.reports).toBe(5)
      expect(detail.weeks).toHaveLength(5)
    }
  })

  it('shows readers only the weeks that individually pass', async () => {
    const { topic: t, id } = await shownGap()
    await deliveries(t, 5, { hour: '2025-01-08T10:00:00Z' })
    await client.query(
      "select cl_gap_touch($1,'missing',2::smallint,'2025-01-08T10:00:00Z',null,2)",
      [t],
    )
    await deliveries(t, 2, { hour: '2025-02-05T10:00:00Z' })
    await client.query(
      "select cl_gap_touch($1,'missing',2::smallint,'2025-02-05T10:00:00Z',null,9)",
      [t],
    )
    const reader = await weeksOf('stranger', id)
    expect(reader.weeks).toEqual([
      { week: expect.any(String) as string, reports: 5, personReports: null, noItemCalls: 0 },
    ])
    expect(reader.reports).toBe(5)
    const owner = await weeksOf('owner', id)
    expect(owner.weeks).toHaveLength(3)
    expect(owner.reports).toBe(16)
  })

  it('lets an owner change the status and add a checked note, with history', async () => {
    const { id } = await smallGap()
    const refused = await api('owner', 'POST', `/gaps/${id}/notes`, {
      note: 'Ask person@example.test',
    })
    expect(refused.statusCode).toBe(422)
    const noted = await api('owner', 'POST', `/gaps/${id}/notes`, {
      note: 'Checked with the team.',
    })
    expect(noted.statusCode, noted.body).toBe(200)
    expect(
      noted
        .json<{ notes: { source: string }[] }>()
        .notes.map((n) => n.source)
        .sort(),
    ).toEqual(['owner', 'report_gap'])
    const closed = await api('owner', 'POST', `/gaps/${id}/status`, {
      status: 'wont_fix',
      reason: 'Covered by the source tool.',
    })
    expect(closed.json()).toMatchObject({ status: 'wont_fix' })
    const audit = await client.query(
      "select action, details from audit_log where subject_type='gap' order by seq desc limit 2",
    )
    expect(audit.rows).toEqual([
      {
        action: 'gap.status_changed',
        details: { from: 'open', to: 'wont_fix', reason: 'Covered by the source tool.' },
      },
      { action: 'gap.note_added', details: {} },
    ])
  })

  it('refuses to reopen a gap while another for the same topic and type is open', async () => {
    const { topic: t, id } = await smallGap()
    await setStatus(id, 'resolved')
    await client.query(
      "select cl_gap_touch($1,'missing',2::smallint,now() + interval '2 hours',null,1)",
      [t],
    )
    const response = await api('owner', 'POST', `/gaps/${id}/status`, { status: 'open' })
    expect(response.statusCode, response.body).toBe(409)
  })

  it('starts a draft from a gap in one action, filled with its scope (FR-616)', async () => {
    const { id } = await shownGap()
    const response = await api('stranger', 'POST', `/gaps/${id}/draft`, {})
    expect(response.statusCode, response.body).toBe(200)
    const proposal = response.json<{
      id: string
      state: string
      draft: object
      proposerId: string
    }>()
    expect(proposal).toMatchObject({
      state: 'draft',
      proposerId: people.stranger,
      draft: {
        areaId: 'finance',
        scope: {
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
        },
      },
    })
    // The gap's month is when people asked, not when the fact applies: no dates.
    expect(proposal.draft).not.toHaveProperty('validity')
    const linked = await client.query(
      'select g.status, p.source_gap_id::text as source, exists (select 1 from gap_proposals x where x.gap_id=g.id and x.proposal_id=p.id) as linked from gaps g, proposals p where g.id=$1 and p.id=$2',
      [id, proposal.id],
    )
    expect(linked.rows).toEqual([{ status: 'proposal_made', source: id, linked: true }])
    expect((await api('owner', 'GET', `/gaps/${id}`)).json()).toMatchObject({
      proposals: [proposal.id],
    })
  })

  it('asks for an area when a topic has none', async () => {
    const t = await topic({ area: null })
    const id = (
      await client.query<{ id: string }>(
        "select cl_gap_touch($1,'missing',2::smallint,now()) as id",
        [t],
      )
    ).rows[0]!.id
    expect((await api('admin', 'POST', `/gaps/${id}/draft`, {})).statusCode).toBe(400)
    expect(
      (await api('admin', 'POST', `/gaps/${id}/draft`, { areaId: 'finance' })).statusCode,
    ).toBe(200)
  })
})

describe('gap tests over the API (FR-610, FR-524)', () => {
  let label: string
  let failing: string
  let newest: string
  let marketingRun: string

  /** A finished answer run of an area, with each question's verdict, as the runner stores it. */
  async function answerRun(
    area: string,
    verdicts: Record<string, string>,
    finishedAt: string,
    kind = 'scheduled',
  ) {
    const result = await client.query<{ id: string }>(
      `insert into eval_runs (kind,state,area_id,tool_schema_digest,model_id,client_label,test_set_digest,tries,
                              estimated_cost_micros,started_at,finished_at,summary)
       values ($1,'finished',$2,'x','mock/scripted-answer','eval','\\x00',3,0,$3,$3,$4) returning id::text`,
      [
        kind,
        area,
        finishedAt,
        JSON.stringify({
          edition: label,
          result: {
            questions: Object.entries(verdicts).map(([id, baseline]) => ({ id, baseline })),
          },
        }),
      ],
    )
    return result.rows[0]!.id
  }
  async function shownGap(area = 'finance') {
    const t = await topic({ area })
    await deliveries(t, 5)
    return (
      await client.query<{ id: string }>(
        "select cl_gap_touch($1,'missing',2::smallint,now(),null,5) as id",
        [t],
      )
    ).rows[0]!.id
  }
  const gapAudit = async (id: string) =>
    (
      await client.query<{ action: string; actor: string; details: object }>(
        `select a.action, a.actor_id::text as actor, a.details from audit_log a join gaps g on g.ref=a.subject_id
          where a.subject_type='gap' and g.id=$1 order by a.seq`,
        [id],
      )
    ).rows
  const linksOf = async (id: string) =>
    (
      await client.query<{ question: string }>(
        'select question_id as question from gap_tests where gap_id=$1 order by question_id',
        [id],
      )
    ).rows.map((row) => row.question)

  beforeAll(async () => {
    label = (
      await client.query<{ label: string }>(
        'select label from editions e join live_edition l on l.seq=e.seq',
      )
    ).rows[0]!.label
    await client.query(`insert into golden_questions (id,area_id,wordings,scope,expected,source,split,status) values
      ('gt-dev','finance','["a","b"]','{}','{}','test','development','active'),
      ('gt-second','finance','["a","b"]','{}','{}','test','development','active'),
      ('gt-held','finance','["a","b"]','{}','{}','test','held_out','active'),
      ('gt-retired','finance','["a","b"]','{}','{}','test','development','retired'),
      ('gt-marketing','marketing','["a","b"]','{}','{}','test','development','active'),
      ('gt-marketing-held','marketing','["a","b"]','{}','{}','test','held_out','active')`)
    failing = await answerRun('finance', { 'gt-dev': 'fail' }, '2026-10-05T06:00:00Z')
    newest = await answerRun('finance', { 'gt-dev': 'pass' }, '2026-10-06T06:00:00Z', 'full')
    // A newer run that set the question aside does not count as its result.
    await answerRun('finance', {}, '2026-10-07T06:00:00Z')
    marketingRun = await answerRun('marketing', {}, '2026-10-05T06:00:00Z')
  })

  it('links a test of the area once, with its evidence and newest result, and unlinks it', async () => {
    const id = await shownGap()
    const linked = await api('owner', 'POST', `/gaps/${id}/tests`, {
      question: 'gt-dev',
      evidenceRun: failing,
    })
    expect(linked.statusCode, linked.body).toBe(200)
    expect(linked.json()).toMatchObject({
      tests: [
        {
          question: 'gt-dev',
          split: 'development',
          active: true,
          linkedHour: thisHour(),
          evidenceRun: failing,
          passed: null,
          latest: {
            run: newest,
            kind: 'full',
            edition: label,
            finishedAt: '2026-10-06T06:00:00Z',
            verdict: 'pass',
          },
        },
      ],
      history: [
        {
          action: 'gap.test_linked',
          hour: thisHour(),
          details: { question: 'gt-dev', evidenceRun: failing },
        },
      ],
    })
    // Linking it again changes nothing, and the history log says who linked it.
    const again = await api('admin', 'POST', `/gaps/${id}/tests`, { question: 'gt-dev' })
    expect(again.statusCode, again.body).toBe(200)
    expect(await gapAudit(id)).toEqual([
      {
        action: 'gap.test_linked',
        actor: people.owner,
        details: { question: 'gt-dev', evidenceRun: failing },
      },
    ])
    // A held-out test of the area may be linked: only the gap's managers read its links.
    expect(
      (await api('owner', 'POST', `/gaps/${id}/tests`, { question: 'gt-held' })).statusCode,
    ).toBe(200)
    expect(await linksOf(id)).toEqual(['gt-dev', 'gt-held'])

    const unlinked = await api('owner', 'POST', `/gaps/${id}/tests/gt-dev/unlink`)
    expect(unlinked.statusCode, unlinked.body).toBe(200)
    expect(unlinked.json<{ tests: { question: string }[] }>().tests.map((t) => t.question)).toEqual(
      ['gt-held'],
    )
    expect((await api('owner', 'POST', `/gaps/${id}/tests/gt-dev/unlink`)).statusCode).toBe(200)
    expect((await gapAudit(id)).map((row) => row.action)).toEqual([
      'gap.test_linked',
      'gap.test_linked',
      'gap.test_unlinked',
    ])
  })

  it('refuses a contributor, an owner of another area, and a test or run of another area', async () => {
    const id = await shownGap()
    expect(
      (await api('stranger', 'POST', `/gaps/${id}/tests`, { question: 'gt-dev' })).statusCode,
    ).toBe(403)
    expect((await api('author', 'POST', `/gaps/${id}/tests/gt-dev/unlink`)).statusCode).toBe(403)
    const marketing = await shownGap('marketing')
    expect(
      (await api('owner', 'POST', `/gaps/${marketing}/tests`, { question: 'gt-marketing' }))
        .statusCode,
    ).toBe(403)
    const other = await api('owner', 'POST', `/gaps/${id}/tests`, { question: 'gt-marketing' })
    expect(other.statusCode, other.body).toBe(422)
    // A held-out question of another area is not found for anyone but its maintainers (FR-503).
    expect(
      (await api('owner', 'POST', `/gaps/${id}/tests`, { question: 'gt-marketing-held' }))
        .statusCode,
    ).toBe(404)
    expect(
      (await api('admin', 'POST', `/gaps/${id}/tests`, { question: 'gt-marketing-held' }))
        .statusCode,
    ).toBe(422)
    expect(
      (await api('owner', 'POST', `/gaps/${id}/tests`, { question: 'gt-nothing' })).statusCode,
    ).toBe(404)
    expect(
      (
        await api('owner', 'POST', `/gaps/${id}/tests`, {
          question: 'gt-dev',
          evidenceRun: marketingRun,
        })
      ).statusCode,
    ).toBe(422)
    expect(
      (
        await api('owner', 'POST', `/gaps/${id}/tests`, {
          question: 'gt-dev',
          evidenceRun: randomUUID(),
        })
      ).statusCode,
    ).toBe(422)
    expect(await linksOf(id)).toEqual([])
    expect(await linksOf(marketing)).toEqual([])
  })

  it('records the live edition on resolving, and clears it and the verification on leaving resolved', async () => {
    const id = await shownGap()
    await api('owner', 'POST', `/gaps/${id}/tests`, { question: 'gt-dev' })
    const resolved = await api('owner', 'POST', `/gaps/${id}/status`, { status: 'resolved' })
    expect(resolved.json()).toMatchObject({
      status: 'resolved',
      resolvedEdition: label,
      verifiedAt: null,
    })
    const [stored] = (
      await client.query<{ seq: string }>(
        'select resolved_edition_seq::text as seq from gaps where id=$1',
        [id],
      )
    ).rows
    expect(stored!.seq).toBe(edition)
    // What slice V3 will record when a weekly run passes it.
    await client.query(
      `update gap_tests set passed_run=$2, passed_edition_seq=$3, passed_revision=1,
              passed_hour=date_trunc('hour', now(), 'UTC') where gap_id=$1`,
      [id, newest, edition],
    )
    await client.query(
      "update gaps set verified_at=date_trunc('hour', now(), 'UTC'), verified_edition_seq=$2 where id=$1",
      [id, edition],
    )
    expect((await api('owner', 'GET', `/gaps/${id}`)).json()).toMatchObject({
      verifiedAt: thisHour(),
      verifiedEdition: label,
      tests: [
        {
          question: 'gt-dev',
          passed: { run: newest, edition: label, revision: 1, hour: thisHour() },
        },
      ],
    })

    const reopened = await api('owner', 'POST', `/gaps/${id}/status`, { status: 'open' })
    expect(reopened.statusCode, reopened.body).toBe(200)
    expect(reopened.json()).toMatchObject({
      status: 'open',
      resolvedEdition: null,
      verifiedAt: null,
      verifiedEdition: null,
      tests: [{ question: 'gt-dev', passed: null }],
    })
    expect(
      (
        await client.query(
          'select resolved_edition_seq, verified_at, verified_edition_seq from gaps where id=$1',
          [id],
        )
      ).rows,
    ).toEqual([{ resolved_edition_seq: null, verified_at: null, verified_edition_seq: null }])
    expect((await gapAudit(id)).map((row) => [row.action, row.details])).toEqual([
      ['gap.test_linked', { question: 'gt-dev' }],
      ['gap.status_changed', { from: 'open', to: 'resolved', edition: label }],
      ['gap.status_changed', { from: 'resolved', to: 'open' }],
      ['gap.verification_cleared', {}],
    ])
    expect(
      reopened.json<{ history: { action: string }[] }>().history.map((entry) => entry.action),
    ).toEqual([
      'gap.test_linked',
      'gap.status_changed',
      'gap.status_changed',
      'gap.verification_cleared',
    ])

    // Won't fix keeps no edition, so nothing can verify it; resolving again starts afresh.
    const closed = await api('owner', 'POST', `/gaps/${id}/status`, { status: 'wont_fix' })
    expect(closed.json()).toMatchObject({
      status: 'wont_fix',
      resolvedEdition: null,
      verifiedAt: null,
    })
    await expect(
      client.query(
        "update gaps set verified_at=date_trunc('hour', now(), 'UTC'), verified_edition_seq=$2 where id=$1",
        [id, edition],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('shows every reader whether a gap is verified by test, and only its managers which tests', async () => {
    const id = await shownGap()
    await api('owner', 'POST', `/gaps/${id}/tests`, { question: 'gt-held' })
    await api('owner', 'POST', `/gaps/${id}/status`, { status: 'resolved' })
    await client.query(
      "update gaps set verified_at=date_trunc('hour', now(), 'UTC'), verified_edition_seq=$2 where id=$1",
      [id, edition],
    )
    const reader = await api('stranger', 'GET', `/gaps/${id}`)
    expect(reader.statusCode, reader.body).toBe(200)
    expect(reader.json()).toMatchObject({
      canManage: false,
      resolvedEdition: label,
      verifiedAt: thisHour(),
      verifiedEdition: label,
      tests: null,
      history: null,
    })
    expect(reader.body).not.toContain('gt-held')
    // The owner-run history read answers nothing to someone who does not manage the gap.
    await transaction(client, async () => {
      await client.query(`set local role ${identifier(localRoles.api)}`)
      await client.query("select set_config('cl.person_id', $1, true)", [people.stranger])
      expect((await client.query('select * from cl_gap_history($1)', [id])).rows).toEqual([])
    })
    expect((await api('admin', 'GET', `/gaps/${id}`)).json()).toMatchObject({
      tests: [{ question: 'gt-held', split: 'held_out' }],
    })
  })

  it("attaches a gap's active development tests to a draft started from it, whoever starts it", async () => {
    const id = await shownGap()
    for (const question of ['gt-dev', 'gt-second', 'gt-held', 'gt-retired'])
      await api('owner', 'POST', `/gaps/${id}/tests`, { question })
    const response = await api('stranger', 'POST', `/gaps/${id}/draft`, {})
    expect(response.statusCode, response.body).toBe(200)
    const proposal = response.json<{ id: string }>().id
    expect(
      (
        await client.query(
          'select question_id from proposal_tests where proposal_id=$1 order by question_id',
          [proposal],
        )
      ).rows.map((row: { question_id: string }) => row.question_id),
    ).toEqual(['gt-dev', 'gt-second'])
    expect((await gapAudit(id)).at(-1)).toEqual({
      action: 'gap.draft_started',
      actor: people.stranger,
      details: { proposal, tests: ['gt-dev', 'gt-second'] },
    })
    // The function attaches only to the caller's own draft started from the gap.
    const other = await client.query<{ id: string }>(
      "insert into proposals (action,area_id,proposer_id,channel,source_gap_id) values ('create','finance',$1,'form',$2) returning id::text",
      [people.author, id],
    )
    await transaction(client, async () => {
      await client.query(`set local role ${identifier(localRoles.api)}`)
      await client.query("select set_config('cl.person_id', $1, true)", [people.stranger])
      expect(
        (await client.query('select * from cl_gap_draft_tests($1)', [other.rows[0]!.id])).rows,
      ).toEqual([])
    })
  })
})

describe('dashboards (FR-614, FR-615)', () => {
  it('hides every call count below the minimum and shows the rest', async () => {
    await client.query("insert into areas (id,name) values ('dash','Dashboard')")
    await client.query(
      "insert into area_assignments (area_id,person_id,role) values ('dash',$1,'owner')",
      [people.owner],
    )
    const busy = await topic({ area: 'dash', metric: 'metric:orders' })
    await deliveries(busy, 6, { status: 'matched', items: 1 })
    await deliveries(busy, 2, { status: 'no_match' })
    const quiet = await topic({ area: 'dash', metric: 'metric:quiet' })
    await deliveries(quiet, 3, { status: 'no_match' })
    const lastWeek = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 13) + ':00:00Z'
    await deliveries(busy, 2, { hour: lastWeek })
    await client.query("select cl_gap_touch($1,'missing',2::smallint,now())", [busy])

    // The dashboard is the area's owners' and the administrators' (Quality design G13), and
    // hides small counts from them too.
    expect((await api('stranger', 'GET', '/areas/dash/dashboard?weeks=3')).statusCode).toBe(403)
    const response = await api('owner', 'GET', '/areas/dash/dashboard?weeks=3')
    expect(response.statusCode, response.body).toBe(200)
    const dashboard = response.json<{
      minimumCount: number
      weeks: { calls: number | null; noItemCalls: number | null; noItemShare: number | null }[]
      openGaps: number
      openGapsByType: object[]
      itemsPastReview: number
      reviewTimes: object
    }>()
    expect(dashboard.minimumCount).toBe(5)
    expect(dashboard.weeks).toHaveLength(3)
    expect(dashboard.weeks.at(-1)).toEqual({
      calls: 11,
      noItemCalls: 5,
      noItemShare: 5 / 11,
      week: expect.any(String) as string,
    })
    expect(dashboard.weeks.at(-2)).toEqual({
      calls: null,
      noItemCalls: null,
      noItemShare: null,
      week: expect.any(String) as string,
    })
    expect(dashboard.weeks[0]).toEqual({
      calls: 0,
      noItemCalls: 0,
      noItemShare: null,
      week: expect.any(String) as string,
    })
    expect(dashboard).toMatchObject({
      openGaps: 1,
      openGapsByType: [{ type: 'missing', gaps: 1 }],
      itemsPastReview: 0,
      reviewTimes: { decided: 0, medianHours: null },
    })

    const counts = await api('stranger', 'GET', '/topics/counts?areaId=dash&weeks=1')
    expect(counts.json()).toEqual({
      minimumCount: 5,
      rows: [
        {
          topic: expect.objectContaining({ metrics: ['metric:orders'] }) as object,
          week: expect.any(String) as string,
          calls: 8,
          noItemCalls: null,
          noItemShare: null,
        },
      ],
      hiddenTopicWeeks: 1,
    })
    expect((await api('admin', 'GET', '/areas/nowhere/dashboard')).statusCode).toBe(404)
  })

  it('reports review times and items past their review date for the area', async () => {
    await transaction(client, async () => {
      const past = await version(client, { reviewDate: '2026-09-01' })
      await accept(client, past.id)
      await publish(client, past.id)
    })
    const response = await api('owner', 'GET', '/areas/finance/dashboard')
    expect(response.json()).toMatchObject({
      itemsPastReview: 1,
      reviewTimes: { decided: 2, medianHours: expect.any(Number) as number },
    })
  })
})

describe('export surfaces (FR-614)', () => {
  async function asReadonly<T>(work: () => Promise<T>) {
    await client.query(`set role ${identifier(localRoles.readonly)}`)
    try {
      return await work()
    } finally {
      await client.query(`set role ${identifier(localRoles.owner)}`)
    }
  }
  it('hides exactly the same cells on every surface', async () => {
    await client.query("insert into areas (id,name) values ('cross','Cross')")
    const t = await topic({ area: 'cross', metric: 'metric:cross' })
    const lastWeek = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 13) + ':00:00Z'
    await deliveries(t, 5, { status: 'matched', items: 1 })
    await deliveries(t, 1, { status: 'no_match' })
    await deliveries(t, 3, { hour: lastWeek })
    const gap = (
      await client.query<{ id: string }>(
        "select cl_gap_touch($1,'missing',2::smallint,now(),null,0) as id",
        [t],
      )
    ).rows[0]!.id
    await client.query(
      'insert into gap_weekly_counts (gap_id, week, reports, no_item_calls) select $1, week, 6, 1 from topic_week_counts where topic_id=$2 and calls=5',
      [gap, t],
    )
    await client.query(
      'insert into gap_weekly_counts (gap_id, week, reports, no_item_calls) select $1, week, 6, 3 from topic_week_counts where topic_id=$2 and calls=3',
      [gap, t],
    )

    const noItem = (rows: { week: string; noItemCalls: number | null }[]) =>
      rows.map((r) => [r.week.slice(0, 10), r.noItemCalls]).sort()
    const exported = await asReadonly(async () =>
      (
        await client.query<{ week: string; no_item_calls: number | null }>(
          "select week::text, no_item_calls from v_topic_counts_public where area_id='cross'",
        )
      ).rows.map((r) => ({ week: r.week, noItemCalls: r.no_item_calls })),
    )
    const counts = (await api('stranger', 'GET', '/topics/counts?areaId=cross&weeks=2')).json<{
      rows: { week: string; noItemCalls: number | null }[]
    }>().rows
    const dashboard = (await api('admin', 'GET', '/areas/cross/dashboard?weeks=2')).json<{
      weeks: { week: string; calls: number | null; noItemCalls: number | null }[]
    }>().weeks
    const gapWeeks = (await api('stranger', 'GET', `/gaps/${gap}`)).json<{
      weeks: { week: string; noItemCalls: number | null }[]
    }>().weeks

    const shownWeeks = <T extends { calls: number | null }>(rows: T[]) =>
      rows.filter((r) => r.calls !== null)
    expect(exported).toHaveLength(1)
    expect(exported[0]!.noItemCalls).toBeNull()
    expect(noItem(counts)).toEqual(noItem(exported))
    expect(noItem(gapWeeks)).toEqual(noItem(exported))
    expect(noItem(shownWeeks(dashboard))).toEqual(noItem(exported))
    expect(dashboard.filter((r) => r.calls === null)).toHaveLength(1)
    expect(dashboard.every((r) => r.noItemCalls === null)).toBe(true)
  })

  it('gives analytics topic detail only at the minimum count, and gaps only as totals', async () => {
    const shown = await topic({ metric: 'metric:shown' })
    const hidden = await topic({ metric: 'metric:hidden' })
    await deliveries(shown, 5)
    await deliveries(hidden, 4)
    await asReadonly(async () => {
      const rows = await client.query<{ metric_keys: string[] }>(
        'select metric_keys from v_topic_counts_public',
      )
      const metrics = rows.rows.flatMap((r) => r.metric_keys)
      expect(metrics).toContain('metric:shown')
      expect(metrics).not.toContain('metric:hidden')
      expect((await client.query('select * from v_gap_totals')).rows.length).toBeGreaterThan(0)
      for (const table of [
        'topics',
        'topic_week_counts',
        'gaps',
        'gap_weekly_counts',
        'gap_notes',
        'deliveries',
        'feedback',
      ])
        await expect(client.query(`select * from ${table}`)).rejects.toMatchObject({
          code: '42501',
        })
    })
  })
})
