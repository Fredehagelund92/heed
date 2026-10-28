import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SourceActivity, SourceRow, SourceSettings } from '../../src/contract/sources.ts'
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
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  The sources as Settings › Integrations shows them (CON-104, CON-115), on the real service and
  PostgreSQL 18: every source with how it is, when it was read and is read next and what it holds;
  a source's activity (its reads, what it reads, its documents); and Pause reading. A definitions
  source of the server's own is read from what its reads kept; a content source is Markdown in Git
  on a Git host on this machine. Only an admin reads or pauses a source, and a read never
  publishes.
*/

const TOKEN = 'overview-it-token-8c41e2d0'
const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-10-08')
const secretsDir = await mkdtemp(join(tmpdir(), 'heed-overview-secrets-'))
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
const list = () => ok<SourceRow[]>(call('GET', '/sources', 'admin'))
const row = async (id: string) => (await list()).find((source) => source.id === id)!
const activity = (id: string) => ok<SourceActivity>(call('GET', `/sources/${id}/activity`, 'admin'))

/** One run of the sources' job, with every source due, as Read again makes one. */
async function read() {
  await client.query('update connectors set next_read_at = null')
  return connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  }) as Promise<{ connectors: Record<string, Record<string, unknown>> }>
}

const doc = (title: string, text: string) => `# ${title}\n\n${text}\n`
const handbook = {
  'docs/finance/orders-norway.md': doc(
    'Orders in Norway include marketplace orders',
    'From 1 October 2026, orders in Norway include orders placed through the marketplace.',
  ),
  'docs/finance/orders-spain.md': doc(
    'Orders in Spain leave out test accounts',
    'Orders in Spain leave out the accounts our teams use to test the webshop.',
  ),
  'docs/finance/contacts.md': doc(
    'Who to ask about orders',
    'Ask anna@example.test about orders in Norway.',
  ),
}

/**
 * The server's own Cube source, as its reads left it: a first read of three definitions in two
 * views (one mapped to Finance), a second that changed one, found one new and lost one, and a
 * third that the repository refused.
 */
async function seedCube() {
  await transaction(client, async () => {
    await client.query(
      `insert into connectors (id, kind, type, name, failures)
       values ('cube', 'definition_source', 'cube', 'Cube model', 1)`,
    )
    const snapshot = async (at: string, status: string, warnings: object[] = []) =>
      (
        await client.query<{ id: string }>(
          `insert into connector_snapshots (connector_id, status, fetched_at, duration_ms, definitions_seen, warnings)
           values ('cube', $1, $2, 1200, 3, $3) returning id`,
          [status, at, JSON.stringify(warnings)],
        )
      ).rows[0]!.id
    const first = await snapshot('2026-10-01T06:00:00Z', 'ok')
    const define = (ref: string, kind: string, name: string, area: string | null) =>
      client.query(
        `insert into definitions (ref, connector_id, kind, name, area_hint, change_mark, first_seen_snapshot, last_seen_snapshot)
         values ($1, 'cube', $2, $3, $4, 'm1', $5, $5)`,
        [ref, kind, name, area, first],
      )
    await define('cube:orders.orders', 'metric', 'orders.orders', 'finance')
    await define('cube:orders.market', 'dimension', 'orders.market', 'finance')
    await define('cube:basket.size', 'metric', 'basket.size', null)
    for (const ref of ['cube:orders.orders', 'cube:orders.market', 'cube:basket.size'])
      await client.query(
        `insert into definition_marks (definition_ref, snapshot_id, change_mark) values ($1, $2, 'm1')`,
        [ref, first],
      )
    const second = await snapshot('2026-10-07T06:00:00Z', 'ok', [
      { code: 'missing_domain', target: 'basket' },
    ])
    await client.query(
      `insert into definitions (ref, connector_id, kind, name, change_mark, first_seen_snapshot, last_seen_snapshot)
       values ('cube:basket.units', 'cube', 'metric', 'basket.units', 'm1', $1, $1)`,
      [second],
    )
    await client.query(
      `insert into definition_marks (definition_ref, snapshot_id, change_mark)
       values ('cube:basket.units', $1, 'm1'), ('cube:orders.orders', $1, 'm2')`,
      [second],
    )
    await client.query(
      `update definitions set missing_since_snapshot = $1 where ref = 'cube:basket.size'`,
      [second],
    )
    await snapshot('2026-10-08T06:00:00Z', 'failed', [
      { code: 'unauthorized', target: 'repository' },
    ])
  })
}

let handbookId = ''

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area] of [
      ['metric:orders', 'Orders', 'finance'],
      ['dim:market', 'Market', null],
      ['val:market/norway', 'Norway', null],
    ]) {
      const term = await client.query<{ id: string }>(
        `insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest)
         values($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id`,
        [key, name, area],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
  await seedCube()
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
  host = await gitHost({ token: TOKEN })
  await host.repository('handbook', handbook)
  handbookId = (
    await ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        type: 'git-markdown',
        name: 'Handbook',
        config: {
          repository: host.address('handbook'),
          ref: 'main',
          folder: 'docs',
          fileLink: 'https://git.example.test/handbook/blob/{commit}/{path}',
        },
        secrets: { token: TOKEN },
        scopes: [{ id: 'finance', title: 'docs/finance', domain: 'finance' }],
        reason: 'Read the handbook',
      }),
      201,
    )
  ).id
}, 120_000)
afterAll(async () => {
  await app.close()
  await host.close()
  await rm(secretsDir, { recursive: true, force: true })
})

describe('the sources an admin reads (CON-104)', () => {
  it('are for admins only', async () => {
    for (const [method, path, payload] of [
      ['GET', '/sources', undefined],
      ['GET', '/sources/cube/activity', undefined],
      ['PUT', '/sources/cube/paused', { paused: true, reason: 'Not mine to pause' }],
    ] as const)
      expect((await call(method, path, 'owner', payload)).statusCode, path).toBe(403)
  })

  it("lists every source, the server's own first, each with its connector", async () => {
    const rows = await list()
    expect(rows.map((source) => [source.id, source.origin, source.kind, source.tool])).toEqual([
      ['demo', 'server', 'definitions', 'Demo'],
      ['cube', 'server', 'definitions', 'Cube'],
      [handbookId, 'workspace', 'content', 'Markdown in Git'],
    ])
  })

  it('says a definitions source needs a new key, with what its copy holds and its last good read', async () => {
    const cube = await row('cube')
    expect(cube).toMatchObject({
      type: 'cube',
      name: 'Cube model',
      health: 'reauth',
      schedule: 'PT1H',
      lastGoodAt: '2026-10-07T06:00:00.000Z',
      failures: 1,
      documents: null,
      addedAt: null,
      addedBy: null,
    })
    expect(cube.lastRead).toMatchObject({
      status: 'failed',
      definitions: null,
      warnings: [{ code: 'unauthorized', count: 1 }],
    })
    // orders.orders and orders.market in orders (Finance), basket.units in basket (no domain);
    // basket.size is gone.
    expect(cube.definitions).toEqual({
      metrics: 2,
      dimensions: 1,
      groups: 2,
      groupsWithoutDomain: 1,
      flagged: 0,
    })
  })

  it('says a read failed for a reason other than its key', async () => {
    await client.query(
      `insert into connector_snapshots (connector_id, status, fetched_at, warnings)
       values ('demo', 'failed', '2026-10-08T07:00:00Z', '[{"code": "unreachable", "target": "model"}]')`,
    )
    expect((await row('demo')).health).toBe('failed')
  })

  it("lists a definitions source's reads newest first, each with what changed, and its views", async () => {
    const { reads, groups, scopes, documents } = await activity('cube')
    expect(
      reads.map((r) => [r.at, r.status, r.first, r.definitions, r.warnings.map((w) => w.code)]),
    ).toEqual([
      ['2026-10-08T06:00:00.000Z', 'failed', false, null, ['unauthorized']],
      [
        '2026-10-07T06:00:00.000Z',
        'ok',
        false,
        { seen: 3, added: 1, changed: 1, gone: 1 },
        ['missing_domain'],
      ],
      ['2026-10-01T06:00:00.000Z', 'ok', true, { seen: 3, added: 3, changed: 0, gone: 0 }, []],
    ])
    expect(groups).toEqual([
      { name: 'basket', metrics: 1, dimensions: 0, domain: null },
      { name: 'orders', metrics: 1, dimensions: 1, domain: 'finance' },
    ])
    expect(scopes).toEqual([])
    expect(documents).toEqual([])
    // Warnings are counted by code: a target, which may name a document, never leaves the service.
    expect(JSON.stringify(reads)).not.toContain('repository')
    expect((await call('GET', '/sources/nowhere/activity', 'admin')).statusCode).toBe(404)
  })
})

describe('a content source on its row and its page (CON-601 to CON-611)', () => {
  it('is not read yet once added, with who added it and its schedule', async () => {
    expect(await row(handbookId)).toMatchObject({
      type: 'git-markdown',
      kind: 'content',
      health: 'healthy',
      schedule: 'P1D',
      nextReadAt: null,
      lastRead: null,
      lastGoodAt: null,
      definitions: null,
      documents: { held: 0, waiting: 0, waitingDomains: 0, madeToday: 0, perDay: 5 },
      addedBy: 'admin',
    })
  })

  it('counts what a read did, which never publishes, and lists its documents', async () => {
    const served = () =>
      client.query(
        `select (select max(seq) from editions)::text as editions,
                (select count(*) from item_version_service)::text as served,
                (select count(*) from decisions)::text as decisions`,
      )
    const before = (await served()).rows
    await read()
    // A sync never publishes: no edition, no served version, no decision.
    expect((await served()).rows).toEqual(before)
    const handbookRow = await row(handbookId)
    expect(handbookRow).toMatchObject({
      health: 'healthy',
      documents: { held: 3, waiting: 2, waitingDomains: 1, madeToday: 2, perDay: 5 },
    })
    expect(handbookRow.lastRead).toMatchObject({
      status: 'ok',
      first: true,
      definitions: null,
      documents: { seen: 3, suggested: 2, replaced: 0, withdrawn: 0, waiting: 0, skipped: 1 },
      warnings: [{ code: 'document_names_people', count: 1 }],
    })
    expect(handbookRow.nextReadAt).not.toBeNull()

    const { reads, groups, scopes, documents } = await activity(handbookId)
    expect(reads).toHaveLength(1)
    expect(groups).toEqual([])
    expect(scopes).toEqual([
      { id: 'finance', title: 'docs/finance', domain: 'finance', documents: 3 },
    ])
    expect(
      documents.map((d) => [d.title, d.scope, d.domain, d.state, d.skipReason, !!d.proposalId]),
    ).toEqual(
      expect.arrayContaining([
        [
          'Orders in Norway include marketplace orders',
          'docs/finance',
          'finance',
          'suggested',
          null,
          true,
        ],
        [
          'Orders in Spain leave out test accounts',
          'docs/finance',
          'finance',
          'suggested',
          null,
          true,
        ],
        ['Who to ask about orders', 'docs/finance', 'finance', 'skipped', 'names_people', false],
      ]),
    )
    expect(documents).toHaveLength(3)
    // Never a document's text, nor the address of a person it names.
    const said = JSON.stringify({ reads, documents })
    expect(said).not.toContain('placed through the marketplace')
    expect(said).not.toContain('anna@example.test')
  })

  it('says a source asked to read now is reading until the job reads it', async () => {
    await client.query('update connectors set next_read_at = now() where id = $1', [handbookId])
    expect((await row(handbookId)).health).toBe('reading')
    await read()
    expect((await row(handbookId)).health).toBe('healthy')
  })
})

describe('Pause reading (CON-115)', () => {
  it('pauses a source and lets it go on, kept in the history log with why', async () => {
    const paused = await ok<{ id: string; paused: boolean }>(
      call('PUT', `/sources/${handbookId}/paused`, 'admin', {
        paused: true,
        reason: 'The handbook moves this week',
      }),
    )
    expect(paused).toEqual({ id: handbookId, paused: true })
    expect(await row(handbookId)).toMatchObject({ health: 'paused', nextReadAt: null })
    // A paused source is not read, by the job or by Read again.
    const job = await read()
    expect(job.connectors[handbookId]).toBeUndefined()
    expect((await call('POST', `/sources/${handbookId}/read`, 'admin')).statusCode).toBe(409)
    // Pausing it again changes nothing, and logs nothing.
    await ok(
      call('PUT', `/sources/${handbookId}/paused`, 'admin', {
        paused: true,
        reason: 'Still moving',
      }),
    )
    await ok(
      call('PUT', `/sources/${handbookId}/paused`, 'admin', {
        paused: false,
        reason: 'The handbook moved',
      }),
    )
    expect((await row(handbookId)).health).not.toBe('paused')
    const log = await client.query<{ action: string; reason: string }>(
      `select action, details->>'reason' as reason from audit_log
        where subject_type = 'source' and subject_id = $1 and action like 'source.%' order by seq`,
      [handbookId],
    )
    expect(log.rows).toEqual([
      { action: 'source.added', reason: 'Read the handbook' },
      { action: 'source.paused', reason: 'The handbook moves this week' },
      { action: 'source.resumed', reason: 'The handbook moved' },
    ])
  })

  it('pauses a source of the server too, and refuses an unknown one or a reason with an address', async () => {
    await ok(call('PUT', '/sources/cube/paused', 'admin', { paused: true, reason: 'Moving Git' }))
    expect((await row('cube')).health).toBe('paused')
    await ok(call('PUT', '/sources/cube/paused', 'admin', { paused: false, reason: 'Moved' }))
    expect(
      (
        await call('PUT', '/sources/nowhere/paused', 'admin', {
          paused: true,
          reason: 'Nothing',
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await call('PUT', '/sources/cube/paused', 'admin', {
          paused: true,
          reason: 'Ask anna@example.test',
        })
      ).statusCode,
    ).toBe(422)
  })
})
