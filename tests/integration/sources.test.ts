import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createCubeSource,
  createWorkspaceSources,
  openLocalSecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { readConnectors } from '../../src/server/modules/jobs/operations.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { gitHost, type GitHost } from '../server/connectors/git-server.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  Sources an administrator adds (connector interface v2), on the real service and PostgreSQL 18,
  with a real Git host on this machine that wants a token. The token goes into the secret store
  and nowhere else: no answer, no row, no history log entry, no retry record and no log line holds
  it. Only administrators reach any of it. The hourly read fetches the repository with the stored
  token, keeps the commit as the read's version and cursor, and leaves members another source
  already reads with that source.
*/

const TOKEN = 'sources-it-token-4b8e21c9'
const NEW_TOKEN = 'sources-it-token-rotated-77d0'
const encoded = (token: string) => Buffer.from(`x-access-token:${token}`).toString('base64')
const fixture = fileURLToPath(new URL('../fixtures/cube/model.yml', import.meta.url))
const ORIGIN = 'http://localhost'

const { client, url } = testDatabase({ seeded: true })
const database = apiDatabase(url)
const rawLog: string[] = []
const logger = createLogger({
  level: 'trace',
  destination: new Writable({
    write(chunk: Buffer, _encoding, done) {
      rawLog.push(chunk.toString())
      done()
    },
  }),
})
const secretsDir = await mkdtemp(join(tmpdir(), 'heed-sources-secrets-'))
const store = await openLocalSecretStore(join(secretsDir, 'store'))
// The server's own source reads the fixture model, so a Git source of the same model collides.
const registry = new ConnectorRegistry(
  [createCubeSource({ modelDir: fileURLToPath(new URL('../fixtures/cube/', import.meta.url)) })],
  { secrets: store },
)
const workspaceSources = createWorkspaceSources({ secrets: store, registry })
const app = buildApp({
  database,
  jobs: idleJobs(),
  sources: registry,
  workspaceSources,
  logger,
  clock: systemClock('2026-10-07'),
  devPeople: ['ravi', 'jon'].map((person) => ({
    email: `per_${person}@example.test`,
    name: person,
    roles: [],
  })),
})
let host: GitHost
let model: string
let commit: string
const sessions: Record<'ravi' | 'jon', { cookie: string; csrf: string }> = {
  ravi: { cookie: '', csrf: '' },
  jon: { cookie: '', csrf: '' },
}

let keys = 0
/** A new retry key, as the web binding makes one per intended change. */
const retryKey = () => ({ 'idempotency-key': (++keys).toString(16).padStart(32, '0') })

async function call(
  person: 'ravi' | 'jon' | null,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  const session = person ? sessions[person] : null
  const response = await app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      origin: ORIGIN,
      ...(session ? { cookie: session.cookie, 'x-heed-csrf': session.csrf } : {}),
      ...headers,
    },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  })
  return { status: response.statusCode, body: response.body }
}

/** Every place a secret could leak to, as text: rows, the history log, retries, snapshots. */
async function everythingKept(): Promise<string> {
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

const sourceInput = (repository: string, extra: Record<string, unknown> = {}) => ({
  type: 'cube',
  name: 'Analytics in Git',
  config: {
    repository,
    ref: 'main',
    folder: 'cube/model',
    modelUrl: 'https://git.example.test/analytics/tree/main/cube/model',
    domainNames: { finance: 'area_sandbox' },
  },
  secrets: { token: TOKEN },
  reason: 'Read the analytics model from Git',
  ...extra,
})

beforeAll(async () => {
  await client.query('reset role')
  for (const person of ['ravi', 'jon'] as const) {
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: ORIGIN, 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `per_${person}@example.test` },
    })
    if (signIn.statusCode !== 200) throw new Error(`Sign-in failed: ${signIn.body}`)
    const cookie = signIn.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    })
    sessions[person] = {
      cookie,
      csrf: (JSON.parse(session.body) as { csrfToken: string }).csrfToken,
    }
  }
  host = await gitHost({ token: TOKEN })
  model = await readFile(fixture, 'utf8')
  // The same model under other view names, so its members are its own.
  const own = model
    .replace('- name: sales', '- name: git_sales')
    .replace('- name: marketing', '- name: git_marketing')
    .replace('- name: operations', '- name: git_operations')
    .replace('- name: growth', '- name: git_growth')
  commit = await host.repository('analytics', { 'cube/model/model.yml': own })
  await host.repository('copy', { 'cube/model/model.yml': model })
}, 120_000)
afterAll(async () => {
  await app.close()
  await host.close()
  await rm(secretsDir, { recursive: true, force: true })
})

describe('sources an administrator adds', () => {
  it('are for administrators only: anyone else is refused every operation', async () => {
    const add = sourceInput(host.address('analytics'))
    const test = { type: 'cube', config: add.config, secrets: {} }
    for (const [person, status] of [
      ['jon', 403],
      [null, 401],
    ] as const) {
      expect((await call(person, 'GET', '/sources/types')).status).toBe(status)
      expect((await call(person, 'GET', '/sources/analytics-in-git')).status).toBe(status)
      expect((await call(person, 'POST', '/sources', add)).status).toBe(status)
      expect(
        (await call(person, 'PUT', '/sources/analytics-in-git', { ...add, revision: 1 })).status,
      ).toBe(status)
      expect((await call(person, 'POST', '/sources/test', test)).status).toBe(status)
    }
    expect(await readdir(join(secretsDir, 'store'))).toEqual([])
  })

  it('keeps the token in the secret store only: in no answer, row, entry, retry or log', async () => {
    const key = { 'idempotency-key': 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }
    const added = await call(
      'ravi',
      'POST',
      '/sources',
      sourceInput(host.address('analytics')),
      key,
    )
    expect(added.status).toBe(201)
    expect(JSON.parse(added.body)).toMatchObject({
      id: 'analytics-in-git',
      secrets: [{ key: 'token', set: true }],
    })
    // A retry after a lost answer is the same source, not a second one or a second secret.
    const again = await call(
      'ravi',
      'POST',
      '/sources',
      sourceInput(host.address('analytics')),
      key,
    )
    expect(again).toEqual(added)
    const files = await readdir(join(secretsDir, 'store'))
    expect(files).toHaveLength(1)
    const file = join(secretsDir, 'store', files[0]!)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await readFile(file, 'utf8')).toContain(TOKEN)
    const [row] = (
      await client.query<{ secret_ref: string; config: unknown; origin: string }>(
        "select secret_ref, config, origin from connectors where id='analytics-in-git'",
      )
    ).rows
    expect(row).toMatchObject({ origin: 'workspace' })
    expect(row!.secret_ref).toBe(`local:${files[0]!.replace(/\.json$/, '')}`)
    const read = await call('ravi', 'GET', '/sources/analytics-in-git')
    for (const text of [added.body, read.body, await everythingKept(), rawLog.join('')]) {
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain(encoded(TOKEN))
    }
  })

  it('refuses a change with problems or a stale revision without echoing the token', async () => {
    const invalid = await call(
      'ravi',
      'POST',
      '/sources',
      { ...sourceInput('http://git.example.test/analytics.git'), name: 'Broken' },
      retryKey(),
    )
    expect(invalid.status).toBe(422)
    // Malformed: too long a secret, and a field the API does not know.
    const long = 'x'.repeat(5000)
    const malformed = await call('ravi', 'POST', '/sources', {
      ...sourceInput(host.address('analytics')),
      secrets: { token: long },
    })
    expect(malformed.status).toBe(400)
    const unknown = await call('ravi', 'POST', '/sources', {
      ...sourceInput(host.address('analytics')),
      password: TOKEN,
    })
    expect(unknown.status).toBe(400)
    const { type: _type, ...change } = sourceInput(host.address('analytics'))
    const stale = await call('ravi', 'PUT', '/sources/analytics-in-git', {
      ...change,
      id: 'analytics-in-git',
      revision: 9,
      secrets: { token: NEW_TOKEN },
    })
    expect(stale.status).toBe(409)
    for (const response of [invalid, malformed, unknown, stale]) {
      expect(response.body).not.toContain(TOKEN)
      expect(response.body).not.toContain(NEW_TOKEN)
      expect(response.body).not.toContain(long.slice(0, 64))
    }
    // The refused change wrote no secret that stays.
    expect(await readdir(join(secretsDir, 'store'))).toHaveLength(1)
    expect(rawLog.join('')).not.toContain(TOKEN)
  })

  it('reads an added source every hour from Git with the stored token, as of a commit', async () => {
    const summary = await connectorSyncJob(registry).run({
      database,
      logger,
      signal: new AbortController().signal,
    })
    expect(summary.connectors).toMatchObject({
      cube: { status: 'ok' },
      'analytics-in-git': { status: 'ok', definitionsSeen: 7 },
    })
    const [snapshot] = (
      await client.query<{ source_version: string; cursor: string }>(
        "select source_version, cursor from connector_snapshots where connector_id='analytics-in-git'",
      )
    ).rows
    expect(snapshot).toEqual({ source_version: commit, cursor: commit })
    // The model's `finance` is the Heed domain the source's domain names give it.
    const domains = await client.query<{ ref: string; area_hint: string | null }>(
      "select ref, area_hint from definitions where connector_id='analytics-in-git' order by ref",
    )
    expect(domains.rows.find((row) => row.ref === 'cube:git_sales.revenue')?.area_hint).toBe(
      'area_sandbox',
    )
    const overview = (await readConnectors(database)).find(
      (source) => source.id === 'analytics-in-git',
    )
    expect(overview).toMatchObject({
      origin: 'workspace',
      status: 'ok',
      settingKeys: [],
      sourceVersion: commit,
    })
    // A test of the saved source uses the token the store holds.
    const test = await call('ravi', 'POST', '/sources/test', {
      id: 'analytics-in-git',
      type: 'cube',
      config: sourceInput(host.address('analytics')).config,
      secrets: {},
    })
    expect(JSON.parse(test.body)).toMatchObject({ ok: true, version: commit, views: 4 })
    expect(rawLog.join('')).not.toContain(TOKEN)
  }, 60_000)

  it('replaces the token: the next read uses the new one, and the old one is forgotten', async () => {
    const files = await readdir(join(secretsDir, 'store'))
    const { type: _type, ...change } = sourceInput(host.address('analytics'))
    const changed = await call('ravi', 'PUT', '/sources/analytics-in-git', {
      ...change,
      id: 'analytics-in-git',
      revision: 1,
      secrets: { token: NEW_TOKEN },
      reason: 'Rotate the token',
    })
    expect(changed.status).toBe(200)
    expect(JSON.parse(changed.body)).toMatchObject({
      revision: 2,
      secrets: [{ key: 'token', set: true }],
    })
    const after = await readdir(join(secretsDir, 'store'))
    expect(after).toHaveLength(1)
    expect(after).not.toEqual(files)
    expect(await readFile(join(secretsDir, 'store', after[0]!), 'utf8')).toContain(NEW_TOKEN)
    // The host still wants the old token, so the new one is refused, and the read says why.
    await connectorSyncJob(registry).run({ database, logger, signal: new AbortController().signal })
    const [failed] = (
      await client.query<{ status: string; warnings: unknown }>(
        `select status::text, warnings from connector_snapshots where connector_id='analytics-in-git'
         order by fetched_at desc limit 1`,
      )
    ).rows
    expect(failed).toEqual({
      status: 'failed',
      warnings: [{ code: 'unauthorized', target: host.address('analytics') }],
    })
    // A failed read changes nothing: the members are still there.
    expect(
      (
        await client.query(
          "select 1 from definitions where connector_id='analytics-in-git' and missing_since_snapshot is null",
        )
      ).rowCount,
    ).toBe(7)
    const text = [await everythingKept(), rawLog.join('')].join('\n')
    expect(text).not.toContain(NEW_TOKEN)
    expect(text).not.toContain(encoded(NEW_TOKEN))
  }, 60_000)

  it('never sends a stored token to another address: a test or a change there forgets it', async () => {
    const before = await readdir(join(secretsDir, 'store'))
    // A test of the saved source at another address does not send the stored token there.
    host.requests.length = 0
    const elsewhere = { repository: host.address('copy'), ref: 'main', folder: 'cube/model' }
    const test = await call('ravi', 'POST', '/sources/test', {
      id: 'analytics-in-git',
      type: 'cube',
      config: elsewhere,
      secrets: {},
    })
    expect(JSON.parse(test.body)).toMatchObject({
      ok: false,
      warnings: [{ code: 'unauthorized', target: host.address('copy') }],
    })
    expect(host.requests.length).toBeGreaterThan(0)
    expect(host.requests.every((request) => request.authorization === null)).toBe(true)

    // A change of address without a token forgets the stored one, and the log says so.
    const { type: _type, ...change } = sourceInput(host.address('copy'))
    const moved = await call('ravi', 'PUT', '/sources/analytics-in-git', {
      ...change,
      id: 'analytics-in-git',
      revision: 2,
      secrets: {},
      reason: 'Read the copy',
    })
    expect(moved.status).toBe(200)
    expect(JSON.parse(moved.body)).toMatchObject({ secrets: [{ key: 'token', set: false }] })
    expect(before).toHaveLength(1)
    expect(await readdir(join(secretsDir, 'store'))).toEqual([])
    const [entry] = (
      await client.query<{ details: { secrets: unknown } }>(
        "select details from audit_log where action='source.changed' order by seq desc limit 1",
      )
    ).rows
    expect(entry!.details.secrets).toEqual({ token: 'removed' })
    // Back at its address with the token given again, it reads.
    const { type: _again, ...home } = sourceInput(host.address('analytics'))
    const back = await call('ravi', 'PUT', '/sources/analytics-in-git', {
      ...home,
      id: 'analytics-in-git',
      revision: 3,
      secrets: { token: TOKEN },
      reason: 'Back to the model',
    })
    expect(back.status).toBe(200)
    expect(await readdir(join(secretsDir, 'store'))).toHaveLength(1)
  }, 60_000)

  it('leaves members another source already reads with it, and says so', async () => {
    const added = await call(
      'ravi',
      'POST',
      '/sources',
      {
        ...sourceInput(host.address('copy')),
        name: 'Copy of the local model',
        config: { repository: host.address('copy'), ref: 'main', folder: 'cube/model' },
      },
      retryKey(),
    )
    expect(added.status).toBe(201)
    const test = JSON.parse(
      (
        await call('ravi', 'POST', '/sources/test', {
          type: 'cube',
          config: { repository: host.address('copy'), ref: 'main', folder: 'cube/model' },
          secrets: { token: TOKEN },
        })
      ).body,
    ) as { ok: boolean; complete: boolean; warnings: { code: string }[] }
    expect(test.ok).toBe(true)
    expect(test.complete).toBe(false)
    expect(test.warnings.filter((warning) => warning.code === 'taken')).toHaveLength(7)
    const summary = await connectorSyncJob(registry).run({
      database,
      logger,
      signal: new AbortController().signal,
    })
    expect(summary.connectors).toMatchObject({
      'copy-of-the-local-model': { status: 'partial', definitionsSeen: 0 },
    })
    // They stay with the server's source; the copy holds none of them.
    const owners = await client.query<{ connector_id: string }>(
      `select distinct connector_id from definitions where ref like 'cube:sales.%'`,
    )
    expect(owners.rows).toEqual([{ connector_id: 'cube' }])
  }, 60_000)
})

describe('a source of a connector written to interface 3', () => {
  const entries = [
    { kind: 'metric', name: 'payments.orders', title: 'Orders', domain: 'Finance' },
    { kind: 'dimension', name: 'payments.market', title: 'Market' },
  ]
  const input = (list: unknown[]) => ({
    name: 'Finance list',
    config: { definitions: JSON.stringify(list), domainNames: { Finance: 'area_sandbox' } },
    secrets: {},
    reason: 'Try a static list',
  })

  it('lists, tests, adds and reads a static list end to end, through the one pipeline', async () => {
    const listed = JSON.parse((await call('ravi', 'GET', '/sources/types')).body) as {
      writtenTo: number
      manifest: { id: string }
    }[]
    expect(listed.map((listing) => [listing.manifest.id, listing.writtenTo])).toEqual([
      ['static-definitions', 3],
      ['git-markdown', 3],
      ['cube', 2],
    ])
    const test = await call('ravi', 'POST', '/sources/test', {
      type: 'static-definitions',
      config: input(entries).config,
      secrets: {},
    })
    expect(JSON.parse(test.body)).toMatchObject({
      ok: true,
      complete: true,
      metrics: 1,
      dimensions: 1,
      steps: [
        { id: 'read', status: 'ok' },
        { id: 'domains', status: 'ok' },
      ],
    })
    const refused = await call(
      'ravi',
      'POST',
      '/sources',
      { type: 'static-definitions', ...input([{ kind: 'metric' }]) },
      retryKey(),
    )
    expect(refused.status).toBe(422)
    expect(refused.body).toContain('Entry 1 needs a name')
    const added = await call(
      'ravi',
      'POST',
      '/sources',
      { type: 'static-definitions', ...input(entries) },
      retryKey(),
    )
    expect(added.status).toBe(201)
    const [row] = (
      await client.query<Record<string, unknown>>(
        "select type, kind::text, interface_version, secret_ref from connectors where id='finance-list'",
      )
    ).rows
    expect(row).toEqual({
      type: 'static-definitions',
      kind: 'definition_source',
      interface_version: 3,
      secret_ref: null,
    })

    const sync = () =>
      connectorSyncJob(registry).run({ database, logger, signal: new AbortController().signal })
    expect((await sync()).connectors).toMatchObject({
      'finance-list': { status: 'ok', definitionsSeen: 2 },
    })
    const stored = async () =>
      (
        await client.query<{
          ref: string
          area_hint: string | null
          change_mark: string
          missing: boolean
        }>(
          `select ref, area_hint, change_mark, missing_since_snapshot is not null as missing
             from definitions where connector_id='finance-list' order by ref`,
        )
      ).rows
    const first = await stored()
    expect(first.map((definition) => [definition.ref, definition.area_hint])).toEqual([
      ['static:payments.market', null],
      ['static:payments.orders', 'area_sandbox'],
    ])
    expect(
      (await readConnectors(database)).find((source) => source.id === 'finance-list'),
    ).toMatchObject({ origin: 'workspace', tool: 'Static list', status: 'ok' })

    // A changed title moves only that member's mark; a member gone from the list goes missing.
    const changed = await call('ravi', 'PUT', '/sources/finance-list', {
      id: 'finance-list',
      revision: 1,
      ...input([{ ...entries[0], title: 'Orders made' }]),
    })
    expect(changed.status).toBe(200)
    expect((await sync()).connectors).toMatchObject({ 'finance-list': { status: 'ok' } })
    const second = await stored()
    expect(second.map((definition) => [definition.ref, definition.missing])).toEqual([
      ['static:payments.market', true],
      ['static:payments.orders', false],
    ])
    expect(second[1]!.change_mark).not.toBe(first[1]!.change_mark)
    expect(second[0]!.change_mark).toBe(first[0]!.change_mark)
  }, 60_000)
})
