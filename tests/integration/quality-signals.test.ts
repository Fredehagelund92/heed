import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EvalRun } from '../../src/contract/evals.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type {
  Comparison,
  FeedbackCounts,
  FixNext,
  HistoryPoint,
  Untested,
  Upkeep,
} from '../../src/contract/quality.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { shiftDate } from '../../src/domain/validity.ts'
import { buildApp } from '../../src/server/app.ts'
import type { Clock } from '../../src/server/clock.ts'
import { evalJobs, queueAreaRun, workEvaluations } from '../../src/server/modules/evals/index.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The second part of the Quality back end: score history in one call, two runs compared with a
  sign test, feedback and upkeep by week, items no test question covers, the ranked Fix next list,
  and the Quality, evaluation, edition and dashboard operations scoped to owners, deputies and
  administrators (Quality design G2, G3, G8, G9, G12, G13, G14). Driven through HTTP and the real
  evaluation worker with the scripted mock model.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const realToday = new Date().toISOString().slice(0, 10)
let day = realToday
const clock: Clock = { now: () => new Date(), today: () => day }
const models = createModelPort({ mode: 'mock' })
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
const retrievalJob = evalJobs(deps).find((job) => job.name === 'evals.retrieval')!
const retrieve = () =>
  retrievalJob.run({ database, logger: silent, signal: new AbortController().signal })
const work = () =>
  workEvaluations(database, deps, {
    deadline: Date.now() + 30_000,
    signal: new AbortController().signal,
    logger: silent,
  })
const weekly = async () => {
  const run = await database.transaction(null, (tx) =>
    queueAreaRun(tx, deps, 'finance', 'scheduled', false),
  )
  await work()
  return run!.id
}

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const read = async <T>(path: string, who: Who): Promise<T> => {
  const response = await call('GET', path, who)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}

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
let proposalRun: string | null = null
/** A finished answer run of a proposed version, as one made before migration 0005 is kept. */
async function legacyRun(proposal: string, version: string) {
  const [{ seq, label }] = (
    await client.query<{ seq: string; label: string }>(
      'select e.seq::text,e.label from live_edition l join editions e on e.seq=l.seq',
    )
  ).rows as [{ seq: string; label: string }]
  const summary = {
    edition: label,
    plan: { questions: [], setAside: [] },
    estimate: { cells: 0, cached: 0, micros: 0 },
  }
  const run = await client.query<{ id: string }>(
    `insert into eval_runs (kind,state,area_id,proposal_id,item_version_id,baseline_edition_seq,
       tool_schema_digest,model_id,judge_model_id,client_label,test_set_digest,tries,
       estimated_cost_micros,requested_by,summary,started_at,finished_at)
     values ('impact','finished','finance',$1,$2,$3,'digest','mock/scripted-answer',
       'mock/scripted-judge','eval','\\x00'::bytea,3,0,$4,$5,now(),now())
     returning id::text`,
    [proposal, version, seq, people.author, JSON.stringify(summary)],
  )
  return run.rows[0]!.id
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
  // No answer test runs on a proposal any more (FR-513): one made before migration 0005 stays in
  // the history, as its proposer's, and is read as it was.
  proposalRun ??= await legacyRun(p.id, submitted.json<ProposalRecord>().itemVersionId!)
  const decided = await call('POST', `/proposals/${p.id}/decisions`, 'owner', {
    revision: review.json<{ proposal: { revision: number } }>().proposal.revision,
    outcome: 'accept',
    reason: 'Reviewed against the evidence',
  })
  expect(decided.statusCode, decided.body).toBe(200)
  return submitted.json<ProposalRecord>().itemId!
}

function question(id: string, expected: object) {
  return {
    id,
    area: 'finance',
    wordings: [
      { text: 'Why did orders drop in Norway in August 2026?', kind: 'natural' },
      { text: 'Orders in Norway from 2026-08-01 to 2026-08-31', kind: 'precise' },
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
async function save(body: { id: string }, revision?: number) {
  const response = await call('PUT', `/evals/questions/${body.id}`, 'owner', {
    id: body.id,
    ...(revision ? { revision } : {}),
    question: body,
  })
  expect(response.statusCode, response.body).toBe(200)
}

let closure = ''
let reopening = ''
let first = ''
let second = ''

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
  // Items first: with no test questions yet, the answer tests have nothing to run.
  closure = await accepted()
  reopening = await accepted({
    kind: 'note',
    riskLevel: 'low',
    title: 'Norway reopening',
    summary: 'Norway online sales started again.',
  })
  await save(question('norway-closure', { must_deliver: [closure] }))
  // A deliberately wrong expectation: the closure is delivered, so this question fails.
  await save(question('norway-forbidden', { must_not_deliver: [closure] }))
  await retrieve()
  first = await weekly()
  // The expectations swap: the first question now fails, the second passes.
  await save(question('norway-closure', { must_not_deliver: [closure] }), 1)
  await save(question('norway-forbidden', { must_deliver: [closure] }), 1)
  second = await weekly()
})
afterAll(async () => {
  await app.close()
})

describe('who reads quality, evaluations and editions (G13)', () => {
  it('refuses contributors and approvers, and keeps the gaps and a proposal run open to them', async () => {
    const scoped = [
      '/quality/history',
      '/quality/fix-next',
      '/quality/untested',
      '/quality/upkeep',
      '/quality/feedback',
      `/quality/runs/${second}/compare`,
      '/areas/finance/dashboard',
      '/evals/areas/finance/scorecard',
      '/evals/areas/finance/estimate',
      '/evals/runs',
      '/evals/export',
      '/editions',
    ]
    for (const who of ['author', 'approver'] as const)
      for (const path of scoped)
        expect((await call('GET', path, who)).statusCode, `${who} ${path}`).toBe(403)
    expect((await call('POST', '/evals/areas/finance/runs', 'author')).statusCode).toBe(403)
    // An area's weekly run is a test result: hidden from those who do not maintain the area.
    expect((await call('GET', `/evals/runs/${second}`, 'author')).statusCode).toBe(404)
    expect((await call('GET', `/evals/runs/${second}`, 'stranger')).statusCode).toBe(404)
    expect((await call('GET', `/evals/runs/${second}`, 'owner')).statusCode).toBe(200)
    // The review screen still shows a proposal's run to its proposer, and test question wording.
    expect(proposalRun).not.toBeNull()
    expect((await call('GET', `/evals/runs/${proposalRun}`, 'author')).statusCode).toBe(200)
    expect((await call('GET', '/evals/questions?area=finance', 'author')).statusCode).toBe(200)
    // Gaps stay with everyone signed in (FR-616); an owner of another area is refused a dashboard.
    expect((await call('GET', '/gaps', 'author')).statusCode).toBe(200)
    expect((await call('GET', '/topics/counts', 'author')).statusCode).toBe(200)
    expect((await call('GET', '/areas/finance/dashboard', 'stranger')).statusCode).toBe(403)
    expect((await call('GET', '/areas/finance/dashboard', 'owner')).statusCode).toBe(200)
    expect((await call('GET', '/editions', 'stranger')).statusCode).toBe(200)
    expect((await call('GET', '/quality/history?area=finance', 'stranger')).statusCode).toBe(403)
  })
})

describe('score history in one call (G2)', () => {
  it('gives every weekly run with its rates, held-out measures, retrieval pass and cost', async () => {
    const history = await read<HistoryPoint[]>('/quality/history', 'owner')
    expect(history.map((p) => p.run)).toEqual([second, first])
    const [now, before] = history as [HistoryPoint, HistoryPoint]
    expect(before).toMatchObject({
      area: 'finance',
      questions: 2,
      passed: 1,
      failed: 1,
      noAnswer: 0,
      regressions: 0,
      rates: { pass: 0.5, caveats: null, causeClaims: null, acceptable: null },
      heldOut: { questions: 0, meetsTargets: false },
      layers: { code: { passed: 1, failed: 1 } },
      failedChecks: { not_delivered: 1 },
      // The retrieval pass of the same edition, made before the run.
      retrieval: { questions: 2, passed: 1, failed: 1, rate: 0.5 },
      modelId: expect.any(String) as string,
    })
    expect(now).toMatchObject({ passed: 1, failed: 1, regressions: 1, edition: before.edition })
    expect(now.costMicros).toBeGreaterThanOrEqual(0)
    expect(Date.parse(now.finishedAt)).toBeGreaterThanOrEqual(Date.parse(before.finishedAt))
    expect(await read<HistoryPoint[]>('/quality/history?limit=1', 'admin')).toHaveLength(1)
    // The stranger maintains marketing, which has had no weekly run.
    expect(await read<HistoryPoint[]>('/quality/history', 'stranger')).toEqual([])
  })
})

describe('two runs compared (G3)', () => {
  it('names the questions that got better and worse, their failing checks and the sign test', async () => {
    const comparison = await read<Comparison>(`/quality/runs/${second}/compare`, 'owner')
    expect(comparison).toMatchObject({
      area: 'finance',
      run: { id: second, kind: 'scheduled' },
      against: { id: first, kind: 'scheduled' },
      questions: 2,
      better: [
        { id: 'norway-forbidden', from: 'fail', to: 'pass', failedChecks: ['not_delivered'] },
      ],
      worse: [{ id: 'norway-closure', from: 'pass', to: 'fail', failedChecks: ['not_delivered'] }],
      unchanged: { pass: 0, fail: 0, noAnswer: 0 },
      added: 0,
      removed: 0,
      signTest: { better: 1, worse: 1, pValue: 1 },
    })
    const reversed = await read<Comparison>(
      `/quality/runs/${first}/compare?against=${second}`,
      'admin',
    )
    expect(reversed.better.map((q) => q.id)).toEqual(['norway-closure'])
    // The first weekly run has nothing before it.
    expect(await read<Comparison>(`/quality/runs/${first}/compare`, 'owner')).toMatchObject({
      against: null,
      questions: 0,
      added: 0,
      signTest: { pValue: null },
    })
  })

  it('compares only finished runs of one area, for those who maintain it', async () => {
    const cancelled = await database.transaction(people.owner, (tx) =>
      queueAreaRun(tx, deps, 'finance', 'full', true),
    )
    expect((await call('POST', `/evals/runs/${cancelled!.id}/cancel`, 'owner')).statusCode).toBe(
      200,
    )
    const refused = await call('GET', `/quality/runs/${cancelled!.id}/compare`, 'owner')
    expect(refused.statusCode, refused.body).toBe(422)
    expect(
      (await call('GET', `/quality/runs/${second}/compare?against=${cancelled!.id}`, 'owner'))
        .statusCode,
    ).toBe(422)
    expect((await call('GET', `/quality/runs/${second}/compare`, 'stranger')).statusCode).toBe(403)
    expect((await call('GET', `/quality/runs/${proposalRun}/compare`, 'admin')).statusCode).toBe(
      404,
    )
  })
})

describe('feedback per verdict, week and area (G8)', () => {
  it('places feedback in the area of its delivery or gap, and hides small counts', async () => {
    const [{ seq }] = (await client.query<{ seq: string }>('select seq::text from live_edition'))
      .rows as [{ seq: string }]
    const topic = (
      await client.query<{ id: string }>(
        `insert into topics (key,area_id,metric_keys,value_keys,month)
         values ($1,'finance','{metric:orders}','{}',date_trunc('month',now())::date) returning id`,
        [`test|${randomUUID()}`],
      )
    ).rows[0]!.id
    const delivery = async () =>
      (
        await client.query<{ id: string }>(
          `insert into deliveries (client_label,edition_seq,overlay_seq,tool_schema_digest,topic_id,scope,status)
           values ('claude-code',$1,0,'digest',$2,'{}','matched') returning id`,
          [seq, topic],
        )
      ).rows[0]!.id
    const give = (verdict: string, deliveryId: string | null, gap: string | null = null) =>
      client.query(
        'insert into feedback (delivery_id,verdict,client_label,gap_id) values ($1,$2,$3,$4)',
        [deliveryId, verdict, 'claude-code', gap],
      )
    for (let i = 0; i < 5; i++) await give('wrong', await delivery())
    await give('helpful', await delivery())
    // Feedback whose gap names the area, and feedback the service cannot place.
    const gap = (
      await client.query<{ id: string }>(
        `insert into gaps (topic_id,type,opened_by_case) values ($1,'missing',3) returning id`,
        [topic],
      )
    ).rows[0]!.id
    for (let i = 0; i < 5; i++) await give('unclear', null, gap)
    await give('missing', randomUUID())
    await give('missing', null)
    const stored = await client.query<{ area: string | null; n: number }>(
      'select area_id as area,count(*)::int as n from feedback group by area_id order by area_id',
    )
    expect(stored.rows).toEqual([
      { area: 'finance', n: 6 },
      { area: null, n: 7 },
    ])

    const week = (await read<FeedbackCounts>('/quality/feedback?weeks=1', 'owner')).rows
    expect(week).toEqual([
      {
        area: 'finance',
        week: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
        helpful: null,
        wrong: 5,
        missing: 0,
        unclear: 5,
        total: null,
      },
    ])
    const all = await read<FeedbackCounts>('/quality/feedback?weeks=3', 'admin')
    expect(all.minimumCount).toBe(5)
    expect(all.rows.map((r) => r.area)).toEqual([
      'finance',
      'finance',
      'finance',
      'marketing',
      'marketing',
      'marketing',
      null,
      null,
      null,
    ])
    expect(all.rows.at(-1)).toMatchObject({ missing: null, total: null })
    expect(all.rows.at(-4)).toMatchObject({ helpful: 0, total: 0 })
    expect((await call('GET', '/quality/feedback?area=finance', 'stranger')).statusCode).toBe(403)
  })
})

describe('upkeep by week (G9)', () => {
  it('counts the proposals accepted each week and the items past review at its end', async () => {
    const now = await read<Upkeep>('/quality/upkeep?area=finance&weeks=2', 'owner')
    expect(now.rows).toHaveLength(2)
    expect(now.rows.at(-1)).toEqual({
      area: 'finance',
      week: expect.any(String) as string,
      itemsPastReview: 0,
      proposalsAccepted: 2,
    })
    expect(now.rows[0]!.proposalsAccepted).toBe(0)

    const [{ review }] = (
      await client.query<{ review: string }>(
        `select max(v.review_date)::text as review from item_versions v where v.item_id=any($1)`,
        [[closure, reopening]],
      )
    ).rows as [{ review: string }]
    day = shiftDate(review, 10)
    try {
      const later = await read<Upkeep>('/quality/upkeep?weeks=1', 'admin')
      expect(later.today).toBe(day)
      expect(later.rows).toEqual([
        // Both items got the default review date when accepted.
        {
          area: 'finance',
          week: expect.any(String) as string,
          itemsPastReview: 2,
          proposalsAccepted: 0,
        },
        {
          area: 'marketing',
          week: expect.any(String) as string,
          itemsPastReview: 0,
          proposalsAccepted: 0,
        },
      ])
      // The same rule as the area dashboard's count for today.
      const dashboard = await read<{ itemsPastReview: number }>('/areas/finance/dashboard', 'owner')
      expect(dashboard.itemsPastReview).toBe(2)
    } finally {
      day = realToday
    }
  })
})

describe('items no test question covers (G12)', () => {
  it('counts per area, and an event without a question as one that needs one', async () => {
    const untested = await read<Untested>('/quality/untested', 'admin')
    expect(untested.areas).toEqual([
      {
        area: 'finance',
        items: 2,
        untested: 1,
        untestedRequired: 0,
        byKind: { note: 1, event: 0, guide: 0, example: 0, issue: 0 },
      },
      {
        area: 'marketing',
        items: 0,
        untested: 0,
        untestedRequired: 0,
        byKind: { note: 0, event: 0, guide: 0, example: 0, issue: 0 },
      },
    ])
    // A set-aside question covers nothing.
    for (const id of ['norway-closure', 'norway-forbidden']) {
      const aside = await call('POST', `/evals/questions/${id}/set-aside`, 'owner', {
        revision: 2,
        reason: 'Checking coverage',
      })
      expect(aside.statusCode, aside.body).toBe(200)
    }
    try {
      const without = await read<Untested>('/quality/untested?area=finance', 'owner')
      expect(without.areas[0]).toMatchObject({ untested: 2, untestedRequired: 1 })
    } finally {
      for (const id of ['norway-closure', 'norway-forbidden'])
        await call('POST', `/evals/questions/${id}/set-aside`, 'owner', {
          revision: 2,
          reason: null,
        })
    }
  })
})

describe('the ranked Fix next list (G14)', () => {
  it('ranks a regression, a retrieval failure, an open gap and an untested item', async () => {
    const next = await read<FixNext>('/quality/fix-next?area=finance', 'owner')
    expect(next.entries.map((e) => [e.kind, e.subject.type, e.subject.id])).toEqual([
      ['regression', 'question', 'norway-closure'],
      ['failing_question', 'question', 'norway-forbidden'],
      ['gap', 'gap', expect.any(String)],
      ['untested', 'item', reopening],
    ])
    expect(next.entries[0]).toMatchObject({
      area: 'finance',
      checks: ['not_delivered'],
      reasons: ['Passed in the baseline run and fails in the newest weekly run'],
    })
    // The retrieval pass was made before the expectations swapped.
    expect(next.entries[1]!.reasons).toEqual([
      'Fails the retrieval check on the live edition, without a model',
    ])
    expect(next.entries[3]).toMatchObject({
      subject: { label: 'Norway reopening' },
      reasons: ['No test question covers this note'],
    })
    expect((await read<FixNext>('/quality/fix-next?limit=1', 'admin')).entries).toHaveLength(1)
    expect((await read<FixNext>('/quality/fix-next', 'stranger')).entries).toEqual([])
    // A weekly run that did not finish is not a result.
    expect(
      (await read<EvalRun[]>('/evals/runs?area=finance', 'owner')).some(
        (r) => r.state === 'cancelled',
      ),
    ).toBe(true)
  })
})
