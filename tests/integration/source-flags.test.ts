import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { ReviewProposal } from '../../src/contract/review.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createToolService } from '../../src/server/mcp/service.ts'
import {
  ConnectorRegistry,
  ConnectorService,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { readConnectors } from '../../src/server/modules/jobs/operations.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/*
  S12b end to end on recorded Cube model files (CON-108): a change in the Cube model reaches the
  items that reference or mention it. A referenced definition that changed flags its items
  `needs_check`, one that disappeared flags them `source_missing` with the renamed id; both are
  delivered as unverified and their owners are told. A definition an item only mentions never
  flags it: the link shows `source_changed` or `source_missing`, the database's stale links hold
  it, and the owner is informed. An outage changes nothing (CON-213, CON-214).
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const app = buildApp({
  database,
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
const servePool = servingPool(url)
const refuse = (): Promise<never> => Promise.reject(new Error('not recorded in this test'))
const execute = createToolService(
  createEditionSource(servePool, 0),
  { write: refuse, reportGap: refuse, feedback: refuse },
  () => new Date('2026-10-08T12:00:00Z'),
)

const fixture = fileURLToPath(new URL('../fixtures/cube/model.yml', import.meta.url))
let modelDir = ''
let configDir = ''
let renamesFile = ''
let cube: ConnectorService
/**
 * Writes the model folder as a change in the Cube repository would leave it. Every view used here
 * belongs to the finance domain, so the accepted items match their definitions' domains.
 */
async function writeModel(transform: (text: string) => string = (text) => text) {
  const base = (await readFile(fixture, 'utf8'))
    .replace('        meta:\n          domain: commerce\n', '')
    .replace('domain: marketing', 'domain: finance')
  await writeFile(join(modelDir, 'model.yml'), transform(base))
}
const withCountDescription = (text: string) =>
  text.replace('type: count\n', 'type: count\n        description: Orders placed.\n')
const withGrowthRenamed = (text: string) => text.replace('- name: growth', '- name: expansion')

type Link = {
  rel: string
  target: { id: string; label: string; status: string; renamed_to?: string }
}
type Delivered = {
  id: string
  freshness: string
  unverified_reason?: string
  links: Link[]
}
async function deliveries(): Promise<Delivered[]> {
  const result = await execute(
    'get_facts',
    {
      question: '',
      metrics: ['metric:order_count', 'metric:revenue', 'metric:growth_revenue'],
      window: { from: '2026-08-10', to: '2026-08-20' },
    },
    { client: 'claude-code', scopes: ['read'], caller: 'agent', canSelectEdition: false },
    200000,
    () => {},
  )
  return (result.structuredContent as { items: Delivered[] }).items
}
const delivery = async (id: string) => (await deliveries()).find((item) => item.id === id)
const mention = (item: Delivered | undefined) => item?.links.find((l) => l.rel === 'mentions')

type Who = keyof typeof people
const headers: Record<string, Record<string, string>> = {}
const call = (method: 'GET' | 'POST', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
function ok<T>(response: Awaited<ReturnType<typeof call>>): T {
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
/** The owner publishes a suggestion, as the review in the Inbox does: unrelated to any clash. */
async function decide(id: string) {
  const sheet = ok<{ proposal: ReviewProposal; clashes: { itemId: string }[] }>(
    await call('GET', `/review/${id}/sheet`, 'owner'),
  )
  return ok(
    await call('POST', `/review/${id}/publish`, 'owner', {
      revision: sheet.proposal.revision,
      relations: sheet.clashes.map((clash) => ({ itemId: clash.itemId, relation: 'unrelated' })),
    }),
  )
}
/** A low-risk note proposed by the author and accepted by the owner, live in a new edition. */
async function accepted(extra: Draft, itemId?: string): Promise<string> {
  const created = ok<ProposalRecord>(
    await call('POST', '/proposals', 'author', {
      draft: {
        areaId: 'finance',
        validity: { start: '2026-08-04', end: null },
        evidence: [{ url: 'https://example.test/note', quote: 'Noted', date: '2026-08-04' }],
        ...extra,
      },
      ...(itemId ? { itemId } : {}),
    }),
  )
  const submitted = ok<ProposalRecord>(
    await call('POST', `/proposals/${created.id}/submit`, 'author', {
      revision: created.revision,
    }),
  )
  await decide(submitted.id)
  return submitted.itemId!
}

async function relay() {
  await client.query('select * from cl_outbox_relay(1000)')
}
/** The owner's inbox entries about sources, oldest first, after the relay ran. */
async function ownerNotices() {
  await relay()
  const rows = await client.query<{ kind: string; subject: string; state: string }>(
    `select kind, subject_id as subject, payload->>'state' as state from inbox_items
      where person_id = $1 and kind in ('item.flagged', 'item.links_stale', 'vocabulary.domain_changed')
      order by event_seq`,
    [people.owner],
  )
  return rows.rows
}
const activeFlags = async () =>
  (
    await client.query<{ item_id: string; flag: string; reason: string }>(
      "select item_id, flag::text, reason from v_overlay_on where kind = 'flag_on' order by item_id, flag",
    )
  ).rows
/** Mentions in live items whose target went stale: item and status, by item. */
const staleLinks = async () =>
  (
    await client.query<{ item_id: string; status: string }>(
      'select item_id, status from v_stale_links order by item_id, field, position',
    )
  ).rows
const overlayEvents = async () =>
  (await client.query<{ n: number }>('select count(*)::int as n from overlay_events')).rows[0]!.n

const items = { a: '', b: '', c: '', d: '' }
let noticesBefore = 0

beforeAll(async () => {
  modelDir = await mkdtemp(join(tmpdir(), 'heed-flags-model-'))
  configDir = await mkdtemp(join(tmpdir(), 'heed-flags-config-'))
  renamesFile = join(configDir, 'renames.json')
  await writeModel()
  await writeFile(renamesFile, JSON.stringify({}))
  cube = new ConnectorService(
    database,
    new ConnectorRegistry([createCubeSource({ modelDir, renamesFile })]),
  )
  await foundation(client)
  expect((await cube.sync('cube')).status).toBe('ok')
  await transaction(client, async () => {
    await client.query(`insert into vocab_terms(key,kind) values
      ('metric:order_count','metric'),('metric:revenue','metric'),('metric:growth_revenue','metric')`)
    // The first edition is a bootstrap: its vocabulary needs no decision (0006).
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, ref] of [
      ['metric:order_count', 'Orders', 'cube:sales.count'],
      ['metric:revenue', 'Revenue', 'cube:sales.revenue'],
      ['metric:growth_revenue', 'Growth revenue', 'cube:growth.revenue'],
    ]) {
      const term = await client.query<{ id: string }>(
        `with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values($1,1,$2,'finance',sha256(convert_to($1,'UTF8'))) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,$3 from v where $3::text is not null) select id from v`,
        [key, name, ref],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
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
  // A and C reference a definition through their scope; B and D only mention one.
  items.a = await accepted({
    title: 'Order count caveat',
    summary: 'Orders were double counted',
    scope: { metrics: ['metric:order_count'], dimensions: [], dimensionValues: [] },
  })
  items.b = await accepted({
    title: 'Revenue note',
    summary: 'Revenue dipped while @[orders](metric:order_count) held',
    scope: { metrics: ['metric:revenue'], dimensions: [], dimensionValues: [] },
  })
  items.c = await accepted({
    title: 'Growth revenue caveat',
    summary: 'Growth revenue excludes refunds',
    scope: { metrics: ['metric:growth_revenue'], dimensions: [], dimensionValues: [] },
  })
  items.d = await accepted({
    title: 'Revenue and growth',
    summary: 'Compare with @[growth revenue](metric:growth_revenue)',
    scope: { metrics: ['metric:revenue'], dimensions: [], dimensionValues: [] },
  })
  noticesBefore = (await ownerNotices()).length
}, 60_000)

afterAll(async () => {
  await app.close()
  await servePool.end()
  await rm(modelDir, { recursive: true, force: true })
  await rm(configDir, { recursive: true, force: true })
})

describe('Cube change flags, the needs-check flow and stale links', () => {
  it('starts verified, with current links and nothing flagged', async () => {
    const all = await deliveries()
    expect(all.map((item) => item.id).sort()).toEqual(Object.values(items).sort())
    expect(all.every((item) => item.freshness === 'verified')).toBe(true)
    expect(mention(await delivery(items.b))?.target.status).toBe('current')
    expect(await activeFlags()).toEqual([])
    expect(await staleLinks()).toEqual([])
    expect(noticesBefore).toBe(0)
  })

  it('flags a referencing item needs_check and only informs about an item that mentions it', async () => {
    await writeModel(withCountDescription)
    const result = await cube.sync('cube')
    expect(result).toMatchObject({
      status: 'ok',
      flags: { raised: 1, cleared: 0 },
      staleLinkNotices: 1,
      domainNotices: 0,
    })
    expect(await activeFlags()).toEqual([
      { item_id: items.a, flag: 'needs_check', reason: 'Definition changed: cube:sales.count' },
    ])
    // C18: still delivered, labelled unverified with the state needs_check.
    expect(await delivery(items.a)).toMatchObject({
      freshness: 'unverified',
      unverified_reason: 'needs_check',
    })
    // L05 for a change: B mentions the metric, so it is delivered as before with a stale link.
    const b = await delivery(items.b)
    expect(b?.freshness).toBe('verified')
    expect(mention(b)?.target).toMatchObject({
      id: 'metric:order_count',
      label: 'orders',
      status: 'source_changed',
    })
    expect(await ownerNotices()).toEqual([
      { kind: 'item.flagged', subject: items.a, state: 'needs_check' },
      { kind: 'item.links_stale', subject: items.b, state: 'stale' },
    ])
    expect(await staleLinks()).toEqual([{ item_id: items.b, status: 'source_changed' }])
    // A second read of the same model changes nothing and tells nobody again.
    expect(await cube.sync('cube')).toMatchObject({
      flags: { raised: 0, cleared: 0 },
      staleLinkNotices: 0,
    })
    expect(await ownerNotices()).toHaveLength(2)
  }, 30_000)

  it('keeps every flag, link status and reply while the source cannot be read', async () => {
    const events = await overlayEvents()
    const before = await deliveries()
    const stale = await staleLinks()
    await writeFile(join(modelDir, 'model.yml'), 'cubes: [')
    const result = await cube.sync('cube')
    expect(result).toMatchObject({ status: 'failed', flags: { raised: 0, cleared: 0 } })
    expect(await overlayEvents()).toBe(events)
    expect(await deliveries()).toEqual(before)
    expect(await staleLinks()).toEqual(stale)
    expect(await ownerNotices()).toHaveLength(2)
  }, 30_000)

  it('flags a referencing item source_missing with the renamed id, and marks mentions of it', async () => {
    await writeFile(
      renamesFile,
      JSON.stringify({ 'cube:growth.revenue': 'cube:expansion.revenue' }),
    )
    await writeModel((text) => withGrowthRenamed(withCountDescription(text)))
    const result = await cube.sync('cube')
    expect(result).toMatchObject({
      status: 'ok',
      flags: { raised: 1, cleared: 0 },
      staleLinkNotices: 1,
    })
    expect(await activeFlags()).toContainEqual({
      item_id: items.c,
      flag: 'source_missing',
      reason: 'Definition missing: cube:growth.revenue (now cube:expansion.revenue)',
    })
    expect(await delivery(items.c)).toMatchObject({
      freshness: 'unverified',
      unverified_reason: 'source_missing',
    })
    // L05: D only mentions the missing metric. It is still delivered, verified, and the link
    // says the source is missing and where it went.
    const d = await delivery(items.d)
    expect(d?.freshness).toBe('verified')
    expect(mention(d)?.target).toEqual({
      type: 'metric',
      id: 'metric:growth_revenue',
      label: 'growth revenue',
      status: 'source_missing',
      renamed_to: 'cube:expansion.revenue',
    })
    expect((await ownerNotices()).slice(2)).toEqual([
      { kind: 'item.flagged', subject: items.c, state: 'source_missing' },
      { kind: 'item.links_stale', subject: items.d, state: 'stale' },
    ])
    expect((await staleLinks()).map((link) => [link.item_id, link.status])).toEqual(
      [
        [items.b, 'source_changed'],
        [items.d, 'source_missing'],
      ].sort((x, y) => (x[0]! < y[0]! ? -1 : 1)),
    )
    // Sources lists the rename the server's file gave, and the view the member left.
    const [source] = await readConnectors(database)
    expect(source?.renames).toEqual([{ from: 'cube:growth.revenue', to: 'cube:expansion.revenue' }])
    expect(source?.views.map((view) => view.name)).toContain('expansion')
    expect(source?.views.map((view) => view.name)).not.toContain('growth')
  }, 30_000)

  it('clears needs_check when an owner says it is still true, and refreshes mentions', async () => {
    // The Inbox's Due for a check card, Still true (FR-139).
    const still = (item: string, reason: string) =>
      call('POST', '/inbox/cards/decide', 'owner', {
        card: `check:${item}`,
        action: 'still_true',
        reason,
      })
    const rechecked = await still(items.a, 'The new description does not change this caveat')
    expect(rechecked.statusCode, rechecked.body).toBe(200)
    expect((await activeFlags()).map((f) => f.item_id)).toEqual([items.c])
    expect(await delivery(items.a)).toMatchObject({ freshness: 'verified' })
    const cleared = await client.query<{ reason: string }>(
      "select reason from overlay_events where item_id = $1 and kind = 'flag_off'",
      [items.a],
    )
    expect(cleared.rows).toEqual([{ reason: 'The new description does not change this caveat' }])
    // B only had a stale mention: the recheck records the current mark, so the link is current.
    const again = await still(items.b, 'Still right with the new order count description')
    expect(again.statusCode, again.body).toBe(200)
    expect(mention(await delivery(items.b))?.target.status).toBe('current')
    expect((await staleLinks()).map((link) => link.item_id)).toEqual([items.d])
  }, 30_000)

  it('informs about a changed domain without flagging anything', async () => {
    const events = await overlayEvents()
    await writeModel((text) =>
      withGrowthRenamed(withCountDescription(text)).replace('domain: finance', 'domain: treasury'),
    )
    const result = await cube.sync('cube')
    expect(result).toMatchObject({ status: 'ok', flags: { raised: 0, cleared: 0 } })
    expect(result.domainNotices).toBe(2)
    expect(await overlayEvents()).toBe(events)
    expect((await ownerNotices()).slice(4)).toEqual([
      { kind: 'vocabulary.domain_changed', subject: 'metric:order_count', state: 'treasury' },
      { kind: 'vocabulary.domain_changed', subject: 'metric:revenue', state: 'treasury' },
    ])
    // Serving keeps the accepted area; C still waits for its missing definition.
    expect(
      (await deliveries())
        .filter((item) => item.id !== items.c)
        .every((item) => item.freshness === 'verified'),
    ).toBe(true)
  }, 30_000)

  it('tells the owners only: the author has no source notice', async () => {
    await relay()
    const author = await client.query<{ kind: string }>(
      'select kind from inbox_items where person_id = $1',
      [people.author],
    )
    expect(author.rows.some((row) => row.kind.startsWith('item.'))).toBe(false)
    expect(author.rows.some((row) => row.kind.startsWith('vocabulary.domain'))).toBe(false)
  })
})

describe('mention marks', () => {
  it('are recorded by the database and cannot be forged by the writer', async () => {
    const rows = await client.query<{ definition_ref: string; change_mark: string; now: string }>(
      `select m.definition_ref, m.change_mark, d.change_mark as now
         from item_version_mentions m join item_versions v on v.id = m.version_id
         join definitions d on d.ref = m.definition_ref
        where v.item_id = $1 order by v.version_no desc limit 1`,
      [items.b],
    )
    expect(rows.rows[0]).toMatchObject({ definition_ref: 'cube:sales.count' })
    expect(rows.rows[0]!.change_mark).toBe(rows.rows[0]!.now)
    const serving = await servePool.query(
      'select count(*)::int as n from serving_links((select seq from live_edition)) where change_mark is not null',
    )
    expect(serving.rows[0]).toEqual({ n: 2 })
    await expect(
      servePool.query('select * from v_stale_links'),
      'the serving role reads links only through serving_links',
    ).rejects.toThrow(/permission denied/)
  })
})
