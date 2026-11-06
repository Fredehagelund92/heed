import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Feed, NamesDecision, NamesRead } from '../../src/contract/inbox.ts'
import type { SourceSettings } from '../../src/contract/sources.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import {
  ConnectorRegistry,
  connectorSyncJob,
  createDemoSource,
  createWorkspaceSources,
  openLocalSecretStore,
} from '../../src/server/modules/connectors/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { legacyManifest, type Manifest } from '../server/connectors/dbt-metricflow-fixture.ts'
import { gitHost, type GitHost } from '../server/connectors/git-server.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  The names a read makes (FR-141), on the real service and PostgreSQL 18, from an empty install:
  a read of a dbt manifest makes names, nothing goes live until an owner accepts them with one
  card, the first accept is the first edition, and a word with another meaning waits for a look.
  This is the path that stood broken while every test started from seeded terms.
*/

const TOKEN = 'names-it-token-3a61f0c2'
const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-10-08')
const secretsDir = await mkdtemp(join(tmpdir(), 'heed-names-secrets-'))
const store = await openLocalSecretStore(join(secretsDir, 'store'))
const registry = new ConnectorRegistry([createDemoSource()], { secrets: store })
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

const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
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

const names = (who: Who) => ok<NamesRead>(call('GET', '/inbox/names', who))
const decide = (who: Who, input: object) => call('POST', '/inbox/names/decide', who, input)
const namesCard = async (who: Who) =>
  (await ok<Feed>(call('GET', '/inbox/feed', who))).cards.find((card) => card.group === 'names')
const steps = async () =>
  Object.fromEntries(
    (
      await ok<{ steps: { id: string; done: boolean }[] }>(call('GET', '/setup', 'admin'))
    ).steps.map((step) => [step.id, step.done]),
  )
/** The fixture's file with more metrics, each like Revenue under its own name and label. */
function withMetrics(...more: [name: string, label: string][]): Manifest {
  const file = structuredClone(legacyManifest)
  const revenue = file.metrics.find((metric) => metric.name === 'revenue')!
  for (const [name, label] of more) file.metrics.push({ ...structuredClone(revenue), name, label })
  return file
}

const live = async () =>
  (
    await client.query<{ key: string; name: string; area_id: string | null }>(
      `select key,name,area_id from serving_vocabulary((select seq from live_edition)) order by key`,
    )
  ).rows

const commit = (file: unknown) =>
  host.commit('shop-metrics', { 'semantic/semantic_manifest.json': JSON.stringify(file) })

/** One run of the sources' job, with the source made due. */
async function read() {
  await client.query('update connectors set next_read_at = null')
  await connectorSyncJob(registry, { clock }).run({
    database,
    logger,
    signal: new AbortController().signal,
  })
}

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
  host = await gitHost({ token: TOKEN })
  await host.repository('shop-metrics', {
    'semantic/semantic_manifest.json': JSON.stringify(legacyManifest),
  })
  await ok<SourceSettings>(
    call('POST', '/sources', 'admin', {
      type: 'dbt-metricflow',
      name: 'dbt',
      config: {
        location: 'git',
        repository: host.address('shop-metrics'),
        ref: 'main',
        folder: 'semantic',
        file: 'semantic_manifest.json',
        domainNames: { sales: 'finance' },
      },
      secrets: { token: TOKEN },
      reason: 'Our metrics live in dbt',
    }),
    201,
  )
  await read()
}, 120_000)
afterAll(async () => {
  await app.close()
  await host.close()
  await rm(secretsDir, { recursive: true, force: true })
})

describe('a read makes names', () => {
  it('offers every metric and dimension, leaves dates out, and nothing is live yet', async () => {
    expect(await live()).toEqual([])
    expect((await client.query('select 1 from live_edition')).rowCount).toBe(0)
    expect(await steps()).toMatchObject({ domain: true, definitions: false })
    const { names: all } = await names('admin')
    expect(all.filter((name) => name.state === 'ready').map((name) => name.name)).toContain(
      'Net revenue',
    )
    // The demo source of an install with no model of its own is no tool of the person's.
    expect(all.map((name) => name.name)).not.toContain('Country')
    expect(all.filter((name) => name.state === 'left_out').map((name) => name.name)).toEqual([
      'Order date',
      'Signed up at',
    ])
    expect(all.filter((name) => name.state === 'flagged')).toEqual([])
    expect(all.find((name) => name.name === 'Orders')).toMatchObject({
      key: 'metric:orders',
      kind: 'metric',
      aliases: ['purchases', 'order count'],
      areaId: 'finance',
      tool: 'dbt',
    })
  })

  it('shows one card to an admin, an owner their domain, and nobody else any', async () => {
    expect(await namesCard('admin')).toMatchObject({
      id: 'names:waiting',
      group: 'names',
      done: null,
      ready: 17,
      flagged: 0,
      tools: ['dbt'],
    })
    const mine = await names('owner')
    expect(mine.names.length).toBeGreaterThan(0)
    expect(mine.names.every((name) => name.areaId === 'finance')).toBe(true)
    expect(await namesCard('owner')).toMatchObject({ areaId: 'finance' })
    expect(await namesCard('author')).toBeUndefined()
    expect((await names('author')).names).toEqual([])
  })

  it('refuses a decision on a list that changed, and a name the person may not accept', async () => {
    const stale = await decide('admin', { revision: '0'.repeat(64), accept: [], leaveOut: [] })
    expect(stale.statusCode, stale.body).toBe(409)
    const { revision } = await names('owner')
    const shared = await decide('owner', {
      revision,
      accept: [{ key: 'metric:customers' }],
      leaveOut: [],
    })
    expect(shared.statusCode, shared.body).toBe(409)
    expect(await live()).toEqual([])
  })

  it('makes an owner’s names live as the first edition, by an owner’s decision', async () => {
    const { revision, names: mine } = await names('owner')
    const ready = mine.filter((name) => name.state === 'ready').map(({ key }) => ({ key }))
    const decided = await ok<NamesDecision>(
      decide('owner', { revision, accept: ready, leaveOut: [] }),
    )
    expect(decided).toMatchObject({ accepted: ready.length, leftOut: 0 })
    expect(decided.edition).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
    expect((await client.query('select 1 from live_edition')).rowCount).toBe(1)
    expect(await live()).toContainEqual({
      key: 'metric:net_revenue',
      name: 'Net revenue',
      area_id: 'finance',
    })
    const { rows } = await client.query<{ capacity: string; outcome: string; state: string }>(
      `select d.capacity,d.outcome,p.state from decisions d join proposals p on p.id=d.proposal_id
        where p.subject='vocabulary' group by 1,2,3`,
    )
    expect(rows).toEqual([{ capacity: 'owner', outcome: 'accept', state: 'accepted' }])
    expect(await steps()).toMatchObject({ definitions: true })
    // Applies to finds it now, and a person can write about it.
    expect(
      JSON.stringify(await ok(call('GET', '/vocabulary/search?q=Net%20revenue', 'author'))),
    ).toContain('metric:net_revenue')
    // What the owner may not accept is still on the admin's card.
    expect((await namesCard('admin'))?.areaId).toBeNull()
    expect(await namesCard('owner')).toBeUndefined()
  })

  it('takes the rest in a later edition', async () => {
    const { revision, names: rest } = await names('admin')
    await ok<NamesDecision>(
      decide('admin', {
        revision,
        accept: rest.filter((name) => name.state === 'ready').map(({ key }) => ({ key })),
        leaveOut: [],
      }),
    )
    expect(await namesCard('admin')).toBeUndefined()
    expect(await live()).toHaveLength(17)
  })
})

describe('later reads', () => {
  it('offer a new metric only, under the same card', async () => {
    await commit(withMetrics(['refunds', 'Refunds']))
    await read()
    const { names: all } = await names('admin')
    expect(all.filter((name) => name.state !== 'left_out').map((name) => name.name)).toEqual([
      'Refunds',
    ])
  })

  it('remember a name an owner left out, and an owner can still accept it', async () => {
    const { revision } = await names('admin')
    const left = await ok<NamesDecision>(
      decide('admin', { revision, accept: [], leaveOut: ['metric:refunds'] }),
    )
    expect(left).toMatchObject({ edition: null, leftOut: 1 })
    await read()
    const { names: after, revision: next } = await names('admin')
    expect(after.find((name) => name.key === 'metric:refunds')).toMatchObject({
      state: 'left_out',
      leftByOwner: true,
    })
    // The card goes under Done, where it can be reached: never in Needs me.
    expect(await namesCard('admin')).toBeUndefined()
    const all = await ok<Feed>(call('GET', '/inbox/feed?tab=all', 'admin'))
    expect(all.cards.find((card) => card.group === 'names')).toMatchObject({
      done: { outcome: 'Left out' },
    })
    const decided = await ok<NamesDecision>(
      decide('admin', { revision: next, accept: [{ key: 'metric:refunds' }], leaveOut: [] }),
    )
    expect(decided.accepted).toBe(1)
    expect(
      (
        await client.query('select 1 from names_left_out where definition_ref like $1', [
          '%refunds',
        ])
      ).rowCount,
    ).toBe(0)
  })

  it('drop a name when its definition goes', async () => {
    await commit(withMetrics(['tips', 'Tips']))
    await read()
    expect((await names('admin')).names.map((name) => name.name)).toContain('Tips')
    await commit(legacyManifest)
    await read()
    expect((await names('admin')).names.map((name) => name.name)).not.toContain('Tips')
  })
})

describe('one word, one meaning (FR-138)', () => {
  const flagged = async () => (await names('admin')).names.filter((n) => n.state === 'flagged')

  it('flags a word people gave another meaning, and refuses it until it is changed', async () => {
    await ok(
      call('POST', '/terms', 'admin', {
        name: 'Tips',
        meaning: 'What people leave for a courier.',
        areaId: 'finance',
      }),
    )
    await commit(withMetrics(['tips', 'Tips']))
    await read()
    const [tips] = await flagged()
    expect(tips).toMatchObject({
      key: 'metric:tips',
    })
    expect(tips!.flags[0]).toMatchObject({ code: 'taken' })
    expect(tips!.flags[0]!.message).toContain('“Tips” is a term')
    // Accept all leaves it out: the app sends only what is ready, and the card stays.
    expect(await namesCard('admin')).toMatchObject({ ready: 0, flagged: 1 })
    const { revision } = await names('admin')
    const refused = await decide('admin', {
      revision,
      accept: [{ key: 'metric:tips' }],
      leaveOut: [],
    })
    expect(refused.statusCode, refused.body).toBe(422)
    expect(refused.json<{ message: string }>().message).toContain('“Tips” is a term')
    const before = (await live()).length
    await ok<NamesDecision>(
      decide('admin', {
        revision,
        accept: [{ key: 'metric:tips', name: 'Courier tips' }],
        leaveOut: [],
      }),
    )
    expect(await live()).toContainEqual({
      key: 'metric:tips',
      name: 'Courier tips',
      area_id: 'finance',
    })
    expect(await live()).toHaveLength(before + 1)
    expect(await flagged()).toEqual([])
  })

  it('flags two definitions of one name, and picks neither', async () => {
    await commit(withMetrics(['tips', 'Courier tips'], ['fees', 'Fees'], ['fees_total', 'Fees']))
    await read()
    const both = await flagged()
    expect(both.map((name) => name.flags[0]!.code)).toEqual(['same_name', 'same_name'])
  })
})

describe('a disconnected source', () => {
  it('offers no names, on the card or in the list', async () => {
    expect((await names('admin')).names.length).toBeGreaterThan(0)
    const { rows } = await client.query<{ id: string }>(
      `select id from connectors where type = 'dbt-metricflow' and removed_at is null`,
    )
    await ok(
      call('POST', `/sources/${rows[0]!.id}/disconnect`, 'admin', {
        reason: 'Connected the wrong dbt project',
      }),
    )
    expect((await names('admin')).names).toEqual([])
    expect(await namesCard('admin')).toBeUndefined()
  })
})
