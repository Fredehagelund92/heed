import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Catalogue } from '../../src/contract/index.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { Database, Queryable } from '../../src/server/db/database.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { openEdition } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  How fast a decision and the reads after it are at a pilot's size (the captain's pilot, 16 Oct
  2026: an accept took 3 seconds and the catalogue 2 to 3.5 on a busy computer). The bulk demo
  seed (1,400 items in service, 2,400 terms) with 600 more metrics in Sales, so the catalogue
  lists over 600 terms. On a busy computer every round trip to PostgreSQL waits its turn, so these
  tests count the statements of each request as well as timing it; the budgets are generous, the
  counts are what changed.
*/

/** Generous for a busy computer (one-minute load near 40); idle, each step takes a fraction. */
const READ_BUDGET_MS = 5_000
const DECIDE_BUDGET_MS = 10_000
const METRICS = 600
const OPEN = 21

const { client, url } = testDatabase({ seeded: true })

/** The statements of every transaction, in order, as the service ran them. */
const transactions: string[][] = []
function counted(database: Database): Database {
  return {
    ...database,
    transaction: (personId, work, options) => {
      const statements: string[] = []
      transactions.push(statements)
      return database.transaction(
        personId,
        (tx) =>
          work({
            query: (text, values) => {
              statements.push(text)
              return tx.query(text, values)
            },
          } satisfies Queryable),
        options,
      )
    },
  }
}

const app = buildApp({
  database: counted(apiDatabase(url)),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-16'),
  devPeople: ['maria', 'jon', 'ravi'].map((name) => ({
    name,
    email: `per_${name}@example.test`,
    roles: [],
  })),
})
type Who = 'maria' | 'jon' | 'ravi'
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })

/** One request: its answer, how long it took and the statements of its transaction. */
async function measured(method: 'GET' | 'POST', path: string, who: Who, payload?: object) {
  const before = transactions.length
  const started = performance.now()
  const response = await call(method, path, who, payload)
  const ms = performance.now() - started
  const statements = transactions.slice(before).flat()
  expect(response.statusCode, response.body).toBe(200)
  return { response, ms, statements }
}

let open: ProposalRecord[] = []

/** 600 metrics in Sales, accepted by its owner and live in one new edition. */
async function pilotMetrics() {
  const keys = Array.from({ length: METRICS }, (_, n) => `metric:pilot_${n}`)
  const names = keys.map((_, n) => `Pilot metric ${n}`)
  const [owner, admin] = (
    await client.query<{ id: string }>(
      `select id::text from people where email = any($1) order by email = $2 desc`,
      [['per_jon@example.test', 'per_ravi@example.test'], 'per_jon@example.test'],
    )
  ).rows as [{ id: string }, { id: string }]
  await client.query(
    "insert into vocab_terms (key,kind,parent_key) select key,'metric',null from unnest($1::text[]) key",
    [keys],
  )
  const versions = await client.query<{ id: string }>(
    `insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest)
     select key,1,name,'area_sales',sha256(convert_to(key,'UTF8')) from unnest($1::text[],$2::text[]) t(key,name)
     returning id::text`,
    [keys, names],
  )
  const ids = versions.rows.map((row) => row.id)
  const proposals = await client.query<{ id: string; version: string }>(
    `insert into proposals (subject,action,state,area_id,vocab_version_id,proposer_id,channel)
     select 'vocabulary','create','submitted','area_sales',id,$2,'form' from unnest($1::uuid[]) id
     returning id::text, vocab_version_id::text as version`,
    [ids, admin.id],
  )
  await client.query(
    `insert into decisions (proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason)
     select p,v,'area_sales',$3,'owner','accept','The pilot metrics' from unnest($1::uuid[],$2::uuid[]) t(p,v)`,
    [proposals.rows.map((row) => row.id), proposals.rows.map((row) => row.version), owner.id],
  )
  const seq = await openEdition(client)
  await client.query('select edition_serve_vocab_version($1,id) from unnest($2::uuid[]) id', [
    seq,
    ids,
  ])
  await client.query('select edition_seal($1)', [seq])
  await client.query('select edition_publish($1)', [seq])
}

beforeAll(async () => {
  for (const who of ['maria', 'jon', 'ravi'] as const) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `per_${who}@example.test` },
    })
    headers[who] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
  await pilotMetrics()
  // Maria sends low-risk notes for Jon to decide.
  for (let n = 0; n < OPEN; n++) {
    const created = await call('POST', '/proposals', 'maria', {
      channel: 'form',
      draft: {
        kind: 'note',
        summaryMarkup: `Pilot metric ${n} counts a visit once per day from 1 September (${n}).`,
        scope: { metrics: [`metric:pilot_${n}`], dimensions: [], dimensionValues: [] },
        validity: { start: '2026-09-01', end: '2026-10-01' },
        evidence: [
          {
            url: `https://wiki.example/pilot-metric-${n}`,
            quote: 'A visit is counted once per day.',
            date: '2026-10-02',
          },
        ],
        areaId: 'area_sales',
        riskLevel: 'low',
      },
    })
    expect(created.statusCode, created.body).toBe(200)
    const draft = created.json<{ id: string; revision: number }>()
    const submitted = await call('POST', `/proposals/${draft.id}/submit`, 'maria', {
      revision: draft.revision,
    })
    expect(submitted.statusCode, submitted.body).toBe(200)
  }
  // Maria's notes, newest first: the ones Jon decides below.
  open = (
    await call('GET', '/proposals?state=submitted&own=true&areaId=area_sales&limit=100', 'maria')
  ).json<{ rows: ProposalRecord[] }>().rows
  expect(open.length).toBeGreaterThanOrEqual(OPEN)
}, 600_000)

afterAll(() => app.close())

it('reads the session, the person and their roles in one statement', async () => {
  const { statements } = await measured('GET', '/areas', 'jon')
  // The session with its person and roles, the person for row security, and the areas.
  expect(statements).toHaveLength(3)
})

it('reads a catalogue of over 600 terms in one statement, within budget', async () => {
  const { response, ms, statements } = await measured('GET', '/catalogue', 'jon')
  expect(response.json<Catalogue>().terms.length).toBeGreaterThan(METRICS)
  expect(statements).toHaveLength(3)
  expect(ms).toBeLessThan(READ_BUDGET_MS)
})

it('reads every list a decision refreshes within budget', async () => {
  for (const path of [
    '/inbox/feed',
    '/proposals?state=submitted&limit=100',
    `/proposals/${open[0]!.id}`,
    `/review/${open[0]!.id}/sheet`,
    '/vocabulary',
    '/library',
    '/serving/stops',
  ]) {
    const { ms } = await measured('GET', path, 'jon')
    expect(ms, path).toBeLessThan(READ_BUDGET_MS)
  }
})

it('accepts one proposal within budget, and never twice', async () => {
  const target = open.shift()!
  const { response, ms, statements } = await measured(
    'POST',
    `/review/${target.id}/publish`,
    'jon',
    { revision: target.revision },
  )
  expect(response.json<{ proposal: ReviewProposal }>().proposal.state).toBe('accepted')
  expect(ms).toBeLessThan(DECIDE_BUDGET_MS)
  // Publish reads the suggestion as its review shows it (clashes, relations, a take-back) before
  // the decision: 62 statements when the web app's review replaced the old one (30 Oct 2026).
  expect(statements.length).toBeLessThanOrEqual(62)
  // Whether it is a rescue (FR-814) is read with the live version, so it costs no statement.
  const rescue = statements.filter((text) => text.includes('rescue_proposal'))
  expect(rescue).toHaveLength(1)
  expect(rescue[0]).toContain('live_edition')
  // A screen that has not caught up offers its old revision, or decides it again: both refused.
  for (const revision of [target.revision, target.revision + 1]) {
    const again = await call('POST', `/review/${target.id}/publish`, 'jon', { revision })
    expect(again.statusCode).toBe(409)
  }
})
