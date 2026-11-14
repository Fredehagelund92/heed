import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SourceCheck, SourceSettings } from '../../src/contract/sources.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createWorkspaceSources,
  noSecretStore,
  openLocalSecretStore,
  type SecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { legacyManifest } from '../server/connectors/dbt-metricflow-fixture.ts'
import { objectHost, type ObjectHost } from '../server/connectors/object-server.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  Connecting a tool that needs a secret, on the real service and PostgreSQL 18. With the store
  compose.yaml sets up (tests/server/connectors/compose-secrets.test.ts checks its address), the
  dbt address route is tested, added, and read after the service starts again, from what the store
  kept. With no store, the service says so at the first step that reaches it, Test connection,
  and not at the last, after the test has passed. A route with no secret needs no store.
*/

const { client, url } = testDatabase()
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-10-08')
const keys = await mkdtemp(join(tmpdir(), 'heed-compose-keys-'))
await chmod(keys, 0o755)
const secretsDir = join(keys, 'secrets')

const serviceWith = (secrets: SecretStore) => {
  const registry = new ConnectorRegistry([], { secrets })
  // Its own connections: closing a service closes them.
  const database = apiDatabase(url)
  const app = buildApp({
    database,
    jobs: idleJobs(),
    sources: registry,
    workspaceSources: createWorkspaceSources({ secrets, registry }),
    logger,
    clock,
    devPeople: Object.keys(people).map((name) => ({
      name,
      email: `${name}@example.test`,
      roles: [],
    })),
  })
  return { app, registry, database }
}
const first = serviceWith(await openLocalSecretStore(secretsDir))
const without = serviceWith(noSecretStore)
let objects: ObjectHost

async function adminOf(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'admin@example.test' },
  })
  expect(response.statusCode, response.body).toBe(200)
  const headers = {
    origin: 'http://localhost',
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
  }
  return (method: 'GET' | 'POST' | 'PUT', path: string, payload?: object) =>
    app.inject({
      method,
      url: '/api/v1' + path,
      headers: { ...headers, 'idempotency-key': randomUUID() },
      ...(payload ? { payload } : {}),
    })
}

beforeAll(async () => {
  await foundation(client)
  objects = await objectHost()
  objects.put('/link/shop.json', JSON.stringify(legacyManifest))
}, 120_000)
afterAll(async () => {
  await first.app.close()
  await without.app.close()
  await objects.close()
  await rm(keys, { recursive: true, force: true })
})

const addressRoute = () => ({
  type: 'dbt-metricflow',
  config: { location: 'address' },
  secrets: { fileAddress: objects.link('/link/shop.json') },
})

const gitRoute = {
  location: 'git',
  repository: 'https://git.example/shop.git',
  ref: 'main',
  file: 'target/semantic_manifest.json',
}

describe('the store compose sets up', () => {
  it('keeps a connector secret, and a new service reads the source with it', async () => {
    const call = await adminOf(first.app)
    const test = await call('POST', '/sources/test', addressRoute())
    expect(test.statusCode, test.body).toBe(200)
    expect(test.json<SourceCheck>()).toMatchObject({ ok: true, metrics: 12 })
    const added = await call('POST', '/sources', {
      ...addressRoute(),
      name: 'Shop metrics',
      reason: 'Our pipeline uploads the file',
    })
    expect(added.statusCode, added.body).toBe(201)
    const { id } = added.json<SourceSettings>()

    // The container made again: the same folder, a new store, a new service.
    const second = serviceWith(await openLocalSecretStore(secretsDir))
    try {
      const shown = await (await adminOf(second.app))('GET', `/sources/${id}`)
      expect(shown.json<SourceSettings>().secrets).toContainEqual({
        key: 'fileAddress',
        set: true,
      })
      const result = (await connectorSyncJob(second.registry, { clock }).run({
        database: second.database,
        logger,
        signal: new AbortController().signal,
      })) as { connectors: Record<string, Record<string, unknown>> }
      expect(result.connectors[id]).toMatchObject({ status: 'ok', definitionsSeen: 19 })
    } finally {
      await second.app.close()
    }
  }, 120_000)
})

describe('a server with no secret store', () => {
  it('says so in the list of connectors, before any form is filled in', async () => {
    const listed = async (app: ReturnType<typeof buildApp>) =>
      (await (await adminOf(app))('GET', '/sources/types')).json<{ secretStore: boolean }[]>()
    expect((await listed(without.app)).every((c) => c.secretStore === false)).toBe(true)
    expect((await listed(first.app)).every((c) => c.secretStore === true)).toBe(true)
  })

  it('refuses at Test connection, in plain words, and reads nothing', async () => {
    const call = await adminOf(without.app)
    const reads = objects.requests.length
    const response = await call('POST', '/sources/test', addressRoute())
    expect(response.statusCode, response.body).toBe(422)
    expect(response.json<{ message: string }>().message).toBe(
      "There's no secret store, so we can't keep a secret. Ask the person who hosts this app to set one up. For the host: set HEED_SECRETS_DIR.",
    )
    expect(objects.requests.length).toBe(reads)
  })

  it('refuses a route whose secret is still empty, and one with an optional token given', async () => {
    const call = await adminOf(without.app)
    for (const [config, secrets] of [
      [{ location: 'address' }, {}],
      [gitRoute, { token: 'y'.repeat(10) }],
    ]) {
      const response = await call('POST', '/sources/test', {
        type: 'dbt-metricflow',
        config,
        secrets,
      })
      expect(response.statusCode, response.body).toBe(422)
      expect(response.body).toContain('HEED_SECRETS_DIR')
      expect(response.body).not.toContain('y'.repeat(10))
    }
  })

  it('says it once on a field, not again that the secret is missing', async () => {
    const call = await adminOf(without.app)
    const response = await call('POST', '/sources', {
      type: 'dbt-metricflow',
      name: 'Shop metrics',
      config: { location: 'address' },
      secrets: {},
      reason: 'Our pipeline uploads the file',
    })
    expect(response.statusCode, response.body).toBe(422)
    expect(response.body).toContain('HEED_SECRETS_DIR')
    expect(response.body).not.toContain('Give the')
  })

  it('still lets a source that keeps its secret be renamed', async () => {
    const call = await adminOf(first.app)
    const added = await call('POST', '/sources', {
      ...addressRoute(),
      name: 'Shop metrics, kept',
      reason: 'Our pipeline uploads the file',
    })
    expect(added.statusCode, added.body).toBe(201)
    const saved = added.json<SourceSettings>()
    const reading = await openLocalSecretStore(secretsDir)
    const readOnly = serviceWith({ ...reading, available: false, read: (ref) => reading.read(ref) })
    try {
      const renamed = await (
        await adminOf(readOnly.app)
      )('PUT', `/sources/${saved.id}`, {
        revision: saved.revision,
        name: 'Shop metrics, renamed',
        config: { location: 'address' },
        secrets: {},
        reason: 'A clearer name',
      })
      expect(renamed.statusCode, renamed.body).toBe(200)
      expect(renamed.json<SourceSettings>().name).toBe('Shop metrics, renamed')
    } finally {
      await readOnly.app.close()
    }
  }, 120_000)

  it('does not stand in the way of a route with no secret', async () => {
    const call = await adminOf(without.app)
    const response = await call('POST', '/sources/test', {
      type: 'dbt-metricflow',
      config: gitRoute,
      secrets: {},
    })
    // The test runs, and says what it found at that address: nothing of the store.
    expect(response.statusCode, response.body).toBe(200)
    expect(response.body).not.toContain('HEED_SECRETS_DIR')
  })
})
