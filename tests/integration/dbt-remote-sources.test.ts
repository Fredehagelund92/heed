import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createRawServer, type Server as RawServer, type Socket } from 'node:net'
import { Writable } from 'node:stream'
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
import { legacyManifest, withChangedRevenue } from '../server/connectors/dbt-metricflow-fixture.ts'
import { objectHost, type ObjectHost } from '../server/connectors/object-server.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  dbt MetricFlow's address and storage routes end to end on the real service and PostgreSQL 18,
  with an object store on this machine: an admin tests a file and adds it, its signed link or key
  stays in the secret store and nowhere else, a file that has not changed is not read again and
  changes nothing, and a change of settings reads it again.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const logged: string[] = []
const logger = createLogger({
  level: 'trace',
  destination: new Writable({
    write(chunk: Buffer, _encoding, done) {
      logged.push(chunk.toString())
      done()
    },
  }),
})
const clock = systemClock('2026-10-08')
const secretsDir = await mkdtemp(join(tmpdir(), 'heed-dbt-remote-'))
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
let objects: ObjectHost
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

/** One run of the sources' job, with the source made due. */
async function read(id: string) {
  await client.query('update connectors set next_read_at = null where id = $1', [id])
  const result = (await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })) as { connectors: Record<string, Record<string, unknown>> }
  return result.connectors[id]
}

/** Every place a secret could leak to, as text: rows, the history log, retries, snapshots. */
async function kept(): Promise<string> {
  await client.query('reset role')
  const tables = [
    'connectors',
    'audit_log',
    'idempotency_keys',
    'connector_snapshots',
    'definitions',
  ]
  const rows: string[] = []
  for (const table of tables)
    rows.push(JSON.stringify((await client.query(`select * from ${table}`)).rows))
  return rows.join('\n')
}

const snapshots = async (id: string) =>
  (
    await client.query<{
      id: string
      status: string
      definitions_seen: number
      source_version: string
      warnings: unknown
    }>(
      `select id, status, definitions_seen, source_version, warnings from connector_snapshots
        where connector_id = $1 order by fetched_at`,
      [id],
    )
  ).rows

const seen = async (id: string) =>
  (
    await client.query<{ last_seen_snapshot: string; missing: boolean }>(
      `select last_seen_snapshot, missing_since_snapshot is not null as missing
         from definitions where connector_id = $1`,
      [id],
    )
  ).rows

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
  objects = await objectHost()
  objects.put('/link/shop.json', JSON.stringify(legacyManifest))
  objects.put('/bucket/dbt/shop.json', JSON.stringify(legacyManifest))
}, 120_000)
afterAll(async () => {
  await app.close()
  await objects.close()
  await rm(secretsDir, { recursive: true, force: true })
})

let source: SourceSettings

describe('a semantic manifest at a signed link', () => {
  const signature = () => new URL(objects.link('/link/shop.json')).searchParams.get('sig')!

  it('is tested with what a read would hold, and the test keeps nothing', async () => {
    const before = await kept()
    const check = await ok<SourceCheck>(
      call('POST', '/sources/test', 'admin', {
        type: 'dbt-metricflow',
        config: { location: 'address' },
        secrets: { fileAddress: objects.link('/link/shop.json') },
      }),
    )
    expect(check).toMatchObject({ ok: true, complete: true, metrics: 12, dimensions: 7 })
    expect(check.warnings.map((warning) => warning.code)).toContain('missing_domain')
    expect(JSON.stringify(check)).not.toContain(signature())
    expect(await kept()).toBe(before)
  })

  it('needs its address, and takes no secret of another route', async () => {
    const add = (secrets: Record<string, string>) =>
      call('POST', '/sources', 'admin', {
        type: 'dbt-metricflow',
        name: 'Shop metrics',
        config: { location: 'address' },
        secrets,
        reason: 'Our pipeline uploads the file',
      })
    expect((await add({})).body).toContain('Give the file address.')
    expect((await add({ fileAddress: 'x'.repeat(10), token: 'y'.repeat(10) })).body).toContain(
      'These settings do not use this secret.',
    )
  })

  it('refuses an address Heed may not fetch when it is given, on its own field, without saying it', async () => {
    const plain = 'http://files.example.com/semantic_manifest.json?sig=topsecretvalue'
    const body = (path: string) =>
      call('POST', path, 'admin', {
        type: 'dbt-metricflow',
        config: { location: 'address' },
        secrets: { fileAddress: plain },
        ...(path === '/sources'
          ? { name: 'Shop metrics', reason: 'Our pipeline uploads the file' }
          : {}),
      })
    for (const path of ['/sources', '/sources/test']) {
      const response = await body(path)
      expect(response.statusCode).toBe(422)
      expect(response.body).toContain('fileAddress')
      expect(response.body).toContain('https')
      expect(response.body).not.toContain('topsecretvalue')
    }
  })

  it('refuses a test with a secret the settings do not use', async () => {
    const response = await call('POST', '/sources/test', 'admin', {
      type: 'dbt-metricflow',
      config: { location: 'address' },
      secrets: { fileAddress: objects.link('/link/shop.json'), token: 'y'.repeat(10) },
    })
    expect(response.statusCode).toBe(422)
    expect(response.body).toContain('These settings do not use this secret.')
  })

  it('keeps the link in the secret store only, and says only that it is set', async () => {
    source = await ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        type: 'dbt-metricflow',
        name: 'Shop metrics',
        config: { location: 'address' },
        secrets: { fileAddress: objects.link('/link/shop.json') },
        reason: 'Our pipeline uploads the file',
      }),
      201,
    )
    expect(source.secrets).toContainEqual({ key: 'fileAddress', set: true })
    expect(await read(source.id)).toMatchObject({ status: 'ok', definitionsSeen: 19 })
    const shown = await ok<SourceSettings>(call('GET', `/sources/${source.id}`, 'admin'))
    expect(JSON.stringify(shown)).not.toContain(signature())
    expect(await kept()).not.toContain(signature())
    expect(logged.join('')).not.toContain(signature())
    const files = await readdir(join(secretsDir, 'store'))
    const held = await Promise.all(
      files.map((file) => readFile(join(secretsDir, 'store', file), 'utf8')),
    )
    expect(held.join('')).toContain(signature())
  }, 120_000)

  it('asks whether the file changed, and rests on the last read when it has not', async () => {
    const [first] = await snapshots(source.id)
    const before = objects.requests.filter((r) => r.status === 200).length
    expect(await read(source.id)).toMatchObject({ status: 'ok', definitionsSeen: 19 })
    expect(objects.requests.filter((r) => r.status === 200).length).toBe(before)
    expect(objects.requests.at(-1)).toMatchObject({ status: 304 })
    const [, second] = await snapshots(source.id)
    expect(second).toMatchObject({
      status: 'ok',
      definitions_seen: first!.definitions_seen,
      source_version: first!.source_version,
      warnings: first!.warnings,
    })
    const definitions = await seen(source.id)
    expect(definitions.length).toBe(19)
    expect(definitions.every((d) => d.last_seen_snapshot === second!.id && !d.missing)).toBe(true)
  }, 120_000)

  it('reads a changed file in full, and the source’s page shows every read', async () => {
    objects.put('/link/shop.json', JSON.stringify(withChangedRevenue(legacyManifest)))
    expect(await read(source.id)).toMatchObject({ status: 'ok', definitionsSeen: 19 })
    const versions = (await snapshots(source.id)).map((row) => row.source_version)
    expect(new Set(versions).size).toBe(2)
  }, 120_000)

  it('reads again after its settings change, whatever the host says of the file', async () => {
    const current = await ok<SourceSettings>(call('GET', `/sources/${source.id}`, 'admin'))
    await ok(
      call('PUT', `/sources/${source.id}`, 'admin', {
        id: source.id,
        revision: current.revision,
        name: current.name,
        config: { ...current.config, domainNames: { sales: 'finance' } },
        secrets: {},
        reason: 'Sales is finance here',
      }),
    )
    const before = objects.requests.length
    expect(await read(source.id)).toMatchObject({ status: 'ok', definitionsSeen: 19 })
    expect(objects.requests.slice(before)).toMatchObject([{ status: 200, ifNoneMatch: null }])
  }, 120_000)

  it('forgets the link when the source moves to another route', async () => {
    const current = await ok<SourceSettings>(call('GET', `/sources/${source.id}`, 'admin'))
    const moved = await ok<SourceSettings>(
      call('PUT', `/sources/${source.id}`, 'admin', {
        id: source.id,
        revision: current.revision,
        name: current.name,
        config: {
          location: 'storage',
          provider: 's3-compatible',
          objectAddress: objects.address('/bucket/dbt/shop.json'),
        },
        secrets: { accessKey: objects.accessKey, secretKey: objects.secretKey },
        reason: 'The file moved to a bucket',
      }),
    )
    expect(moved.secrets).toContainEqual({ key: 'fileAddress', set: false })
    expect(moved.secrets).toContainEqual({ key: 'secretKey', set: true })
    const held = await Promise.all(
      (await readdir(join(secretsDir, 'store'))).map((file) =>
        readFile(join(secretsDir, 'store', file), 'utf8'),
      ),
    )
    expect(held.join('')).not.toContain(signature())
    expect(await read(source.id)).toMatchObject({ status: 'ok', definitionsSeen: 19 })
    expect(await kept()).not.toContain(objects.secretKey)
    expect(logged.join('')).not.toContain(objects.secretKey)
  }, 120_000)

  it('will not move to a route without that route’s secret', async () => {
    const current = await ok<SourceSettings>(call('GET', `/sources/${source.id}`, 'admin'))
    const response = await call('PUT', `/sources/${source.id}`, 'admin', {
      id: source.id,
      revision: current.revision,
      name: current.name,
      config: { location: 'address' },
      secrets: {},
      reason: 'Back to a link',
    })
    expect(response.body).toContain('Give the file address.')
  })
})

/*
  Hardening, on the same service: a host that misbehaves fails a read safely. The service answers
  afterwards, nothing is kept from the failed read, and no secret is in an answer, a row or a log
  line. The raw listener below is a second port on this machine, the one a redirect must not reach.
*/
describe('a host that misbehaves', () => {
  let raw: RawServer
  let rawPort = 0
  const rawHeads: string[] = []
  const sockets = new Set<Socket>()
  const rawAddress = (path: string) => `http://127.0.0.1:${rawPort}${path}`

  beforeAll(async () => {
    raw = createRawServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => {})
      socket.once('data', (chunk) => {
        const head = chunk.toString()
        rawHeads.push(head)
        socket.end('HTTP/1.1 700 Nope\r\nconnection: close\r\ncontent-length: 2\r\n\r\nno')
      })
    })
    await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve))
    rawPort = (raw.address() as { port: number }).port
  })
  afterAll(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => raw.close(() => resolve()))
  })

  const addByLink = async (name: string, link: string) =>
    ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        type: 'dbt-metricflow',
        name,
        config: { location: 'address' },
        secrets: { fileAddress: link },
        reason: 'Our pipeline uploads the file',
      }),
      201,
    )
  const testLink = (link: string) =>
    ok<SourceCheck>(
      call('POST', '/sources/test', 'admin', {
        type: 'dbt-metricflow',
        config: { location: 'address' },
        secrets: { fileAddress: link },
      }),
    )
  const nextReadAt = async (id: string) =>
    (
      await client.query<{ at: Date | null }>(
        'select next_read_at as at from connectors where id = $1',
        [id],
      )
    ).rows[0]!.at
  const stillAnswers = async () => {
    const listed = await call('GET', '/sources', 'admin')
    expect(listed.statusCode, listed.body).toBe(200)
  }

  it('[hardening 1] answers a status above 599: the service stays up and the read fails with a worded code', async () => {
    const link = `${rawAddress('/seven-hundred')}?sig=hundredsecret`
    const before = await kept()
    const check = await testLink(link)
    expect(check.ok).toBe(false)
    expect(check.warnings[0]).toMatchObject({ code: 'unreachable' })
    expect(JSON.stringify(check)).not.toContain('hundredsecret')
    expect(await kept()).toBe(before)
    const source = await addByLink('Seven hundred', link)
    expect(await read(source.id)).toMatchObject({ status: 'failed' })
    const rows = await snapshots(source.id)
    expect(rows.at(-1)).toMatchObject({ status: 'failed', definitions_seen: 0 })
    expect(await seen(source.id)).toHaveLength(0)
    expect(await kept()).not.toContain('hundredsecret')
    expect(logged.join('')).not.toContain('hundredsecret')
    await stillAnswers()
  }, 120_000)

  for (const value of ['315360000', '1e20']) {
    it(`[hardening 2] a Retry-After of ${value} is stored as a failed read, and the next read is soon`, async () => {
      const path = `/public/busy-${value}.json`
      objects.refuse(path, 429, value)
      const link = objects.address(path)
      const source = await addByLink(`Busy ${value}`, link)
      expect(await read(source.id)).toMatchObject({ status: 'failed' })
      expect((await snapshots(source.id)).at(-1)).toMatchObject({ status: 'failed' })
      const at = await nextReadAt(source.id)
      expect(at).toBeInstanceOf(Date)
      expect(Number.isNaN(at!.getTime())).toBe(false)
      expect(at!.getTime() - Date.now()).toBeLessThan(2 * 24 * 3_600_000)
      await stillAnswers()
    }, 120_000)
  }

  it('[hardening 3] a cursor left under other settings is not trusted: a full read with the new settings', async () => {
    // The shop source holds these names, so it is the one that reads: back at its link.
    const back = await ok<SourceSettings>(call('GET', `/sources/${source.id}`, 'admin'))
    await ok(
      call('PUT', `/sources/${source.id}`, 'admin', {
        id: source.id,
        revision: back.revision,
        name: back.name,
        config: { location: 'address' },
        secrets: { fileAddress: objects.link('/link/shop.json') },
        reason: 'Back to the link',
      }),
    )
    expect(await read(source.id)).toMatchObject({ status: 'ok', definitionsSeen: 19 })
    const left = (
      await client.query<{ cursor: string | null }>(
        'select cursor from connector_snapshots where connector_id = $1 order by fetched_at desc limit 1',
        [source.id],
      )
    ).rows[0]!.cursor
    expect(left).not.toBeNull()
    const current = await ok<SourceSettings>(call('GET', `/sources/${source.id}`, 'admin'))
    await ok(
      call('PUT', `/sources/${source.id}`, 'admin', {
        id: source.id,
        revision: current.revision,
        name: current.name,
        config: { ...current.config, domainNames: { sales: 'finance' } },
        secrets: {},
        reason: 'Sales is finance here',
      }),
    )
    // The snapshot is newer than the change, as a read on old settings leaves it: only the
    // settings the cursor was left under can tell it is stale.
    await client.query(
      `update connectors set changed_at = changed_at - interval '1 hour' where id = $1`,
      [source.id],
    )
    const before = objects.requests.length
    expect(await read(source.id)).toMatchObject({ status: 'ok', definitionsSeen: 19 })
    expect(objects.requests.slice(before)).toMatchObject([{ status: 200, ifNoneMatch: null }])
  }, 120_000)

  it('[hardening 4] a redirect to another port, or to a private or link-local address, is refused and never followed', async () => {
    const targets = [
      rawAddress('/seven-hundred'),
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/semantic_manifest.json',
    ]
    const asked = rawHeads.length
    for (const [index, target] of targets.entries()) {
      objects.redirect(`/bucket/dbt/moved-${index}.json`, target)
      const check = await ok<SourceCheck>(
        call('POST', '/sources/test', 'admin', {
          type: 'dbt-metricflow',
          config: {
            location: 'storage',
            provider: 's3-compatible',
            objectAddress: objects.address(`/bucket/dbt/moved-${index}.json`),
          },
          secrets: { accessKey: objects.accessKey, secretKey: objects.secretKey },
        }),
      )
      expect(check.ok).toBe(false)
      expect(check.warnings[0]!.code).toMatch(/^(redirect_refused|private_address)$/)
      expect(JSON.stringify(check)).not.toContain(objects.secretKey)
    }
    expect(rawHeads).toHaveLength(asked)
    expect(rawHeads.join('')).not.toMatch(/authorization/i)
    expect(logged.join('')).not.toContain(objects.secretKey)
    expect(await kept()).not.toContain(objects.secretKey)
    await stillAnswers()
  }, 120_000)

  it('[hardening 5] only reads reach the store: no write of any method arrived', () => {
    // The runtime asks for GET only; a DELETE, PUT or a POST to a host not declared for signing
    // in is refused in the core (tests/server/connectors/dbt-metricflow-hardening.test.ts), and
    // cannot be asked from a source, so what is provable at this level is what the host saw.
    expect(objects.requests.length).toBeGreaterThan(0)
    expect(objects.requests.every((request) => request.method === 'GET')).toBe(true)
  })
})
