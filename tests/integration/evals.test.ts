import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import { promisify } from 'node:util'
import { APICallError, type LanguageModelV4GenerateResult } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EvalRun } from '../../src/contract/evals.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Gate } from '../../src/contract/review.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { goldenQuestionSchema, type GoldenQuestionInput } from '../../src/domain/golden-question.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  evalJobs,
  queueAreaRun,
  runWithheld,
  workEvaluations,
} from '../../src/server/modules/evals/index.ts'
import { createModelPort, type ModelPort } from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  S13 end to end: golden questions over HTTP, answer tests through the real MCP wire with the
  scripted mock model, levels 4 and 5 on the review gate, a deliberately wrong item blocked,
  flips listed both ways, the cell cache, transcripts, approval, spend caps, the weekly scorecard
  and baseline, and the alert for a scheduled run that does not finish.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const clock = systemClock('2026-10-08')
// Priced like Sonnet so estimates, budgets and caps have something to count. Still no model.
const models = createModelPort({
  mode: 'mock',
  mockPrices: { input: 2, output: 10, cacheRead: 0.2 },
})
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
const logs: Record<string, unknown>[] = []
const logger = createLogger({
  level: 'info',
  destination: new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(JSON.parse(chunk.toString()) as Record<string, unknown>)
      done()
    },
  }),
})
const work = (port: ModelPort = models) =>
  workEvaluations(
    database,
    { port, clock },
    { deadline: Date.now() + 30_000, signal: new AbortController().signal, logger },
  )

type Headers = { cookie: string; origin: string; 'x-heed-csrf': string }
const headers: Record<string, Headers> = {}
type Who = keyof typeof people
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
async function submitted(extra: Draft = {}, itemId?: string) {
  const created = await call('POST', '/proposals', 'author', {
    draft: draft(extra),
    ...(itemId ? { itemId } : {}),
  })
  expect(created.statusCode, created.body).toBe(200)
  const p = created.json<ProposalRecord>()
  const response = await call('POST', `/proposals/${p.id}/submit`, 'author', {
    revision: p.revision,
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ProposalRecord>()
}
async function decide(id: string, who: Who = 'owner') {
  const review = await call('GET', `/proposals/${id}/review`, who)
  expect(review.statusCode, review.body).toBe(200)
  return call('POST', `/proposals/${id}/decisions`, who, {
    revision: review.json<{ proposal: { revision: number } }>().proposal.revision,
    outcome: 'accept',
    reason: 'Reviewed against the evidence',
  })
}
const gateOf = async (id: string) =>
  (await call('GET', `/proposals/${id}/review`, 'owner')).json<{ gate: Gate }>().gate
const runsOf = async (proposal: string) =>
  (await call('GET', `/evals/runs?proposal=${proposal}`, 'owner')).json<EvalRun[]>()
type Detail = {
  run: EvalRun
  results: {
    id: string
    impact: boolean
    baseline: string
    candidate: string
    flip: string | null
  }[]
  flips: { id: string; flip: string }[]
  levels: Record<string, { outcome: string; message: string }>
  replay: { deliveries: number; changed: number; topics: { changed: number }[] } | null
  cells: {
    id: string
    questionId: string
    arm: string
    trial: number
    state: string
    passed: boolean | null
    refused: boolean
    reused: boolean
    failureKind: string | null
  }[]
}
const detail = async (run: string, who: Who = 'owner') =>
  (await call('GET', `/evals/runs/${run}`, who)).json<Detail>()

function question(id: string, caveat: string, extra: Partial<GoldenQuestionInput> = {}) {
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
    expected: { must_deliver: [closure], caveat, no_cause_claim: true },
    rubrics: ['Names the market "Norway"'],
    source: 'Evaluation tests',
    ...extra,
  }
}
const save = (body: object, who: Who = 'owner', revision?: number) =>
  call('PUT', `/evals/questions/${(body as { id: string }).id}`, who, {
    id: (body as { id: string }).id,
    ...(revision ? { revision } : {}),
    question: body,
  })

let closure = ''
let liveSeq = ''

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query(`insert into vocab_terms(key,kind,parent_key) values
      ('val:market/spain','dimension_value','dim:market'),('metric:revenue','metric',null)`)
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area, ref] of [
      ['metric:orders', 'Orders', 'finance', 'demo:orders'],
      ['metric:revenue', 'Revenue', 'finance', null],
      ['dim:market', 'Market', null, null],
      ['val:market/norway', 'Norway', null, null],
      ['val:market/spain', 'Spain', null, null],
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
  })
  for (const name of Object.keys(people)) {
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
  // The closure is accepted before any test question exists: nothing to test, so level 4 passes.
  const p = await submitted()
  const accepted = await decide(p.id)
  expect(accepted.statusCode, accepted.body).toBe(200)
  closure = p.itemId!
  liveSeq = (await client.query<{ seq: string }>('select seq::text from live_edition')).rows[0]!.seq
})
afterAll(async () => {
  await app.close()
})

describe('golden questions', () => {
  it('lets owners create, change and set questions aside, and hides held-out ones', async () => {
    expect(
      (await save(question('norway-cause', 'Online sales to Norway stopped on 4 August'), 'author'))
        .statusCode,
    ).toBe(403)
    const created = await save(
      question('norway-cause', 'Online sales to Norway stopped on 4 August'),
    )
    expect(created.statusCode, created.body).toBe(200)
    expect(created.json()).toMatchObject({
      id: 'norway-cause',
      revision: 1,
      setAsideReason: null,
    })
    const compare = await save(question('norway-compare', 'compare with an unaffected market'))
    expect(compare.statusCode, compare.body).toBe(200)

    expect((await save(question('norway-cause', 'Changed caveat'))).statusCode).toBe(409)
    expect((await save(question('norway-cause', 'Changed caveat'), 'owner', 5)).statusCode).toBe(
      409,
    )
    const secret = await save({
      ...question('norway-secret', 'Online sales stopped'),
      source: 'Asked by someone@example.test',
    })
    expect(secret.statusCode).toBe(422)
    const oneWording = await save({
      ...question('norway-short', 'Online sales stopped'),
      wordings: [{ text: 'Orders in Norway', kind: 'natural' }],
    })
    expect(oneWording.statusCode).toBe(400)

    const heldOut = await save(
      question('norway-held-out', 'Online sales to Norway stopped on 4 August', {
        split: 'held_out',
      }),
    )
    expect(heldOut.statusCode, heldOut.body).toBe(200)
    const ids = async (who: Who) =>
      (await call('GET', '/evals/questions?area=finance', who))
        .json<{ id: string }[]>()
        .map((q) => q.id)
    expect(await ids('owner')).toContain('norway-held-out')
    expect(await ids('author')).not.toContain('norway-held-out')
    expect((await call('GET', '/evals/questions/norway-held-out', 'author')).statusCode).toBe(404)

    const aside = await call('POST', '/evals/questions/norway-held-out/set-aside', 'owner', {
      revision: 1,
      reason: 'Duplicates norway-cause for now',
    })
    expect(aside.statusCode, aside.body).toBe(200)
    expect(aside.json()).toMatchObject({ setAsideReason: 'Duplicates norway-cause for now' })
    const history = await client.query(
      "select revision from golden_question_revisions where question_id='norway-cause'",
    )
    expect(history.rowCount).toBe(1)
  })

  it('imports a file after a dry run and exports the same questions', async () => {
    const file = {
      questions: [
        question('spain-revenue', 'Revenue figures in Spain', {
          wordings: [
            { text: 'How did revenue develop in Spain in July 2026?', kind: 'natural' },
            { text: 'Revenue in Spain from 2026-07-01 to 2026-07-31', kind: 'precise' },
          ],
          scope: {
            metrics: ['metric:revenue'],
            dimension_filters: [{ dimension: 'dim:market', values: ['val:market/spain'] }],
            window: { from: '2026-07-01', to: '2026-07-31' },
          },
          expected: { status: 'no_match' },
          rubrics: [],
        }),
        { id: 'broken', area: 'finance' },
      ],
    }
    const dry = await call('POST', '/evals/import', 'owner', { content: JSON.stringify(file) })
    expect(dry.statusCode, dry.body).toBe(200)
    expect(dry.json()).toMatchObject({ applied: false, created: ['spain-revenue'] })
    expect(dry.json<{ errors: { id: string }[] }>().errors.map((e) => e.id)).toEqual(['broken'])
    file.questions.pop()
    const applied = await call('POST', '/evals/import', 'owner', {
      content: JSON.stringify(file),
      dryRun: false,
    })
    expect(applied.json()).toMatchObject({ applied: true, created: ['spain-revenue'] })
    const exported = await call('GET', '/evals/export?area=finance', 'owner')
    const content = exported.json<{ content: string }>().content
    expect(content).toContain('id: spain-revenue')
    const again = await call('POST', '/evals/import', 'owner', { content, dryRun: true })
    expect(again.json<{ unchanged: string[] }>().unchanged).toContain('spain-revenue')
    // Owners, deputies and administrators maintain test questions (Quality design G13).
    expect(
      (await call('POST', '/evals/import', 'author', { content, dryRun: false })).statusCode,
    ).toBe(403)
  })
})

describe('answer tests on the review gate', () => {
  let wrong: ProposalRecord
  let wrongRun = ''

  it('blocks a deliberately wrong item: the answer starts to claim a cause', async () => {
    // Five agent deliveries in one topic, so the replay has a topic to report (FR-512).
    const topic = randomUUID()
    await client.query(
      `insert into topics(id,key,area_id,metric_keys,value_keys,month)
       values($1,'finance|orders|norway|2026-08','finance','{metric:orders}','{val:market/norway}','2026-08-01')`,
      [topic],
    )
    for (let i = 0; i < 5; i++)
      await client.query(
        `insert into deliveries(client_label,caller,edition_seq,overlay_seq,tool_schema_digest,topic_id,scope,status)
         values('claude-code','agent',$1,0,'test',$2,$3,'matched')`,
        [
          liveSeq,
          topic,
          JSON.stringify({
            metrics: ['metric:orders'],
            filters: { 'dim:market': ['val:market/norway'] },
            window: { start: '2026-08-01', end: '2026-09-01' },
            today: '2026-10-08',
            max_items: 20,
          }),
        ],
      )
    wrong = await submitted(
      { summary: 'Orders in Norway fell because online sales stopped on 4 August 2026.' },
      closure,
    )
    const pending = await decide(wrong.id)
    expect(pending.statusCode).toBe(422)
    expect(
      pending
        .json<{ data: { gate: Gate } }>()
        .data.gate.levels.find((l) => l.level === 'answer_impact'),
    ).toMatchObject({
      outcome: 'not_run',
      details: { message: expect.stringMatching(/running/) as unknown },
    })
    // Levels 1 to 3 pass: the item is still delivered where it should be.
    expect((await gateOf(wrong.id)).levels.slice(0, 3).map((l) => l.outcome)).toEqual([
      'passed',
      'passed',
      'passed',
    ])

    const summary = await work()
    expect(summary.runs).toHaveLength(1)
    const gate = await gateOf(wrong.id)
    expect(gate.levels.find((l) => l.level === 'answer_impact')).toMatchObject({
      outcome: 'failed',
      details: {
        message: expect.stringMatching(
          /These answers got worse with this change: norway-cause/,
        ) as unknown,
      },
    })
    const blocked = await decide(wrong.id)
    expect(blocked.statusCode).toBe(422)

    const [run] = await runsOf(wrong.id)
    wrongRun = run!.id
    expect(run).toMatchObject({
      kind: 'impact',
      state: 'finished',
      modelId: 'mock/scripted-answer',
      judgeModelId: 'mock/scripted-judge',
      tries: 3,
      flipRepeats: 7,
      setAside: 1,
      questions: 2,
    })
    expect(run!.toolSchemaDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(run!.testSetDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(run!.actualCostMicros).toBeGreaterThan(0)
    const d = await detail(run!.id)
    expect(d.flips).toEqual([{ id: 'norway-cause', flip: 'pass_to_fail' }])
    expect(d.results.find((q) => q.id === 'norway-compare')).toMatchObject({
      impact: true,
      baseline: 'fail',
      candidate: 'fail',
      flip: null,
    })
    // The flipping question was repeated to seven tries on each side; the other stayed at three.
    const tries = (q: string) =>
      Math.max(...d.cells.filter((c) => c.questionId === q).map((c) => c.trial))
    expect(tries('norway-cause')).toBe(7)
    expect(tries('norway-compare')).toBe(3)
    expect(d.replay).toMatchObject({ deliveries: 5, changed: 5, topics: [{ changed: 5 }] })
    expect(d.levels.answer_impact).toMatchObject({ outcome: 'failed' })
  })

  it('shows owners the transcript of a failed try, and nobody else', async () => {
    const d = await detail(wrongRun)
    const failed = d.cells.find(
      (c) => c.questionId === 'norway-cause' && c.arm === 'candidate' && c.passed === false,
    )!
    const transcript = await call('GET', `/evals/cells/${failed.id}/transcript`, 'owner')
    expect(transcript.statusCode, transcript.body).toBe(200)
    const body = transcript.json<{
      wording: string
      scores: { checks: Record<string, boolean> }
      toolCalls: { tool: string; items: string[] }[]
      messages: unknown[]
    }>()
    expect(body.scores.checks).toMatchObject({
      no_cause_claim: false,
      caveat: true,
      delivered: true,
    })
    expect(body.toolCalls).toEqual([
      expect.objectContaining({ tool: 'get_facts', items: [closure] }),
    ])
    expect(JSON.stringify(body.messages)).toContain('because online sales stopped')
    expect((await call('GET', `/evals/cells/${failed.id}/transcript`, 'author')).statusCode).toBe(
      403,
    )
    // Listing runs is for maintainers; someone who may not read the proposal does not see its runs.
    expect((await call('GET', `/evals/runs?proposal=${wrong.id}`, 'stranger')).statusCode).toBe(403)
    expect((await call('GET', `/evals/runs/${wrongRun}`, 'stranger')).statusCode).toBe(404)
    expect((await call('GET', `/evals/runs/${wrongRun}`, 'author')).statusCode).toBe(200)
    // Eval traffic is never demand: the runner wrote no delivery records.
    const deliveries = await client.query(
      "select count(*)::int as n from deliveries where caller<>'agent'",
    )
    expect(deliveries.rows[0]).toEqual({ n: 0 })
  })

  it('lists a fail-to-pass flip, reuses unchanged cells, and lets a corrected item through', async () => {
    const fixed = await submitted(
      {
        summary:
          'Online sales to Norway stopped on 4 August 2026; compare with an unaffected market before reading the drop.',
      },
      closure,
    )
    await work()
    const [run] = await runsOf(fixed.id)
    const d = await detail(run!.id)
    expect(d.flips).toEqual([{ id: 'norway-compare', flip: 'fail_to_pass' }])
    expect(d.levels.answer_impact).toMatchObject({ outcome: 'passed' })
    // The live side did not change since the last run, so its cells reuse the earlier results.
    const baseline = d.cells.filter((c) => c.arm === 'baseline' && c.trial <= 3)
    expect(baseline.length).toBeGreaterThan(0)
    expect(baseline.every((c) => c.reused)).toBe(true)
    const accepted = await decide(fixed.id)
    expect(accepted.statusCode, accepted.body).toBe(200)
  })

  it('reruns answer tests when the live edition changed since they ran', async () => {
    // The wrong proposal's result is for the previous live edition: the gate no longer counts it.
    const gate = await gateOf(wrong.id)
    expect(gate.levels.find((l) => l.level === 'answer_impact')).toMatchObject({
      outcome: 'not_run',
      details: {
        previous: 'failed',
        message: expect.stringMatching(/live edition is now/) as unknown,
      },
    })
    const summary = await work()
    expect(summary.queued).toBe(1)
    expect((await gateOf(wrong.id)).levels.find((l) => l.level === 'answer_impact')).toMatchObject({
      outcome: 'failed',
    })
  })

  it('plans a finished failed run again once a question is set aside and checks are rerun', async () => {
    const level = async () =>
      (await gateOf(wrong.id)).levels.find((l) => l.level === 'answer_impact')
    expect(await level()).toMatchObject({ outcome: 'failed' })
    const earlier = await runsOf(wrong.id)
    const [before] = earlier
    expect(before).toMatchObject({ state: 'finished' })

    // The wrong item flips both questions, so both are set aside before the gate can pass.
    const questions = ['norway-cause', 'norway-compare']
    for (const id of questions) {
      const aside = await call('POST', `/evals/questions/${id}/set-aside`, 'owner', {
        revision: 1,
        reason: 'Judged too strict for this wording',
      })
      expect(aside.statusCode, aside.body).toBe(200)
    }
    const rerun = await call('POST', `/proposals/${wrong.id}/checks`, 'author')
    expect(rerun.statusCode, rerun.body).toBe(200)
    const runs = await runsOf(wrong.id)
    expect(runs).toHaveLength(earlier.length + 1)
    expect(runs.map((r) => r.id)).toContain(before!.id)
    await work()
    expect(await level()).toMatchObject({ outcome: 'passed' })
    const newest = (await runsOf(wrong.id)).find((r) => !earlier.some((o) => o.id === r.id))!
    expect(newest).toMatchObject({ state: 'finished', setAside: before!.setAside + 2 })
    expect((await detail(newest.id)).levels.answer_impact).toMatchObject({ outcome: 'passed' })

    for (const id of questions) {
      const restored = await call('POST', `/evals/questions/${id}/set-aside`, 'owner', {
        revision: 1,
        reason: null,
      })
      expect(restored.statusCode, restored.body).toBe(200)
    }
  })

  it('needs the full area set for high risk, and records both levels', async () => {
    const high = await submitted({
      kind: 'note',
      title: 'Spain note',
      summary: 'Spain reporting changed.',
      riskLevel: 'high',
      scope: {
        metrics: ['metric:orders'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
      },
    })
    await work()
    const [run] = await runsOf(high.id)
    expect(run).toMatchObject({ kind: 'full', state: 'finished' })
    const levels = (await gateOf(high.id)).levels.slice(3)
    expect(levels.map((l) => [l.level, l.outcome])).toEqual([
      ['answer_impact', 'passed'],
      ['answer_full', 'passed'],
    ])
    const rows = await client.query(
      'select level::text,eval_run_id::text from check_results where item_version_id=$1 and level::text like $2',
      [high.itemVersionId, 'answer_%'],
    )
    expect(rows.rows).toEqual([
      { level: 'answer_impact', eval_run_id: run!.id },
      { level: 'answer_full', eval_run_id: run!.id },
    ])
  })

  it('plans the tests attached to a proposal and reports them without blocking it (FR-524)', async () => {
    // A test that fails on the live edition, about a market the change does not touch.
    const id = 'spain-attached'
    expect(
      (
        await save(
          question(id, 'Spain is not affected', {
            wordings: [
              { text: 'How did orders develop in Spain in July 2026?', kind: 'natural' },
              { text: 'Orders in Spain from 2026-07-01 to 2026-07-31', kind: 'precise' },
            ],
            scope: {
              metrics: ['metric:orders'],
              dimension_filters: [{ dimension: 'dim:market', values: ['val:market/spain'] }],
              window: { from: '2026-07-01', to: '2026-07-31' },
            },
          }),
        )
      ).statusCode,
    ).toBe(200)
    try {
      const created = await call('POST', '/proposals', 'author', {
        draft: draft({
          title: 'Spain revenue in May',
          summary: 'Spain revenue was reported late in May 2026.',
          scope: {
            metrics: ['metric:revenue'],
            dimensions: [],
            dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
          },
          validity: { start: '2026-05-01', end: '2026-06-01' },
        }),
      })
      const p = created.json<ProposalRecord>()
      const attached = await call('POST', `/proposals/${p.id}/tests`, 'author', { question: id })
      expect(attached.statusCode, attached.body).toBe(200)
      const sent = await call('POST', `/proposals/${p.id}/submit`, 'author', {
        revision: p.revision,
      })
      expect(sent.statusCode, sent.body).toBe(200)
      await work()
      const [run] = await runsOf(p.id)
      expect(run).toMatchObject({ kind: 'impact', state: 'finished', questions: 1 })
      expect((await detail(run!.id)).results).toEqual([
        expect.objectContaining({ id, impact: false, baseline: 'fail', candidate: 'fail' }),
      ])
      const gate = await gateOf(p.id)
      expect(gate.levels.find((l) => l.level === 'answer_impact')).toMatchObject({
        outcome: 'passed',
        details: {
          run: run!.id,
          message:
            'None of the test questions could change. Attached tests, reported only: spain-attached still fails.',
          attached: [{ id, baseline: 'fail', candidate: 'fail' }],
        },
      })
      expect(gate.attached).toEqual([
        {
          question: id,
          active: true,
          attachedHour: expect.stringMatching(/T\d{2}:00:00Z$/) as unknown,
          retrieval: { baseline: false, candidate: false },
          answer: { run: run!.id, baseline: 'fail', candidate: 'fail' },
        },
      ])
      // Reported only: the failing test does not stand in the way of acceptance.
      const accepted = await decide(p.id)
      expect(accepted.statusCode, accepted.body).toBe(200)
    } finally {
      await client.query("update golden_questions set status='retired' where id=$1", [id])
    }
  })
})

describe('cost control', () => {
  it('estimates first and waits for an administrator above the budget', async () => {
    await setting('evals.run_budget_micros', 1000)
    try {
      // Cached cells cost nothing, so a fresh question is what makes this run cost something.
      const fresh = await save(
        question('norway-approval', 'Online sales to Norway stopped on 4 August', {
          rubrics: ['Names "Norway" once more'],
        }),
      )
      expect(fresh.statusCode, fresh.body).toBe(200)
      const estimate = await call('GET', '/evals/areas/finance/estimate', 'owner')
      expect(estimate.json()).toMatchObject({ area: 'finance', questions: 4, needsApproval: true })
      expect((await call('POST', '/evals/areas/finance/runs', 'author')).statusCode).toBe(403)
      const started = await call('POST', '/evals/areas/finance/runs', 'owner')
      expect(started.statusCode, started.body).toBe(200)
      const run = started.json<EvalRun>()
      expect(run).toMatchObject({ kind: 'full', state: 'awaiting_approval' })
      await work()
      expect((await detail(run.id)).run.state).toBe('awaiting_approval')
      expect((await call('POST', `/evals/runs/${run.id}/approve`, 'owner')).statusCode).toBe(403)
      const approved = await call('POST', `/evals/runs/${run.id}/approve`, 'admin')
      expect(approved.json()).toMatchObject({ state: 'queued', approvedBy: people.admin })
      await work()
      expect((await detail(run.id)).run.state).toBe('finished')
    } finally {
      await setting('evals.run_budget_micros', 2_000_000)
      await client.query("update golden_questions set status='retired' where id='norway-approval'")
    }
  })

  it('stops a run at the monthly cap, says why, and keeps it to resume', async () => {
    const spent = await client.query<{ cost: string }>(
      "select cost_micros::text as cost from llm_spend_monthly where feature='eval'",
    )
    expect(Number(spent.rows[0]!.cost)).toBeGreaterThan(0)
    await setting('limits.llm_feature_monthly_micros', { eval: 1, assistant: 250000000 })
    try {
      const fresh = await save(
        question('norway-capped', 'Online sales to Norway stopped on 4 August', {
          rubrics: ['Names "Norway" again'],
        }),
      )
      expect(fresh.statusCode, fresh.body).toBe(200)
      const run = (await call('POST', '/evals/areas/finance/runs', 'owner')).json<EvalRun>()
      await work()
      const d = await detail(run.id)
      // A cap is no failure of the run: it stops incomplete, and resuming it makes what is missing.
      expect(d.run).toMatchObject({ state: 'incomplete' })
      expect(d.run.failure).toMatch(/Evaluation spending reached its monthly cap of \$0\.00/)
      expect((d as unknown as { stopped: { reason: string } }).stopped).toMatchObject({
        reason: 'cap',
      })
    } finally {
      await setting('limits.llm_feature_monthly_micros', { eval: 250000000, assistant: 250000000 })
      await client.query("update golden_questions set status='retired' where id='norway-capped'")
    }
  })
})

describe('one worker per run (try-it-2 round 3: the ledger counted a run twice)', () => {
  it('lets the job leave alone a run the command line works, so the ledger and the run agree', async () => {
    // Fresh questions, so no answer comes from the cache and every cell costs something.
    for (const id of ['norway-twice-1', 'norway-twice-2'])
      expect(
        (
          await save(
            question(id, 'Online sales to Norway stopped on 4 August', {
              rubrics: [`Names "${id}" or not`],
            }),
          )
        ).statusCode,
      ).toBe(200)
    try {
      const ledger = async () =>
        Number(
          (
            await client.query<{ cost: string }>(
              "select coalesce(sum(cost_micros),0)::text as cost from llm_spend_monthly where feature='eval'",
            )
          ).rows[0]!.cost,
        )
      const before = await ledger()
      const run = await database.transaction(null, (tx) =>
        queueAreaRun(tx, { port: models, clock }, 'finance', 'full', false),
      )
      const options = (only?: string) => ({
        deadline: Date.now() + 30_000,
        signal: new AbortController().signal,
        logger,
        ...(only ? { only } : {}),
      })
      // The command line works its run while the service's every-minute job runs too.
      await Promise.all([
        workEvaluations(database, { port: models, clock }, options(run!.id)),
        workEvaluations(database, { port: models, clock }, options()),
        workEvaluations(database, { port: models, clock }, options()),
      ])
      const [row] = (
        await client.query<{ state: string; cost: string }>(
          'select state::text,actual_cost_micros::text as cost from eval_runs where id=$1',
          [run!.id],
        )
      ).rows
      expect(row!.state).toBe('finished')
      expect(Number(row!.cost)).toBeGreaterThan(0)
      // Every model call counted once: what the run says it cost is what the ledger added.
      expect((await ledger()) - before).toBe(Number(row!.cost))
      const cells = await client.query(
        "select 1 from eval_cells where run_id=$1 and state<>'finished'",
        [run!.id],
      )
      expect(cells.rowCount).toBe(0)
    } finally {
      await client.query(
        "update golden_questions set status='retired' where id in ('norway-twice-1','norway-twice-2')",
      )
    }
  })
})

describe('runs that stop before every answer is made (R4, R6)', () => {
  /** The scripted answer model behind a provider that refuses for its rate limit while asked to. */
  let throttle = false
  const scripted = models.choose('eval_answer').model as MockLanguageModelV4
  const limited = new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'scripted-answer',
    doGenerate: (options) =>
      throttle
        ? Promise.reject(
            new APICallError({
              message: 'Rate limited',
              url: 'https://example.test/v1/chat/completions',
              requestBodyValues: {},
              statusCode: 429,
              responseHeaders: { 'retry-after': '1' },
            }),
          )
        : scripted.doGenerate(options),
  })
  const port: ModelPort = {
    ...models,
    choose: (role, ref) => ({
      ...models.choose(role, ref),
      ...(role === 'eval_answer' ? { model: limited } : {}),
    }),
  }
  const waits: number[] = []
  const workOn = (only?: string) =>
    workEvaluations(
      database,
      { port, clock },
      {
        deadline: Date.now() + 30_000,
        signal: new AbortController().signal,
        logger,
        wait: (ms) => {
          waits.push(ms)
          return Promise.resolve()
        },
        ...(only ? { only } : {}),
      },
    )
  type Stopped = { reason: string; failed: Record<string, number>; cells: number }
  const stoppedOf = async (id: string) =>
    (await call('GET', `/evals/runs/${id}`, 'owner')).json<
      Detail & { stopped: Stopped | null; scorecard: unknown }
    >()
  let made = 0
  async function freshRun(options: Parameters<typeof queueAreaRun>[6] = {}) {
    const id = `norway-stop-${++made}`
    expect(
      (
        await save(
          question(id, 'Online sales to Norway stopped on 4 August', {
            rubrics: [`Says "${id}" or not`],
          }),
        )
      ).statusCode,
    ).toBe(200)
    await client.query(
      "update golden_questions set status='retired' where area_id='finance' and id<>$1 and status='active'",
      [id],
    )
    return (await database.transaction(people.admin, (tx) =>
      queueAreaRun(tx, { port, clock }, 'finance', 'full', true, undefined, options),
    ))!
  }
  let active: string[] = []
  beforeAll(async () => {
    active = (
      await client.query<{ id: string }>(
        "select id from golden_questions where area_id='finance' and status='active'",
      )
    ).rows.map((r) => r.id)
  })
  afterAll(async () => {
    await client.query("update golden_questions set status='retired' where id like 'norway-stop-%'")
    await client.query("update golden_questions set status='active' where id=any($1)", [active])
  })

  it('ends incomplete when the provider keeps refusing, never as no answer, and resumes what is missing', async () => {
    throttle = true
    const run = await freshRun()
    await workOn()
    let d = await stoppedOf(run.id)
    expect(d.run.state).toBe('incomplete')
    expect(d.scorecard).toBeNull()
    expect(d.stopped).toMatchObject({
      reason: 'infrastructure',
      failed: { throttled: 6 },
      cells: 6,
    })
    expect(d.run.failure).toMatch(/6 refused for the provider’s rate limit/)
    expect(d.cells.every((c) => c.passed === null && !c.refused)).toBe(true)
    // Retry-After was honoured, and every refused try is on record with no cost.
    expect(waits).toContain(1_000)
    const calls = await client.query<{ outcome: string; n: number; cost: string }>(
      `select outcome,count(*)::int as n,sum(cost_micros)::text as cost from model_calls
        where run_id=$1 group by outcome`,
      [run.id],
    )
    expect(calls.rows).toEqual([{ outcome: 'throttled', n: 30, cost: '0' }])

    // The job tries it again a while later, by itself, a few times.
    await client.query("update eval_runs set finished_at=now()-interval '16 minutes' where id=$1", [
      run.id,
    ])
    expect(await workOn()).toMatchObject({ resumed: 1 })
    d = await stoppedOf(run.id)
    expect(d.run.state).toBe('incomplete')

    // Once the provider answers, resuming makes only the missing answers.
    throttle = false
    expect((await call('POST', `/evals/runs/${run.id}/resume`, 'author')).statusCode).toBe(404)
    const resumed = await call('POST', `/evals/runs/${run.id}/resume`, 'owner')
    expect(resumed.json()).toMatchObject({ state: 'queued' })
    await workOn()
    d = await stoppedOf(run.id)
    expect(d.run.state).toBe('finished')
    expect(d.stopped).toBeNull()
    expect(d.cells).toHaveLength(6)
    expect(d.scorecard).toMatchObject({ noAnswer: 0, questions: 1 })
    const [ledger] = (
      await client.query<{ cost: string; calls: string }>(
        "select coalesce(sum(cost_micros),0)::text as cost from model_calls where run_id=$1 and outcome='ok'",
        [run.id],
      )
    ).rows
    expect(Number(ledger!.cost)).toBe(d.run.actualCostMicros)
  })

  it('does not call the model again for identical inputs after the first failed, and resumes them', async () => {
    throttle = true
    const ids = ['norway-stop-same-1', 'norway-stop-same-2']
    for (const id of ids)
      expect(
        (
          await save(
            question(id, 'Online sales to Norway stopped on 4 August', {
              rubrics: ['Names the market "Norway" in the same words'],
            }),
          )
        ).statusCode,
      ).toBe(200)
    await client.query(
      "update golden_questions set status='retired' where area_id='finance' and id<>all($1) and status='active'",
      [ids],
    )
    const run = (await database.transaction(people.admin, (tx) =>
      queueAreaRun(tx, { port, clock }, 'finance', 'full', true),
    ))!
    await workOn(run.id)
    const d = await stoppedOf(run.id)
    expect(d.run.state).toBe('incomplete')
    expect(d.stopped).toMatchObject({ reason: 'infrastructure', failed: { throttled: 12 } })
    const calls = await client.query<{ n: number }>(
      "select count(*)::int as n from model_calls where run_id=$1 and outcome='throttled'",
      [run.id],
    )
    // Six distinct inputs, five tries each: the twin question's cells made no call of their own.
    expect(calls.rows[0]!.n).toBe(30)
    throttle = false
    await call('POST', `/evals/runs/${run.id}/resume`, 'owner')
    await workOn(run.id)
    expect((await stoppedOf(run.id)).run.state).toBe('finished')
    await client.query("update golden_questions set status='retired' where id=any($1)", [ids])
  })

  it('refuses to resume a run with models other than its own, and leaves it incomplete', async () => {
    const run = await freshRun({ costCeilingMicros: 1 })
    await workOn(run.id)
    await client.query("update eval_runs set model_id='another-model' where id=$1", [run.id])
    const result = await promisify(execFile)(
      process.execPath,
      ['src/server/run-evals.ts', '--resume', run.id, '--max-cost-usd', '100'],
      {
        env: {
          ...process.env,
          DATABASE_URL: url,
          CL_FIXED_TODAY: '2026-10-08',
          LOG_LEVEL: 'silent',
        },
        timeout: 240_000,
      },
    ).then(
      () => ({ code: 0, stderr: '' }),
      (error: { code: number; stderr: string }) => error,
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/was planned for another-model/)
    expect((await stoppedOf(run.id)).run.state).toBe('incomplete')
    // The service's own job stops it, incomplete, instead of failing it.
    await client.query("update eval_runs set state='queued' where id=$1", [run.id])
    await workOn(run.id)
    const d = await stoppedOf(run.id)
    expect(d.run.state).toBe('incomplete')
    expect(d.run.failure).toMatch(/was planned for another-model/)
  }, 300_000)

  /** Sets get_facts's limit per client and minute; returns what puts the setting back. */
  async function getContextLimit(perMinute: number) {
    const [current] = (
      await client.query<{ value: Record<string, number> }>(
        "select value from settings_current where key='limits.mcp_rate_per_minute'",
      )
    ).rows
    await setting('limits.mcp_rate_per_minute', { ...current!.value, get_facts: perMinute })
    return () => setting('limits.mcp_rate_per_minute', current!.value)
  }

  it('counts the tool server’s limits in real minutes, though it answers as of the run’s day (round 5)', async () => {
    // Round 5: the tool server counted its limits on the clock the answers are as of, frozen at
    // noon of the run's day. Its minute never ended, so every call past the limit was refused.
    throttle = false
    const restore = await getContextLimit(2)
    try {
      const run = await freshRun()
      let reads = 0
      // Every read of the wall clock is a minute later; the day the answers are as of stays.
      const moving = {
        today: () => clock.today(),
        now: () => new Date(Date.now() + 61_000 * reads++),
      }
      await workEvaluations(
        database,
        { port, clock: moving },
        {
          deadline: Date.now() + 30_000,
          signal: new AbortController().signal,
          logger,
          only: run.id,
        },
      )
      const d = await stoppedOf(run.id)
      expect(d.run.state).toBe('finished')
      expect(d.cells.map((c) => c.state)).toEqual(Array(6).fill('finished'))
    } finally {
      await restore()
    }
  })

  it('fails an answer whose tool call was refused as the run’s failure, never the model’s, and makes it again', async () => {
    throttle = false
    const restore = await getContextLimit(2)
    let run
    try {
      run = await freshRun()
      await workOn(run.id)
    } finally {
      await restore()
    }
    let d = await stoppedOf(run.id)
    // Two answers had room in the minute; the other four are not made, and nothing is scored.
    expect(d.run.state).toBe('incomplete')
    expect(d.scorecard).toBeNull()
    expect(d.stopped).toMatchObject({ reason: 'infrastructure', failed: { tool: 4 }, cells: 6 })
    expect(d.run.failure).toMatch(/4 with a tool call the tool server refused/)
    const failed = d.cells.filter((c) => c.state === 'failed')
    expect(failed).toHaveLength(4)
    expect(failed.every((c) => c.failureKind === 'tool' && c.passed === null)).toBe(true)
    const kept = await client.query('select 1 from eval_transcripts where cell_id=any($1)', [
      failed.map((c) => c.id),
    ])
    expect(kept.rowCount).toBe(0)
    // Resuming makes only the four, from the model, never from a stored refusal.
    const resumed = await call('POST', `/evals/runs/${run.id}/resume`, 'owner')
    expect(resumed.json()).toMatchObject({ state: 'queued' })
    await workOn(run.id)
    d = await stoppedOf(run.id)
    expect(d.run.state).toBe('finished')
    expect(d.cells.filter((c) => c.state === 'finished')).toHaveLength(6)
    expect(d.cells.filter((c) => c.reused)).toHaveLength(0)
    expect(d.scorecard).toMatchObject({ noAnswer: 0, questions: 1 })
  })

  it('stops at its cost ceiling before a call could pass it, and resumes at the command line', async () => {
    const run = await freshRun({ costCeilingMicros: 1 })
    await workOn(run.id)
    const d = await stoppedOf(run.id)
    expect(d.run).toMatchObject({ state: 'incomplete', costCeilingMicros: 1, actualCostMicros: 0 })
    expect(d.stopped).toMatchObject({ reason: 'ceiling' })
    expect(d.run.failure).toMatch(/reached its cost ceiling/)
    // Approved with a ceiling at the command line, it is resumed there, with its models.
    const refused = await call('POST', `/evals/runs/${run.id}/resume`, 'owner')
    expect(refused.statusCode).toBe(409)
    expect(refused.body).toContain(`npm run eval -- --resume ${run.id}`)
    const result = await promisify(execFile)(
      process.execPath,
      ['src/server/run-evals.ts', '--resume', run.id, '--max-cost-usd', '100'],
      {
        env: {
          ...process.env,
          DATABASE_URL: url,
          CL_FIXED_TODAY: '2026-10-08',
          LOG_LEVEL: 'silent',
        },
        timeout: 240_000,
      },
    ).catch((error: { code: number; stdout: string; stderr: string }) => error)
    expect(result.stdout, result.stderr).toMatch(new RegExp(`^Run ${run.id}: finished\\.`, 'm'))
    expect(result.stdout).toMatch(/of a \$100\.00 ceiling/)
  }, 300_000)
})

describe('weekly scorecard and baseline', () => {
  // FR-610, slice V3: a gap resolved on the live edition, linked to a development and a held-out
  // test, waits for the weekly run below to pass both.
  let gap = ''
  beforeAll(async () => {
    const topic = await client.query<{ id: string }>(
      "insert into topics (key,area_id,metric_keys,value_keys,month) values ('weekly-verify','finance','{metric:orders}','{val:market/norway}','2026-08-01') returning id",
    )
    gap = (
      await client.query<{ id: string }>(
        "insert into gaps (topic_id,type,opened_by_case) values ($1,'missing',2) returning id::text",
        [topic.rows[0]!.id],
      )
    ).rows[0]!.id
    for (const question of ['norway-cause', 'norway-held-out']) {
      const linked = await call('POST', `/gaps/${gap}/tests`, 'owner', { question })
      expect(linked.statusCode, linked.body).toBe(200)
    }
    const resolved = await call('POST', `/gaps/${gap}/status`, 'owner', { status: 'resolved' })
    expect(resolved.json()).toMatchObject({ status: 'resolved', verifiedAt: null })
  })

  it('scores each live area, moves the baseline and posts the scorecard', async () => {
    const restored = await call('POST', '/evals/questions/norway-held-out/set-aside', 'owner', {
      revision: 1,
      reason: null,
    })
    expect(restored.json()).toMatchObject({ setAsideReason: null })
    const [, weekly] = evalJobs({ port: models, clock })
    const context = { database, logger, signal: new AbortController().signal }
    expect(await weekly!.run(context)).toMatchObject({ areas: 2, queued: 2 })
    expect(await weekly!.run(context)).toMatchObject({ areas: 0, queued: 0 })
    await work()
    expect((await call('GET', '/evals/areas/finance/scorecard', 'author')).statusCode).toBe(403)
    const card = await call('GET', '/evals/areas/finance/scorecard', 'owner')
    expect(card.statusCode, card.body).toBe(200)
    expect(card.json()).toMatchObject({
      area: 'finance',
      run: { kind: 'scheduled', state: 'finished' },
      scorecard: {
        questions: 4,
        passed: 4,
        failed: 0,
        setAside: 0,
        regressions: [],
        // Section 1.7 on the held-out part: every required caveat, no cause claimed.
        heldOut: {
          questions: 1,
          answers: 6,
          caveats: { required: 6, present: 6 },
          causeClaims: 0,
          acceptable: 1,
          meetsTargets: true,
        },
      },
    })
    expect(card.json<{ baselineRun: string }>().baselineRun).toBe(
      card.json<{ run: { id: string } }>().run.id,
    )
    const outbox = await client.query(
      "select area_id from outbox_events where topic='eval.scorecard' order by area_id",
    )
    expect(outbox.rows).toEqual([{ area_id: 'finance' }, { area_id: 'marketing' }])
  })

  it('verifies a resolved gap by test when the weekly run passes its tests (FR-610)', async () => {
    const card = (await call('GET', '/evals/areas/finance/scorecard', 'owner')).json<{
      run: { id: string }
    }>()
    const label = (
      await client.query<{ label: string }>(
        'select label from editions e join live_edition l on l.seq=e.seq',
      )
    ).rows[0]!.label
    const read = await call('GET', `/gaps/${gap}`, 'owner')
    expect(read.statusCode, read.body).toBe(200)
    expect(read.json()).toMatchObject({
      status: 'resolved',
      resolvedEdition: label,
      verifiedEdition: label,
      tests: [
        { question: 'norway-cause', passed: { run: card.run.id, edition: label } },
        { question: 'norway-held-out', passed: { run: card.run.id, edition: label } },
      ],
    })
    expect(read.json<{ verifiedAt: string | null }>().verifiedAt).not.toBeNull()
    const events = await client.query(
      "select area_id, payload from outbox_events where topic='gap.verified' and aggregate_id=$1",
      [gap],
    )
    expect(events.rows).toEqual([{ area_id: 'finance', payload: { edition: label } }])
  })

  it('shows held-out questions only to those who maintain them', async () => {
    const card = (await call('GET', '/evals/areas/finance/scorecard', 'owner')).json<{
      run: { id: string }
    }>()
    const ids = async (who: Who) => {
      const d = await detail(card.run.id, who)
      return [...d.results.map((q) => q.id), ...d.cells.map((c) => c.questionId)]
    }
    expect(await ids('owner')).toContain('norway-held-out')
    // An area's weekly run is a test result, read only by those who maintain the area (G13).
    expect((await call('GET', `/evals/runs/${card.run.id}`, 'author')).statusCode).toBe(404)
    // Transcripts belong to the owners of the question's area, not every owner.
    const cell = (await detail(card.run.id, 'owner')).cells.find(
      (c) => c.questionId === 'norway-cause',
    )!
    await client.query(
      "insert into area_assignments(area_id,person_id,role) values('marketing',$1,'owner')",
      [people.stranger],
    )
    try {
      expect((await call('GET', `/evals/runs/${card.run.id}`, 'stranger')).statusCode).toBe(404)
      expect((await call('GET', `/evals/cells/${cell.id}/transcript`, 'stranger')).statusCode).toBe(
        404,
      )
      expect((await call('GET', `/evals/cells/${cell.id}/transcript`, 'owner')).statusCode).toBe(
        200,
      )
    } finally {
      await client.query(
        "delete from area_assignments where area_id='marketing' and person_id=$1",
        [people.stranger],
      )
    }
  })

  it('lets only maintainers or the requester cancel a run', async () => {
    const run = await database.transaction(null, (tx) =>
      queueAreaRun(tx, { port: models, clock }, 'finance', 'scheduled', false),
    )
    // Someone who does not maintain the area does not see its runs, so cannot cancel them.
    expect((await call('POST', `/evals/runs/${run!.id}/cancel`, 'author')).statusCode).toBe(404)
    const cancelled = await call('POST', `/evals/runs/${run!.id}/cancel`, 'owner')
    expect(cancelled.json()).toMatchObject({ state: 'cancelled' })
    const own = (await call('POST', '/evals/areas/finance/runs', 'owner')).json<EvalRun>()
    expect((await call('POST', `/evals/runs/${own.id}/cancel`, 'author')).statusCode).toBe(404)
    expect((await call('POST', `/evals/runs/${own.id}/cancel`, 'owner')).statusCode).toBe(200)
  })

  it('fails and alerts a scheduled run that does not finish within a day', async () => {
    await client.query(
      `insert into eval_runs(kind,state,area_id,tool_schema_digest,model_id,client_label,test_set_digest,tries,
         estimated_cost_micros,created_at)
       values('scheduled','queued','marketing','x','mock/scripted-answer','eval','\\x00',3,0,now()-interval '25 hours')`,
    )
    logs.length = 0
    expect(await work()).toMatchObject({ expired: 1 })
    expect(logs).toContainEqual(
      expect.objectContaining({ alert: 'eval_run_unfinished', area: 'marketing' }),
    )
  })
})

describe('refusals', () => {
  it('counts a refusal as no answer, never as a pass or a fail', async () => {
    const refusing = new MockLanguageModelV4({
      provider: 'mock',
      modelId: 'refusing',
      doGenerate: (): Promise<LanguageModelV4GenerateResult> =>
        Promise.resolve({
          content: [],
          finishReason: { unified: 'content-filter', raw: 'refusal' },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 0, text: 0, reasoning: 0 },
          },
          warnings: [],
        }),
    })
    const port: ModelPort = {
      ...models,
      choose: (role) => ({
        ...models.choose(role),
        ...(role === 'eval_answer' ? { model: refusing, id: 'mock/refusing' } : {}),
      }),
    }
    const run = await database.transaction(people.admin, (tx) =>
      queueAreaRun(tx, { port, clock }, 'finance', 'full', true),
    )
    await work(port)
    const d = await detail(run!.id)
    expect(d.run.state).toBe('finished')
    expect(d.cells.every((c) => c.refused && c.passed === null)).toBe(true)
    const result = await client.query<{
      card: { noAnswer: number; failed: number; passed: number }
    }>("select summary->'result'->'scorecard' as card from eval_runs where id=$1", [run!.id])
    expect(result.rows[0]!.card).toMatchObject({ noAnswer: 4, failed: 0, passed: 0 })
  })
})

describe('a judge that numbers rubrics by position (round 6)', () => {
  it('keeps the answers, scores them neither pass nor fail, and reports the judge-error rate', async () => {
    // Gemini 2.5 Flash-Lite passed every rubric as `1.23` and `2.34` in most tries, and the
    // runner read each as failed: 2 of 15 where the answers passed 12.
    let judged = 0
    const misnumbering = new MockLanguageModelV4({
      provider: 'mock',
      modelId: 'misnumbering',
      doGenerate: (): Promise<LanguageModelV4GenerateResult> => {
        judged++
        const verdict = {
          caveat_present: true,
          cause_claimed: false,
          asks_clarifying_question: false,
          rubrics: [{ index: 1.23, passed: true }],
          reason: 'Fulfils the rubric.',
        }
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify(verdict) }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 10, text: 10, reasoning: 0 },
          },
          warnings: [],
        })
      },
    })
    const port: ModelPort = {
      ...models,
      choose: (role) => ({
        ...models.choose(role),
        ...(role === 'judge' ? { model: misnumbering, id: 'mock/misnumbering' } : {}),
      }),
      otherLine: (role, answer) => ({
        ...models.otherLine(role, answer),
        model: misnumbering,
        id: 'mock/misnumbering',
      }),
    }
    const run = await database.transaction(people.admin, (tx) =>
      queueAreaRun(tx, { port, clock }, 'finance', 'full', true),
    )
    await work(port)
    const d = (await call('GET', `/evals/runs/${run!.id}`, 'owner')).json<
      Detail & { judging: { judged: number; errors: number } }
    >()
    expect(d.run.state).toBe('finished')
    const answered = d.cells.filter((c) => !c.reused)
    expect(answered.length).toBeGreaterThan(0)
    expect(d.cells.every((c) => c.state === 'finished' && c.passed === null && !c.refused)).toBe(
      true,
    )
    expect(d.judging).toEqual({ judged: d.cells.length, errors: d.cells.length })
    // One retry per answer, then a judge error: never a third call to a judge that reads the
    // rubrics fine but keys them wrong.
    expect(judged).toBe(2 * answered.length)
    const cells = await client.query<{ scores: { judgeError?: string; checks: object } }>(
      'select scores from eval_cells where run_id=$1',
      [run!.id],
    )
    for (const { scores } of cells.rows) {
      // A question without rubrics gets an entry it does not have; one with a rubric also lacks it.
      expect(scores.judgeError).toMatch(
        /^The judge (left out rubric_1; )?graded rubrics the question does not have \(\[\{"index":1\.23,/,
      )
      expect(scores.checks).toEqual({})
    }
    const result = await client.query<{
      card: { noAnswer: number; failed: number; passed: number }
    }>("select summary->'result'->'scorecard' as card from eval_runs where id=$1", [run!.id])
    expect(result.rows[0]!.card).toMatchObject({ failed: 0, passed: 0 })
  })
})

describe('a failed model call', () => {
  it('is logged by run, cell and error kind, never with the prompt or the question', async () => {
    const failing = new MockLanguageModelV4({
      provider: 'mock',
      modelId: 'failing',
      // A provider error carries the request it failed on: the whole prompt, question included.
      doGenerate: (options) =>
        Promise.reject(
          new APICallError({
            message: `Bad request: ${JSON.stringify(options.prompt)}`,
            url: 'https://example.test/v1/chat/completions',
            requestBodyValues: { messages: options.prompt },
            statusCode: 400,
          }),
        ),
    })
    const port: ModelPort = {
      ...models,
      choose: (role) => ({
        ...models.choose(role),
        ...(role === 'eval_answer' ? { model: failing, id: 'mock/failing' } : {}),
      }),
    }
    await database.transaction(people.admin, (tx) =>
      queueAreaRun(tx, { port, clock }, 'finance', 'full', true),
    )
    logs.length = 0
    await work(port)
    const failed = logs.filter((line) => line.msg === 'evaluation cell failed')
    expect(failed.length).toBeGreaterThan(0)
    expect(failed[0]).toMatchObject({ err: { type: 'AI_APICallError', statusCode: 400 } })
    expect(JSON.stringify(logs)).not.toContain('orders drop in Norway')
  })
})

describe('npm run eval', () => {
  it('prints the finished run it started, which has no requester to read it as', async () => {
    // The command reads its run back after working it. A person's view shows only the runs they
    // requested or maintain, so it used to end with NOT_FOUND after every run, saved or not.
    const run = promisify(execFile)
    const result = await run(process.execPath, ['src/server/run-evals.ts', '--area', 'finance'], {
      env: {
        ...process.env,
        DATABASE_URL: url,
        CL_FIXED_TODAY: '2026-10-08',
        LOG_LEVEL: 'silent',
      },
      timeout: 240_000,
    }).catch((error: { code: number; stdout: string; stderr: string }) => error)
    expect(result.stderr).not.toMatch(/NOT_FOUND|No evaluation run/)
    expect(result.stdout, result.stderr).toMatch(
      /^Run [0-9a-f-]{36}: finished\. \d+ passed, \d+ failed/m,
    )
    expect(result.stdout).toMatch(/^Judge errors: 0 of \d+ judged answers \(0\.0%\)\.$/m)
    // The day the questions were asked on: none of these has its own, so the run's pinned day.
    expect(result.stdout).toMatch(
      /^Asked as of 2026-10-08: \d+ questions without an as-of day, on the run's day \(CL_FIXED_TODAY\)\.$/m,
    )
  }, 300_000)
})

describe('the day a question is asked on (round 6)', () => {
  it("reads a dateless question at its own as-of day, and one without at the run's day", async () => {
    // A golden question is dated (7 October 2026); without its day a run read "this past week"
    // at the machine's real today, unless CL_FIXED_TODAY was pinned by hand for every run.
    const dateless = (id: string, extra: Partial<GoldenQuestionInput> = {}) =>
      question(id, 'Online sales to Norway stopped on 4 August', {
        wordings: [
          { text: 'How did orders do in Norway this past week?', kind: 'natural' },
          { text: 'Orders in Norway from 2026-08-04 to 2026-08-10', kind: 'precise' },
        ],
        ...extra,
      })
    const dated = await save(dateless('norway-as-of', { as_of: '2026-08-10' }))
    expect(dated.statusCode, dated.body).toBe(200)
    expect(dated.json()).toMatchObject({ as_of: '2026-08-10' })
    const undated = await save(dateless('norway-today'))
    expect(undated.statusCode, undated.body).toBe(200)
    expect(undated.json()).not.toHaveProperty('as_of')
    const exported = (await call('GET', '/evals/export?area=finance', 'owner')).json<{
      content: string
    }>().content
    expect(exported).toMatch(/^ {4}as_of: '?2026-08-10'?$/m)
    // The exported file imports as it is: the day is part of the question.
    expect(
      (await call('POST', '/evals/import', 'owner', { content: exported, dryRun: true })).json<{
        unchanged: string[]
      }>().unchanged,
    ).toEqual(expect.arrayContaining(['norway-as-of', 'norway-today']))

    const run = await database.transaction(people.admin, (tx) =>
      queueAreaRun(tx, { port: models, clock }, 'finance', 'full', true),
    )
    await work()
    const days = await client.query<{ id: string; day: string }>(
      `select q->>'id' as id,q->>'asOf' as day from eval_runs,jsonb_array_elements(summary->'plan'->'questions') q
        where eval_runs.id=$1 and q->>'id' like 'norway-%'`,
      [run!.id],
    )
    expect(Object.fromEntries(days.rows.map((r) => [r.id, r.day]))).toMatchObject({
      'norway-as-of': '2026-08-10',
      'norway-today': '2026-10-08',
    })
    // What the tool server told the agent for the natural wording: the week it read "this past
    // week" as, the seven days to the day it read the question at (FR-304).
    const readAs = async (id: string) => {
      const rows = await client.query<{ messages: unknown }>(
        `select t.messages from eval_transcripts t join eval_cells c on c.id=t.cell_id
          where c.run_id=$1 and c.question_id=$2 and c.wording=0 and c.reused_from is null`,
        [run!.id, id],
      )
      expect(rows.rowCount).toBeGreaterThan(0)
      return [
        ...JSON.stringify(rows.rows.map((r) => r.messages)).matchAll(
          /"dates_read":\{[^}]*"reads_as":"([^"]+)"/g,
        ),
      ].map((m) => m[1])
    }
    expect(new Set(await readAs('norway-as-of'))).toEqual(
      new Set(['4-10 Aug 2026 (the 7 days to today; UTC)']),
    )
    expect(new Set(await readAs('norway-today'))).toEqual(
      new Set(['2-8 Oct 2026 (the 7 days to today; UTC)']),
    )

    // Retired, so the runs after this one keep their own question counts.
    for (const id of ['norway-as-of', 'norway-today']) {
      const current = (await call('GET', `/evals/questions/${id}`, 'owner')).json<
        GoldenQuestionInput & { revision: number }
      >()
      const retired = await save({ ...current, status: 'retired' }, 'owner', current.revision)
      expect(retired.statusCode, retired.body).toBe(200)
    }
  })
})

describe('questions run in memory, with nothing of them kept (FR-525)', () => {
  it('runs them through the same runner, and no word of them reaches the database or a log', async () => {
    // The sealed held-out questions reach the runner only in memory, from the code that opened
    // them; a canary in every text they hold proves where their words could go.
    const canary = 'CANARY7F31'
    const sealed = [
      question(`sealed-${canary.toLowerCase()}`, `Online sales stopped ${canary}`, {
        wordings: [
          { text: `How did orders do in Norway this past week? ${canary}`, kind: 'natural' },
          {
            text: `Orders in Norway from 2026-08-04 to 2026-08-10 ${canary}`,
            kind: 'precise',
          },
        ],
        rubrics: [`Names the market "Norway" ${canary}`],
        source: `Sealed ${canary}`,
        split: 'held_out',
        as_of: '2026-08-10',
      }),
      question('sealed-unanswerable', 'Revenue figures in Spain', {
        expected: { must_deliver: [closure], caveat: `Never said ${canary}` },
      }),
    ].map((q) => goldenQuestionSchema.parse(q))
    const before = await client.query<{ n: number }>('select count(*)::int as n from eval_cells')
    logs.length = 0
    const run = await runWithheld(
      database,
      { port: models, clock },
      {
        area: 'finance',
        questions: sealed,
        person: null,
        ceilingMicros: null,
        signal: new AbortController().signal,
        logger,
      },
    )
    expect(run.state).toBe('finished')
    expect(run.verdicts).toHaveLength(2)
    expect(run.verdicts.every((v) => v === 'pass' || v === 'fail')).toBe(true)
    expect(run.judging.judged).toBeGreaterThan(0)
    // No cell and no transcript: the run keeps its model calls and cost, and counts in words.
    const after = await client.query<{ n: number }>('select count(*)::int as n from eval_cells')
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n)
    const record = await client.query<{ kind: string; area_id: string | null; text: string }>(
      'select kind::text,area_id,row_to_json(r)::text as text from eval_runs r where id=$1',
      [run.runId],
    )
    expect(record.rows[0]).toMatchObject({ kind: 'held_out', area_id: null })
    expect(record.rows[0]!.text).toMatch(/Held-out questions: \d passed, \d failed/)
    const calls = await client.query<{ text: string }>(
      'select row_to_json(c)::text as text from model_calls c where run_id=$1',
      [run.runId],
    )
    expect(calls.rowCount).toBeGreaterThan(0)
    // Every table the runner could write, and every log line it wrote.
    const tables = await client.query<{ text: string }>(
      `select coalesce(string_agg(t::text, ' '),'') as text from (
         select row_to_json(r)::text as t from eval_runs r
         union all select row_to_json(c)::text from eval_cells c
         union all select row_to_json(x)::text from eval_transcripts x
         union all select row_to_json(m)::text from model_calls m
         union all select row_to_json(a)::text from audit_log a
         union all select row_to_json(q)::text from golden_questions q
         union all select row_to_json(v)::text from golden_question_revisions v) all_rows`,
    )
    expect(tables.rows[0]!.text).not.toContain(canary)
    expect(tables.rows[0]!.text).not.toContain(canary.toLowerCase())
    expect(JSON.stringify(logs)).not.toContain(canary)
    // The job never works such a run.
    expect((await work()).runs).not.toContain(run.runId)
    // Read back through the service, as an administrator would list it: counts only.
    const listed = await call('GET', `/evals/runs/${run.runId}`, 'admin')
    expect(listed.statusCode, listed.body).toBe(200)
    expect(listed.body).not.toContain(canary)
  })
  it('stops at its cost ceiling before a call, incomplete, saying so in counts', async () => {
    const canary = 'CANARY4B8D'
    const run = await runWithheld(
      database,
      { port: models, clock },
      {
        area: 'finance',
        questions: [
          goldenQuestionSchema.parse(question('sealed-ceiling', `Online sales ${canary}`)),
        ],
        person: null,
        ceilingMicros: 0,
        signal: new AbortController().signal,
        logger,
      },
    )
    expect(run).toMatchObject({ state: 'incomplete', verdicts: ['no_answer'], costMicros: 0 })
    expect(run.stopped).toMatch(/ceiling\. 6 of 6 answers not made\.$/)
    const record = await client.query<{ failure: string }>(
      'select failure from eval_runs where id=$1',
      [run.runId],
    )
    expect(record.rows[0]!.failure).not.toContain(canary)
  })
})
