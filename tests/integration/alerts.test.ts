import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AlertRaise, AlertRuleRecord, AlertRules } from '../../src/contract/alerts.ts'
import type { Feed } from '../../src/contract/inbox.ts'
import { buildApp } from '../../src/server/app.ts'
import type { Clock } from '../../src/server/clock.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import { raiseAlerts } from '../../src/server/modules/alerts/index.ts'
import { createBundleCache } from '../../src/server/modules/answer/index.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { relayOutbox } from '../../src/server/modules/notifications/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, people, publish, servingEdition, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Alert rules on the service (FR-621): eight rules raise cards in the Inbox through the outbox,
  never an email. Administrators turn rules on and off and set thresholds; owners mute a rule for
  their own domains. The alert job raises once for what it finds, and a raise tells counts and
  scopes only, a count under the minimum hidden (FR-614).
*/

const { client, url } = testDatabase()
const today = new Date().toISOString().slice(0, 10)
/** The job's clock: after 07:00, UTC, when a check that is due raises its reminder. */
const clock: Clock = { now: () => new Date(`${today}T08:00:00Z`), today: () => today }
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
async function api(name: string, method: 'GET' | 'POST', path: string, payload?: object) {
  return app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
}
async function ok<T>(name: string, method: 'GET' | 'POST', path: string, body?: object) {
  const response = await api(name, method, path, body)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
const rules = (name: string) => ok<AlertRules>(name, 'GET', '/alerts/rules')
const raised = (name: string) => ok<AlertRaise[]>(name, 'GET', '/alerts/raised')
const feed = (name: string) => ok<Feed>(name, 'GET', '/inbox/feed')
const setRule = (name: string, rule: string, body: object) =>
  api(name, 'POST', `/alerts/rules/${rule}`, body)
const mute = (name: string, rule: string, areaIds: string[], muted: boolean) =>
  api(name, 'POST', `/alerts/rules/${rule}/mute`, { areaIds, muted })

const run = async () => {
  const done = await raiseAlerts(database, clock, createBundleCache())
  await relayOutbox(database)
  return done
}
/** Who got a raise in their Inbox items, by name. */
async function reached(raiseId: string) {
  const { rows } = await client.query<{ name: string }>(
    `select p.display_name as name from inbox_items i join people p on p.id = i.person_id
      join alert_raises r on r.event_seq = i.event_seq where r.id = $1 order by 1`,
    [raiseId],
  )
  return rows.map((r) => r.name)
}

let gap: string
let dueItem: string
let quiet: string

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
    await servingEdition(client)
    // An item whose check date passed, published as the edition agents get now.
    const due = await version(client, {
      title: 'Returns changed definition',
      summary: 'Returns',
      reviewDate: '2026-01-02',
      owner: people.owner,
    })
    dueItem = due.item
    await accept(client, due.id)
    await publish(client, due.id)
    await client.query('select cl_ensure_delivery_partitions(2), cl_ensure_request_partitions(2)')
    // Agents asked 9 times this week about a topic in finance and found nothing: a Not found card.
    const [topic] = (
      await client.query<{ id: string }>(
        `insert into topics (key, area_id, metric_keys, value_keys, month)
         values ('finance|orders|norway|2026-10', 'finance', '{metric:orders}', '{val:market/norway}', '2026-10-01')
         returning id::text`,
      )
    ).rows
    gap = (
      await client.query<{ id: string }>(
        `insert into gaps (topic_id, type, opened_by_case) values ($1, 'missing', 1) returning id::text`,
        [topic!.id],
      )
    ).rows[0]!.id
    await client.query(
      `insert into gap_weekly_counts (gap_id, week, no_item_calls)
       values ($1, date_trunc('week', now() at time zone 'UTC')::date, 9)`,
      [gap],
    )
    // A second gap that only 3 calls found nothing for: its count is hidden (FR-614).
    const [small] = (
      await client.query<{ id: string }>(
        `insert into topics (key, area_id, metric_keys, value_keys, month)
         values ('finance|orders|sweden|2026-10', 'finance', '{metric:orders}', '{val:market/sweden}', '2026-10-01')
         returning id::text`,
      )
    ).rows
    quiet = (
      await client.query<{ id: string }>(
        `insert into gaps (topic_id, type, opened_by_case) values ($1, 'missing', 1) returning id::text`,
        [small!.id],
      )
    ).rows[0]!.id
    await client.query(
      `insert into gap_weekly_counts (gap_id, week, no_item_calls)
       values ($1, date_trunc('week', now() at time zone 'UTC')::date, 3)`,
      [quiet],
    )
    // Agents got two items that disagree, 3 times in a week, on the Norway topic.
    for (let i = 0; i < 3; i++)
      await client.query(
        `insert into deliveries (delivered_hour, client_label, caller, edition_seq, overlay_seq,
                                 tool_schema_digest, topic_id, scope, status, answer_state)
         values (date_trunc('hour', now(), 'UTC'), 'claude-code', 'agent', 1, 0, 'digest', $1, '{}', 'matched', 'conflict')`,
        [topic!.id],
      )
    // The demo source's last read failed.
    await client.query(
      `insert into connector_snapshots (connector_id, status, fetched_at, error)
       values ('demo', 'failed', now() - interval '5 minutes', 'Definition source could not be read')`,
    )
    // Model spend this month: 90% of the default cap of 500 dollars.
    await client.query(
      `insert into llm_spend_monthly (month, feature, provider, calls, cost_micros)
       values (date_trunc('month', now() at time zone 'UTC')::date, 'assistant', 'anthropic', 9, 450000000)`,
    )
  })
})
afterAll(() => app.close())

describe('the rules', () => {
  it('lists the eight rules for an administrator, the Not found threshold from its setting', async () => {
    const { rules: all } = await rules('admin')
    expect(all.map((r) => r.rule)).toEqual([
      'gap',
      'saved',
      'disagree',
      'share',
      'fail',
      'spend',
      'sync',
      'due',
    ])
    expect(all.every((r) => r.enabled)).toBe(true)
    expect(Object.fromEntries(all.map((r) => [r.rule, r.threshold]))).toMatchObject({
      gap: 5,
      saved: null,
      disagree: 3,
      share: 20,
      fail: 5,
      spend: 80,
    })
  })

  it('is for owners and administrators only', async () => {
    expect((await api('owner', 'GET', '/alerts/rules')).statusCode).toBe(200)
    expect((await api('stranger', 'GET', '/alerts/rules')).statusCode).toBe(403)
    expect((await api('stranger', 'GET', '/alerts/raised')).statusCode).toBe(403)
  })

  it('lets an administrator turn a rule off and set a threshold its sentence offers', async () => {
    const off = await setRule('admin', 'spend', { enabled: false })
    expect(off.statusCode, off.body).toBe(200)
    expect(off.json<AlertRuleRecord>()).toMatchObject({ rule: 'spend', enabled: false })
    const set = await setRule('admin', 'disagree', { threshold: 5 })
    expect(set.json<AlertRuleRecord>().threshold).toBe(5)
    expect((await setRule('admin', 'disagree', { threshold: 4 })).statusCode).toBe(422)
    expect((await setRule('admin', 'saved', { threshold: 3 })).statusCode).toBe(422)
    expect((await setRule('owner', 'spend', { enabled: true })).statusCode).toBe(403)
    // Back as it was, for the job below; the history log names who changed what.
    await setRule('admin', 'spend', { enabled: true })
    await setRule('admin', 'disagree', { threshold: 3 })
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from audit_log where action = 'alert.rule_changed' and actor_id = $1`,
      [people.admin],
    )
    expect(rows[0]!.n).toBe(4)
  })

  it("keeps the Not found threshold in the gap detection's setting, with its history", async () => {
    const set = await setRule('admin', 'gap', { threshold: 10 })
    expect(set.json<AlertRuleRecord>().threshold).toBe(10)
    const { rows } = await client.query<{ value: { calls: number; days: number } }>(
      `select value from settings_current where key = 'gaps.no_item_threshold'`,
    )
    expect(rows[0]!.value).toEqual({ calls: 10, days: 7 })
    await setRule('admin', 'gap', { threshold: 5 })
  })

  it('lets an owner mute a rule for their own domain only, and not a rule for admins', async () => {
    const muted = await mute('owner', 'due', ['finance'], true)
    expect(muted.statusCode, muted.body).toBe(200)
    expect(muted.json<AlertRuleRecord>().mutedFor).toEqual(['finance'])
    expect((await mute('owner', 'due', ['marketing'], true)).statusCode).toBe(403)
    expect((await mute('owner', 'spend', ['finance'], true)).statusCode).toBe(422)
    // Someone else's mutes are their own.
    expect((await rules('admin')).rules.find((r) => r.rule === 'due')!.mutedFor).toEqual([])
  })
})

describe('the alert job', () => {
  it('raises what the rules find, once, to each rule’s audience less those who muted it', async () => {
    const first = await run()
    expect(first).toMatchObject({ gap: 2, disagree: 1, spend: 1, sync: 1, due: 1 })
    // A second run raises nothing new.
    expect(await run()).toEqual({
      gap: 0,
      saved: 0,
      disagree: 0,
      share: 0,
      fail: 0,
      spend: 0,
      sync: 0,
      due: 0,
    })
    const all = await raised('admin')
    const of = (rule: string) => all.filter((r) => r.rule === rule)
    // Owners of the domain get the Not found card; the admins do not.
    const norway = of('gap').find((r) => 'card' in r.subject && r.subject.card === `gap:${gap}`)!
    expect(norway.title).toMatch(/: not found, 9 times$/)
    expect(await reached(norway.id)).toEqual(['owner'])
    expect(norway.reached).toEqual(['owner'])
    // The relay put it in the owner's Inbox, by the raise and never by anyone's words.
    const inbox = await client.query<{ subject: string }>(
      "select subject_id as subject from inbox_items where person_id = $1 and kind = 'alert.raised'",
      [people.owner],
    )
    expect(inbox.rows.map((row) => row.subject)).toContain(norway.id)
    // Model spend goes to the admins only; the source that did not sync to the admins too.
    expect(await reached(of('spend')[0]!.id)).toEqual(['admin'])
    expect(of('spend')[0]!.title).toBe('Model spend reached 80% of the monthly cap')
    expect(await reached(of('sync')[0]!.id)).toContain('admin')
    expect(of('sync')[0]!.title).toBe('Demo did not sync')
    // The owner muted A check is due for finance: the reminder reached nobody.
    const due = of('due')[0]!
    expect(due.subject).toEqual({ card: `check:${dueItem}` })
    expect(await reached(due.id)).toEqual([])
  })

  it('raises once for a run of failed reads, and nothing for a rule that is off', async () => {
    // Another failed read in the same run raises nothing new.
    await client.query(
      `insert into connector_snapshots (connector_id, status, fetched_at, error)
       values ('demo', 'failed', now() - interval '4 minutes', 'Definition source could not be read')`,
    )
    expect((await run()).sync).toBe(0)
    // A good read, then a failed one: a new run of failures.
    await client.query(
      `insert into connector_snapshots (connector_id, status, fetched_at) values ('demo', 'ok', now() - interval '3 minutes');
       insert into connector_snapshots (connector_id, status, fetched_at, error)
       values ('demo', 'failed', now() - interval '1 minute', 'Definition source could not be read')`,
    )
    await setRule('admin', 'sync', { enabled: false })
    expect((await run()).sync).toBeUndefined()
    await setRule('admin', 'sync', { enabled: true })
    expect((await run()).sync).toBe(1)
  })

  it('refuses a raise from anyone but the job', async () => {
    const response = await database
      .transaction(people.admin, (tx) =>
        tx.query(`select cl_alert_raise('spend', 'x', '{}', 'x', '{"page":"usage"}')`),
      )
      .catch((error: unknown) => error as Error)
    expect(response).toBeInstanceOf(Error)
  })
})

describe('privacy', () => {
  it('hides a count under the minimum in what a raise says (FR-614)', async () => {
    const all = await raised('admin')
    const small = all.find((r) => 'card' in r.subject && r.subject.card === `gap:${quiet}`)!
    expect(small.title).toMatch(/: not found, fewer than 5 times$/)
    // The conflict was asked 3 times: hidden too.
    expect(all.find((r) => r.rule === 'disagree')!.title).toMatch(/: conflict, fewer than 5 times$/)
  })

  it('never raises a share whose part is under the minimum, so no hidden count is worked out', async () => {
    // Yesterday 4 calls of 10 failed: 40%, but 4 is a hidden count.
    const day = new Date(`${today}T00:00:00Z`)
    day.setUTCDate(day.getUTCDate() - 1)
    await client.query(
      `insert into mcp_requests (hour, client_label, tool, status)
       select $1::timestamptz + interval '10 hours', 'signed-in', 'get_context',
              case when n <= 4 then 'error' else 'ok' end
         from generate_series(1, 10) n`,
      [day.toISOString()],
    )
    expect((await run()).fail).toBe(0)
    // Two more failed calls make 6 of 12: shown, so it fires.
    await client.query(
      `insert into mcp_requests (hour, client_label, tool, status)
       select $1::timestamptz + interval '11 hours', 'signed-in', 'get_context', 'error'
         from generate_series(1, 2)`,
      [day.toISOString()],
    )
    expect((await run()).fail).toBe(1)
  })

  it('shows an owner only the raises about their own domains', async () => {
    const mine = await raised('owner')
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((r) => r.areaIds.includes('finance'))).toBe(true)
    expect(mine.some((r) => r.rule === 'spend')).toBe(false)
    // The last raise of an admins-only rule is not an owner's to read either.
    expect((await rules('owner')).rules.find((r) => r.rule === 'spend')!.last).toBeNull()
  })

  it('the serving and analytics roles read none of it', async () => {
    for (const table of ['alert_rules', 'alert_mutes', 'alert_raises'])
      for (const role of [localRoles.serve, localRoles.readonly]) {
        const { rows } = await client.query<{ can: boolean }>(
          `select has_table_privilege($1, $2, 'select') as can`,
          [role, `public.${table}`],
        )
        expect(rows[0]!.can, `${role} on ${table}`).toBe(false)
      }
  })
})

describe('the Inbox', () => {
  it('shows a raise of a rule with a card of its own as an Alert card to whom it reached', async () => {
    const alerts = async (name: string) =>
      (await feed(name)).cards.flatMap((c) => (c.group === 'alert' ? [c] : []))
    // Calls fail, model spend and the source that did not sync (twice) reached the admin; the
    // conflict, the owner.
    expect((await alerts('admin')).map((c) => c.rule).sort()).toEqual([
      'fail',
      'spend',
      'sync',
      'sync',
    ])
    const [conflict] = await alerts('owner')
    expect(conflict).toMatchObject({ group: 'alert', rule: 'disagree', areaId: 'finance' })
    expect(conflict!.subject).toHaveProperty('topic')
    expect(conflict!.title).toMatch(/: conflict, fewer than 5 times$/)
    expect(conflict!.id).toBe(`alert:${conflict!.raiseId}`)
    // Muted for its domain, it stops reaching the owner; off, it reaches nobody.
    await mute('owner', 'disagree', ['finance'], true)
    expect(await alerts('owner')).toEqual([])
    await mute('owner', 'disagree', ['finance'], false)
    await setRule('admin', 'spend', { enabled: false })
    expect((await alerts('admin')).some((c) => c.rule === 'spend')).toBe(false)
    await setRule('admin', 'spend', { enabled: true })
  })

  it('raises a card for a domain whose saved questions need a look, once, and lists them', async () => {
    const question = 'Why did orders fall in Norway?'
    await transaction(client, async () => {
      const [q] = (
        await client.query<{ id: string }>(
          `insert into saved_questions (area_id, question, origin, created_by)
           values ('finance', $1, 'ask', $2) returning id::text`,
          [question, people.owner],
        )
      ).rows
      const answer = JSON.stringify({ state: 'missing', say: 'Nothing.', items: [] })
      const [b] = (
        await client.query<{ id: string }>(
          `insert into saved_question_baselines (question_id, answer, why, kept_by)
           values ($1, $2, 'saved', $3) returning id::text`,
          [q!.id, answer, people.owner],
        )
      ).rows
      const [c] = (
        await client.query<{ id: string }>(
          `insert into check_runs (trigger, day, total, checked, finished_at)
           values ('publish', $1, 1, 1, now()) returning id::text`,
          [today],
        )
      ).rows
      await client.query(
        `insert into saved_question_results (run_id, question_id, baseline_id, result, reason, answer)
         values ($1, $2, $3, 'look', 'worse', $4)`,
        [c!.id, q!.id, b!.id, answer],
      )
    })
    expect((await run()).saved).toBe(1)
    expect((await run()).saved).toBe(0)
    const raise = (await raised('owner')).find((r) => r.rule === 'saved')!
    expect(raise).toMatchObject({
      title: '1 saved question needs a look',
      subject: { card: 'look:finance' },
      reached: ['owner'],
    })
    const card = (await feed('owner')).cards.find((c) => c.id === 'look:finance')
    expect(card).toMatchObject({ group: 'look', areaId: 'finance', questions: [{ question }] })
    // Muted for finance, the card stops reaching the owner.
    await mute('owner', 'saved', ['finance'], true)
    expect((await feed('owner')).cards.some((c) => c.group === 'look')).toBe(false)
    await mute('owner', 'saved', ['finance'], false)
  })

  it('keeps a muted rule’s cards from the person who muted it, and an off rule’s from everyone', async () => {
    const checkCard = `check:${dueItem}`
    // The owner muted A check is due for finance; the admin still gets the card.
    expect((await feed('owner')).cards.map((c) => c.id)).not.toContain(checkCard)
    expect((await feed('admin')).cards.map((c) => c.id)).toContain(checkCard)
    await mute('owner', 'due', ['finance'], false)
    expect((await feed('owner')).cards.map((c) => c.id)).toContain(checkCard)
    // Not found off: no Not found card for anyone.
    await setRule('admin', 'gap', { enabled: false })
    for (const name of ['owner', 'admin'])
      expect((await feed(name)).cards.some((c) => c.group === 'gap')).toBe(false)
    await setRule('admin', 'gap', { enabled: true })
    expect((await feed('owner')).cards.map((c) => c.id)).toContain(`gap:${gap}`)
  })

  it('keeps an Alert card over two domains until the owner has muted it for both', async () => {
    await client.query(
      "insert into area_assignments (area_id, person_id, role) values ('marketing', $1, 'owner')",
      [people.owner],
    )
    await client.query(
      `select cl_alert_raise('sync', 'two-domains', '{finance,marketing}', 'Two domains did not sync',
                             '{"connector":"demo"}')`,
    )
    await relayOutbox(database)
    const title = 'Two domains did not sync'
    const shown = async () =>
      (await feed('owner')).cards.some((c) => c.group === 'alert' && c.title === title)
    expect(await shown()).toBe(true)
    await mute('owner', 'sync', ['finance'], true)
    expect(await shown()).toBe(true)
    await mute('owner', 'sync', ['marketing'], true)
    expect(await shown()).toBe(false)
    await mute('owner', 'sync', ['finance', 'marketing'], false)
    expect(await shown()).toBe(true)
    await client.query(
      "delete from area_assignments where area_id = 'marketing' and person_id = $1",
      [people.owner],
    )
  })
})
