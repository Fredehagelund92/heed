import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { QuestionComparison, QuestionHistory } from '../../src/contract/quality.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import type { Clock } from '../../src/server/clock.ts'
import { evalJobs, queueAreaRun, workEvaluations } from '../../src/server/modules/evals/index.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The Workbench's two reads of one test question (implementation plan, slice W3): the question
  across two runs of its area, try by try, with what was held constant and the items that changed
  between the editions (from the editions comparison), and its history over runs and editions.
  Driven through HTTP and the real evaluation worker with the scripted mock model.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const clock: Clock = { now: () => new Date(), today: () => new Date().toISOString().slice(0, 10) }
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
const weekly = async () => {
  const run = await database.transaction(null, (tx) =>
    queueAreaRun(tx, deps, 'finance', 'scheduled', false),
  )
  await workEvaluations(database, deps, {
    deadline: Date.now() + 30_000,
    signal: new AbortController().signal,
    logger: silent,
  })
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
const compare = (question: string, run: string, who: Who, against?: string) =>
  read<QuestionComparison>(
    `/quality/questions/${question}/compare?run=${run}${against ? `&against=${against}` : ''}`,
    who,
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

function question(id: string, expected: object, split = 'development') {
  return {
    id,
    area: 'finance',
    split,
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
    source: 'Workbench tests',
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
let first = ''
let second = ''
let third = ''

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
  await save(question('norway-closure', { must_deliver: [closure] }))
  await save(question('norway-held', { must_deliver: [closure] }, 'held_out'))
  await retrieve()
  first = await weekly()
  // The expectation turns: the closure must not be delivered, so the question now fails.
  await save(question('norway-closure', { must_not_deliver: [closure] }), 1)
  second = await weekly()
  // The closure is retired in a new edition, so the question passes again on it.
  const retired = await call('POST', `/items/${closure}/retire`, 'owner', {
    reason: 'Norway reopened',
  })
  expect(retired.statusCode, retired.body).toBe(200)
  await retrieve()
  third = await weekly()
})
afterAll(async () => {
  await app.close()
})

/** Every key of a JSON value, at any depth. */
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
      : []

describe('one test question across two runs', () => {
  it('pairs a regression try by try, and says the question changed, not the edition', async () => {
    const comparison = await compare('norway-closure', second, 'owner')
    expect(comparison).toMatchObject({
      question: 'norway-closure',
      area: 'finance',
      run: { run: { id: second, kind: 'scheduled' }, revision: 2, verdict: 'fail' },
      against: { run: { id: first, kind: 'scheduled' }, revision: 1, verdict: 'pass' },
      changed: ['revision'],
      unknown: [],
      items: [],
      withheld: 0,
    })
    // The wordings stayed, and so did the models, tools and prompt.
    expect(comparison.heldConstant).toEqual([
      'edition',
      'wordings',
      'tries',
      'answer_model',
      'judge_model',
      'tool_descriptions',
      'prompt',
    ])
    expect(comparison.run.layers).toMatchObject({ code: 'fail', failedChecks: ['not_delivered'] })
    for (const side of [comparison.run, comparison.against!]) {
      expect(side.wordings.map((w) => w.wording)).toEqual([0, 1])
      for (const wording of side.wordings) {
        expect(wording.tries.map((t) => t.trial)).toEqual(
          Array.from({ length: side.run.tries }, (_, i) => i + 1),
        )
        for (const attempt of wording.tries) {
          expect(attempt.delivered).toContain(closure)
          expect(attempt.judgeReason).toBe('Scripted judge: fixed rules, no model.')
          expect(attempt.answer).toContain(closure)
        }
      }
    }
    const [now] = comparison.run.wordings[0]!.tries
    const [then] = comparison.against!.wordings[0]!.tries
    expect(now).toMatchObject({ passed: false, checks: { not_delivered: false } })
    expect(then).toMatchObject({ passed: true, checks: { delivered: true } })
    expect(comparison.run.wordings.map((w) => w.verdict)).toEqual(['fail', 'fail'])
    // A try's cell opens its transcript, for the same readers.
    const transcript = await call('GET', `/evals/cells/${now!.cell}/transcript`, 'owner')
    expect(transcript.statusCode, transcript.body).toBe(200)
    // Nothing names a person.
    expect(
      keysOf(comparison).filter((key) =>
        /person|people|requested|approved|saved_?by|proposer|author|actor|owner/i.test(key),
      ),
    ).toEqual([])
  })

  it('says only the edition differs, and lists the item that changed between the editions', async () => {
    const comparison = await compare('norway-closure', third, 'admin')
    expect(comparison).toMatchObject({
      run: { run: { id: third }, verdict: 'pass' },
      against: { run: { id: second }, verdict: 'fail' },
      changed: ['edition'],
      unknown: [],
      withheld: 0,
    })
    expect(comparison.run.run.edition).not.toBe(comparison.against!.run.edition)
    expect(comparison.items).toEqual([
      {
        itemId: closure,
        title: 'Norway closure',
        kind: 'event',
        change: 'retired',
        fields: expect.any(Array) as string[],
        named: ['must_not_deliver'],
        delivered: { run: false, against: true },
      },
    ])
    // Against a run that is not the one before: backwards, and the question changed too.
    const reversed = await compare('norway-closure', first, 'owner', third)
    expect(reversed.changed).toEqual(['edition', 'revision'])
    expect(reversed.items.map((item) => item.change)).toEqual(['added'])
  })

  it('reports a changed judge as not held constant', async () => {
    const [{ judge }] = (
      await client.query<{ judge: string }>(
        'select judge_model_id as judge from eval_runs where id=$1',
        [second],
      )
    ).rows as [{ judge: string }]
    await client.query("update eval_runs set judge_model_id='another-judge' where id=$1", [second])
    try {
      const comparison = await compare('norway-closure', third, 'owner')
      expect(comparison.changed).toEqual(['edition', 'judge_model'])
      expect(comparison.heldConstant).not.toContain('judge_model')
    } finally {
      await client.query('update eval_runs set judge_model_id=$2 where id=$1', [second, judge])
    }
  })

  it('has no other side for the first weekly run', async () => {
    const comparison = await compare('norway-closure', first, 'owner')
    expect(comparison).toMatchObject({
      against: null,
      heldConstant: [],
      changed: [],
      unknown: [],
      items: [],
    })
    expect(comparison.run.verdict).toBe('pass')
  })

  it('is for the maintainers of the area, and hides a held-out question from everyone else', async () => {
    const path = `/quality/questions/norway-closure/compare?run=${second}`
    for (const who of ['author', 'approver'] as const)
      expect((await call('GET', path, who)).statusCode, who).toBe(403)
    expect((await call('GET', path, 'stranger')).statusCode).toBe(403)
    // A held-out question is not found for an owner of another area, so its id is not confirmed.
    const held = `/quality/questions/norway-held/compare?run=${second}`
    expect((await call('GET', held, 'stranger')).statusCode).toBe(404)
    expect(
      (await call('GET', '/quality/questions/norway-held/history', 'stranger')).statusCode,
    ).toBe(404)
    expect((await call('GET', held, 'owner')).statusCode).toBe(200)
    expect(
      (await call('GET', '/quality/questions/no-such-question/history', 'owner')).statusCode,
    ).toBe(404)
    expect(
      (await call('GET', `/quality/questions/norway-closure/compare?run=${randomUUID()}`, 'owner'))
        .statusCode,
    ).toBe(404)
  })

  it('compares only finished weekly and full runs of the question’s area', async () => {
    const cancelled = await database.transaction(people.owner, (tx) =>
      queueAreaRun(tx, deps, 'finance', 'full', true),
    )
    expect((await call('POST', `/evals/runs/${cancelled!.id}/cancel`, 'owner')).statusCode).toBe(
      200,
    )
    const refused = await call(
      'GET',
      `/quality/questions/norway-closure/compare?run=${cancelled!.id}`,
      'owner',
    )
    expect(refused.statusCode, refused.body).toBe(422)
    expect(
      (
        await call(
          'GET',
          `/quality/questions/norway-closure/compare?run=${second}&against=${cancelled!.id}`,
          'owner',
        )
      ).statusCode,
    ).toBe(422)
  })
})

describe("one test question's history", () => {
  it('gives its verdict in the area’s recent runs and its retrieval result per edition', async () => {
    const history = await read<QuestionHistory>(
      '/quality/questions/norway-closure/history',
      'owner',
    )
    expect(history).toMatchObject({ question: 'norway-closure', area: 'finance' })
    expect(history.runs.map((r) => [r.run, r.state, r.revision, r.verdict])).toEqual([
      [third, 'tested', 2, 'pass'],
      [second, 'tested', 2, 'fail'],
      [first, 'tested', 1, 'pass'],
    ])
    expect(history.runs[1]!.layers).toMatchObject({ failedChecks: ['not_delivered'] })
    // Two retrieval passes: the first edition's, on revision 1, and the edition that retired it.
    expect(history.retrieval.map((r) => [r.revision, r.passed])).toEqual([
      [2, true],
      [1, true],
    ])
    expect(history.retrieval[0]!.edition).toBe(history.runs[0]!.edition)
    expect(history.retrieval[0]!.checks).toMatchObject({ not_delivered: true })
    const one = await read<QuestionHistory>(
      '/quality/questions/norway-closure/history?limit=1',
      'admin',
    )
    expect([one.runs.length, one.retrieval.length]).toEqual([1, 1])
    expect(
      (await call('GET', '/quality/questions/norway-closure/history', 'author')).statusCode,
    ).toBe(403)
  })
})
