import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NamesDecision, NamesRead } from '../../src/contract/inbox.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The names a read makes from a Cube model on the server (FR-141), on the real service and
  PostgreSQL 18: the same card as a dbt manifest, and a dimension several views have is one name
  that links each view's member (CON-201).
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-10-08')
const registry = new ConnectorRegistry([
  createCubeSource({
    modelDir: fileURLToPath(new URL('../fixtures/cube/model/', import.meta.url)),
  }),
])
const app = buildApp({
  database,
  jobs: idleJobs(),
  sources: registry,
  logger,
  clock,
  devPeople: [{ name: 'admin', email: 'admin@example.test', roles: [] }],
})
const headers: Record<string, string> = {}

const call = (method: 'GET' | 'POST', path: string, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers, 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })

beforeAll(async () => {
  await foundation(client)
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'admin@example.test' },
  })
  expect(response.statusCode, response.body).toBe(200)
  headers.origin = 'http://localhost'
  headers.cookie = response.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  headers['x-heed-csrf'] = response.json<{ csrfToken: string }>().csrfToken
  await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })
}, 120_000)
afterAll(() => app.close())

describe('a read of a Cube model', () => {
  it('makes names that one press makes live, with a shared dimension as one name', async () => {
    const read = await call('GET', '/inbox/names')
    expect(read.statusCode, read.body).toBe(200)
    const { revision, names } = read.json<NamesRead>()
    const ready = names.filter((name) => name.state === 'ready')
    expect(ready.length).toBeGreaterThan(0)
    const decided = await call('POST', '/inbox/names/decide', {
      revision,
      accept: ready.map(({ key }) => ({ key })),
      leaveOut: [],
    })
    expect(decided.statusCode, decided.body).toBe(200)
    expect(decided.json<NamesDecision>().edition).not.toBeNull()
    const live = await client.query<{ key: string; refs: number }>(
      `select key,cardinality(definition_refs) as refs
         from serving_vocabulary((select seq from live_edition)) order by key`,
    )
    expect(live.rows.length).toBe(ready.length)
    const shared = ready.find((name) => name.kind === 'dimension')
    expect(live.rows.find((row) => row.key === shared?.key)?.refs).toBe(
      shared?.definitionRefs.length,
    )
    expect(live.rows.some((row) => row.refs > 1)).toBe(true)
  })
})
