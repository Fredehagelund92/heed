import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AlertRaise } from '../../src/contract/alerts.ts'
import type { PublishItemResult } from '../../src/contract/context.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import type { Clock } from '../../src/server/clock.ts'
import { raiseAlerts } from '../../src/server/modules/alerts/index.ts'
import { createBundleCache } from '../../src/server/modules/answer/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  A Conflict alert says which pair it is about (FR-220): when the topic's answer gives exactly one
  pair of items that disagree, the raise's subject carries the pair's key beside the topic, so its
  card can show the two items. With several pairs it names the topic alone.
*/

const { client, url } = testDatabase()
const today = new Date().toISOString().slice(0, 10)
const clock: Clock = { now: () => new Date(`${today}T08:00:00Z`), today: () => today }
const database = apiDatabase(url)
const devPeople = ['owner', 'admin'].map((name) => ({
  name,
  email: `${name}@example.test`,
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
async function call(name: string, method: 'GET' | 'POST', path: string, payload?: object) {
  const response = await app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(await login(name)), 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<unknown>()
}

const markets = ['one', 'several']
const draft = (market: string, extra: Draft = {}): Draft => ({
  areaId: 'finance',
  kind: 'note',
  title: `Orders in ${market} count store credit`,
  summary: `Orders in ${market} include orders paid with store credit and gift cards.`,
  scope: {
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: `val:market/${market}` }],
  },
  validity: { start: '2026-01-01', end: null },
  evidence: [
    { url: 'https://wiki.example/orders', quote: 'Store credit counts', date: '2026-10-01' },
  ],
  ...extra,
})
async function live(d: Draft) {
  const r = (await call('owner', 'POST', '/items/publish', { draft: d })) as PublishItemResult
  if (!r.published) throw new Error('not published')
  return r.itemId
}
/** An item of the market that says it disagrees with `against`. */
const disagreeing = (market: string, against: string[], how: string) =>
  live(
    draft(market, {
      title: `Orders in ${market} are ${how}`,
      summary: `Orders in ${market} count only ${how}.`,
      conflicts: against,
    }),
  )

const topics: Record<string, string> = {}
const pairs: Record<string, string[]> = {}

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query(
      `insert into vocab_terms(key,kind,parent_key) select 'val:market/'||m,'dimension_value','dim:market'
         from unnest($1::text[]) m`,
      [markets],
    )
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area] of [
      ['metric:orders', 'Orders', 'finance'],
      ['dim:market', 'Market', null],
      ...markets.map((m) => [`val:market/${m}`, `Market ${m}`, null]),
    ]) {
      const term = await client.query<{ id: string }>(
        `insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest)
         values($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id`,
        [key, name, area],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
  await client.query('select cl_ensure_delivery_partitions(2), cl_ensure_request_partitions(2)')

  const first = await live(draft('one'))
  const second = await disagreeing('one', [first], 'card payments')
  pairs.one = [first, second]

  const base = await live(draft('several'))
  const card = await disagreeing('several', [base], 'card payments')
  pairs.several = [base, card, await disagreeing('several', [base, card], 'cash payments')]

  for (const market of markets) {
    const row = await client.query<{ id: string }>(
      `insert into topics (key, area_id, metric_keys, value_keys, month)
       values ($1, 'finance', '{metric:orders}', $2, $3) returning id::text`,
      [`finance|orders|${market}|2026-10`, `{val:market/${market}}`, '2026-10-01'],
    )
    topics[market] = row.rows[0]!.id
    for (let i = 0; i < 5; i++)
      await client.query(
        `insert into deliveries (delivered_hour, client_label, caller, edition_seq, overlay_seq,
                                 tool_schema_digest, topic_id, scope, status, answer_state)
         values (date_trunc('hour', now(), 'UTC'), 'claude-code', 'agent', 1, 0, 'digest', $1, '{}', 'matched', 'conflict')`,
        [topics[market]],
      )
  }
  await raiseAlerts(database, clock, createBundleCache())
})
afterAll(() => app.close())

describe('the subject of a Conflict alert', () => {
  const subjectOf = async (market: string) =>
    ((await call('admin', 'GET', '/alerts/raised')) as AlertRaise[]).find(
      (r) => r.rule === 'disagree' && 'topic' in r.subject && r.subject.topic === topics[market],
    )?.subject

  it('carries the pair when the topic answer gives exactly one', async () => {
    const [a, b] = pairs.one!
    expect(await subjectOf('one')).toEqual({ topic: topics.one, pair: [a, b].sort().join('.') })
  })

  it('names only the topic when the answer gives several pairs', async () => {
    expect(await subjectOf('several')).toEqual({ topic: topics.several })
  })
})
