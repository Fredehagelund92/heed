import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Catalogue } from '../../src/contract/index.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import type { Database, Queryable } from '../../src/server/db/database.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
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
const BULK_BUDGET_MS = 30_000
const METRICS = 600
const OPEN = 21

const { url } = testDatabase({ seeded: true })

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

let open: ReviewProposal[] = []

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
  // The administrator proposes 600 metrics in Sales, and its owner accepts them.
  const terms = Array.from({ length: METRICS }, (_, n) => ({
    key: `metric:pilot_${n}`,
    kind: 'metric',
    parentKey: null,
    name: `Pilot metric ${n}`,
    aliases: [],
    areaId: 'area_sales',
    definitionRefs: [],
  }))
  const proposed = await call('POST', '/vocabulary/batches', 'ravi', { terms })
  expect(proposed.statusCode, proposed.body).toBe(200)
  const accepted = await call(
    'POST',
    `/vocabulary/batches/${proposed.json<{ batchId: string }>().batchId}/decisions`,
    'jon',
    { outcome: 'accept', reason: 'The pilot metrics', capacity: 'owner' },
  )
  expect(accepted.statusCode, accepted.body).toBe(200)
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
  open = (await call('GET', '/review/queue?limit=100', 'jon')).json<ReviewProposal[]>()
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
    '/review/queue?limit=100',
    '/proposals?state=submitted&limit=100',
    `/proposals/${open[0]!.id}`,
    `/proposals/${open[0]!.id}/events`,
    `/proposals/${open[0]!.id}/review`,
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
    `/proposals/${target.id}/decisions`,
    'jon',
    { revision: target.revision, outcome: 'accept', reason: 'Checked against the source' },
  )
  expect(response.json<{ proposal: ReviewProposal }>().proposal.state).toBe('accepted')
  expect(ms).toBeLessThan(DECIDE_BUDGET_MS)
  // 53 before the session, the format check's reference and the check results each took one.
  expect(statements.length).toBeLessThanOrEqual(45)
  // Whether it is a rescue (FR-814) is read with the live version, so it costs no statement.
  const rescue = statements.filter((text) => text.includes('rescue_proposal'))
  expect(rescue).toHaveLength(1)
  expect(rescue[0]).toContain('live_edition')
  // A screen that has not caught up offers its old revision, or decides it again: both refused.
  for (const revision of [target.revision, target.revision + 1]) {
    const again = await call('POST', `/proposals/${target.id}/decisions`, 'jon', {
      revision,
      outcome: 'accept',
      reason: 'Checked against the source',
    })
    expect(again.statusCode).toBe(409)
  }
})

it('accepts many proposals in one step, reading the live edition once', async () => {
  const targets = open.splice(0, 20)
  const { response, ms, statements } = await measured('POST', '/review/decisions', 'jon', {
    proposals: targets.map(({ id, revision }) => ({ id, revision })),
    outcome: 'accept',
    reason: 'Checked against the source',
  })
  const result = response.json<{ proposals: ReviewProposal[]; skipped: unknown[] }>()
  expect(result.skipped).toEqual([])
  expect(result.proposals.every((proposal) => proposal.state === 'accepted')).toBe(true)
  expect(ms).toBeLessThan(BULK_BUDGET_MS)
  // The serving bundle the checks run against, once for the step and not once per proposal.
  expect(statements.filter((text) => text.includes('serving_items(')).length).toBe(1)
})
