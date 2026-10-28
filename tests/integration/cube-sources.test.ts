import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SourceCheck, SourceSettings } from '../../src/contract/sources.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createWorkspaceSources,
  openLocalSecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { gitHost, type GitHost } from '../server/connectors/git-server.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  Cube on connector interface 3.0, end to end on the real service and PostgreSQL 18, with a Git
  host on this machine that wants a token: an admin tests a Cube model in a repository, adds it
  with a schedule of its own, and the sources' job reads it through the Cube connector's runtime,
  its worker and the definitions pipeline. Each source is read on its own schedule and backs off
  after a failure that clears by itself (CON-115). A read only says which definitions exist and
  flags what relies on them: it never publishes, decides or suggests anything (I-2).
*/

const TOKEN = 'cube-it-token-3e8a51c4'
const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-10-08')
const secretsDir = await mkdtemp(join(tmpdir(), 'heed-cube-secrets-'))
const store = await openLocalSecretStore(join(secretsDir, 'store'))
const registry = new ConnectorRegistry([], { secrets: store })
const app = buildApp({
  database,
  jobs: idleJobs(),
  sources: registry,
  workspaceSources: createWorkspaceSources({ secrets: store, registry }),
  logger,
  clock,
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
let host: GitHost
let model = ''
type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}

const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const ok = async <T>(
  response: Promise<{ statusCode: number; body: string; json: <U>() => U }>,
  status = 200,
) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(status)
  return r.json<T>()
}

/** One run of the sources' job: it reads the sources that are due, and only those. */
const run = () =>
  connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  }) as Promise<{ connectors: Record<string, Record<string, unknown>> }>

/** The source's next read, in seconds from now, and its failures in a row. */
const schedule = async (id: string) => {
  const [row] = (
    await client.query<{ wait: number; failures: number }>(
      `select extract(epoch from next_read_at - now())::int as wait, failures
         from connectors where id = $1`,
      [id],
    )
  ).rows
  return row!
}

/** What a read could publish, decide or suggest: none of it moves. */
const published = async () =>
  (
    await client.query(
      `select (select max(seq) from editions)::text as editions,
              (select count(*) from item_versions)::text as versions,
              (select count(*) from item_version_service)::text as served,
              (select count(*) from decisions)::text as decisions,
              (select count(*) from proposals)::text as proposals`,
    )
  ).rows[0] as Record<string, string>

const config = () => ({
  repository: host.address('analytics'),
  ref: 'main',
  folder: 'cube/model',
  domainNames: { commerce: 'finance' },
})

let sourceId = ''

beforeAll(async () => {
  await foundation(client)
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
  model = await readFile(new URL('../fixtures/cube/model.yml', import.meta.url), 'utf8')
  host = await gitHost({ token: TOKEN })
  await host.repository('analytics', { 'cube/model/model.yml': model, 'README.md': '# Model' })
}, 120_000)
afterAll(async () => {
  await app.close()
  await host.close()
  await rm(secretsDir, { recursive: true, force: true })
})

describe('a Cube model in Git, on interface 3', () => {
  it('is tested step by step, then read once and kept nowhere', async () => {
    const types = await ok<{ writtenTo: number; manifest: { id: string; kind: string } }[]>(
      call('GET', '/sources/types', 'admin'),
    )
    expect(types.find((type) => type.manifest.id === 'cube')).toMatchObject({
      writtenTo: 3,
      manifest: { kind: 'definitions' },
    })
    const check = await ok<SourceCheck>(
      call('POST', '/sources/test', 'admin', {
        type: 'cube',
        config: config(),
        secrets: { token: TOKEN },
      }),
    )
    expect(check).toMatchObject({ ok: true, complete: true, views: 4, metrics: 5, dimensions: 2 })
    expect(check.steps.map((step) => [step.id, step.status])).toEqual([
      ['reach', 'ok'],
      ['files', 'ok'],
    ])
    expect(JSON.stringify(check)).not.toContain(TOKEN)
    // A token the host refuses says why in a code, as a read does.
    const refused = await ok<SourceCheck>(
      call('POST', '/sources/test', 'admin', {
        type: 'cube',
        config: config(),
        secrets: { token: 'not-the-token' },
      }),
    )
    expect(refused).toMatchObject({
      ok: false,
      warnings: [{ code: 'unauthorized', target: host.address('analytics') }],
    })
    expect(
      (await client.query("select count(*)::int as n from definitions where ref like 'cube:%'"))
        .rows[0],
    ).toEqual({ n: 0 })
  }, 120_000)

  it('is added with a schedule of its own, and read through its runtime', async () => {
    const added = await ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        type: 'cube',
        name: 'Analytics model',
        config: config(),
        secrets: { token: TOKEN },
        schedule: 'PT30M',
        reason: 'Read the analytics model from Git',
      }),
      201,
    )
    sourceId = added.id
    expect(added).toMatchObject({ type: 'cube', schedule: 'PT30M', nextReadAt: null })
    const [row] = (
      await client.query<{ interface_version: number; kind: string }>(
        'select interface_version, kind::text from connectors where id = $1',
        [sourceId],
      )
    ).rows
    expect(row).toEqual({ interface_version: 3, kind: 'definition_source' })
    // At or above the connector's minimum, and often enough not to go out of date.
    for (const schedule of ['PT5M', 'PT12H'])
      expect(
        (
          await call('PUT', `/sources/${sourceId}`, 'admin', {
            id: sourceId,
            revision: added.revision,
            name: added.name,
            config: config(),
            secrets: {},
            schedule,
            reason: 'Try another schedule',
          })
        ).statusCode,
      ).toBe(422)

    const before = await published()
    const result = await run()
    expect(result.connectors[sourceId]).toMatchObject({ status: 'ok', definitionsSeen: 7 })
    const stored = await client.query<{ ref: string; area_hint: string | null }>(
      'select ref, area_hint from definitions where connector_id = $1 order by ref',
      [sourceId],
    )
    expect(stored.rows).toHaveLength(7)
    // The domain names map the model's `commerce` to the domain `finance`.
    expect(stored.rows.find((d) => d.ref === 'cube:sales.count')?.area_hint).toBe('finance')
    const [snapshot] = (
      await client.query<{ source_version: string; cursor: string; status: string }>(
        `select source_version, cursor, status::text from connector_snapshots
          where connector_id = $1 order by fetched_at desc limit 1`,
        [sourceId],
      )
    ).rows
    expect(snapshot).toMatchObject({ status: 'ok' })
    expect(snapshot!.cursor).toBe(snapshot!.source_version)
    // A read never publishes, decides or suggests (I-2).
    expect(await published()).toEqual(before)
  }, 120_000)

  it('is read on its own schedule, and only when it is due (CON-115)', async () => {
    const { wait, failures } = await schedule(sourceId)
    expect(failures).toBe(0)
    expect(wait).toBeGreaterThan(30 * 60 - 120)
    expect(wait).toBeLessThanOrEqual(30 * 60)
    // Not due: the job reads the other sources, and not this one.
    expect((await run()).connectors[sourceId]).toBeUndefined()
  }, 120_000)

  it('backs off after a failure that clears by itself, and reads again once it clears', async () => {
    const current = await ok<SourceSettings>(call('GET', `/sources/${sourceId}`, 'admin'))
    const change = (repository: string, secrets: Record<string, string>) =>
      ok<SourceSettings>(
        call('PUT', `/sources/${sourceId}`, 'admin', {
          id: sourceId,
          revision: current.revision,
          name: current.name,
          config: { ...config(), repository },
          secrets,
          reason: 'Move the model',
        }),
      )
    const moved = await change('http://127.0.0.1:9/nothing.git', {})
    expect((await run()).connectors[sourceId]).toMatchObject({ status: 'failed' })
    // A host that could not be reached is tried again after a minute, then two.
    expect(await schedule(sourceId)).toMatchObject({ failures: 1 })
    expect((await schedule(sourceId)).wait).toBeLessThanOrEqual(60)
    await client.query('update connectors set next_read_at = now() where id = $1', [sourceId])
    expect((await run()).connectors[sourceId]).toMatchObject({ status: 'failed' })
    expect(await schedule(sourceId)).toMatchObject({ failures: 2 })
    expect((await schedule(sourceId)).wait).toBeGreaterThan(60)
    expect((await schedule(sourceId)).wait).toBeLessThanOrEqual(120)
    // The definitions it read stay as they were: a failed read changes nothing (CON-213).
    expect(
      (
        await client.query(
          'select count(*)::int as n from definitions where connector_id = $1 and missing_since_snapshot is null',
          [sourceId],
        )
      ).rows[0],
    ).toEqual({ n: 7 })
    await ok<SourceSettings>(
      call('PUT', `/sources/${sourceId}`, 'admin', {
        id: sourceId,
        revision: moved.revision,
        name: moved.name,
        config: config(),
        secrets: { token: TOKEN },
        reason: 'Back to the model',
      }),
    )
    expect((await run()).connectors[sourceId]).toMatchObject({ status: 'ok' })
    expect(await schedule(sourceId)).toMatchObject({ failures: 0 })
  }, 180_000)

  it('moves only the marks whose meaning changed, and never publishes (I-2)', async () => {
    const marks = async () =>
      (
        await client.query<{ ref: string; change_mark: string }>(
          'select ref, change_mark from definitions where connector_id = $1 order by ref',
          [sourceId],
        )
      ).rows
    const before = await published()
    const first = await marks()
    await host.commit('analytics', {
      'cube/model/model.yml': model.replace('sql: amount', 'sql: amount * 2'),
    })
    await client.query('update connectors set next_read_at = null where id = $1', [sourceId])
    expect((await run()).connectors[sourceId]).toMatchObject({ status: 'ok' })
    const second = await marks()
    const changed = second.filter(
      (definition, index) => definition.change_mark !== first[index]!.change_mark,
    )
    expect(changed.map((definition) => definition.ref)).toContain('cube:sales.revenue')
    expect(changed.map((definition) => definition.ref)).not.toContain('cube:sales.country')
    // A changed calculation moves marks; nothing is published, decided or suggested.
    expect(await published()).toEqual(before)
  }, 120_000)
})
