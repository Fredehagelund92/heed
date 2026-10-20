import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Edition, ReviewProposal, TermCandidate } from '../../src/contract/review.ts'
import { buildApp } from '../../src/server/app.ts'
import { readConnectors } from '../../src/server/modules/jobs/operations.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  A model of 2,000 members, as a pilot with a large Cube model has them (the scale lab of 15 Oct
  2026): 40 views of 40 metrics and 10 dimensions, every view mapped to its domain by the server's
  list, so its read warns once per member. Proposing every suggested member is one batch, read and
  stored in a fixed handful of statements, and accepting it is one edition; the Sources overview
  reads where each member's domain comes from without looking each one up in the warnings. Each
  step had taken from tens of seconds to minutes, and a batch over 500 terms was refused.
*/

const VIEWS = 40
const METRICS = 40
const DIMENSIONS = 10
/** Generous for a busy computer; before the change each step took many times this. */
const BUDGET_MS = 15_000

const { client, url } = testDatabase()
const database = apiDatabase(url)
const app = buildApp({
  database,
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-15'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const timed = async <T>(step: () => Promise<T>) => {
  const started = performance.now()
  const result = await step()
  return { result, ms: performance.now() - started }
}

beforeAll(async () => {
  await foundation(client)
  // The second administrator accepts what the first proposes.
  await client.query(
    "insert into global_role_grants (person_id,role) values ($1,'administrator')",
    [people.stranger],
  )
  const views = Array.from({ length: VIEWS }, (_, v) => `view${v}`)
  await client.query(
    `insert into areas (id,name) select 'domain_' || v, 'Domain ' || v from generate_series(0,$1) v`,
    [VIEWS - 1],
  )
  // One read that saw every member, with one domain_override warning each, as the pilot's are.
  const members = views.flatMap((view, v) => [
    ...Array.from({ length: METRICS }, (_, m) => ({
      ref: `cube:${view}.metric_${m}`,
      kind: 'metric',
      name: `${view}.metric_${m}`,
      // Every view has a Clicks: the first is proposed plain, the rest take their view's name.
      title: m === 0 ? 'Clicks' : `Metric ${v} ${m}`,
      area: `domain_${v}`,
    })),
    ...Array.from({ length: DIMENSIONS }, (_, d) => ({
      ref: `cube:${view}.dim_${v}_${d}`,
      kind: 'dimension',
      name: `${view}.dim_${v}_${d}`,
      title: `Dimension ${v} ${d}`,
      area: `domain_${v}`,
    })),
  ])
  expect(members).toHaveLength(2_000)
  const [snapshot] = (
    await client.query<{ id: string }>(
      `insert into connector_snapshots (connector_id,status,definitions_seen,warnings)
       values ('demo','ok',$1,$2) returning id::text`,
      [
        members.length,
        JSON.stringify(members.map((m) => ({ code: 'domain_override', target: m.ref }))),
      ],
    )
  ).rows as [{ id: string }]
  await client.query(
    `insert into definitions (ref,connector_id,kind,name,title,change_mark,area_hint,last_seen_snapshot)
     select m->>'ref','demo',(m->>'kind')::definition_kind,m->>'name',m->>'title','1',m->>'area',$2
       from jsonb_array_elements($1::jsonb) m`,
    [JSON.stringify(members), snapshot.id],
  )
  for (const name of Object.keys(people) as Who[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `${name}@example.test` },
    })
    headers[name] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
})

afterAll(() => app.close())

it('reads where 2,000 members take their domain from without one lookup each', async () => {
  const { result, ms } = await timed(() => readConnectors(database))
  const demo = result.find((connector) => connector.id === 'demo')!
  expect(demo.domainCoverage).toMatchObject({ override: VIEWS * METRICS, cube: 0 })
  expect(ms).toBeLessThan(BUDGET_MS)
}, 60_000)

it('proposes 2,000 members as one batch and accepts them as one edition', async () => {
  const candidates = (await call('GET', '/vocabulary/candidates', 'admin')).json<TermCandidate[]>()
  const chosen = candidates.filter((candidate) => candidate.suggested)
  expect(chosen.length).toBeGreaterThan(500)
  // Clicks of every view but the first takes the view's name, so no two metrics share a name.
  const clicks = chosen.filter((candidate) => candidate.name.startsWith('Clicks'))
  expect(clicks).toHaveLength(VIEWS)
  expect(new Set(clicks.map((candidate) => candidate.name)).size).toBe(VIEWS)

  const terms = chosen.map((candidate) => ({
    key: candidate.key,
    kind: candidate.kind,
    parentKey: null,
    name: candidate.name,
    aliases: candidate.aliases,
    areaId: candidate.areaId,
    definitionRefs: candidate.definitionRefs,
  }))
  const proposed = await timed(() =>
    call('POST', '/vocabulary/batches', 'admin', { terms, sourceName: 'Cube members' }),
  )
  expect(proposed.result.statusCode, proposed.result.body).toBe(200)
  expect(proposed.ms).toBeLessThan(BUDGET_MS)
  const batch = proposed.result.json<{ batchId: string; proposals: ReviewProposal[] }>()
  expect(batch.proposals).toHaveLength(terms.length)
  expect(new Set(batch.proposals.map((proposal) => proposal.state))).toEqual(new Set(['submitted']))

  const accepted = await timed(() =>
    call('POST', `/vocabulary/batches/${batch.batchId}/decisions`, 'stranger', {
      outcome: 'accept',
      reason: 'The members of the model',
      capacity: 'administrator',
    }),
  )
  expect(accepted.result.statusCode, accepted.result.body).toBe(200)
  expect(accepted.ms).toBeLessThan(BUDGET_MS)
  const decided = accepted.result.json<{ proposals: ReviewProposal[]; edition: Edition }>()
  expect(decided.proposals.every((proposal) => proposal.state === 'accepted')).toBe(true)
  expect(decided.edition).toMatchObject({ reason: 'vocabulary_changed', live: true })
  const served = await client.query<{ n: number }>(
    `select count(*)::int as n from vocab_term_service where editions @> (select seq from live_edition)`,
  )
  expect(served.rows[0]!.n).toBeGreaterThanOrEqual(terms.length)
  // A new view's Clicks is checked against the live terms too: it takes its view's name.
  await client.query(
    `insert into definitions (ref,connector_id,kind,name,title,change_mark,area_hint)
     values ('cube:late.clicks','demo','metric','late.clicks','Clicks','1','domain_0')`,
  )
  const late = (await call('GET', '/vocabulary/candidates', 'admin'))
    .json<TermCandidate[]>()
    .find((candidate) => candidate.definitionRefs.includes('cube:late.clicks'))
  expect(late).toMatchObject({ name: 'Clicks (late)' })
}, 120_000)

it('refuses a batch over the limit before it reads a term', async () => {
  const terms = Array.from({ length: 5_001 }, (_, n) => ({
    key: `metric:over_${n}`,
    kind: 'metric',
    parentKey: null,
    name: `Over ${n}`,
    aliases: [],
    areaId: null,
    definitionRefs: [],
  }))
  const refused = await call('POST', '/vocabulary/batches', 'admin', { terms })
  expect(refused.statusCode).toBe(400)
}, 60_000)
