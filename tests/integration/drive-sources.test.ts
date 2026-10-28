import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
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
import { driveHost, type DriveHost } from '../server/connectors/drive-server.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Google Drive end to end (CON-601 to CON-611), on the real service and PostgreSQL 18, with a fake
  Drive on this machine whose service account and key are invented when the test starts. An admin
  tests the key, chooses a shared folder and maps it to a domain; a read turns each Google Doc in
  it into one suggestion for that domain's owners and never publishes. A read from the cursor
  brings only what changed: a changed document replaces its suggestion, a trashed one withdraws
  it, and once a week the core asks for a full read, which withdraws what a change list missed.
  The key is in the secret store only: in no answer, row, history entry, retry record, snapshot or
  log line, and the source's page shows it only as set.
*/

const { client, url } = testDatabase()
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
const clock = systemClock('2026-10-08')
const secretsDir = await mkdtemp(join(tmpdir(), 'heed-drive-secrets-'))
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
type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const bodies: string[] = []

const call = async (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) => {
  const response = await app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
  bodies.push(response.body)
  return response
}
const ok = async <T>(
  response: Promise<{ statusCode: number; body: string; json: <U>() => U }>,
  status = 200,
) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(status)
  return r.json<T>()
}

/** One run of the sources' job, with every source due, as Read again makes one. */
async function read() {
  await client.query('update connectors set next_read_at = null')
  return connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  }) as Promise<{ connectors: Record<string, Record<string, unknown>> }>
}

const suggestions = async (source: string) =>
  (
    await client.query<{ document: string; state: string; channel: string; proposer: null }>(
      `select p.source_document_id as document, p.state::text as state, p.channel::text as channel,
              p.proposer_id as proposer
         from proposals p where p.source_id = $1 order by p.created_at, p.number`,
      [source],
    )
  ).rows
const lastRead = async (source: string) =>
  (
    await client.query<{ status: string; full_read: boolean; cursor: string | null }>(
      `select status, full_read, cursor from connector_snapshots where connector_id=$1
        order by fetched_at desc limit 1`,
      [source],
    )
  ).rows[0]!

const doc = (title: string, text: string) => `# ${title}\n\n${text}\n`
let drive: DriveHost
let key = ''
const ids: Record<string, string> = {}
let sourceId = ''

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [termKey, name, area] of [
      ['metric:orders', 'Orders', 'finance'],
      ['dim:market', 'Market', null],
      ['val:market/norway', 'Norway', null],
    ]) {
      const term = await client.query<{ id: string }>(
        `insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest)
         values($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id`,
        [termKey, name, area],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [termKey, term.rows[0]!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
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
  drive = await driveHost()
  key = drive.key()
  ids.finance = drive.folder('Finance')
  ids.norway = drive.document(
    'Orders in Norway include marketplace orders',
    ids.finance,
    doc(
      'Orders in Norway include marketplace orders',
      'From 1 October 2026, orders in Norway include orders placed through the marketplace.',
    ),
  )
  ids.returns = drive.document(
    'Orders in Norway leave out returns',
    ids.finance,
    doc('Orders in Norway leave out returns', 'Orders in Norway leave out returned orders.'),
  )
  ids.forecast = drive.document(
    'Orders in Norway are counted on the day',
    ids.finance,
    doc('Orders in Norway are counted on the day', 'Orders in Norway are counted when paid.'),
  )
  drive.file('Order sheet', ids.finance, 'application/vnd.google-apps.spreadsheet')
}, 120_000)
afterAll(async () => {
  await app.close()
  await drive.close()
  await rm(secretsDir, { recursive: true, force: true })
})

const config = () => ({ apiAddress: drive.address, signInAddress: drive.signInAddress })

describe('adding Google Drive (CON-601, CON-602)', () => {
  it('tests the key: it names the account to share with and lists the shared folders', async () => {
    const check = await ok<SourceCheck>(
      call('POST', '/sources/test', 'admin', {
        type: 'google-drive',
        config: config(),
        secrets: { serviceAccountKey: key },
      }),
    )
    expect(check.ok, JSON.stringify(check)).toBe(true)
    expect(check.steps.map((step) => [step.id, step.status])).toEqual([
      ['sign-in', 'ok'],
      ['folders', 'ok'],
      ['documents', 'ok'],
    ])
    expect(check.steps[0]!.detail).toContain('heed-reader@drive-fake.example.test')
    expect(check.scopes).toEqual([
      { id: ids.finance, title: 'Finance', suggestedDomain: 'finance' },
    ])
    // A key Google refuses says so in its own step, and nothing is kept.
    const refused = await ok<SourceCheck>(
      call('POST', '/sources/test', 'admin', {
        type: 'google-drive',
        config: config(),
        secrets: { serviceAccountKey: drive.strangerKey() },
      }),
    )
    expect(refused.steps).toMatchObject([{ id: 'sign-in', status: 'failed' }])
    const owner = await call('POST', '/sources/test', 'owner', {
      type: 'google-drive',
      config: config(),
      secrets: { serviceAccountKey: key },
    })
    expect(owner.statusCode).toBe(403)
  })

  it('adds it with a folder mapped to a domain, and shows its key only as set', async () => {
    const added = await ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        type: 'google-drive',
        name: 'Finance drive',
        config: config(),
        secrets: { serviceAccountKey: key },
        scopes: [{ id: ids.finance, title: 'Finance', domain: 'finance' }],
        schedule: 'P1D',
        reason: 'Read the finance definitions',
      }),
      201,
    )
    expect(added).toMatchObject({
      type: 'google-drive',
      scopes: [{ id: ids.finance, domain: 'finance' }],
      schedule: 'P1D',
      secrets: [{ key: 'serviceAccountKey', set: true }],
    })
    sourceId = added.id
    const page = await ok<SourceSettings>(call('GET', `/sources/${sourceId}`, 'admin'))
    expect(page.secrets).toEqual([{ key: 'serviceAccountKey', set: true }])
    // Its key is in the secret store, and only there.
    const files = await readdir(join(secretsDir, 'store'))
    expect(files).toHaveLength(1)
    expect(await readFile(join(secretsDir, 'store', files[0]!), 'utf8')).toContain(
      'drive-fake.example.test',
    )
  })
})

describe('a read of Google Drive (CON-603 to CON-611)', () => {
  it('turns each Google Doc into one suggestion for its domain, and never publishes', async () => {
    const state = () =>
      client.query(
        `select (select max(seq) from editions)::text as editions,
                (select count(*) from item_version_service)::text as served,
                (select count(*) from decisions)::text as decisions`,
      )
    const before = (await state()).rows
    const result = await read()
    expect(result.connectors[sourceId]).toMatchObject({
      status: 'ok',
      documentsSeen: 3,
      suggested: 3,
    })
    expect((await suggestions(sourceId)).map((s) => [s.state, s.channel, s.proposer])).toEqual([
      ['submitted', 'source', null],
      ['submitted', 'source', null],
      ['submitted', 'source', null],
    ])
    // Nothing published, decided or served: a read only suggests (CON-604).
    expect((await state()).rows).toEqual(before)
    expect(await lastRead(sourceId)).toMatchObject({ status: 'ok', full_read: true })
    const kept = await client.query<{ link: string }>(
      'select link from connector_documents where source_id=$1 order by document_id',
      [sourceId],
    )
    for (const row of kept.rows)
      expect(row.link).toMatch(/^https:\/\/docs\.google\.com\/document\/d\//)
  })

  it('reads from its cursor only what changed: a changed document replaces its suggestion', async () => {
    const unchanged = await read()
    expect(unchanged.connectors[sourceId]).toMatchObject({ status: 'ok', documentsSeen: 0 })
    expect(await lastRead(sourceId)).toMatchObject({ full_read: false })
    drive.edit(
      ids.norway!,
      doc(
        'Orders in Norway include marketplace orders',
        'From 1 October 2026, orders in Norway include marketplace orders and orders by phone.',
      ),
    )
    const changed = await read()
    expect(changed.connectors[sourceId]).toMatchObject({
      status: 'ok',
      documentsSeen: 1,
      suggested: 1,
      replaced: 1,
    })
    const norway = (await suggestions(sourceId)).filter((s) => s.document === ids.norway)
    expect(norway.map((s) => s.state)).toEqual(['withdrawn', 'submitted'])
  })

  it('withdraws the open suggestion of a trashed document, from its tombstone', async () => {
    drive.trash(ids.returns!)
    const result = await read()
    expect(result.connectors[sourceId]).toMatchObject({ status: 'ok', withdrawn: 1 })
    const returns = (await suggestions(sourceId)).filter((s) => s.document === ids.returns)
    expect(returns.map((s) => s.state)).toEqual(['withdrawn'])
  })

  it('lists everything again once a week, which finds what a change list missed', async () => {
    drive.forget(ids.forecast!)
    const missed = await read()
    expect(missed.connectors[sourceId]).toMatchObject({ status: 'ok', withdrawn: 0 })
    // A week on, the core hands no cursor: a full read, where a document left out is gone.
    await client.query(
      `update connector_snapshots set fetched_at = fetched_at - interval '8 days' where connector_id=$1`,
      [sourceId],
    )
    const full = await read()
    expect(full.connectors[sourceId]).toMatchObject({ status: 'ok', withdrawn: 1 })
    expect(await lastRead(sourceId)).toMatchObject({ full_read: true })
    const forecast = (await suggestions(sourceId)).filter((s) => s.document === ids.forecast)
    expect(forecast.map((s) => s.state)).toEqual(['withdrawn'])
  })

  it('takes a key gone from the secret store as a failed read, which changes nothing', async () => {
    const before = await suggestions(sourceId)
    const store = await readdir(join(secretsDir, 'store'))
    await rm(join(secretsDir, 'store', store[0]!))
    const result = await read()
    expect(result.connectors[sourceId]).toMatchObject({ status: 'failed' })
    const [failed] = (
      await client.query<{ warnings: { code: string }[] }>(
        `select warnings from connector_snapshots where connector_id=$1 and status='failed'
          order by fetched_at desc limit 1`,
        [sourceId],
      )
    ).rows
    expect(failed!.warnings[0]!.code).toBe('secret_missing')
    expect(await suggestions(sourceId)).toEqual(before)
  })

  it('keeps the key in the secret store only: in no answer, row, entry, retry or log', async () => {
    const privateKey = (JSON.parse(key) as { private_key: string }).private_key
    const lines = privateKey.split('\n').filter((line) => /^[A-Za-z0-9+/=]{40,}$/.test(line))
    expect(lines.length).toBeGreaterThan(5)
    const kept: string[] = []
    for (const table of [
      'connectors',
      'connector_snapshots',
      'connector_documents',
      'audit_log',
      'idempotency_keys',
      'proposals',
    ])
      kept.push(JSON.stringify((await client.query(`select * from ${table}`)).rows))
    const everything = [...bodies, ...kept, rawLog.join('')].join('\n')
    for (const line of lines) expect(everything).not.toContain(line)
    expect(everything).not.toContain('PRIVATE KEY')
    // Nor the short-lived tokens Google gave for it.
    expect(drive.issued().length).toBeGreaterThan(0)
    for (const token of drive.issued()) expect(everything).not.toContain(token)
  })
})
