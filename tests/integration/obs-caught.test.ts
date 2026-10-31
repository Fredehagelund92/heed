import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ObsSnapshot, ObsSnapshotItem, ObsSummary } from '../../src/contract/observability.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import type { JobContext } from '../../src/server/modules/jobs/index.ts'
import { snapshotJob, weeklyRollupJob } from '../../src/server/modules/observability/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, servingEdition, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  What Heed caught (FR-620), besides the answers with a warning: the saved questions whose answer
  changed after a change, by the change, and the alerts that asked an owner for a decision and
  were acted on within 14 days. Kept each week in obs_caught_weekly as counts only, shown on
  Summary through its disclosure pass, and kept in its monthly snapshot. Today is Wednesday
  4 November 2026, so Summary reads October.
*/

const { client, url } = testDatabase()
const today = '2026-11-04'
const clock = systemClock(today)
const database = apiDatabase(url)
const devPeople: DevPerson[] = ['owner', 'admin', 'author'].map((name) => ({
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
async function get<T>(name: string, path: string) {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1' + path,
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
const summary = (name: string, query = '') =>
  get<ObsSummary>(name, `/observability/summary${query}`)
const rollup = async () =>
  (await weeklyRollupJob({ clock }).run({ database } as JobContext)) as { caughtWeeks: string[] }

let edition: string
const questions: string[] = []
const baselines: string[] = []
const gaps: Record<string, { id: string; ref: string }> = {}

/** A check run Heed or a person started, at noon on a day, and its results. */
async function run(trigger: string, day: string, results: [number, 'same' | 'changed' | 'look'][]) {
  const at = `${day}T12:00:00Z`
  const { rows } = await client.query<{ id: string }>(
    `insert into check_runs (trigger, day, total, checked, started_at, finished_at)
     values ($1, $2, $3, $3, $4, $4) returning id::text`,
    [trigger, day, results.length, at],
  )
  for (const [i, result] of results)
    await client.query(
      `insert into saved_question_results (run_id, question_id, baseline_id, result, reason, answer, checked_at)
       values ($1, $2, $3, $4, $5, '{}', $6)`,
      [
        rows[0]!.id,
        questions[i],
        baselines[i],
        result,
        result === 'same' ? 'same' : result === 'look' ? 'worse' : 'words',
        at,
      ],
    )
}

/** An alert the alert job raised, at a time. */
async function raise(rule: string, key: string, areas: string[], at: string, subject: object) {
  await client.query(
    `insert into alert_raises (rule, key, area_ids, title, subject, raised_at)
     values ($1, $2, $3, 'An alert', $4, $5)`,
    [rule, key, areas, JSON.stringify(subject), at],
  )
}

async function gap(name: string, area: string) {
  const { rows: topic } = await client.query<{ id: string }>(
    `insert into topics (key, area_id, metric_keys, value_keys, month)
     values ($1, $2, '{metric:orders}', $3, '2026-10-01') returning id::text`,
    [`${area}|metric:orders|${name}|2026-10`, area, [`val:market/${name}`]],
  )
  const { rows } = await client.query<{ id: string; ref: string }>(
    `insert into gaps (topic_id, type, opened_by_case, first_seen)
     values ($1, 'missing', 1, '2026-09-20') returning id::text, ref`,
    [topic[0]!.id],
  )
  gaps[name] = rows[0]!
}

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    edition = (await servingEdition(client)).edition
  })
  // Who owned and administered what held since the start of the year.
  await client.query(
    `update area_assignments set valid_at = tstzrange('2026-01-01', null);
     update global_role_grants set valid_at = tstzrange('2026-01-01', null);`,
  )
  for (const [month, next] of [
    ['2026_10', '2026-11-01'],
    ['2026_11', '2026-12-01'],
  ] as const)
    await client.query(
      `create table if not exists deliveries_${month} partition of deliveries
         for values from ('${month.replace('_', '-')}-01 00:00Z') to ('${next} 00:00Z')`,
    )
  // Agents asked about Norway every day in October and November: enough for a Summary.
  const { rows: norway } = await client.query<{ id: string }>(
    `insert into topics (key, area_id, metric_keys, value_keys, month)
     values ('finance|metric:orders|norway|2026-10', 'finance', '{metric:orders}', '{val:market/norway}', '2026-10-01')
     returning id::text`,
  )
  await client.query(
    `insert into deliveries (delivered_hour, client_label, caller, edition_seq, overlay_seq,
                             tool_schema_digest, topic_id, scope, status, answer_state)
     select d + interval '10 hours', 'claude-code', 'agent', $1, 0, 'digest', $2, '{}', 'matched', 'grounded'
       from generate_series('2026-10-01'::timestamptz, '2026-11-03'::timestamptz, interval '1 day') d,
            generate_series(1, 3)`,
    [edition, norway[0]!.id],
  )

  // Thirteen saved questions in Finance, and one in Marketing.
  for (let i = 0; i < 14; i++) {
    const { rows } = await client.query<{ id: string; baseline: string }>(
      `with q as (insert into saved_questions (area_id, question, origin, created_by, created_at)
                  values ($1, $2, 'typed', $3, '2026-09-01') returning id)
       insert into saved_question_baselines (question_id, answer, why, kept_by, kept_at)
       select id, '{}', 'saved', $3, '2026-09-01' from q returning question_id::text as id, id::text as baseline`,
      [
        i < 13 ? 'finance' : 'marketing',
        `Saved question ${i}`,
        i < 13 ? people.owner : people.admin,
      ],
    )
    questions.push(rows[0]!.id)
    baselines.push(rows[0]!.baseline)
  }
  const all = (result: 'same' | 'changed' | 'look', from: number, to: number) =>
    Array.from({ length: to - from }, (_, k) => [from + k, result] as [number, typeof result])
  // Every question was the same on 28 September.
  await run('saved', '2026-09-28', all('same', 0, 14))
  // A publish on 6 October changed six; a sync on 14 October found them still changed.
  await run('publish', '2026-10-06', [...all('changed', 0, 6), ...all('same', 6, 14)])
  await run('sync', '2026-10-14', [...all('changed', 0, 6), ...all('same', 6, 14)])
  // A sync on 20 October changed five more, and the Marketing question.
  await run('sync', '2026-10-20', [
    ...all('changed', 0, 6),
    ...all('look', 8, 14),
    ...all('same', 6, 8),
  ])
  // Check now on 15 October is not a change: its Needs a look is not counted.
  await run('manual', '2026-10-15', [[6, 'look']])
  // A check date passing on 29 October: question 7 needs a look (it was Same before).
  await run('check_date', '2026-10-29', [[7, 'look']])
  // A publish on 2 November is after October.
  await run('publish', '2026-11-02', [[6, 'changed']])

  // Alerts in October.
  await gap('poland', 'finance')
  await gap('spain', 'finance')
  await gap('italy', 'marketing')
  await gap('nordics', 'finance')
  await gap('late', 'finance')
  // Poland: raised 5 October, an owner wrote a draft for it 8 October (its state changed).
  await raise('gap', gaps.poland!.id, ['finance'], '2026-10-05T06:00:00Z', {
    card: `gap:${gaps.poland!.id}`,
  })
  await client.query(
    `insert into audit_log (at, actor_id, actor_kind, action, area_id, subject_type, subject_id, details)
     values ('2026-10-08T09:00:00Z', $1, 'person', 'gap.status_changed', 'finance', 'gap', $2,
             '{"from":"open","to":"proposal_made"}')`,
    [people.owner, gaps.poland!.ref],
  )
  // Spain: raised 1 October, closed 20 October: more than 14 days later, so not acted on.
  await raise('gap', gaps.spain!.id, ['finance'], '2026-10-01T06:00:00Z', {
    card: `gap:${gaps.spain!.id}`,
  })
  await client.query(
    `insert into audit_log (at, actor_id, actor_kind, action, area_id, subject_type, subject_id, details)
     values ('2026-10-20T09:00:00Z', $1, 'person', 'gap.status_changed', 'finance', 'gap', $2,
             '{"from":"open","to":"wont_fix"}')`,
    [people.owner, gaps.spain!.ref],
  )
  // Italy, in Marketing: an administrator started a draft for it two days after.
  await raise('gap', gaps.italy!.id, ['marketing'], '2026-10-07T06:00:00Z', {
    card: `gap:${gaps.italy!.id}`,
  })
  const { rows: draft } = await client.query<{ id: string }>(
    `insert into proposals (subject, action, state, area_id, proposer_id, channel, created_at, draft)
     values ('item', 'create', 'draft', 'marketing', $1, 'form', '2026-10-09T10:00:00Z', '{}')
     returning id::text`,
    [people.admin],
  )
  await client.query(`insert into gap_proposals (gap_id, proposal_id) values ($1, $2)`, [
    gaps.italy!.id,
    draft[0]!.id,
  ])
  // The Nordics, about two domains: someone who is no owner wrote a suggestion, which is not an
  // owner acting on it.
  await raise('gap', gaps.nordics!.id, ['finance', 'marketing'], '2026-10-12T06:00:00Z', {
    card: `gap:${gaps.nordics!.id}`,
  })
  const { rows: suggestion } = await client.query<{ id: string }>(
    `insert into proposals (subject, action, state, area_id, proposer_id, channel, created_at, draft)
     values ('item', 'create', 'draft', 'finance', $1, 'form', '2026-10-13T10:00:00Z', '{}')
     returning id::text`,
    [people.author],
  )
  await client.query(`insert into gap_proposals (gap_id, proposal_id) values ($1, $2)`, [
    gaps.nordics!.id,
    suggestion[0]!.id,
  ])
  // Saved questions need a look in Finance on 20 October; an owner kept a new answer next day.
  await raise('saved', 'finance:2026-10-20T12:00:00.000Z', ['finance'], '2026-10-20T12:05:00Z', {
    card: 'look:finance',
  })
  await client.query(
    `insert into saved_question_baselines (question_id, answer, why, kept_by, kept_at)
     values ($1, '{}', 'kept', $2, '2026-10-21T08:00:00Z')`,
    [questions[8], people.owner],
  )
  // A check was due on 26 October; the item was archived on 27 October.
  const due = await transaction(client, () =>
    version(client, { area: 'finance', owner: people.owner, title: 'Returns' }),
  )
  await raise('due', `${due.item}:2026-10-25`, ['finance'], '2026-10-26T07:00:00Z', {
    card: `check:${due.item}`,
  })
  await client.query(
    `insert into decisions (item_version_id, area_id, decided_by, capacity, outcome, reason, decided_at)
     values ($1, 'finance', $2, 'owner', 'retire', 'Checked: archived.', '2026-10-27T08:00:00Z')`,
    [due.id, people.owner],
  )
  // A conflict asks for no decision Heed keeps: never counted on this line.
  await raise('disagree', 'topic:2026-10-12', ['finance'], '2026-10-14T06:00:00Z', {
    topic: 'topic',
  })
  // Raised on 30 October and not acted on yet.
  await raise('gap', gaps.late!.id, ['finance'], '2026-10-30T06:00:00Z', {
    card: `gap:${gaps.late!.id}`,
  })
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

describe('counting what was caught (cl_obs_caught)', () => {
  it('counts a saved question each time it changed after a change, by the change', async () => {
    const { rows } = await client.query(
      `select area_id as area, kind, count from cl_obs_caught('2026-10-01', '2026-11-01')
        where line = 'saved' order by area_id, kind`,
    )
    expect(rows).toEqual([
      // Questions 7 needed a look after a check date; 8 to 12 changed after the sync.
      { area: 'finance', kind: 'check_date', count: 1 },
      { area: 'finance', kind: 'publish', count: 6 },
      { area: 'finance', kind: 'sync', count: 5 },
      { area: 'marketing', kind: 'sync', count: 1 },
    ])
  })

  it('counts the alerts raised, and those an owner acted on within 14 days', async () => {
    const { rows } = await client.query(
      `select area_id as area, kind, count, acted from cl_obs_caught('2026-10-01', '2026-11-01')
        where line = 'alert' order by area_id nulls first, kind`,
    )
    expect(rows).toEqual([
      // The Nordics, about two domains: counted with none, and no owner acted on it.
      { area: null, kind: 'gap', count: 1, acted: 0 },
      { area: 'finance', kind: 'disagree', count: 1, acted: 0 },
      // Poland acted on; Spain too late; the latest not yet.
      { area: 'finance', kind: 'due', count: 1, acted: 1 },
      { area: 'finance', kind: 'gap', count: 3, acted: 1 },
      { area: 'finance', kind: 'saved', count: 1, acted: 1 },
      { area: 'marketing', kind: 'gap', count: 1, acted: 1 },
    ])
  })

  it('does not count a decision that was undone', async () => {
    const { rows } = await client.query<{ id: string }>(
      `select id::text from decisions where reason = 'Checked: archived.'`,
    )
    await transaction(client, async () => {
      await client.query(`insert into decision_undos (decision_id, undone_by) values ($1, $2)`, [
        rows[0]!.id,
        people.owner,
      ])
      const { rows: due } = await client.query(
        `select acted from cl_obs_caught('2026-10-01', '2026-11-01') where kind = 'due'`,
      )
      expect(due).toEqual([{ acted: 0 }])
      throw new Error('rollback')
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== 'rollback') throw error
    })
  })
})

describe('the weekly counts (obs_caught_weekly)', () => {
  it('keeps every completed week from the first record, as counts only', async () => {
    const result = await rollup()
    expect(result.caughtWeeks[0]).toBe('2026-09-28')
    expect(result.caughtWeeks.at(-1)).toBe('2026-10-26')
    const { rows } = await client.query(
      `select week::text, area_id as area, line, kind, count, acted from obs_caught_weekly
        where week = '2026-10-19' order by line, area_id nulls first, kind`,
    )
    expect(rows).toEqual([
      { week: '2026-10-19', area: 'finance', line: 'alert', kind: 'saved', count: 1, acted: 1 },
      { week: '2026-10-19', area: 'finance', line: 'saved', kind: 'sync', count: 5, acted: 0 },
      { week: '2026-10-19', area: 'marketing', line: 'saved', kind: 'sync', count: 1, acted: 0 },
    ])
  })

  it('keeps the same counts when it runs again, and counts the last weeks again', async () => {
    const all = `select week::text as week, area_id as area, line, kind, count, acted
                   from obs_caught_weekly order by 1, 2 nulls first, 3, 4`
    const before = await client.query<{
      week: string
      area: string | null
      line: string
      kind: string
    }>(all)
    // The latest alert is acted on: the next night counts its week again.
    await client.query(
      `insert into audit_log (at, actor_id, actor_kind, action, area_id, subject_type, subject_id, details)
       values ('2026-11-02T09:00:00Z', $1, 'person', 'gap.status_changed', 'finance', 'gap', $2,
               '{"from":"open","to":"resolved"}')`,
      [people.owner, gaps.late!.ref],
    )
    const again = await rollup()
    expect(again.caughtWeeks).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    const after = await client.query(all)
    expect(after.rows).toEqual(
      before.rows.map((r) =>
        r.week === '2026-10-26' && r.line === 'alert' && r.kind === 'gap' && r.area === 'finance'
          ? { ...r, acted: 1 }
          : r,
      ),
    )
  })

  it('refuses anything but a Monday, the fixed lists and a count over 0', async () => {
    const insert = (values: string) =>
      client.query(
        `insert into obs_caught_weekly (week, area_id, line, kind, count, acted) values ${values}`,
      )
    for (const values of [
      `('2026-10-06', null, 'saved', 'publish', 1, 0)`,
      `('2026-10-05', null, 'saved', 'manual', 1, 0)`,
      `('2026-10-05', null, 'alert', 'publish', 1, 0)`,
      `('2026-10-05', null, 'saved', 'publish', 0, 0)`,
      `('2026-10-05', null, 'saved', 'publish', 2, 1)`,
      `('2026-10-05', null, 'alert', 'disagree', 2, 1)`,
      `('2026-10-05', null, 'alert', 'gap', 2, 3)`,
    ])
      await expect(insert(values)).rejects.toMatchObject({ code: '23514' })
  })

  it('is kept by retention, and the API role runs only the roll-up and the count', async () => {
    const count = async () =>
      (await client.query<{ n: number }>(`select count(*)::int as n from obs_caught_weekly`))
        .rows[0]!.n
    const before = await count()
    await client.query(`select cl_retention_run()`)
    expect(await count()).toBe(before)
    await expect(
      database.transaction(people.admin, (tx) =>
        tx.query(`select cl_obs_caught_rollup('2026-10-05')`),
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      database.transaction(people.admin, (tx) =>
        tx.query(`select cl_obs_managed_at($1, '{finance}', now())`, [people.owner]),
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

describe('Summary', () => {
  it('shows the three lines for every domain, through the disclosure pass', async () => {
    const s = await summary('admin')
    expect(s.now).toEqual({ start: '2026-10-01', end: '2026-11-01' })
    expect(s.caught).toEqual({
      saved: {
        // 6 after a publish, 6 after a sync, 1 after a check date: the 1 is hidden, so is a 6.
        total: 13,
        triggers: { publish: null, archive: 0, restore: 0, sync: 6, check_date: null },
      },
      // Poland, Spain, Italy, the Nordics, the latest, the saved questions and the due check:
      // all but Spain and the Nordics acted on.
      alerts: { raised: 7, acted: 5 },
    })
  })

  it("reads an owner's own domain, though they cannot read the records of another", async () => {
    const s = await summary('owner')
    expect(s.caught).toEqual({
      // 6, 5 and 1: the 1 is hidden, and the 5 with it.
      saved: {
        total: 12,
        triggers: { publish: 6, archive: 0, restore: 0, sync: null, check_date: null },
      },
      // Four acted on: under the minimum.
      alerts: { raised: 5, acted: null },
    })
  })

  it('counts the same from the weekly counts as from the records', async () => {
    const kept = await summary('admin')
    await client.query(`create temporary table kept_caught as select * from obs_caught_weekly`)
    await client.query(`delete from obs_caught_weekly`)
    try {
      expect((await summary('admin')).caught).toEqual(kept.caught)
    } finally {
      await client.query(`insert into obs_caught_weekly select * from kept_caught`)
      await client.query(`drop table kept_caught`)
    }
  })

  it('is kept in the monthly snapshot, with its sentences', async () => {
    const live = await summary('admin')
    await snapshotJob({ clock }).run({ database } as JobContext)
    const [all] = await get<ObsSnapshotItem[]>('admin', '/observability/snapshots')
    const kept = await get<ObsSnapshot>('admin', `/observability/snapshots/${all!.id}`)
    expect(kept.summary.caught).toEqual(live.caught)
    expect(kept.words.caught.map((c) => [c.key, c.measured])).toEqual([
      ['warned', true],
      ['saved', true],
      ['alerts', true],
    ])
    expect(kept.words.caught[1]!.text).toBe(
      '13 times, a saved question gave a different answer after a change: 6 after a sync and 7 after other changes.',
    )
    expect(kept.words.caught[2]!.text).toBe(
      '7 alerts asked an owner for a decision; owners acted on 5 of them within 14 days.',
    )
    const json = JSON.stringify(kept)
    expect(json).not.toMatch(/Saved question \d|prevent|owner@|admin@/i)
  })
})
