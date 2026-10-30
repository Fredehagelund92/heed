import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ObsAgents, ObsFeedback, ObsUsage, ObsView } from '../../src/contract/observability.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, servingEdition } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Observability on the service (FR-620): what agents asked, as topics and counts, for
  administrators and, for their own domains, owners; Usage for administrators only. Every count
  from one to just under the minimum is hidden, and no count gives a hidden one away by
  subtraction (FR-614): the privacy suite walks every answer. The week counted is 16 to 22 October
  2026, back from yesterday.
*/

const { client, url } = testDatabase()
const today = '2026-10-23'
const quietOwner = '00000000-0000-4000-8000-000000000011'
const devPeople: DevPerson[] = ['author', 'owner', 'admin', 'stranger', 'quiet'].map((name) => ({
  email: `${name}@example.test`,
  name,
  roles: [],
}))
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({ level: process.env.OBS_LOG ? 'error' : 'silent' }),
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
async function api(
  name: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  payload?: object,
) {
  return app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
}
async function ok<T>(name: string, path: string) {
  const response = await api(name, 'GET', path)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}

type State = 'grounded' | 'partial' | 'conflict' | 'stale' | 'missing'
const topics: Record<string, string> = {}
let edition: string

async function topic(
  name: string,
  area: string | null,
  metric: string,
  value: string,
  month: string,
) {
  const { rows } = await client.query<{ id: string }>(
    `insert into topics (key, area_id, metric_keys, value_keys, month)
     values ($1, $2, $3, $4, $5) returning id::text`,
    [
      `${area ?? ''}|${metric}|${value}|${month}`,
      area,
      metric ? [metric] : [],
      [value],
      `${month}-01`,
    ],
  )
  topics[name] = rows[0]!.id
}

/** Agent calls about a topic on a day of October 2026, by answer state and kind of agent. */
async function calls(
  name: string | null,
  day: number,
  counts: Partial<Record<State, number>>,
  family = 'claude_code',
) {
  for (const [state, n] of Object.entries(counts))
    for (let i = 0; i < n; i++)
      await client.query(
        `insert into deliveries (delivered_hour, client_label, caller, edition_seq, overlay_seq,
                                 tool_schema_digest, topic_id, scope, status, answer_state, app_family)
         values ($1, 'claude-code', 'agent', $6, 0, 'digest', $2, '{}', $3, $4, $5)`,
        [
          `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`,
          name ? topics[name] : null,
          state === 'missing' ? 'no_match' : state === 'conflict' ? 'conflict' : 'matched',
          state,
          family,
          edition,
        ],
      )
}

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    edition = (await servingEdition(client)).edition
  })
  for (const month of ['2026_09', '2026_10'])
    for (const table of ['deliveries', 'mcp_requests']) {
      const start = `${month.replace('_', '-')}-01`
      const next = month === '2026_09' ? '2026-10-01' : '2026-11-01'
      await client.query(
        `create table if not exists ${table}_${month} partition of ${table}
           for values from ('${start} 00:00Z') to ('${next} 00:00Z')`,
      )
    }
  await client.query(
    `insert into people (id, email, display_name) values ($1, 'quiet@example.test', 'quiet')`,
    [quietOwner],
  )
  await client.query(
    `insert into areas (id, name) values ('tiny', 'Tiny'), ('unasked', 'Unasked');
     insert into vocab_terms (key, kind, parent_key) values
       ('metric:net_revenue', 'metric', null), ('val:market/sweden', 'dimension_value', 'dim:market'),
       ('val:market/germany', 'dimension_value', 'dim:market');
     insert into vocab_term_versions (term_key, version_no, name, content_digest) values
       ('metric:orders', 1, 'Orders', sha256('o')), ('metric:net_revenue', 1, 'Net revenue', sha256('n')),
       ('val:market/norway', 1, 'Norway', sha256('no')), ('val:market/sweden', 1, 'Sweden', sha256('se')),
       ('val:market/germany', 1, 'Germany', sha256('de')), ('group:payments', 1, 'Payments', sha256('p'))
     on conflict do nothing;`,
  )
  await client.query(
    `insert into area_assignments (area_id, person_id, role) values ('tiny', $1, 'owner'), ('marketing', $2, 'owner')`,
    [quietOwner, people.stranger],
  )
  await topic('orders-norway', 'finance', 'metric:orders', 'val:market/norway', '2026-10')
  await topic('orders-norway-sep', 'finance', 'metric:orders', 'val:market/norway', '2026-09')
  await topic('revenue-norway', 'finance', 'metric:net_revenue', 'val:market/norway', '2026-10')
  await topic('revenue-norway-sep', 'finance', 'metric:net_revenue', 'val:market/norway', '2026-09')
  await topic('orders-sweden', 'finance', 'metric:orders', 'val:market/sweden', '2026-10')
  await topic('payments-norway', 'finance', 'group:payments', 'val:market/norway', '2026-10')
  await topic('orders-germany', 'marketing', 'metric:orders', 'val:market/germany', '2026-10')
  await topic('orders-germany-nov', 'marketing', 'metric:orders', 'val:market/germany', '2026-11')
  await topic('tiny', 'tiny', 'metric:orders', 'val:market/norway', '2026-10')
  // This week.
  await calls('orders-norway', 20, { grounded: 20, partial: 1, stale: 2, missing: 1 })
  await calls('orders-norway-sep', 19, { grounded: 6, partial: 1 })
  await calls('revenue-norway', 18, { grounded: 13 })
  await calls('revenue-norway-sep', 18, { grounded: 4 })
  await calls('orders-sweden', 17, { grounded: 2 })
  await calls('orders-sweden', 17, { grounded: 5 }, 'cursor')
  await calls('payments-norway', 21, { grounded: 9 })
  await calls('orders-germany', 22, { missing: 3 })
  await calls('orders-germany-nov', 22, { missing: 3 })
  await calls('tiny', 16, { grounded: 2 })
  // Calls that could not be read: no topic.
  await client.query(
    `insert into deliveries (delivered_hour, client_label, caller, edition_seq, overlay_seq,
                             tool_schema_digest, scope, status, answer_state, app_family)
     select '2026-10-19T09:00:00Z', 'claude-code', 'agent', $1, 0, 'digest', '{}', 'need_more_detail', null, 'claude_ai'
       from generate_series(1, 6)`,
    [edition],
  )
  // The week before, and a day of today, which no view counts yet.
  await calls('orders-norway', 12, { grounded: 30 })
  await calls('orders-norway', 23, { grounded: 50 })
  // Usage: tool calls by kind of agent, and this month's model spend.
  await client.query(
    `insert into mcp_requests (hour, client_label, app_family, tool, status, result_status, duration_ms)
     select '2026-10-20T10:00:00Z', 'claude-code', 'claude_code', 'get_context', 'ok',
            (array['matched','matched','no_match','need_more_detail'])[1 + g % 4], 30 + g
       from generate_series(1, 40) g;
     insert into mcp_requests (hour, client_label, app_family, tool, status, duration_ms)
     select '2026-10-21T10:00:00Z', 'cursor', 'cursor', 'suggest_context', 'error', 50
       from generate_series(1, 3);
     insert into llm_spend_monthly (month, feature, calls, cost_micros, provider)
     values ('2026-10-01', 'assistant', 40, 11200000, 'mock'), ('2026-10-01', 'eval', 3, 6100000, 'mock');`,
  )
  // Feedback: an agent's report waiting in the Inbox, one closed as not a problem, and ratings.
  await client.query(
    `insert into feedback (verdict, client_label, area_id, note, created_hour) values
       ('unclear', 'claude-code', 'finance', 'Germany only?', '2026-10-21T08:00:00Z'),
       ('wrong', 'cursor', 'finance', null, '2026-10-20T08:00:00Z'),
       ('helpful', 'claude-code', 'marketing', null, '2026-10-19T08:00:00Z');
     insert into assistant_ratings (verdict, area_id, created_hour)
     select 'helpful', 'finance', '2026-10-20T10:00:00Z' from generate_series(1, 6);
     insert into assistant_ratings (verdict, area_id, created_hour)
     select 'wrong', 'finance', '2026-10-20T10:00:00Z' from generate_series(1, 2);`,
  )
  const [closed] = (
    await client.query<{ id: string }>(`select id::text from feedback where verdict = 'wrong'`)
  ).rows
  await client.query(
    `insert into card_states (card, area_id, state, decided_by) values ($1, 'finance', 'closed', $2)`,
    [`feedback:${closed!.id}`, people.owner],
  )
  await app.ready()
})
afterAll(async () => {
  await app.close()
})

/** Every count a reader sees, by where it is, for the privacy suite. */
function countsIn(view: ObsAgents): [string, number | null][] {
  const out: [string, number | null][] = []
  for (const t of view.topics) {
    out.push([`topic ${t.id}`, t.total])
    for (const [s, n] of Object.entries(t.counts)) out.push([`topic ${t.id} ${s}`, n])
  }
  for (const s of view.subjects) {
    out.push([`subject ${s.key}`, s.total])
    for (const [k, n] of Object.entries(s.counts)) out.push([`subject ${s.key} ${k}`, n])
  }
  for (const d of view.domains) out.push([`domain ${d.areaId}`, d.total])
  for (const a of view.agents) out.push([`agent ${a.family}`, a.count])
  out.push(['could not be read', view.couldNotRead])
  out.push(['asked', view.numbers.asked])
  for (const [s, n] of Object.entries(view.numbers.counts)) out.push([`asked ${s}`, n])
  for (const b of view.bars)
    for (const [s, n] of Object.entries(b.counts)) out.push([`bar ${b.start} ${s}`, n])
  return out
}

/** FR-614: no count from one to just under the minimum, and no total that gives one away. */
function expectPrivate(view: ObsAgents) {
  const least = view.minimumCount
  for (const [where, n] of countsIn(view))
    expect(n === null || n === 0 || n >= least, `${where} is ${n}`).toBe(true)
  const byId = new Map(view.topics.map((t) => [t.id, t]))
  const left = (total: number, parts: (number | null)[]) =>
    total - parts.reduce<number>((a, b) => a + (b ?? 0), 0)
  const fine = (n: number) => n === 0 || n >= least
  for (const t of view.topics)
    if (t.total !== null)
      expect(fine(left(t.total, Object.values(t.counts))), `topic ${t.id} by state`).toBe(true)
  if (view.numbers.asked !== null)
    expect(
      fine(left(view.numbers.asked, Object.values(view.numbers.counts))),
      'asked by state',
    ).toBe(true)
  for (const [state, n] of Object.entries(view.numbers.counts))
    if (n !== null)
      expect(
        fine(
          left(
            n,
            view.bars.map((b) => b.counts[state as State]),
          ),
        ),
        `${state} by bar`,
      ).toBe(true)
  for (const s of view.subjects) {
    if (s.total === null) continue
    const parts = s.topics.map((id) => byId.get(id)!.total)
    expect(fine(left(s.total, parts)), `subject ${s.key} by month`).toBe(true)
    expect(fine(left(s.total, Object.values(s.counts))), `subject ${s.key} by state`).toBe(true)
  }
}

describe('Overview and Questions (obs.agents)', () => {
  it('counts the week back from yesterday by answer state and by day, for an administrator', async () => {
    const view = await ok<ObsAgents>('admin', '/observability/agents?range=7')
    expect(view).toMatchObject({ state: 'normal', range: 7, last: '2026-10-22', minimumCount: 5 })
    expect(view.bars.map((b) => [b.start, b.days])).toEqual(
      Array.from({ length: 7 }, (_, i) => [`2026-10-${16 + i}`, 1]),
    )
    // 72 asked, 7 found nothing; the week before, 30, every one checked. Today is not counted
    // until it is over.
    expect(view.numbers.asked).toBe(72)
    expect(view.numbers.counts.missing).toBe(7)
    expect(view.numbers.before).toEqual({ asked: 30, missing: 0, grounded: 30 })
    // 61 were checked, but with 72 asked and 7 not found that leaves the 4 answered with a
    // warning: what was checked hides, so the hidden 4 cannot be worked out.
    expect(view.numbers.counts.grounded).toBeNull()
    // Two calls covered part of it: hidden, and the day's bar shows no part of them.
    expect(view.numbers.counts.partial).toBeNull()
    expect(view.bars.find((b) => b.start === '2026-10-20')!.counts).toMatchObject({
      partial: null,
      missing: null,
    })
    expect(view.couldNotRead).toBe(6)
    expectPrivate(view)
  })

  it('hides a topic under the minimum, and a total over months that would give one away', async () => {
    const view = await ok<ObsAgents>('admin', '/observability/agents?range=7')
    const topic = (name: string) => view.topics.find((t) => t.id === topics[name])!
    const subject = (name: string) => view.subjects.find((s) => s.topics.includes(topics[name]!))!
    expect(topic('orders-norway')).toMatchObject({
      metric: 'Orders',
      values: ['Norway'],
      dimension: 'market',
      named: 'metric',
      month: '2026-10',
      total: 24,
    })
    // A month of a subject over several shows its total only: its subject says how it was answered.
    expect(Object.values(topic('orders-norway').counts)).toEqual([null, null, null, null, null])
    expect(topic('payments-norway')).toMatchObject({ named: 'group', metric: 'Payments', total: 9 })
    // September of Net revenue in Norway was asked 4 times: the total of 17 would give it away.
    expect(topic('revenue-norway-sep').total).toBeNull()
    expect(subject('revenue-norway')).toMatchObject({ total: null, atLeast: 13 })
    // Orders in Norway: both months shown, so the total is too.
    expect(subject('orders-norway')).toMatchObject({ total: 31, atLeast: 31 })
    // Orders in Germany: three calls about each month, counted together as one subject.
    expect(subject('orders-germany').topics).toHaveLength(2)
    expectPrivate(view)
  })

  it("lists what found nothing in the last 7 days across a month edge, and its views' flags", async () => {
    const view = await ok<ObsAgents>('admin', '/observability/agents?range=30')
    expect(view.notFound.map((s) => s.topics.length)).toEqual([2])
    expect(view.notFoundTopics.map((t) => t.month).sort()).toEqual(['2026-10', '2026-11'])
    for (const t of view.notFoundTopics) expect(t.in.notFound).toBe(true)
    // Two calls about Orders in Norway may be out of date: a hidden count, so it is in the view of
    // what may be out of date; none had a conflict, which shows as 0.
    expect(view.topics.find((t) => t.id === topics['orders-norway'])!.in).toEqual({
      notFound: false,
      reported: false,
      answers: ['grounded', 'partial', 'stale', 'missing'],
    })
    expectPrivate(view)
  })

  it('narrows the numbers to a domain, and an owner to the domains they own', async () => {
    const finance = await ok<ObsAgents>('admin', '/observability/agents?range=7&areaId=finance')
    expect(finance.numbers.asked).toBe(64)
    // Finance's 64: 59 checked; the 1 not found hides, so what checked leaves over is 5 (the 4
    // with a warning and the 1), which may show, and Overview's checked share is 59 of 64.
    expect(finance.numbers.counts).toMatchObject({ grounded: 59, missing: null })
    expectPrivate(finance)
    const owner = await ok<ObsAgents>('owner', '/observability/agents?range=7')
    expect(new Set(owner.topics.map((t) => t.areaId))).toEqual(new Set(['finance']))
    // Calls with no domain, and the kinds of agent, are an administrator's.
    expect(owner.couldNotRead).toBeNull()
    expect(owner.agents).toEqual([])
    expectPrivate(owner)
    expect((await api('owner', 'GET', '/observability/agents?areaId=marketing')).statusCode).toBe(
      403,
    )
    expect((await api('author', 'GET', '/observability/agents')).statusCode).toBe(403)
  })

  it('says when too few were asked to count, and when nothing was asked yet', async () => {
    expect(await ok<ObsAgents>('quiet', '/observability/agents?range=7')).toMatchObject({
      state: 'quiet',
      numbers: { asked: null },
      bars: [],
      topics: [],
    })
    expect(
      await ok<ObsAgents>('admin', '/observability/agents?range=7&areaId=unasked'),
    ).toMatchObject({ state: 'empty', topics: [] })
  })

  it('counts the kinds of agent, hiding a small one, and narrows to one without giving the rest away', async () => {
    const view = await ok<ObsAgents>('admin', '/observability/agents?range=7')
    expect(view.agents).toEqual([
      { family: 'claude_code', count: 67 },
      { family: 'cursor', count: 5 },
    ])
    const cursor = await ok<ObsAgents>('admin', '/observability/agents?range=7&agent=cursor')
    // Cursor asked about Orders in Sweden 5 times of 7: the 2 left over would show, so it is hidden.
    expect(cursor.state).toBe('normal')
    expect(cursor.topics.find((t) => t.id === topics['orders-sweden'])!.total).toBeNull()
    expectPrivate(cursor)
  })

  it('does not let the last 7 days of one kind of agent be subtracted from all to reveal a small count', async () => {
    const rows = (family: string, n: number) =>
      client.query(
        `insert into deliveries (delivered_hour, client_label, caller, edition_seq, overlay_seq,
                                 tool_schema_digest, topic_id, scope, status, answer_state, app_family)
         select '2026-10-17T10:00:00Z', 'subtraction', 'agent', $1, 0, 'digest', $2, '{}', 'no_match', 'missing', $3
           from generate_series(1, $4)`,
        [edition, topics['orders-sweden'], family, n],
      )
    await rows('cursor', 5)
    await rows('claude_code', 2)
    try {
      const sweden = (v: ObsAgents) =>
        v.notFound.find((s) => s.topics.includes(topics['orders-sweden']!))
      const all = await ok<ObsAgents>('admin', '/observability/agents?range=30')
      const cursor = await ok<ObsAgents>('admin', '/observability/agents?range=30&agent=cursor')
      expectPrivate(all)
      expectPrivate(cursor)
      expect(sweden(all)).toBeDefined()
      // Cursor made 5 of the 7: the 2 left over by the other agents would show, so its total is hidden.
      expect(sweden(cursor)?.total ?? null).toBeNull()
      for (const t of cursor.notFoundTopics.filter((t) => t.id === topics['orders-sweden']))
        expect(t.total).toBeNull()
    } finally {
      await client.query(`delete from deliveries where client_label = 'subtraction'`)
    }
  })
})

describe('Usage (obs.usage)', () => {
  it('counts tool calls and how they ended, kinds of agent, reply times and spend, for administrators only', async () => {
    const usage = await ok<ObsUsage>('admin', '/observability/usage?range=7')
    expect(usage.state).toBe('normal')
    expect(usage.tools).toEqual([
      { tool: 'get_context', calls: 40, answered: 20, detail: 10, nothing: 10, failed: 0 },
      { tool: 'suggest_context', calls: 3, answered: 0, detail: 0, nothing: 0, failed: 3 },
    ])
    // Cursor's 3 calls are hidden; the 43 tool calls would give them away beside Claude Code's 40,
    // so that goes too, and so does when each last called.
    expect(usage.agents.map((a) => [a.family, a.calls, a.lastAt])).toEqual([
      ['claude_code', null, null],
      ['cursor', null, null],
    ])
    expect(usage.speed).toHaveLength(7)
    expect(usage.speed.find((s) => s.start === '2026-10-20')!.median).toBeGreaterThan(30)
    expect(usage.spend).toMatchObject({
      month: '2026-10-01',
      totalMicros: 17_300_000,
      caps: { monthlyMicros: 500_000_000, dailyPersonMicros: 2_000_000 },
    })
    expect((await ok<ObsUsage>('admin', '/observability/usage?range=30')).speed).toHaveLength(5)
    expect((await ok<ObsUsage>('admin', '/observability/usage?range=90')).speed).toHaveLength(13)
    expect((await api('owner', 'GET', '/observability/usage')).statusCode).toBe(403)
  })
})

describe('Feedback (obs.feedback)', () => {
  it('lists reports with where they stand, never a name, and hides a small count of ratings', async () => {
    const feedback = await ok<ObsFeedback>('admin', '/observability/feedback?range=7')
    expect(feedback.state).toBe('normal')
    expect(feedback.reports.map((r) => [r.kind, r.state, r.agent])).toEqual([
      ['unclear', 'inbox', 'claude_code'],
      ['wrong', 'fine', 'cursor'],
      ['helpful', 'looked', 'claude_code'],
    ])
    expect(feedback.reports[0]!.card).toMatch(/^feedback:/)
    expect(JSON.stringify(feedback)).not.toMatch(/owner@example|display_name/)
    expect(feedback.week).toEqual({ good: 6, goodBefore: 0, wrong: null })
    expect(feedback.goodByWeek).toHaveLength(14)
    const owner = await ok<ObsFeedback>('owner', '/observability/feedback?range=7')
    expect(new Set(owner.reports.map((r) => r.areaId))).toEqual(new Set(['finance']))
  })

  it('lists a named report from Ask with who sent it, up to now, and where it stands', async () => {
    const sent = async (what: string, at?: string) =>
      (
        await client.query<{ id: string }>(
          `insert into reports (person_id, area_id, item_id, part, question, what, created_at)
           values ($1, 'finance', 'itm_target0001', 'item', 'Why are orders low?', $2,
                   coalesce($3::timestamptz, now()))
           returning id::text`,
          [people.author, what, at ?? null],
        )
      ).rows[0]!.id
    const waiting = await sent('Is this Germany only?')
    const fine = await sent('Wrong market', '2026-10-21T09:00:00Z')
    await sent('Before the range', '2026-10-01T09:00:00Z')
    await client.query(
      `insert into card_states (card, area_id, state, decided_by) values ($1, 'finance', 'closed', $2)`,
      [`report:${fine}`, people.owner],
    )
    const named = (await ok<ObsFeedback>('owner', '/observability/feedback?range=7')).reports
      .filter((r) => r.kind === 'named')
      .map((r) => [r.id, r.card, r.by, r.from, r.note, r.state])
    expect(named).toEqual([
      [
        `report:${waiting}`,
        `report:${waiting}`,
        'author',
        'person',
        'Is this Germany only?',
        'inbox',
      ],
      [`report:${fine}`, null, 'author', 'person', 'Wrong market', 'fine'],
    ])
    // Agents' reports still carry no name.
    const admin = await ok<ObsFeedback>('admin', '/observability/feedback?range=7')
    expect(admin.reports.filter((r) => r.from === 'agent').every((r) => r.by === null)).toBe(true)
  })
})

describe('saved views (obs.views)', () => {
  it('keeps a view for everyone in the workspace; only its saver or an administrator removes it', async () => {
    const saved = await api('owner', 'POST', '/observability/views', {
      name: 'Found nothing',
      filters: { answer: ['missing'] },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const view = saved.json<ObsView>()
    expect(view).toMatchObject({ name: 'Found nothing', by: 'owner', mine: true })
    expect(
      (await api('admin', 'POST', '/observability/views', { name: ' found NOTHING', filters: {} }))
        .statusCode,
    ).toBe(409)
    const listed = await ok<ObsView[]>('stranger', '/observability/views')
    expect(listed).toEqual([{ ...view, mine: false }])
    expect((await api('stranger', 'DELETE', `/observability/views/${view.id}`)).statusCode).toBe(
      403,
    )
    expect((await api('author', 'GET', '/observability/views')).statusCode).toBe(403)
    const removed = await api('admin', 'DELETE', `/observability/views/${view.id}`)
    expect(removed.json()).toEqual({ removed: true })
    expect(await ok<ObsView[]>('owner', '/observability/views')).toEqual([])
  })
})
