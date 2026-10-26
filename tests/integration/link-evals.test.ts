import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { EvalRun } from '../../src/contract/evals.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { workEvaluations } from '../../src/server/modules/evals/index.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, openEdition, people, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  S19 link-follow evaluation (FR-523): a question whose caveat lives only in a linked item, and a
  question that forbids a retired link target, run as a links run: the same live edition with
  get_related off (baseline) and on (candidate), through the real MCP wire with the scripted
  model. The run shows the gain and the cost of following links; the tool stays off.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const clock = systemClock('2026-10-08')
const models = createModelPort({ mode: 'mock' })
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
type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const ids = { closure: '', refunds: '', old: '' }

const wordings = [
  { text: 'What happened to orders in August 2026?', kind: 'natural' },
  { text: 'Orders from 2026-08-01 to 2026-08-31', kind: 'precise' },
]
const scope = { metrics: ['metric:orders'], window: { from: '2026-08-01', to: '2026-08-31' } }

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    // The refund rule ended before August: get_facts never delivers it for an August question.
    const refunds = await version(client, {
      title: 'Refund rule',
      summary: 'Orders are counted net of refunds.',
      validity: { from: '2026-01-01', until: '2026-03-01' },
      owner: people.owner,
    })
    const old = await version(client, {
      title: 'Old licence rule',
      summary: 'Orders from the old licence.',
      owner: people.owner,
    })
    const closure = await version(client, {
      title: 'Norway closure',
      summary: 'Orders',
      body: 'Counting follows the refund rule; it replaced the old rule.',
      bodyMarkup: `Counting follows @[the refund rule](item:${refunds.item}); it replaced @[the old rule](item:${old.item}).`,
      owner: people.owner,
    })
    for (const [position, target, label] of [
      [0, refunds.item, 'the refund rule'],
      [1, old.item, 'the old rule'],
    ] as const)
      await client.query(
        "insert into item_version_mentions (version_id,field,position,item_id,label) values ($1,'body',$2,$3,$4)",
        [closure.id, position, target, label],
      )
    Object.assign(ids, { closure: closure.item, refunds: refunds.item, old: old.item })
    for (const v of [refunds, old, closure]) await accept(client, v.id)
    const first = await openEdition(client)
    for (const v of [refunds, old, closure])
      await client.query('select edition_serve_item_version($1,$2)', [first, v.id])
    const term = await client.query<{ id: string }>(
      "with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values('metric:orders',1,'Orders','finance',sha256('orders')) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,'demo:orders' from v where 'demo:orders'::text is not null) select id from v",
    )
    const proposal = await client.query<{ id: string }>(
      "insert into proposals (subject,action,state,area_id,vocab_version_id,proposer_id,channel) values ('vocabulary','create','submitted','finance',$1,$2,'form') returning id",
      [term.rows[0]!.id, people.author],
    )
    await client.query(
      "insert into decisions (proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason) values ($1,$2,'finance',$3,'owner','accept','Reviewed vocabulary')",
      [proposal.rows[0]!.id, term.rows[0]!.id, people.owner],
    )
    await client.query('select edition_serve_vocab_version($1,$2)', [first, term.rows[0]!.id])
    await client.query('select edition_seal($1)', [first])
    await client.query('select edition_publish($1)', [first])
    await client.query(
      "insert into decisions (item_version_id,area_id,decided_by,capacity,outcome,reason) values ($1,'finance',$2,'owner','retire','Ended')",
      [old.id, people.owner],
    )
    const second = await openEdition(client)
    await client.query('select edition_close_item($1,$2)', [second, old.item])
    await client.query('select edition_seal($1)', [second])
    await client.query('select edition_publish($1)', [second])
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
  for (const question of [
    {
      id: 'link-refund-rule',
      expected: {
        must_deliver: [ids.closure],
        reachable_via_link: [ids.refunds],
        caveat: 'Orders are counted net of refunds',
      },
    },
    { id: 'stale-old-rule', expected: { must_deliver: [ids.closure], forbidden_links: [ids.old] } },
  ]) {
    const saved = await call('PUT', `/evals/questions/${question.id}`, 'owner', {
      id: question.id,
      question: {
        ...question,
        area: 'finance',
        wordings,
        scope,
        source: 'Link-follow tests',
      },
    })
    expect(saved.statusCode, saved.body).toBe(200)
  }
})
afterAll(async () => {
  await app.close()
})

it('refuses a link target that is both reachable and forbidden', async () => {
  const response = await call('PUT', '/evals/questions/link-both-ways', 'owner', {
    id: 'link-both-ways',
    question: {
      id: 'link-both-ways',
      area: 'finance',
      wordings,
      scope,
      expected: { reachable_via_link: [ids.refunds], forbidden_links: [ids.refunds] },
      source: 'Link-follow tests',
    },
  })
  expect(response.statusCode).toBe(400)
})

it('estimates a links run as both sides of every question, for maintainers only', async () => {
  const estimate = await call('GET', '/evals/areas/finance/estimate?kind=links', 'owner')
  expect(estimate.statusCode, estimate.body).toBe(200)
  // Two questions, two wordings, three tries, two sides.
  expect(estimate.json()).toMatchObject({ kind: 'links', questions: 2, cells: 24 })
  expect((await call('POST', '/evals/areas/finance/link-runs', 'author')).statusCode).toBe(403)
})

it('shows that following links helps, what it costs, and leaves the switch as it was', async () => {
  const started = await call('POST', '/evals/areas/finance/link-runs', 'owner')
  expect(started.statusCode, started.body).toBe(200)
  const run = started.json<EvalRun>()
  expect(run).toMatchObject({ kind: 'links', state: 'queued', questions: 2 })
  await workEvaluations(
    database,
    { port: models, clock },
    {
      only: run.id,
      deadline: Date.now() + 30_000,
      signal: new AbortController().signal,
      logger: createLogger({ level: 'silent' }),
    },
  )
  const detail = await call('GET', `/evals/runs/${run.id}`, 'owner')
  expect(detail.statusCode, detail.body).toBe(200)
  const result = detail.json<{
    run: EvalRun
    results: { id: string; baseline: string; candidate: string; flip: string | null }[]
    links: {
      gained: string[]
      lost: string[]
      gain: boolean
      arms: Record<'baseline' | 'candidate', { answers: number; calls: number }>
    }
    cells: { id: string; questionId: string; arm: string }[]
  }>()
  expect(result.run.state).toBe('finished')
  const passing = { code: 'pass', judge: 'pass', failedChecks: [] }
  expect(result.results).toEqual([
    {
      id: 'link-refund-rule',
      impact: false,
      baseline: 'fail',
      candidate: 'pass',
      flip: 'fail_to_pass',
      // Without links the item is never reached (code) and its caveat never stated (judge).
      layers: {
        baseline: { code: 'fail', judge: 'fail', failedChecks: ['caveat', 'linked'] },
        candidate: passing,
      },
    },
    {
      id: 'stale-old-rule',
      impact: false,
      baseline: 'pass',
      candidate: 'pass',
      flip: null,
      layers: { baseline: passing, candidate: passing },
    },
  ])
  expect(result.links).toMatchObject({ gained: ['link-refund-rule'], lost: [], gain: true })
  // One get_context call without links; with them, one more get_related call per answer.
  expect(result.links.arms.baseline.calls).toBe(1)
  expect(result.links.arms.candidate.calls).toBe(2)
  expect(result.links.arms.candidate.answers).toBe(result.links.arms.baseline.answers)

  const transcript = async (arm: string) => {
    const cell = result.cells.find((c) => c.questionId === 'link-refund-rule' && c.arm === arm)!
    const response = await call('GET', `/evals/cells/${cell.id}/transcript`, 'owner')
    return response.json<{ toolCalls: { tool: string; items: string[] }[] }>()
  }
  expect((await transcript('baseline')).toolCalls.map((c) => c.tool)).toEqual(['get_context'])
  const followed = (await transcript('candidate')).toolCalls
  expect(followed.map((c) => c.tool)).toEqual(['get_context', 'get_related'])
  // The retired rule is a marker with the author's words: never read, never cited.
  expect(followed[1]!.items).toEqual([ids.refunds])

  const tools = await call('GET', '/tools', 'admin')
  expect(tools.json<{ tool: string; enabled: boolean }[]>()).toContainEqual(
    expect.objectContaining({ tool: 'get_related', enabled: true }),
  )
})
