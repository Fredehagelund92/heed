import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EvalRun, RetrievalPoint, RetrievalRun } from '../../src/contract/evals.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import type { Clock } from '../../src/server/clock.ts'
import { evalJobs, queueAreaRun, workEvaluations } from '../../src/server/modules/evals/index.ts'
import {
  createModelPort,
  modelProviders,
  type ModelPort,
  type ProviderEntry,
} from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The first part of the Quality back end: the retrieval pass of every edition without a model,
  the code and judge layers kept apart, the judge's model family, and full runs queued by changes
  the review gate does not see. Driven through HTTP and the real scheduled jobs, with the scripted
  mock model.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
let day = '2026-10-08'
const clock: Clock = { now: () => new Date(), today: () => day }
// Priced like Sonnet so a triggered run has a cost to hold against the budget. Still no model.
const models = createModelPort({
  mode: 'mock',
  mockPrices: { input: 2, output: 10, cacheRead: 0.2 },
})
const deps = { port: models, clock }
const app = buildApp({
  database,
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock,
  models,
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
const silent = createLogger({ level: 'silent' })
const context = { database, logger: silent, signal: new AbortController().signal }
const retrievalJob = evalJobs(deps).find((job) => job.name === 'evals.retrieval')!
const retrieve = () => retrievalJob.run(context)
const work = () =>
  workEvaluations(database, deps, {
    deadline: Date.now() + 30_000,
    signal: new AbortController().signal,
    logger: silent,
  })

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const setting = (key: string, value: unknown) =>
  client.query(
    `insert into settings_versions(key,version,value,reason)
     select $1,coalesce(max(version),0)+1,$2,'test' from settings_versions where key=$1`,
    [key, JSON.stringify(value)],
  )

function draft(extra: Draft = {}): Draft {
  return {
    areaId: 'finance',
    kind: 'event',
    title: 'Norway closure',
    summary: 'Online sales to Norway stopped on 4 August 2026.',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    validity: { start: '2026-08-04', end: null },
    evidence: [
      { url: 'https://example.test/law', quote: 'Online sales stopped', date: '2026-08-04' },
    ],
    ...extra,
  }
}
async function accepted(extra: Draft = {}) {
  const created = await call('POST', '/proposals', 'author', { draft: draft(extra) })
  expect(created.statusCode, created.body).toBe(200)
  const p = created.json<ProposalRecord>()
  const submitted = await call('POST', `/proposals/${p.id}/submit`, 'author', {
    revision: p.revision,
  })
  expect(submitted.statusCode, submitted.body).toBe(200)
  const review = await call('GET', `/proposals/${p.id}/review`, 'owner')
  const decided = await call('POST', `/proposals/${p.id}/decisions`, 'owner', {
    revision: review.json<{ proposal: { revision: number } }>().proposal.revision,
    outcome: 'accept',
    reason: 'Reviewed against the evidence',
  })
  expect(decided.statusCode, decided.body).toBe(200)
  return submitted.json<ProposalRecord>().itemId!
}

const wording = 'Orders in Norway from 2026-08-01 to 2026-08-31'
function question(id: string, area: string, expected: object) {
  return {
    id,
    area,
    wordings: [
      { text: 'Why did orders drop in Norway in August 2026?', kind: 'natural' },
      { text: wording, kind: 'precise' },
    ],
    scope: {
      metrics: ['metric:orders'],
      dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
      window: { from: '2026-08-01', to: '2026-08-31' },
    },
    expected,
    source: 'Quality tests',
  }
}
async function save(body: { id: string }, who: Who) {
  const response = await call('PUT', `/evals/questions/${body.id}`, who, {
    id: body.id,
    question: body,
  })
  expect(response.statusCode, response.body).toBe(200)
}
const latest = async (who: Who, area?: string) =>
  call('GET', `/evals/retrieval${area ? `?area=${area}` : ''}`, who)
const runOf = async (id: string) =>
  (await call('GET', `/evals/runs/${id}`, 'owner')).json<{
    run: EvalRun
    results: { id: string; layers: unknown }[]
    scorecard: { layers: unknown; failedChecks: unknown } | null
  }>()

let closure = ''
const labels: string[] = []

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area, ref] of [
      ['metric:orders', 'Orders', 'finance', 'demo:orders'],
      ['dim:market', 'Market', null, null],
      ['val:market/norway', 'Norway', null, null],
    ]) {
      const term = await client.query<{ id: string }>(
        `with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,$4 from v where $4::text is not null) select id from v`,
        [key, name, area, ref],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
    // The stranger owners marketing only.
    await client.query(
      "insert into area_assignments(area_id,person_id,role) values('marketing',$1,'owner')",
      [people.stranger],
    )
  })
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
  closure = await accepted()
  await save(question('norway-closure', 'finance', { must_deliver: [closure] }), 'owner')
  // A deliberately wrong expectation: the closure is delivered, so this question fails.
  await save(question('norway-forbidden', 'finance', { must_not_deliver: [closure] }), 'owner')
  await save(question('norway-aside', 'finance', { must_deliver: [closure] }), 'owner')
  const aside = await call('POST', '/evals/questions/norway-aside/set-aside', 'owner', {
    revision: 1,
    reason: 'Duplicates norway-closure',
  })
  expect(aside.statusCode, aside.body).toBe(200)
  await save(question('marketing-closure', 'marketing', { must_deliver: [closure] }), 'stranger')
  labels.push(
    ...(await client.query<{ label: string }>('select label from editions order by seq')).rows.map(
      (r) => r.label,
    ),
  )
})
afterAll(async () => {
  await app.close()
})

describe('the retrieval pass of every edition', () => {
  it('passes the live edition once, with no model and no wording text stored', async () => {
    const spend = () =>
      client.query('select feature,calls::int from llm_spend_monthly order by feature')
    const before = (await spend()).rows
    expect(await retrieve()).toEqual({ editions: 1, daily: false, queued: {} })
    // Safe to run twice (NFR-047): nothing new for the same edition and day.
    expect(await retrieve()).toEqual({ editions: 0, daily: false, queued: {} })
    const runs = await client.query(
      'select e.label,r.trigger::text,r.questions,r.passed,r.set_aside from retrieval_runs r join editions e on e.seq=r.edition_seq',
    )
    expect(runs.rows).toEqual([
      {
        label: labels.at(-1),
        trigger: 'edition',
        questions: 3,
        passed: 2,
        set_aside: { finance: 1 },
      },
    ])
    expect((await spend()).rows).toEqual(before)
    expect((await client.query('select 1 from eval_cells')).rowCount).toBe(0)
    const stored = await client.query('select row_to_json(r)::text as row from retrieval_results r')
    expect(stored.rows.map((r: { row: string }) => r.row).join(' ')).not.toContain('Norway')
  })

  it('lets owners read their own areas and administrators every area', async () => {
    const owner = await latest('owner')
    expect(owner.statusCode, owner.body).toBe(200)
    const body = owner.json<{ edition: string; run: RetrievalRun }>()
    expect(body.edition).toBe(labels.at(-1))
    expect(body.run).toMatchObject({
      trigger: 'edition',
      questions: 2,
      passed: 1,
      failed: 1,
      setAside: 1,
      failedChecks: { served: 0, delivered: 0, not_delivered: 1, status: 0 },
    })
    expect(body.run.results.find((r) => r.id === 'norway-forbidden')).toMatchObject({
      area: 'finance',
      passed: false,
      checks: { served: true, delivered: true, not_delivered: false },
      wordings: [
        { passed: false, status: 'matched', missing: [], forbidden: [closure] },
        { passed: false, status: 'matched', missing: [], forbidden: [closure] },
      ],
    })
    expect((await latest('owner', 'marketing')).statusCode).toBe(403)
    const marketing = (await latest('stranger')).json<{ run: RetrievalRun }>()
    expect(marketing.run.results.map((r) => r.id)).toEqual(['marketing-closure'])
    // A contributor is refused at the gate; the assistant never acts with these roles.
    expect((await latest('author')).statusCode).toBe(403)
    expect((await latest('admin')).json<{ run: RetrievalRun }>().run.questions).toBe(3)
    expect((await latest('admin', 'marketing')).json<{ run: RetrievalRun }>().run.questions).toBe(1)

    const live = await call('GET', `/evals/retrieval/editions/${labels.at(-1)}`, 'owner')
    expect(live.json<{ run: RetrievalRun }>().run.id).toBe(body.run.id)
    // The bootstrap edition was sealed before the first pass and has none.
    const first = await call('GET', `/evals/retrieval/editions/${labels[0]}`, 'owner')
    expect(first.json()).toEqual({ edition: labels[0], run: null })
    expect((await call('GET', '/evals/retrieval/editions/2020-01-01.1', 'owner')).statusCode).toBe(
      404,
    )
  })

  it('passes each newly sealed edition and shows the trend, newest first', async () => {
    // A low-risk note: levels 1 to 3 only, so no answer run is needed to release it.
    await accepted({
      kind: 'note',
      riskLevel: 'low',
      title: 'Norway reopening',
      summary: 'Norway online sales started again.',
    })
    const label = (
      await client.query<{ label: string }>(
        'select e.label from editions e join live_edition l on l.seq=e.seq',
      )
    ).rows[0]!.label
    expect(await retrieve()).toMatchObject({ editions: 1, daily: false })
    const trend = (await call('GET', '/evals/retrieval/trend', 'admin')).json<RetrievalPoint[]>()
    expect(trend.map((p) => [p.edition, p.trigger, p.questions])).toEqual([
      [label, 'edition', 3],
      [labels.at(-1), 'edition', 3],
    ])
    const one = await call('GET', '/evals/retrieval/trend?area=marketing&limit=1', 'stranger')
    expect(one.json<RetrievalPoint[]>().map((p) => [p.edition, p.questions])).toEqual([[label, 1]])
    labels.push(label)
  })
})

describe('the judge family and the layers of an answer run', () => {
  it('records both families, and flags a judge from the answering model family', async () => {
    const started = await call('POST', '/evals/areas/finance/runs', 'owner')
    expect(started.statusCode, started.body).toBe(200)
    expect(started.json()).toMatchObject({
      modelFamily: 'mock/scripted-answer',
      judgeFamily: 'mock/scripted-judge',
      judgeSameFamily: false,
      modelProvider: 'mock',
      judgeProvider: 'mock',
      modelVendor: 'mock',
      judgeVendor: 'mock',
      judgeSameVendor: true,
      trigger: null,
    })
    await work()
    const finished = await runOf(started.json<EvalRun>().id)
    expect(finished.run.state).toBe('finished')
    // The forbidden item is delivered: a code-checked failure, while the judge has nothing against it.
    expect(finished.scorecard).toMatchObject({
      layers: { code: { passed: 1, failed: 1 }, judge: { passed: 2, failed: 0 } },
      failedChecks: { not_delivered: 1 },
    })
    expect(finished.results.find((q) => q.id === 'norway-forbidden')!.layers).toEqual({
      baseline: { code: 'fail', judge: 'pass', failedChecks: ['not_delivered'] },
      candidate: null,
    })

    const ownLine = { ...models.choose('judge'), family: models.choose('eval_answer').family }
    const ownFamily: ModelPort = {
      ...models,
      choose: (role, ref) => (role === 'judge' ? ownLine : models.choose(role, ref)),
      otherLine: () => ownLine,
    }
    const run = await database.transaction(people.owner, (tx) =>
      queueAreaRun(tx, { port: ownFamily, clock }, 'finance', 'full', true),
    )
    expect((await runOf(run!.id)).run).toMatchObject({
      judgeSameFamily: true,
      judgeSameVendor: true,
    })
    expect((await call('POST', `/evals/runs/${run!.id}/cancel`, 'owner')).statusCode).toBe(200)

    // A judge of another vendor is a setting that names it, here behind a second gateway: the
    // vendor comes from the provider registry, and the run flags that the vendors differ.
    const secondGateway: ProviderEntry = {
      name: 'second-gateway',
      adapter: 'openai-compatible',
      operator: 'Second Gateway Inc.',
      apiKeyEnv: 'SECOND_GATEWAY_API_KEY',
      baseUrlEnv: 'SECOND_GATEWAY_BASE_URL',
      baseUrl: 'https://gateway.invalid/v1',
      models: {
        'othervendor/judge-1': {
          vendor: 'othervendor',
          line: 'judge',
          prices: { input: 1, output: 4, cacheRead: 0.1 },
        },
      },
    }
    const twoVendors = createModelPort({
      mode: 'live',
      env: { ANTHROPIC_API_KEY: 'placeholder-not-a-key', SECOND_GATEWAY_API_KEY: 'placeholder' },
      providers: [...modelProviders, secondGateway],
    })
    await setting('models.judge', { provider: 'second-gateway', model: 'othervendor/judge-1' })
    // Planned and costed without a model call, then cancelled before any call is made.
    const second = await database.transaction(people.owner, (tx) =>
      queueAreaRun(tx, { port: twoVendors, clock }, 'finance', 'full', true),
    )
    await setting('models.judge', 'different_family')
    expect((await runOf(second!.id)).run).toMatchObject({
      modelProvider: 'anthropic',
      judgeProvider: 'second-gateway',
      modelVendor: 'anthropic',
      judgeVendor: 'othervendor',
      judgeFamily: 'othervendor/judge',
      judgeSameFamily: false,
      judgeSameVendor: false,
    })
    const [stored] = (
      await client.query<{ provider: string }>(
        'select judge_provider as provider from eval_runs where id=$1',
        [second!.id],
      )
    ).rows
    expect(stored).toEqual({ provider: 'second-gateway' })
    expect((await call('POST', `/evals/runs/${second!.id}/cancel`, 'owner')).statusCode).toBe(200)
  })
})

describe('full runs for changes the review gate does not see', () => {
  const triggered = async () =>
    (
      await client.query<{
        area: string
        trigger: string
        state: string
        requested: string | null
      }>(
        `select area_id as area,summary->>'trigger' as trigger,state::text,requested_by::text as requested
           from eval_runs where summary ? 'trigger' order by created_at`,
      )
    ).rows

  it('queues one when the tool descriptions changed since the last full run', async () => {
    // A run made by an earlier service version, with other tool descriptions.
    await client.query(
      `update eval_runs set tool_schema_digest='an-older-version'
        where id=(select id from eval_runs where area_id='finance' and kind in ('full','scheduled')
                   order by created_at desc limit 1)`,
    )
    expect((await retrieve()).queued).toEqual({ tool_descriptions: ['finance'] })
    expect((await retrieve()).queued).toEqual({})
    expect(await triggered()).toEqual([
      { area: 'finance', trigger: 'tool_descriptions', state: 'queued', requested: null },
    ])
    // Marketing never had a full run: the weekly run covers it.
    await work()
  })

  it('queues one when a sync changed a definition the area owns, never for a failed one', async () => {
    await client.query(
      "insert into connector_snapshots(connector_id,status,fetched_at) values('demo','failed',clock_timestamp())",
    )
    expect((await retrieve()).queued).toEqual({})
    const snapshot = await client.query<{ id: string }>(
      "insert into connector_snapshots(connector_id,status,fetched_at) values('demo','ok',clock_timestamp()) returning id",
    )
    await client.query(
      "insert into definition_marks(definition_ref,snapshot_id,change_mark) values('demo:orders',$1,'2')",
      [snapshot.rows[0]!.id],
    )
    expect((await retrieve()).queued).toEqual({ source_sync: ['finance'] })
    expect((await retrieve()).queued).toEqual({})
    await work()
  })

  it('queues one when the date alone changed what is delivered, held to the budget', async () => {
    day = '2026-10-09'
    // A new day with the same deliveries: a daily pass, and nothing to run.
    expect(await retrieve()).toEqual({ editions: 0, daily: true, queued: {} })
    await setting('evals.run_budget_micros', 1000)
    try {
      // The closure's review date passes: it is still delivered, now marked unverified.
      day = '2027-01-07'
      expect(await retrieve()).toEqual({
        editions: 0,
        daily: true,
        queued: { date_expiry: ['finance'] },
      })
      expect((await retrieve()).queued).toEqual({})
      // Its answers have changed inputs, so the run costs something and waits for an administrator.
      expect((await triggered()).at(-1)).toEqual({
        area: 'finance',
        trigger: 'date_expiry',
        state: 'awaiting_approval',
        requested: null,
      })
      const passes = (await call('GET', '/evals/retrieval/trend', 'owner')).json<RetrievalPoint[]>()
      expect(passes.slice(0, 2).map((p) => [p.trigger, p.asOf])).toEqual([
        ['daily', '2027-01-07'],
        ['daily', '2026-10-09'],
      ])
    } finally {
      await setting('evals.run_budget_micros', 2_000_000)
      day = '2026-10-08'
    }
  })
})
