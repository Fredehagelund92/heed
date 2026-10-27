import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewSheet } from '../../src/contract/review-path.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, version } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The review path before anything is shared with agents: the very first suggestion of a
  workspace has no live edition to be compared with, and still reads and publishes.
*/

const { client, url } = testDatabase()
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})

type Headers = { cookie: string; origin: string; 'x-heed-csrf': string }
const headers: Record<string, Headers> = {}
type Who = keyof typeof people
const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const ok = async <T>(response: Promise<{ statusCode: number; body: string; json: <U>() => U }>) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(200)
  return r.json<T>()
}

beforeAll(async () => {
  await foundation(client)
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
})
afterAll(async () => {
  await app.close()
})

/** A submitted suggestion written straight into the tables: no proposal can name scope before a vocabulary is live. */
const submitted = () =>
  transaction(client, async () => {
    const v = await version(client, { title: 'Units sold excludes test accounts' })
    const row = await client.query<{ id: string; revision: number }>(
      `insert into proposals (action,state,area_id,item_id,item_version_id,proposer_id,channel,submitted_at)
       select 'change','submitted',area_id,item_id,id,proposer_id,'form',now()
         from item_versions where id=$1 returning id::text,revision`,
      [v.id],
    )
    return row.rows[0]!
  })

describe('the first suggestion of a workspace', () => {
  it('has a sheet with nothing to compare, and its checks run without a live edition', async () => {
    expect(
      (await client.query('select 1 from live_edition')).rowCount,
      'no edition is live',
    ).toBe(0)
    const p = await submitted()
    const s = await ok<ReviewSheet>(call('GET', `/review/${p.id}/sheet`, 'owner'))
    expect(s.mode).toBe('new')
    expect(s.clashes).toEqual([])
    expect(s.canPublish).toBe(true)

    // Before any vocabulary is published nothing can name the suggestion's scope, so the checks
    // cannot pass. They still run and say which failed: no edition-less 412, and nothing is published.
    const refused = await call('POST', `/review/${p.id}/publish`, 'owner', { revision: p.revision })
    expect(refused.statusCode, refused.body).toBe(422)
    const gate = refused.json<{ data: { gate: { levels: { level: string; outcome: string }[] } } }>()
      .data.gate
    expect(gate.levels.map((l) => [l.level, l.outcome])).toEqual([
      ['format', 'failed'],
      ['matching', 'passed'],
      ['delivery', 'failed'],
    ])
    expect((await client.query('select 1 from live_edition')).rowCount).toBe(0)
  })

  it('names a suggestion left out instead of failing the whole bulk call', async () => {
    const result = await ok<{ published: unknown[]; skipped: { code: string }[] }>(
      call('POST', '/review/publish-read', 'owner', { ids: [randomUUID()] }),
    )
    expect(result.published).toEqual([])
    expect(result.skipped).toHaveLength(1)
  })
})
