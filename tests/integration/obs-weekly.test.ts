import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppFamily } from '../../src/domain/app-family.ts'
import { shownStates } from '../../src/domain/observability.ts'
import { systemClock } from '../../src/server/clock.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import type { JobContext } from '../../src/server/modules/jobs/index.ts'
import {
  createObservabilityService,
  weeklyRollupJob,
  type ObservabilityService,
  type WeeklyCounts,
} from '../../src/server/modules/observability/index.ts'
import { foundation, people, servingEdition } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The weekly counts Observability keeps without limit (obs_weekly, FR-612, FR-620): each completed
  week's agent calls by domain, answer state and kind of agent, counted from the deliveries and
  nothing else. Counting a week again keeps the same counts; a week whose deliveries retention
  dropped stays as it was kept. Small counts are hidden when they are read, never subtracted to
  give one away (FR-614). Today is Wednesday 28 October 2026: the last completed week starts on
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

/** Agent calls about a topic at 10:00 UTC on a day, in an answer state, from a kind of agent. */
async function calls(
  topic: string | null,
  day: string,
  state: State | null,
  n: number,
  family: AppFamily = 'claude_code',
  caller = 'agent',
) {
  await client.query(
    `insert into deliveries (delivered_hour, client_label, caller, edition_seq, overlay_seq,
                             tool_schema_digest, topic_id, scope, status, answer_state, app_family)
     select $1, 'weekly', $2::caller_kind, $3, 0, 'digest', $4, '{}',
            case when $4::uuid is null then 'need_more_detail' when $5 = 'missing' then 'no_match'
                 else 'matched' end::delivery_status, $5, $6
       from generate_series(1, $7)`,
    [`${day}T10:00:00Z`, caller, edition, topic ? topics[topic] : null, state, family, n],
  )
}

/** Everything kept, in a stable order, to compare runs. */
async function kept() {
  const { rows } = await client.query<{
    week: string
    area: string | null
    state: string
    family: string
    calls: number
  }>(
    `select week::text, area_id as area, answer_state as state, app_family as family, calls
       from obs_weekly order by week, area_id nulls last, answer_state, app_family`,
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

const weekly = (person: string, input: Parameters<ObservabilityService['weekly']>[0]) =>
  database.transaction(person, (tx) => createObservabilityService(tx, clock).weekly(input))

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
  await calls('finance', '2026-10-06', 'grounded', 6, 'cursor')
  await calls('finance', '2026-10-06', 'partial', 2)
  await calls('marketing', '2026-10-07', 'missing', 7)
  await calls('nowhere', '2026-10-08', 'stale', 5, 'claude_ai')
  // The week of 19 October, ending on Sunday the 25th.
  await calls('finance', '2026-10-20', 'grounded', 9)
  await calls('finance', '2026-10-25', 'conflict', 1)
  // Not counted: a failed check, a question that could not be read, an answer test's call, and
  // this week, which is not over.
  await calls('finance', '2026-10-21', 'failed', 4)
  await calls(null, '2026-10-21', null, 6, 'claude_ai')
  await calls('finance', '2026-10-21', 'grounded', 8, 'heed', 'eval')
  await calls('finance', '2026-10-27', 'grounded', 50)
})
afterAll(async () => {
  await database.close()
})

describe('the roll-up (observability.rollup)', () => {
  it('backfills every completed week from the oldest delivery, by domain, answer state and agent', async () => {
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
      rows: 9,
    })
    expect(await kept()).toEqual([
      { week: '2026-09-07', area: 'finance', state: 'grounded', family: 'claude_code', calls: 12 },
      { week: '2026-09-07', area: 'finance', state: 'missing', family: 'claude_code', calls: 3 },
      { week: '2026-10-05', area: 'finance', state: 'grounded', family: 'claude_code', calls: 20 },
      { week: '2026-10-05', area: 'finance', state: 'grounded', family: 'cursor', calls: 6 },
      { week: '2026-10-05', area: 'finance', state: 'partial', family: 'claude_code', calls: 2 },
      { week: '2026-10-05', area: 'marketing', state: 'missing', family: 'claude_code', calls: 7 },
      { week: '2026-10-05', area: null, state: 'stale', family: 'claude_ai', calls: 5 },
      { week: '2026-10-19', area: 'finance', state: 'conflict', family: 'claude_code', calls: 1 },
      { week: '2026-10-19', area: 'finance', state: 'grounded', family: 'claude_code', calls: 9 },
    ])
  })

  it('keeps the same counts when it runs again, and when a week is counted again', async () => {
    const before = await kept()
    // From the latest week kept: a call that comes in late still counts.
    expect(await job.run(context)).toEqual({ weeks: ['2026-10-19'], rows: 2 })
    for (const week of ['2026-09-07', '2026-10-05', '2026-10-05'])
      await client.query('select cl_obs_weekly_rollup($1)', [week])
    expect(await kept()).toEqual(before)
  })

  it('counts a call that came in late to the latest week kept', async () => {
    await calls('finance', '2026-10-25', 'grounded', 1)
    await job.run(context)
    expect((await kept()).filter((r) => r.week === '2026-10-19')).toEqual([
      { week: '2026-10-19', area: 'finance', state: 'conflict', family: 'claude_code', calls: 1 },
      { week: '2026-10-19', area: 'finance', state: 'grounded', family: 'claude_code', calls: 10 },
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
      ).toEqual([{ kept: '5' }])
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

  it('keeps no words: an answer state or a kind of agent from a fixed list, a Monday, a count over 0', async () => {
    const insert = (week: string, state: string, family: string, n: number) =>
      client.query(
        `insert into obs_weekly (week, area_id, answer_state, app_family, calls)
         values ($1, 'finance', $2, $3, $4)`,
        [week, state, family, n],
      )
    for (const [week, state, family, n] of [
      ['2026-08-03', 'Orders in Norway', 'claude_code', 5],
      ['2026-08-03', 'failed', 'claude_code', 5],
      ['2026-08-03', 'grounded', 'Claude Code 1.0', 5],
      ['2026-08-03', 'grounded', 'alice@example.test', 5],
      ['2026-08-04', 'grounded', 'claude_code', 5],
      ['2026-08-03', 'grounded', 'claude_code', 0],
    ] as const)
      await expect(insert(week, state, family, n), `${state} ${family}`).rejects.toMatchObject({
        code: '23514',
      })
    // One row a week, domain, answer state and kind of agent, with no domain as with one.
    const none = (n: number) =>
      client.query(
        `insert into obs_weekly (week, area_id, answer_state, app_family, calls)
         values ('2026-08-03', null, 'grounded', 'cursor', $1)`,
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
      { n: 9 },
    ])
    for (const sql of [
      "insert into obs_weekly (week, answer_state, app_family, calls) values ('2026-08-03', 'grounded', 'cursor', 5)",
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

/**
 * What a reader can work out from a week as read, independently of the disclosure: each week's
 * total over its answer states and over its domains, solved one unknown at a time. No count from
 * one to just under the minimum may come out of it.
 */
function expectNothingWorkedOut(view: WeeklyCounts, truth: WeeklyCounts) {
  const fine = (n: number) => n === 0 || n >= view.minimumCount
  for (const [i, week] of view.weeks.entries()) {
    const real = truth.weeks[i]!
    expect(real.week).toBe(week.week)
    const value = new Map<string, number>()
    const known = new Map<string, number>()
    const set = (id: string, shown: number | null, actual: number | null) => {
      value.set(id, actual!)
      if (shown !== null) known.set(id, shown)
    }
    set('w', week.total, real.total)
    for (const s of shownStates) set(`w:${s}`, week.counts[s], real.counts[s])
    const sums: [string, string[]][] = [
      ['w', shownStates.map((s) => `w:${s}`)],
      ['w', week.domains.map((d) => `d:${d.areaId}`)],
    ]
    for (const [j, d] of week.domains.entries())
      set(`d:${d.areaId}`, d.total, real.domains[j]!.total)
    for (let changed = true; changed;) {
      changed = false
      for (const [whole, parts] of sums) {
        const unknown = parts.filter((p) => !known.has(p))
        if (!unknown.length && !known.has(whole)) {
          known.set(
            whole,
            parts.reduce((n, p) => n + known.get(p)!, 0),
          )
          changed = true
        } else if (unknown.length === 1 && known.has(whole)) {
          known.set(unknown[0]!, value.get(unknown[0]!)!)
          changed = true
        }
      }
    }
    for (const [id, n] of known) expect(fine(n), `${week.week} ${id} works out to ${n}`).toBe(true)
  }
}

describe('the weekly read model (internal)', () => {
  /** The same weeks with nothing hidden, to check the view against. */
  async function truthOf(input: { from: string; to: string; agent?: AppFamily }) {
    await client.query(
      `insert into settings_versions (key, version, value, reason)
       select 'privacy.min_count', max(version) + 1, '1', 'test'
         from settings_versions where key = 'privacy.min_count'`,
    )
    try {
      return await weekly(people.admin, input)
    } finally {
      await client.query(
        `insert into settings_versions (key, version, value, reason)
         select 'privacy.min_count', max(version) + 1, '5', 'test'
           from settings_versions where key = 'privacy.min_count'`,
      )
    }
  }

  it('reads every week of a range, a week with no calls as 0, and hides small counts', async () => {
    const range = { from: '2026-09-09', to: '2026-10-26' }
    const view = await weekly(people.admin, range)
    expect(view.minimumCount).toBe(5)
    // From the week 9 September falls in, up to the week of 26 October, without it.
    expect(view.weeks.map((w) => w.week)).toEqual([
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ])
    const week = (w: string) => view.weeks.find((x) => x.week === w)!
    expect(week('2026-09-14')).toEqual({
      week: '2026-09-14',
      total: 0,
      counts: { grounded: 0, partial: 0, conflict: 0, stale: 0, missing: 0 },
      domains: [],
    })
    // 40 asked in the week of 5 October; 2 covered part of it, so that count is hidden.
    expect(week('2026-10-05')).toMatchObject({ total: 40, counts: { partial: null } })
    expect(week('2026-10-05').domains.map((d) => [d.areaId, d.total])).toEqual([
      ['finance', 28],
      ['marketing', 7],
      [null, 5],
    ])
    // The week of 19 October: 11 asked, 1 with a conflict, hidden with what would give it away.
    expect(week('2026-10-19')).toMatchObject({ total: 11, counts: { conflict: null } })
    expect(week('2026-10-19').counts.grounded).toBeNull()
    for (const w of view.weeks)
      for (const n of [w.total, ...Object.values(w.counts), ...w.domains.map((d) => d.total)])
        expect(n === null || n === 0 || n >= 5, `${w.week}: ${n}`).toBe(true)
    expectNothingWorkedOut(view, await truthOf(range))
  })

  it('reads an owner the domains they own, and one kind of agent for administrators only', async () => {
    const range = { from: '2026-10-05', to: '2026-10-12' }
    const owner = await weekly(people.owner, range)
    expect(owner.weeks[0]!.domains.map((d) => d.areaId)).toEqual(['finance'])
    expect(owner.weeks[0]!.total).toBe(28)
    // The kind of agent is an administrator's filter: an owner reads every agent.
    expect((await weekly(people.owner, { ...range, agent: 'cursor' })).weeks[0]!.total).toBe(28)
    const cursor = await weekly(people.admin, { ...range, agent: 'cursor' })
    expect(cursor.weeks[0]).toMatchObject({ total: 6, counts: { grounded: 6 } })
    expectNothingWorkedOut(cursor, await truthOf({ ...range, agent: 'cursor' }))
    await expect(weekly(people.author, range)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('does not let one kind of agent be subtracted from every agent to reveal a small count', async () => {
    await client.query(
      `insert into obs_weekly (week, area_id, answer_state, app_family, calls)
       values ('2026-10-12', 'finance', 'grounded', 'cursor', 6),
              ('2026-10-12', 'finance', 'grounded', 'claude_code', 2)`,
    )
    try {
      const range = { from: '2026-10-12', to: '2026-10-19' }
      const cursor = await weekly(people.admin, { ...range, agent: 'cursor' })
      // Cursor asked 6 of 8: the 2 the others asked would show, so every count of it is hidden.
      expect(cursor.weeks[0]!.total).toBeNull()
      expect(cursor.weeks[0]!.domains[0]!.total).toBeNull()
      expect(cursor.weeks[0]!.counts.grounded).toBeNull()
    } finally {
      await client.query("delete from obs_weekly where week = '2026-10-12'")
    }
  })
})
