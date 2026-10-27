import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedPersonId } from '../../db/seed/bulk.ts'
import type {
  AnswerResult,
  Asked,
  LookupEvent,
  Reach,
  Replay,
  TryItRun,
} from '../../src/contract/answer.ts'
import type { PreviewReply, ProposalRecord } from '../../src/contract/proposals.ts'
import { answer, startersOf, topicScope } from '../../src/domain/answer.ts'
import { ownCaveat } from '../../src/domain/proposal-rules.ts'
import { buildApp } from '../../src/server/app.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { systemClock } from '../../src/server/clock.ts'
import { loadServingBundle, type ServingBundle } from '../../src/server/modules/editions/index.ts'
import { deliver } from '../../src/server/modules/evals/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { labCases, phrasings } from '../server/domain/topics-lab.ts'
import { accept, publish, version } from './fixtures.ts'
import { apiDatabase, tableContents, testDatabase, transaction } from './support.ts'

/*
  The answer engine over HTTP, on the demo library (the bulk seed of 1,500 Larchwood items and
  its 1,400 editions): Ask's look-up streamed step by step, Try it on a draft, the reach of a
  draft, Asked this week and the replay of a topic on the live edition and the one before it.
  Each answer is held to get_context's own code on the same edition (`deliver`), nothing is
  recorded, and no question is kept or logged (FR-602).
*/

const { client, url } = testDatabase({ seeded: true })
const today = '2026-10-07'
const week = '2026-10-05'
const logs: string[] = []
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
  clock: systemClock(today),
  devPeople: ['maria', 'jon', 'ravi', 'tomas', 'kofi'].map((name) => ({
    name,
    email: `per_${name}@example.test`,
    roles: [],
  })),
})
type Who = 'maria' | 'jon' | 'ravi' | 'tomas' | 'kofi'
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const ok = async <T>(method: 'GET' | 'POST', path: string, who: Who, payload?: object) => {
  const response = await call(method, path, who, payload)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
const tx = {
  query: async <Row extends object>(sql: string, values?: unknown[]) =>
    (await client.query(sql, values)).rows as Row[],
}
type Head = { seq: string; label: string; overlay: string }
const heads = async () =>
  (
    await client.query<Head>(
      `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay
         from editions e where e.sealed_at is not null and e.seq <= (select seq from live_edition)
        order by e.seq desc limit 2`,
    )
  ).rows
/** The events of a look-up, as the event stream sends them. */
const events = (body: string) =>
  body
    .split('\n\n')
    .map((block) => block.split('\n').find((line) => line.startsWith('data:')))
    .filter((line): line is string => !!line)
    .map((line) => JSON.parse(line.slice(5).trim()) as LookupEvent)
/** What get_context gives, as the engine's answer names it. */
const asGiven = (reply: { status?: string; items?: { id: string }[]; say?: string }) => ({
  status: reply.status,
  items: (reply.items ?? []).map((item) => item.id),
  say: reply.say,
})
const asAnswered = (a: Pick<AnswerResult, 'status' | 'items' | 'say'>) => ({
  status: a.status,
  items: a.items.map((item) => item.id),
  say: a.say,
})
/** The answer without its times, which differ between two runs. */
const untimed = ({ ms: _ms, steps, ...rest }: AnswerResult) => ({
  ...rest,
  steps: steps.map(({ ms: _step, ...step }) => step),
})
/** The engine's own answer as the API gives it: with its target, without the overlay. */
const engine = (target: AnswerResult['target'], ...args: Parameters<typeof answer>) => {
  const { overlay: _overlay, ...rest } = answer(...args)
  return { target, ...rest }
}

let live: ServingBundle
let draft: ProposalRecord
const draftScope = {
  metrics: ['metric:orders'],
  dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
}
const october = { from: '2026-10-01', to: '2026-10-31' }

async function topicWithCalls(
  topic: { area: string | null; metrics: string[]; values: string[]; month: string },
  calls: number,
) {
  const key = [
    topic.area ?? '',
    topic.metrics.join(','),
    topic.values.join(','),
    topic.month.slice(0, 7),
  ].join('|')
  const { rows } = await client.query<{ id: string }>(
    `insert into topics (key, area_id, metric_keys, value_keys, month) values ($1,$2,$3,$4,$5)
     on conflict (key) do update set key = excluded.key returning id::text`,
    [key, topic.area, topic.metrics, topic.values, topic.month],
  )
  if (calls)
    await client.query(
      `insert into topic_week_counts (topic_id, week, status, calls, no_item_calls)
       values ($1, $2, 'matched', $3, 0)`,
      [rows[0]!.id, week, calls],
    )
  return rows[0]!.id
}

beforeAll(async () => {
  await client.query('reset role')
  for (const who of ['maria', 'jon', 'ravi', 'tomas', 'kofi'] as const) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `per_${who}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[who] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
  live = await loadServingBundle(tx, (await heads())[0]!)
  // Maria drafts an event about orders in Norway, high risk so it ranks first where it applies.
  draft = await ok<ProposalRecord>('POST', '/proposals', 'maria', {
    channel: 'form',
    draft: {
      kind: 'event',
      title: 'Online orders to Norway paused for a carrier strike',
      summaryMarkup: 'A carrier strike paused online orders to Norway from 6 October 2026.',
      scope: {
        metrics: ['metric:orders'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
      },
      validity: { start: '2026-10-06', end: null },
      reviewDate: '2027-01-15',
      evidence: [
        {
          url: 'https://carrier.example/norway/strike',
          quote: 'Deliveries to Norway are paused from 6 October.',
          date: '2026-10-06',
        },
      ],
      areaId: 'area_sales',
      riskLevel: 'high',
    },
  })
  // This week's topics: what agents asked about, as counts.
  await client.query('delete from topic_week_counts where week = $1', [week])
  await topicWithCalls(
    {
      area: 'area_sales',
      metrics: ['metric:orders'],
      values: ['val:market/norway'],
      month: '2026-10-01',
    },
    12,
  )
  await topicWithCalls(
    {
      area: 'area_sales',
      metrics: ['metric:orders'],
      values: ['val:market/norway'],
      month: '2026-09-01',
    },
    3,
  )
  await topicWithCalls(
    {
      area: 'area_sales',
      metrics: ['metric:orders'],
      values: ['val:market/spain'],
      month: '2026-10-01',
    },
    9,
  )
  await topicWithCalls(
    {
      area: 'area_sales',
      metrics: ['metric:net_revenue'],
      values: ['val:market/norway'],
      month: '2026-10-01',
    },
    3,
  )
  await topicWithCalls(
    {
      area: 'area_sales',
      metrics: ['metric:units_sold'],
      values: ['val:market/poland'],
      month: '2026-10-01',
    },
    4,
  )
}, 120_000)
afterAll(async () => {
  await app.close()
})

describe('Ask: a look-up', () => {
  const question = 'What were orders in Norway in August 2026?'

  it('sends each step as it is done, then the answer, as get_context answers the question', async () => {
    const response = await call('POST', '/ask/lookup', 'maria', { question })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['content-type']).toMatch(/^text\/event-stream/)
    const sent = events(response.body)
    expect(sent.map((e) => (e.type === 'step' ? e.step.step : e.type))).toEqual([
      'read_scope',
      'looked_up',
      'left_out',
      'checked',
      'said',
      'answer',
    ])
    const result = (sent.at(-1) as Extract<LookupEvent, { type: 'answer' }>).answer
    expect(result.steps).toEqual(sent.slice(0, 5).map((e) => (e as { step: unknown }).step))
    expect(result).toMatchObject({ target: { kind: 'live' }, edition: live.edition })
    expect(asAnswered(result)).toEqual(
      asGiven(await deliver(live, systemClock(today), { question })),
    )
    expect(untimed(result)).toEqual(
      untimed(engine({ kind: 'live' }, live, { question }, { today })),
    )
    expect(result.items.length).toBeGreaterThan(0)
  })

  it('takes the names a person picked beside the words, as an agent sends them', async () => {
    const asked = {
      question: 'How much did we make in Norge?',
      metrics: ['Net revenue'],
      dimension_filters: [{ dimension: 'Market', values: ['Norge'] }],
      window: { from: '2026-08-01', to: '2026-08-31' },
    }
    const sent = events((await call('POST', '/ask/lookup', 'kofi', asked)).body)
    const result = (sent.at(-1) as Extract<LookupEvent, { type: 'answer' }>).answer
    expect(result.scope).toMatchObject({
      metrics: ['metric:net_revenue'],
      filters: { 'dim:market': ['val:market/norway'] },
    })
    expect(asAnswered(result)).toEqual(asGiven(await deliver(live, systemClock(today), asked)))
  })

  it("carries each item's copied source line and what not to conclude, for Where", async () => {
    const sent = events((await call('POST', '/ask/lookup', 'maria', { question })).body)
    const result = (sent.at(-1) as Extract<LookupEvent, { type: 'answer' }>).answer
    for (const item of result.items) {
      const served = live.items.find((i) => i.id === item.id)!
      expect(item.quote, item.id).toBe(served.evidence.find((e) => e.quote.trim())?.quote ?? null)
      expect(item.notToConclude, item.id).toBe(ownCaveat(served.notToConclude))
    }
    expect(result.items.some((item) => item.quote)).toBe(true)
  })

  it('records nothing and never keeps or logs the question', async () => {
    const secret = 'Why did orders in Norway drop when the warehouse in Bergen flooded?'
    const before = await tableContents(client, ['auth.sessions'])
    const lines = logs.length
    const response = await call('POST', '/ask/lookup', 'maria', { question: secret })
    expect(response.statusCode).toBe(200)
    expect(await tableContents(client, ['auth.sessions'])).toEqual(before)
    expect(logs.slice(lines).join('\n')).not.toContain('Bergen')
    expect((await call('POST', '/ask/lookup', 'maria', { question: '' })).statusCode).toBe(400)
  })

  it('answers the topics lab in under 50 ms at the 95th percentile on the demo library', async () => {
    const durations: number[] = []
    for (const ask of [
      ...phrasings.map((p) => ({ question: p.question })),
      ...labCases.map((c) => c.ask),
    ]) {
      const sent = events((await call('POST', '/ask/lookup', 'maria', ask)).body)
      const result = (sent.at(-1) as Extract<LookupEvent, { type: 'answer' }>).answer
      durations.push(result.ms)
    }
    expect(durations).toHaveLength(phrasings.length + labCases.length)
    const sorted = durations.sort((a, b) => a - b)
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!
    process.stdout.write(`answer engine on the demo library: p95 ${p95} ms\n`)
    expect(p95).toBeLessThan(50)
  })

  it('asks a visitor to sign in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ask/lookup',
      payload: { question },
    })
    expect(response.statusCode).toBe(401)
  })
})

describe('Ask keeps no question (FR-602, FR-603)', () => {
  it('stores and logs none of the words of a question asked in Ask, read for its scope, or offered back', async () => {
    // A word nothing else in the database holds, so finding it anywhere means the question was kept.
    const marker = 'Quillfeather'
    const asked = [
      `Why did orders in Norway drop after the ${marker} audit?`,
      `What should I know about ${marker} in Spain?`,
    ]
    const before = await tableContents(client, ['auth.sessions'])
    const lines = logs.length
    for (const question of asked) {
      expect((await call('POST', '/ask/lookup', 'maria', { question })).statusCode).toBe(200)
      expect(
        (
          await call('POST', '/ask/lookup', 'jon', {
            question,
            metrics: ['metric:orders'],
            dimension_filters: [{ dimension: 'dim:market', values: ['val:market/spain'] }],
          })
        ).statusCode,
      ).toBe(200)
      expect((await call('POST', '/try-it/read', 'maria', { question })).statusCode).toBe(200)
    }
    expect(JSON.stringify(await ok<Asked>('GET', '/ask/asked', 'maria'))).not.toContain(marker)
    // Nothing changed anywhere: no count, no topic, no record of who asked.
    expect(await tableContents(client, ['auth.sessions'])).toEqual(before)
    expect((await tableContents(client)).join('\n')).not.toContain(marker)
    expect(logs.slice(lines).join('\n')).not.toContain(marker)
  })
})

describe('a named report keeps its words in the report only (FR-602, FR-622)', () => {
  it('keeps the question and words a person sends, with their name, in the report and nowhere else', async () => {
    const marker = 'Brightwater'
    const item = live.items.find((i) => i.audience.kind === 'everyone')!
    const lines = logs.length
    const before = await tableContents(client, ['auth.sessions', 'public.reports'])
    const sent = await ok<{ id: string }>('POST', '/reports', 'maria', {
      question: `Is the ${marker} store in the Norway numbers?`,
      itemId: item.id,
      part: 'item',
      what: `It leaves out ${marker}.`,
    })
    // The report holds the words, with who sent them.
    const [row] = (
      await client.query<{ question: string; person: string }>(
        'select question, person_id::text as person from reports where id=$1',
        [sent.id],
      )
    ).rows
    expect(row).toEqual({
      question: `Is the ${marker} store in the Norway numbers?`,
      person: seedPersonId('per_maria'),
    })
    // Nothing else holds them, not even the stored answer a retry gets, and no log says them.
    const others = await tableContents(client, ['auth.sessions', 'public.reports'])
    expect(others.filter((t) => !before.includes(t)).map((t) => t.split(' ')[0])).toEqual([
      'public.idempotency_keys',
    ])
    expect(others.join('\n')).not.toContain(marker)
    expect(logs.slice(lines).join('\n')).not.toContain(marker)
  })

  it('is never read by agents: the serving role has no grant on reports', async () => {
    await client.query('begin')
    try {
      await client.query(`set local role ${identifier(localRoles.serve)}`)
      await expect(client.query('select * from reports')).rejects.toThrow(/permission denied/)
    } finally {
      await client.query('rollback')
    }
  })
})

describe('Try it on a draft', () => {
  const scope = { ...draftScope, window: october }

  it('answers with the draft in the live edition, as its preview does, beside the live answer', async () => {
    const tried = await ok<TryItRun>('POST', '/try-it', 'maria', { ...scope, draft: draft.id })
    const preview = await ok<{ result: PreviewReply }>(
      'POST',
      `/proposals/${draft.id}/preview`,
      'maria',
      { question: '', ...scope },
    )
    const item = tried.answer!.target.kind === 'draft' ? tried.answer!.target.item : ''
    expect(tried.answer!.target).toEqual({ kind: 'draft', proposal: draft.id, item })
    expect(asAnswered(tried.answer!)).toEqual(asGiven(preview.result))
    expect(tried.result.items?.map((i) => i.id)).toEqual(tried.answer!.items.map((i) => i.id))
    expect(tried.answer!.items[0]).toMatchObject({ id: item, kind: 'event' })
    // On the live edition the draft is nowhere.
    const now = await ok<TryItRun>('POST', '/try-it', 'maria', scope)
    expect(now.answer!.target).toEqual({ kind: 'live' })
    expect(asAnswered(now.answer!)).toEqual(
      asGiven(await deliver(live, systemClock(today), { question: '', ...scope })),
    )
    expect(now.answer!.items.map((i) => i.id)).not.toContain(item)
  })

  it('is no way to read a draft the person may not see', async () => {
    const response = await call('POST', '/try-it', 'kofi', { ...scope, draft: draft.id })
    expect(response.statusCode, response.body).toBe(404)
  })
})

describe('the reach of a draft', () => {
  it("counts this week's questions that would get it, from topics asked at least five times", async () => {
    // Each topic this week, previewed with the draft in it: get_context's own answer.
    const topics = [
      { values: ['val:market/norway'], from: '2026-10-01', to: '2026-10-31', calls: 12 },
      { values: ['val:market/norway'], from: '2026-09-01', to: '2026-09-30', calls: 3 },
      { values: ['val:market/spain'], from: '2026-10-01', to: '2026-10-31', calls: 9 },
    ]
    let expected = 0
    for (const t of topics) {
      const preview = await ok<{ result: PreviewReply }>(
        'POST',
        `/proposals/${draft.id}/preview`,
        'maria',
        {
          question: '',
          metrics: ['metric:orders'],
          dimension_filters: [{ dimension: 'dim:market', values: t.values }],
          window: { from: t.from, to: t.to },
        },
      )
      const gets = (preview.result.items ?? []).some((i) => i.title.startsWith('Online orders'))
      if (gets && t.calls >= 5) expected += t.calls
    }
    expect(expected).toBe(12)
    expect(await ok<Reach>('POST', '/engine/reach', 'maria', { draft: draft.id })).toEqual({
      questions: 12,
      week,
    })
    expect((await call('POST', '/engine/reach', 'kofi', { draft: draft.id })).statusCode).toBe(404)
  })
})

describe('Asked this week', () => {
  it('lists the topics asked most, with the state each gets now, and never a small count', async () => {
    const asked = await ok<Asked>('GET', '/ask/asked', 'kofi')
    expect(asked).toMatchObject({ week, hidden: 7 })
    expect(asked.rows.map((r) => [r.title, r.count, r.atLeast, r.months])).toEqual([
      // 12 in October and 3 in September: a total would give the 3 away.
      ['Orders in Norway', null, 12, ['2026-10-01']],
      ['Orders in Spain', 9, 9, ['2026-10-01']],
    ])
    for (const row of asked.rows) {
      const tried = await ok<TryItRun>('POST', '/try-it', 'kofi', {
        metrics: row.scope.metrics,
        dimension_filters: Object.entries(row.scope.filters).map(([dimension, values]) => ({
          dimension,
          values,
        })),
        window: { from: row.scope.window.start, to: '2026-10-31' },
      })
      expect([row.state, row.items]).toEqual([tried.answer!.state, tried.answer!.items.length])
    }
    expect(JSON.stringify(asked)).not.toMatch(/per_|@example/)
  })

  it('hides the total when, beside the rows, it would give a small count away', async () => {
    // 12 + 3 + 9 + 3 + 4 calls this week. The rows show 12 (Norway's 3 in September hidden), 9 and
    // 7 hidden: a total of 31 would give the 3 away by subtraction (FR-614).
    expect(await ok<Asked>('GET', '/ask/asked', 'kofi')).toMatchObject({
      asked: null,
      askedAtLeast: 21,
    })
  })

  it('offers first questions made from what the workspace has written', async () => {
    const { starters } = await ok<Asked>('GET', '/ask/asked', 'kofi')
    expect(starters.map((s) => s.scope)).toEqual(startersOf(live, today))
    expect(starters).toHaveLength(4)
    for (const s of starters) expect(s.title).not.toBe('')
  })
})

describe('the replay of a topic', () => {
  let topic = ''
  let before: ServingBundle
  let newItem = ''

  beforeAll(async () => {
    // A publish: a high-risk event about orders in Norway in September.
    const v = await transaction(client, async () => {
      const made = await version(client, {
        title: 'Orders in Norway were counted twice for a week',
        summary: 'Orders in Norway were counted twice from 14 to 20 September 2026.',
        risk: 'high',
        author: seedPersonId('per_maria'),
        owner: seedPersonId('per_jon'),
        area: 'area_sales',
        validity: { from: '2026-09-14', until: '2026-09-21' },
      })
      // The version's scope is checked when the transaction ends: orders, in Norway.
      await client.query(
        "insert into item_version_dimension_values values ($1,'dim:market','val:market/norway')",
        [made.id],
      )
      return made
    })
    // High risk: the owner and the domain's approver accept it.
    await accept(client, v.id, {
      actor: seedPersonId('per_jon'),
      approver: true,
      approverActor: seedPersonId('per_lars'),
    })
    before = live
    await publish(client, v.id)
    live = await loadServingBundle(tx, (await heads())[0]!)
    newItem = v.item
    topic = await topicWithCalls(
      {
        area: 'area_sales',
        metrics: ['metric:orders'],
        values: ['val:market/norway'],
        month: '2026-09-01',
      },
      0,
    )
  })

  it('answers the topic now and before the last publish, each as get_context did on its edition', async () => {
    const scope = topicScope({
      metrics: ['metric:orders'],
      values: ['val:market/norway'],
      dimensions: [],
      month: '2026-09-01',
    })
    const ask = {
      question: '',
      metrics: scope.metrics,
      dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
      window: { from: '2026-09-01', to: '2026-09-30' },
    }
    const now = await ok<Replay>('POST', '/observability/replay', 'jon', { topic, when: 'now' })
    const then = await ok<Replay>('POST', '/observability/replay', 'jon', {
      topic,
      when: 'before',
    })
    expect(now.answer).toMatchObject({ target: { kind: 'live' }, edition: live.edition })
    expect(then.answer).toMatchObject({ target: { kind: 'edition' }, edition: before.edition })
    expect(asAnswered(now.answer)).toEqual(asGiven(await deliver(live, systemClock(today), ask)))
    expect(asAnswered(then.answer)).toEqual(asGiven(await deliver(before, systemClock(today), ask)))
    expect(now.answer.items[0]!.id).toBe(newItem)
    expect(then.answer.items.map((i) => i.id)).not.toContain(newItem)
    expect(untimed(now.answer)).toEqual(
      untimed(engine({ kind: 'live' }, live, { scope }, { today })),
    )
    expect(now.answer.steps.map((s) => s.step)).toEqual([
      'read_scope',
      'looked_up',
      'left_out',
      'checked',
      'said',
    ])
  })

  it("is for administrators and the owners of the topic's domain", async () => {
    expect((await call('POST', '/observability/replay', 'ravi', { topic })).statusCode).toBe(200)
    // An owner of another domain is told it does not exist; a member may not ask.
    expect((await call('POST', '/observability/replay', 'tomas', { topic })).statusCode).toBe(404)
    expect((await call('POST', '/observability/replay', 'kofi', { topic })).statusCode).toBe(403)
    expect(
      (await call('POST', '/observability/replay', 'jon', { topic: randomUUID() })).statusCode,
    ).toBe(404)
  })
})
