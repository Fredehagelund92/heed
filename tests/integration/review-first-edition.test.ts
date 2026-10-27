import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewSheet } from '../../src/contract/review-path.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

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

const draft = (): Draft => ({
  areaId: 'finance',
  kind: 'note',
  title: 'Units sold excludes test accounts',
  summary: 'Orders in Norway leave out the 312 accounts our teams use to test the webshop.',
  scope: {
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
  },
  validity: { start: '2026-01-01', end: null },
  evidence: [
    {
      url: 'https://wiki.example/units-sold',
      quote: 'Test accounts are left out',
      date: '2026-10-01',
    },
  ],
})

describe('the first suggestion of a workspace', () => {
  it('has a sheet with nothing to compare, and publishes the first edition', async () => {
    expect(
      (await client.query('select 1 from live_edition')).rowCount,
      'no edition is live',
    ).toBe(0)
    const created = await ok<ProposalRecord>(
      call('POST', '/proposals', 'author', { draft: draft() }),
    )
    const p = await ok<ProposalRecord>(
      call('POST', `/proposals/${created.id}/submit`, 'author', { revision: created.revision }),
    )
    const s = await ok<ReviewSheet>(call('GET', `/review/${p.id}/sheet`, 'owner'))
    expect(s.mode).toBe('new')
    expect(s.clashes).toEqual([])
    expect(s.canPublish).toBe(true)

    const done = await ok<{ proposal: { state: string }; edition: { label: string } | null }>(
      call('POST', `/review/${p.id}/publish`, 'owner', { revision: p.revision }),
    )
    expect(done.proposal.state).toBe('accepted')
    expect(done.edition).not.toBeNull()
    expect((await client.query('select 1 from live_edition')).rowCount).toBe(1)
  })

  it('names a suggestion left out instead of failing the whole bulk call', async () => {
    const result = await ok<{ published: unknown[]; skipped: { code: string }[] }>(
      call('POST', '/review/publish-read', 'owner', { ids: [randomUUID()] }),
    )
    expect(result.published).toEqual([])
    expect(result.skipped).toHaveLength(1)
  })
})
