import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { systemClock } from '../../src/server/clock.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import type { JobContext } from '../../src/server/modules/jobs/index.ts'
import { weeklyRollupJob } from '../../src/server/modules/observability/index.ts'
import { foundation, servingEdition } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The weekly counts Observability keeps without limit (obs_weekly, FR-612, FR-620): each completed
  week's agent calls by domain and answer state, counted from the deliveries and
  nothing else. Counting a week again keeps the same counts; a week whose deliveries retention
  dropped stays as it was kept. Today is Wednesday 28 October 2026: the last completed week starts on
  Monday 19 October.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const today = '2026-10-28'
const clock = systemClock(today)
const job = weeklyRollupJob({ clock })
const context = { database } as JobContext

type State = 'grounded' | 'partial' | 'conflict' | 'stale' | 'missing' | 'failed'
const topics: Record<string, string> = {}
let edition: string

/** Agent calls about a topic at 10:00 UTC on a day, in an answer state. */
async function calls(
  topic: string | null,
  day: string,
  state: State | null,
  n: number,
  caller = 'agent',
) {
  await client.query(
    `insert into deliveries (delivered_hour, client_label, caller, edition_seq, overlay_seq,
                             tool_schema_digest, topic_id, scope, status, answer_state)
     select $1, 'weekly', $2::caller_kind, $3, 0, 'digest', $4, '{}',
            case when $4::uuid is null then 'need_more_detail' when $5 = 'missing' then 'no_match'
                 else 'matched' end::delivery_status, $5
       from generate_series(1, $6)`,
    [`${day}T10:00:00Z`, caller, edition, topic ? topics[topic] : null, state, n],
  )
}

/** Everything kept, in a stable order, to compare runs. */
async function kept() {
  const { rows } = await client.query<{
    week: string
    area: string | null
    state: string
    calls: number
  }>(
    `select week::text, area_id as area, answer_state as state, calls
       from obs_weekly order by week, area_id nulls last, answer_state`,
  )
  return rows
}

async function setRetention(days: number) {
  await client.query(
    `insert into settings_versions (key, version, value, reason)
     select 'retention.delivery_days', max(version) + 1, $1::jsonb, 'test'
       from settings_versions where key = 'retention.delivery_days'`,
    [JSON.stringify(days)],
  )
}

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    edition = (await servingEdition(client)).edition
  })
  for (const [month, next] of [
    ['2026_09', '2026-10-01'],
    ['2026_10', '2026-11-01'],
  ] as const)
    await client.query(
      `create table if not exists deliveries_${month} partition of deliveries
         for values from ('${month.replace('_', '-')}-01 00:00Z') to ('${next} 00:00Z')`,
    )
  for (const [name, area] of [
    ['finance', 'finance'],
    ['marketing', 'marketing'],
    ['nowhere', null],
  ] as const) {
    const { rows } = await client.query<{ id: string }>(
      `insert into topics (key, area_id, metric_keys, value_keys, month)
       values ($1, $2, '{metric:orders}', '{val:market/norway}', '2026-10-01') returning id::text`,
      [`weekly|${name}`, area],
    )
    topics[name] = rows[0]!.id
  }
  // The week of 7 September.
  await calls('finance', '2026-09-08', 'grounded', 12)
  await calls('finance', '2026-09-08', 'missing', 3)
  // The week of 5 October.
  await calls('finance', '2026-10-06', 'grounded', 20)
  await calls('finance', '2026-10-06', 'grounded', 6)
  await calls('finance', '2026-10-06', 'partial', 2)
  await calls('marketing', '2026-10-07', 'missing', 7)
  await calls('nowhere', '2026-10-08', 'stale', 5)
  // The week of 19 October, ending on Sunday the 25th.
  await calls('finance', '2026-10-20', 'grounded', 9)
  await calls('finance', '2026-10-25', 'conflict', 1)
  // Not counted: a failed check, a question that could not be read, an answer test's call, and
  // this week, which is not over.
  await calls('finance', '2026-10-21', 'failed', 4)
  await calls(null, '2026-10-21', null, 6)
  await calls('finance', '2026-10-21', 'grounded', 8, 'eval')
  await calls('finance', '2026-10-27', 'grounded', 50)
})
afterAll(async () => {
  await database.close()
})

describe('the roll-up (observability.rollup)', () => {
  it('backfills every completed week from the oldest delivery, by domain and answer state', async () => {
    const summary = await job.run(context)
    expect(summary).toEqual({
      weeks: [
        '2026-09-07',
        '2026-09-14',
        '2026-09-21',
        '2026-09-28',
        '2026-10-05',
        '2026-10-12',
        '2026-10-19',
      ],
      rows: 8,
      // No saved question was checked and no alert raised: nothing was caught.
      caughtWeeks: [],
      caughtRows: 0,
    })
    expect(await kept()).toEqual([
      { week: '2026-09-07', area: 'finance', state: 'grounded', calls: 12 },
      { week: '2026-09-07', area: 'finance', state: 'missing', calls: 3 },
      { week: '2026-10-05', area: 'finance', state: 'grounded', calls: 26 },
      { week: '2026-10-05', area: 'finance', state: 'partial', calls: 2 },
      { week: '2026-10-05', area: 'marketing', state: 'missing', calls: 7 },
      { week: '2026-10-05', area: null, state: 'stale', calls: 5 },
      { week: '2026-10-19', area: 'finance', state: 'conflict', calls: 1 },
      { week: '2026-10-19', area: 'finance', state: 'grounded', calls: 9 },
    ])
  })

  it('keeps the same counts when it runs again, and when a week is counted again', async () => {
    const before = await kept()
    // From the latest week kept: a call that comes in late still counts.
    expect(await job.run(context)).toEqual({
      weeks: ['2026-10-19'],
      rows: 2,
      caughtWeeks: [],
      caughtRows: 0,
    })
    for (const week of ['2026-09-07', '2026-10-05', '2026-10-05'])
      await client.query('select cl_obs_weekly_rollup($1)', [week])
    expect(await kept()).toEqual(before)
  })

  it('counts a call that came in late to the latest week kept', async () => {
    await calls('finance', '2026-10-25', 'grounded', 1)
    await job.run(context)
    expect((await kept()).filter((r) => r.week === '2026-10-19')).toEqual([
      { week: '2026-10-19', area: 'finance', state: 'conflict', calls: 1 },
      { week: '2026-10-19', area: 'finance', state: 'grounded', calls: 10 },
    ])
  })

  it('keeps a week after retention drops its deliveries, and never counts it again', async () => {
    const before = await kept()
    // Retention at 7 days drops September's deliveries, the oldest partition, first.
    await setRetention(7)
    try {
      await client.query('alter table deliveries detach partition deliveries_2026_09')
      await client.query('drop table deliveries_2026_09')
      // The week of 7 September, and the one that ends in October, may no longer be whole.
      for (const week of ['2026-09-07', '2026-09-28'])
        expect(
          (await client.query('select cl_obs_weekly_rollup($1) as kept', [week])).rows,
        ).toEqual([{ kept: null }])
      // A week inside the partitions still kept is counted again as it was.
      expect(
        (await client.query('select cl_obs_weekly_rollup($1) as kept', ['2026-10-05'])).rows,
      ).toEqual([{ kept: '4' }])
      await job.run(context)
      expect(await kept()).toEqual(before)
    } finally {
      await setRetention(180)
    }
  })

  it('refuses a week that does not start on a Monday, and a missing day', async () => {
    await expect(client.query("select cl_obs_weekly_rollup('2026-10-06')")).rejects.toMatchObject({
      code: '22023',
    })
    await expect(
      client.query('select * from cl_obs_weekly_rollup_due(null)'),
    ).rejects.toMatchObject({ code: '22023' })
  })
})

describe('what obs_weekly may hold (FR-602, FR-613)', () => {
  const as = async (role: string, sql: string, values?: unknown[]) => {
    await client.query(`set role ${identifier(role)}`)
    try {
      return await client.query(sql, values)
    } finally {
      await client.query(`set role ${identifier(localRoles.owner)}`)
    }
  }

  it('keeps no words: an answer state from a fixed list, a Monday, a count over 0', async () => {
    const insert = (week: string, state: string, n: number) =>
      client.query(
        `insert into obs_weekly (week, area_id, answer_state, calls)
         values ($1, 'finance', $2, $3)`,
        [week, state, n],
      )
    for (const [week, state, n] of [
      ['2026-08-03', 'Orders in Norway', 5],
      ['2026-08-03', 'failed', 5],
      ['2026-08-04', 'grounded', 5],
      ['2026-08-03', 'grounded', 0],
    ] as const)
      await expect(insert(week, state, n), `${week} ${state} ${n}`).rejects.toMatchObject({
        code: '23514',
      })
    // One row a week, domain and answer state, with no domain as with one.
    const none = (n: number) =>
      client.query(
        `insert into obs_weekly (week, area_id, answer_state, calls)
         values ('2026-08-03', null, 'grounded', $1)`,
        [n],
      )
    try {
      await none(5)
      await expect(none(6)).rejects.toMatchObject({ code: '23505' })
    } finally {
      await client.query("delete from obs_weekly where week = '2026-08-03'")
    }
  })

  it('lets the API role read the counts and run the roll-up, and only through it write them', async () => {
    expect((await as(localRoles.api, 'select count(*)::int as n from obs_weekly')).rows).toEqual([
      { n: 8 },
    ])
    for (const sql of [
      "insert into obs_weekly (week, answer_state, calls) values ('2026-08-03', 'grounded', 5)",
      'update obs_weekly set calls = calls + 1',
      'delete from obs_weekly',
      "select cl_obs_weekly_rollup('2026-10-05')",
    ])
      await expect(as(localRoles.api, sql), sql).rejects.toMatchObject({ code: '42501' })
  })

  it('gives the serving and analytics roles none of it', async () => {
    for (const role of [localRoles.serve, localRoles.readonly]) {
      for (const sql of [
        'select * from obs_weekly',
        `select * from cl_obs_weekly_rollup_due('${today}')`,
      ])
        await expect(as(role, sql), `${role}: ${sql}`).rejects.toMatchObject({ code: '42501' })
    }
  })
})
