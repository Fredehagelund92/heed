import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Gap, GapReport } from '../../src/contract/gaps.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, servingEdition } from './fixtures.ts'
import { apiDatabase, servingPool, tableContents, testDatabase, transaction } from './support.ts'

/*
  A person reports a gap (FR-606 case 5) from Try it or the assistant, over HTTP, on a service
  that also serves MCP. The report counts against the topic's gap exactly as report_gap does
  (FR-308), its topic comes from the scope alone (FR-604), and nothing anywhere names the person
  who sent it (FR-608, FR-613): no row, no history entry. Unknown terms are refused as get_facts
  refuses them, a double click counts once, and each person has a tighter limit of their own.
*/

const { client, url } = testDatabase()
const pool = servingPool(url)
const resource = 'http://localhost:3000/mcp'
const { privateKey } = generateKeyPairSync('ed25519')
const devPeople = Object.keys(people).map((name) => ({
  name,
  email: `${name}@example.test`,
  roles: [],
}))
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock(),
  devPeople,
  mcp: {
    source: createEditionSource(pool),
    store: createAnonymousStore(pool),
    verifier: createDevVerifier(privateKey, resource, 'test'),
    resource,
  },
})

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const report = (
  who: Who | null,
  payload: object,
  key: string | null = randomUUID(),
  extra: Record<string, string> = {},
) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/gaps/reports',
    headers: {
      ...(who ? headers[who] : { origin: 'http://localhost' }),
      ...(key === null ? {} : { 'idempotency-key': key }),
      ...extra,
    },
    payload,
  })
const listGaps = async (who: Who) => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/gaps?limit=200',
    headers: headers[who],
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<Gap[]>()
}

const august = {
  metrics: ['metric:orders'],
  window: { from: '2026-08-01', to: '2026-08-31' },
}
const september = {
  metrics: ['metric:orders'],
  window: { from: '2026-09-01', to: '2026-09-30' },
}
let wire: Client
let beforeLive: { statusCode: number; message: string }

let limitVersion = 1
const setLimit = (person: number) =>
  client.query(
    `insert into settings_versions (key, version, value, reason)
     values ('limits.gap_reports_per_minute', $1, $2, 'test')`,
    [++limitVersion, JSON.stringify({ person })],
  )

/** The gap's row and this week's counts, straight from the tables. */
async function stored(id: string) {
  const { rows } = await client.query<{
    type: string
    case: number
    reports: number
    human: number
    key: string
  }>(
    `select g.type, g.opened_by_case as case, t.key, coalesce(sum(w.reports), 0)::int as reports,
            coalesce(sum(w.human_reports), 0)::int as human
       from gaps g join topics t on t.id = g.topic_id left join gap_weekly_counts w on w.gap_id = g.id
      where g.id = $1 group by g.id, t.key`,
    [id],
  )
  return rows[0]
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
  const before = await report('author', { ...august, type: 'missing' })
  beforeLive = {
    statusCode: before.statusCode,
    message: before.json<{ message: string }>().message,
  }
  await transaction(client, () => servingEdition(client))
  // Room for every step below; the limit itself has its own test.
  await setLimit(1000)
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  wire = new Client(
    { name: 'gap-reports', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await wire.connect(
    new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: {
        headers: { Authorization: `Bearer ${await mintDevToken(privateKey, resource)}` },
      },
    }),
  )
})
afterAll(async () => {
  await wire?.close()
  await app.close()
  await pool.end()
})

describe('reporting a gap', () => {
  it('needs a live edition, as Try it does, and a signed-in person', async () => {
    expect(beforeLive).toEqual({
      statusCode: 412,
      message: 'Gaps can be reported once agents get their first facts.',
    })
    expect((await report(null, { ...august, type: 'missing' })).statusCode).toBe(401)
  })

  it('opens a person-reported gap for the topic of the scope, with its type and note', async () => {
    const response = await report('author', {
      ...september,
      type: 'outdated',
      note: 'The market closed in August.',
    })
    expect(response.statusCode, response.body).toBe(200)
    const { id } = response.json<GapReport>()
    expect(await stored(id)).toEqual({
      type: 'outdated',
      case: 5,
      key: 'finance|metric:orders||2026-09',
      reports: 1,
      human: 1,
    })
    const notes = await client.query('select source, note from gap_notes where gap_id = $1', [id])
    expect(notes.rows).toEqual([{ source: 'person', note: 'The market closed in August.' }])
  })

  it('counts every report against one gap per topic and type, as report_gap does', async () => {
    const first = (await report('author', { ...august, type: 'missing' })).json<GapReport>()
    const second = (await report('owner', { ...august, type: 'missing' })).json<GapReport>()
    expect(second.id).toBe(first.id)
    // An agent's report_gap about the same scope counts against the same gap, not as a person's.
    const agent = await wire.callTool({
      name: 'report_gap',
      arguments: { question: '', ...august },
    })
    expect(agent.isError, JSON.stringify(agent.content)).not.toBe(true)
    expect((agent.structuredContent as { gap_id: string }).gap_id).toBe(first.id)
    expect(await stored(first.id)).toMatchObject({ case: 5, reports: 3, human: 2 })
    // Another type about the same topic is another gap.
    const wider = (await report('author', { ...august, type: 'scope_too_wide' })).json<GapReport>()
    expect(wider.id).not.toBe(first.id)
  })

  it('shows the reports to the owners and administrators who manage the gap, in full', async () => {
    const { id } = (
      await report('approver', { ...august, type: 'contradictory' })
    ).json<GapReport>()
    const gap = (await listGaps('admin')).find((candidate) => candidate.id === id)
    expect(gap).toMatchObject({ openedBy: 'person', reports: 1, personReports: 1, canManage: true })
    expect(gap?.weeks).toEqual([
      expect.objectContaining({ reports: 1, personReports: 1, noItemCalls: 0 }),
    ])
    // One report is below the minimum: anyone else does not see the gap at all (FR-614).
    expect((await listGaps('stranger')).map((candidate) => candidate.id)).not.toContain(id)
  })

  it('records no person: not in any table, and not in the history', async () => {
    const before = await tableContents(client, ['auth.sessions'])
    const response = await report('stranger', {
      ...september,
      type: 'incorrect',
      note: 'The total looks off.',
    })
    expect(response.statusCode, response.body).toBe(200)
    const after = await tableContents(client, ['auth.sessions'])
    const added = after.filter((line) => !before.includes(line)).join('\n')
    expect(added).toContain('The total looks off.')
    for (const trace of [
      people.stranger,
      'stranger@example.test',
      'stranger',
      headers.stranger!.cookie!,
    ])
      expect(added).not.toContain(trace)
    expect(added).not.toMatch(/^public\.audit_log /m)
  })

  it('refuses a scope get_facts would not resolve, a sensitive note and unknown fields', async () => {
    const refused = async (payload: object, status: number) => {
      const response = await report('author', payload)
      expect(response.statusCode, response.body).toBe(status)
      return response.json<{ data?: { findings: { code: string; field: string }[] } }>()
    }
    const unknown = await refused(
      { ...august, metrics: ['metric:nothing_like_this'], type: 'missing' },
      422,
    )
    expect(unknown.data?.findings).toContainEqual(
      expect.objectContaining({ code: 'unknown_term', field: 'metrics' }),
    )
    const nothing = await refused({ window: august.window, type: 'missing' }, 422)
    expect(nothing.data?.findings.map((finding) => finding.code)).toEqual(['scope'])
    for (const note of [
      'Mail me at someone@example.test',
      'call +45 12 34 56 78',
      'password: hunter22',
    ])
      expect((await refused({ ...august, type: 'missing', note }, 422)).data?.findings).toEqual([
        expect.objectContaining({ field: 'note' }),
      ])
    await refused({ ...august, type: 'not_a_type' }, 400)
    await refused({ ...august }, 400)
    await refused({ ...august, type: 'missing', note: 'x'.repeat(501) }, 400)
    await refused({ ...august, type: 'missing', note: '' }, 400)
    // No question text and no free-text topic (FR-602, FR-604).
    await refused({ ...august, type: 'missing', question: 'Why did orders drop?' }, 400)
    await refused({ ...august, type: 'missing', topic: 'Orders in Norway' }, 400)
  })

  it('counts a double click or a retry once, and refuses the same key for another report', async () => {
    const key = randomUUID()
    const payload = { ...august, type: 'duplicate' }
    const [first, second] = await Promise.all([
      report('author', payload, key),
      report('author', payload, key),
    ])
    expect(first.statusCode, first.body).toBe(200)
    expect(second.statusCode, second.body).toBe(200)
    const { id } = first.json<GapReport>()
    expect(second.json<GapReport>().id).toBe(id)
    expect((await report('author', payload, key)).json<GapReport>().id).toBe(id)
    expect(await stored(id)).toMatchObject({ reports: 1, human: 1 })
    const other = await report('author', { ...payload, note: 'Two items say the same.' }, key)
    expect(other.statusCode, other.body).toBe(422)
    expect((await report('author', payload, null)).statusCode).toBe(400)
    expect((await report('author', payload, 'short')).statusCode).toBe(400)
    // A key that could be guessed is refused: the stored digest mixes in the caller.
    expect((await report('author', payload, 'report-0000000001')).statusCode).toBe(400)
    expect((await report('author', payload, randomBytes(16).toString('hex'))).statusCode).toBe(200)
  })

  it('never lets a reader uncover a hidden count by adding reports of their own', async () => {
    const october = {
      metrics: ['metric:orders'],
      window: { from: '2026-10-01', to: '2026-10-07' },
    }
    const first = (await report('stranger', { ...october, type: 'outdated' })).json<GapReport>()
    // The topic is asked about often enough this week to show, and two agents found it missing.
    await client.query(
      `insert into topic_week_counts (topic_id, week, status, calls, no_item_calls)
       select topic_id, date_trunc('week', now() at time zone 'UTC')::date, 'no_match', 20, 0
         from gaps where id = $1`,
      [first.id],
    )
    await client.query(
      `update gap_weekly_counts set reports = reports + 2
        where gap_id = $1 and week = date_trunc('week', now() at time zone 'UTC')::date`,
      [first.id],
    )
    for (let n = 0; n < 4; n += 1)
      expect((await report('stranger', { ...october, type: 'outdated' })).statusCode).toBe(200)
    // Seven reports: two agents' and five of the reader's. Without the reader's, two stay hidden.
    expect(await stored(first.id)).toMatchObject({ reports: 7, human: 5 })
    expect((await listGaps('stranger')).map((gap) => gap.id)).not.toContain(first.id)
    // Its owners see every report, and how many came from people.
    expect((await listGaps('owner')).find((gap) => gap.id === first.id)).toMatchObject({
      reports: 7,
      personReports: 5,
    })
    // Three more from agents: the week shows without the reader's reports, still without them.
    await client.query(
      `update gap_weekly_counts set reports = reports + 3
        where gap_id = $1 and week = date_trunc('week', now() at time zone 'UTC')::date`,
      [first.id],
    )
    expect((await listGaps('stranger')).find((gap) => gap.id === first.id)).toMatchObject({
      reports: 5,
      personReports: null,
      weeks: [expect.objectContaining({ reports: 5, personReports: null })],
    })
  })

  it("keeps one person's retry key apart from another's", async () => {
    const key = randomUUID()
    const payload = { ...august, type: 'scope_too_narrow' }
    const mine = await report('author', payload, key)
    const theirs = await report('approver', { ...payload, note: 'Only for Norway.' }, key)
    expect(mine.statusCode, mine.body).toBe(200)
    // The same key from someone else is another report, not a replay or a refusal.
    expect(theirs.statusCode, theirs.body).toBe(200)
    expect(await stored(mine.json<GapReport>().id)).toMatchObject({ reports: 2, human: 2 })
    const keys = await client.query<{ digest: string }>(
      "select encode(retry_digest, 'hex') as digest from gap_report_keys",
    )
    for (const { digest } of keys.rows)
      expect([people.author, people.approver]).not.toContain(digest)
  })

  it("limits each person's reports per minute, with a retry hint, and leaves others alone", async () => {
    await setLimit(2)
    try {
      const payload = { ...august, type: 'unclear_question' }
      expect((await report('admin', payload)).statusCode).toBe(200)
      expect((await report('admin', payload)).statusCode).toBe(200)
      const limited = await report('admin', payload)
      expect(limited.statusCode, limited.body).toBe(429)
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
      expect(limited.json<{ data: { retryAfterSeconds: number } }>().data.retryAfterSeconds).toBe(
        Number(limited.headers['retry-after']),
      )
      expect((await report('owner', payload)).statusCode).toBe(200)
    } finally {
      await setLimit(1000)
    }
  })
})
