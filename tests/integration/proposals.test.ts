import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  ConnectorService,
  ConnectorRegistry,
  createCubeSource,
} from '../../src/server/modules/connectors/index.ts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { databaseFromPool } from '../../src/server/db/database.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { createProposalsService } from '../../src/server/modules/proposals/index.ts'
import { ORPCError } from '@orpc/client'
import type { ItemPage } from '../../src/contract/context.ts'
import type { ProposalRecord, ProposalListResult } from '../../src/contract/proposals.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { itemVersionDigests } from '../../src/domain/item-version.ts'
import { formatDraft } from '../../src/domain/draft.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { apiDatabase, ignoreTeardownDisconnects, testDatabase, transaction } from './support.ts'
import { foundation, people, version, accept, openEdition } from './fixtures.ts'

const { client, url } = testDatabase()
const database = apiDatabase(url)
const clock = systemClock('2026-10-08')
const app = buildApp({
  database,
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock,
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
type Headers = { cookie: string; origin: string; 'x-heed-csrf': string }
const headers: Record<string, Headers> = {}
let acceptedItem: string
beforeAll(async () => {
  await foundation(client)
  const cubePool = ignoreTeardownDisconnects(
    new pg.Pool({ connectionString: url, options: '-c role=context_layer_api' }),
  )
  try {
    const cube = createCubeSource({
      modelDir: fileURLToPath(new URL('../fixtures/cube/', import.meta.url)),
    })
    const synced = await new ConnectorService(
      databaseFromPool(cubePool),
      new ConnectorRegistry([cube]),
    ).sync('cube')
    expect(synced.status).toBe('ok')
  } finally {
    await cubePool.end()
  }
  await client.query("insert into vocab_terms(key,kind) values('metric:revenue','metric')")
  await transaction(client, async () => {
    const v = await version(client, { risk: 'low', owner: people.owner })
    acceptedItem = v.item
    await accept(client, v.id)
    let seq = await openEdition(client)
    // Seed a complete governed edition, as the preceding slices do.
    await client.query("select set_config('cl.person_id',$1,true)", [people.admin])
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
    seq = await openEdition(client)
    await client.query('select edition_serve_item_version($1,$2)', [seq, v.id])
    // Vocabulary decisions are outside S7; the fixture owns the baseline.
    await client.query('alter table vocab_term_service disable trigger user')
    for (const [key, name, ref] of [
      ['metric:orders', 'Orders', 'demo:orders'],
      ['metric:revenue', 'Revenue', 'cube:sales.revenue'],
      ['dim:market', 'Market', null],
      ['val:market/norway', 'Norway', null],
      ['group:payments', 'Payments', null],
    ]) {
      const term = await client.query<{ id: string }>(
        `with v as (insert into vocab_term_versions (term_key,name,area_id,proposer_id,content_digest,version_no) values($1,$2,'finance',$4,sha256('term'),1) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,$3 from v where $3::text is not null) select id from v`,
        [key, name, ref, people.owner],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('alter table vocab_term_service enable trigger user')
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
})
afterAll(() => app.close())
function draft(extra: Draft = {}): Draft {
  return {
    areaId: 'finance',
    title: 'A dated note',
    summary: 'Market update',
    scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
    validity: { start: '2026-08-04', end: null },
    evidence: [
      { url: 'https://example.test/report', quote: 'Trading resumed', date: '2026-08-04' },
    ],
    ...extra,
  }
}
const write = (path: string, payload: object, who = 'author', key: string = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': key },
    payload,
  })
async function create(extra: Draft = {}, who = 'author') {
  const response = await write('/proposals', { draft: draft(extra) }, who)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ProposalRecord>()
}
const submit = (p: ProposalRecord, key?: string) =>
  write(`/proposals/${p.id}/submit`, { revision: p.revision }, 'author', key)
/**
 * Saves the author's draft through the proposals service, as the editor does when it finishes a
 * draft: the API has no save of its own. Answers as the API would, with the error's status.
 */
async function save(p: ProposalRecord, d: Draft) {
  try {
    const saved = await database.transaction(people.author, (tx) =>
      createProposalsService(tx, clock, people.author).save(p.id, p.revision, d),
    )
    return { statusCode: 200, body: '', json: <T = ProposalRecord>() => saved as T }
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error
    const answer: unknown = error.toJSON()
    return { statusCode: error.status, body: error.message, json: <T = unknown>() => answer as T }
  }
}
/** The live item as its page in Heed reads it. */
const livePage = (id: string) =>
  app.inject({ url: `/api/v1/items/${id}/page`, headers: headers.author })

it('lists and reads retirement proposals with permission-filtered totals', async () => {
  const proposed = await write(`/items/${acceptedItem}/retire-proposals`, {
    reason: 'The note no longer applies',
  })
  expect(proposed.statusCode, proposed.body).toBe(200)
  const { id } = proposed.json<{ id: string }>()
  const response = await app.inject({ url: `/api/v1/proposals/${id}`, headers: headers.author })
  expect(response.statusCode, response.body).toBe(200)
  expect(response.json()).toMatchObject({ action: 'retire', reason: 'The note no longer applies' })
  const list = async (query: string, who = 'author') => {
    const result = await app.inject({ url: `/api/v1/proposals?${query}`, headers: headers[who] })
    expect(result.statusCode, result.body).toBe(200)
    return result.json<ProposalListResult>()
  }
  const all = await list('own=true&limit=100')
  expect(all.rows.map((p) => p.id)).toContain(id)
  expect(all.total).toBe(all.rows.length)
  const page = await list('own=true&limit=1&offset=1')
  expect(page).toEqual({ rows: all.rows.slice(1, 2), total: all.total, limit: 1, offset: 1 })
  expect(await list('own=true&offset=100')).toEqual({
    rows: [],
    total: all.total,
    limit: 50,
    offset: 100,
  })
  expect(await list('own=true&state=rejected')).toMatchObject({ rows: [], total: 0 })
  const finance = await list('own=true&areaId=finance')
  expect(finance.rows.map((p) => p.id)).toContain(id)
  expect(finance.total).toBe(finance.rows.length)
  expect(
    (await app.inject({ url: `/api/v1/proposals/${id}`, headers: headers.stranger })).statusCode,
  ).toBe(404)
  // A retirement has no draft to save.
  expect((await save(response.json<ProposalRecord>(), draft())).statusCode).toBe(404)
  const stranger = await list('limit=100', 'stranger')
  expect(stranger.rows.map((p) => p.id)).not.toContain(id)
  expect(stranger.total).toBe(stranger.rows.length)
  expect((await list('limit=100', 'admin')).rows.map((p) => p.id)).toContain(id)
  expect((await list('limit=100', 'owner')).rows.map((p) => p.id)).toContain(id)
})

describe('proposal write path over authenticated HTTP', () => {
  it('saves incomplete forms, defaults fields, derives area only from scope, and rejects forged identity', async () => {
    const response = await write('/proposals', { draft: { areaId: 'finance' } })
    expect(response.statusCode, response.body).toBe(200)
    const p = response.json<ProposalRecord>()
    expect(p).toMatchObject({
      state: 'draft',
      proposerId: people.author,
      draft: { riskLevel: 'low', reviewDate: '2027-01-06', notToConclude: 'cause not proven' },
    })
    expect(p.findings.length).toBeGreaterThan(0)
    expect((await submit(p)).statusCode).toBe(422)
    const changed = await save(p, draft({ summary: 'Saved work' }))
    expect(changed.statusCode, changed.body).toBe(200)
    expect(
      (await app.inject({ url: `/api/v1/proposals/${p.id}`, headers: headers.author })).json(),
    ).toMatchObject({ draft: { summary: 'Saved work' }, revision: 2 })
    const inferred = await write('/proposals', {
      draft: {
        title: 'Derived',
        scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
      },
    })
    expect(inferred.statusCode, inferred.body).toBe(200)
    expect(inferred.json()).toMatchObject({ areaId: 'finance' })
    expect(
      (await write('/proposals', { draft: { summaryMarkup: '@[Finance](area:finance)' } }))
        .statusCode,
    ).toBe(422)
    expect(
      (await write('/proposals', { draft: { ...draft(), proposerId: people.admin } })).statusCode,
    ).toBe(400)
  })
  it('submits one immutable version with derived mention rows, checks, digests, audit and outbox', async () => {
    const p = await create({
      summaryMarkup: `@[Orders](metric:orders), @[Market](dim:market), @[Norway](val:market/norway), @[Finance](area:finance), @[Note](item:${acceptedItem})`,
      bodyMarkup: 'Literal \\@[words](metric:absent) and \\\\@[Orders](metric:orders)',
    })
    const response = await submit(p)
    expect(response.statusCode, response.body).toBe(200)
    const submitted = response.json<ProposalRecord>()
    expect(submitted.state).toBe('submitted')
    expect((await livePage(submitted.itemId!)).statusCode).toBe(404)
    const stored = (
      await client.query<{ summary: string; body: string; content_digest: Buffer }>(
        'select * from item_versions where id=$1',
        [submitted.itemVersionId],
      )
    ).rows[0]!
    expect(stored.summary).toBe('Orders, Market, Norway, Finance, Note')
    expect(stored.body).toBe('Literal @[words](metric:absent) and \\Orders')
    expect(
      (
        await client.query('select * from item_version_mentions where version_id=$1', [
          submitted.itemVersionId,
        ])
      ).rows,
    ).toHaveLength(6)
    const parsed = formatDraft(p.draft, people.author, 'form').version!
    expect(stored.content_digest.toString('hex')).toBe((await itemVersionDigests(parsed)).content)
    expect(
      (
        await client.query<{ level: string; outcome: string }>(
          'select level,outcome from check_results where item_version_id=$1 order by level',
          [submitted.itemVersionId],
        )
      ).rows,
    ).toEqual([
      { level: 'format', outcome: 'passed' },
      { level: 'matching', outcome: 'passed' },
      { level: 'delivery', outcome: 'passed' },
    ])
    expect(
      (
        await client.query('select * from item_version_service where version_id=$1', [
          submitted.itemVersionId,
        ])
      ).rows,
    ).toEqual([])
    expect(
      (
        await client.query('select payload from outbox_events where aggregate_id=$1', [p.id])
      ).rows.every((r) => !JSON.stringify(r).includes('Market update')),
    ).toBe(true)
    expect((await client.query('select * from audit_verify()')).rows).toEqual([])
    expect((await save(submitted, draft())).statusCode).toBe(409)
    await expect(
      client.query("update item_versions set title='Changed' where id=$1", [
        submitted.itemVersionId,
      ]),
    ).rejects.toThrow(/append.only|immutable/i)
  })
  it('replays retry keys, rejects changed requests and serializes stale saves and submissions', async () => {
    const key = randomUUID()
    const a = await write('/proposals', { draft: draft() }, 'author', key)
    const b = await write('/proposals', { draft: draft() }, 'author', key)
    expect(b.json()).toEqual(a.json())
    expect(
      (await write('/proposals', { draft: draft({ title: 'Different' }) }, 'author', key))
        .statusCode,
    ).toBe(422)
    const p = a.json<ProposalRecord>()
    const attempts = await Promise.all([
      save(p, draft({ title: 'First' })),
      save(p, draft({ title: 'Second' })),
    ])
    expect(attempts.map((r) => r.statusCode).sort()).toEqual([200, 409])
    expect(attempts.find((r) => r.statusCode === 409)!.json()).toMatchObject({
      data: { current: { revision: 2 } },
    })
    const latest = attempts.find((r) => r.statusCode === 200)!.json<ProposalRecord>()
    const submitKey = randomUUID()
    const first = await submit(latest, submitKey)
    expect(first.statusCode, first.body).toBe(200)
    expect((await submit(latest, submitKey)).json()).toEqual(first.json())
    expect((await submit(latest)).statusCode).toBe(409)
    const q = await create()
    const competing = await Promise.all([submit(q), submit(q)])
    expect(competing.map((r) => r.statusCode).sort()).toEqual([200, 409])
  })
  it('enforces proposer/owner permissions and withdrawals', async () => {
    const p = (await submit(await create())).json<ProposalRecord>()
    expect(
      (await app.inject({ url: `/api/v1/proposals/${p.id}`, headers: headers.stranger }))
        .statusCode,
    ).toBe(404)
    expect(
      (
        await write(
          `/proposals/${p.id}/withdraw`,
          { revision: p.revision, reason: 'Withdrawing' },
          'owner',
        )
      ).statusCode,
    ).toBe(403)
    const withdrawn = await write(`/proposals/${p.id}/withdraw`, {
      revision: p.revision,
      reason: 'Dates need more evidence',
    })
    expect(withdrawn.statusCode, withdrawn.body).toBe(200)
    expect(withdrawn.json()).toMatchObject({ state: 'withdrawn' })
  })
  it.each([
    { summaryMarkup: '@[Unknown](metric:unknown)' },
    { summaryMarkup: '@[Retired](item:itm_target0001)' },
    { summaryMarkup: '@[Missing](area:missing)' },
    { summaryMarkup: '@[Bad](group:payments)' },
    { title: '@[Finance](area:finance)' },
    {
      scope: { metrics: [], dimensions: [], dimensionValues: [] },
      summaryMarkup: '@[Orders](metric:orders)',
    },
    { summaryMarkup: Array.from({ length: 51 }, () => '@[D](metric:orders)').join(' ') },
    { summaryMarkup: '@[Bad label' + 'x'.repeat(121) + '](metric:orders)' },
  ] satisfies Draft[])('blocks invalid scope or mentions: %j', async (extra) => {
    const p = await create(extra)
    expect((await submit(p)).statusCode).toBe(422)
    expect(
      (
        await client.query<{ item_version_id: string | null }>(
          'select item_version_id from proposals where id=$1',
          [p.id],
        )
      ).rows[0]!.item_version_id,
    ).toBeNull()
  })
  it('names sensitive patterns and prevents storage', async () => {
    const response = await write('/proposals', {
      draft: draft({ summary: 'Contact someone@example.com' }),
    })
    expect(response.statusCode, response.body).toBe(422)
    expect(response.json()).toMatchObject({ data: { findings: [{ code: 'email_address' }] } })
    expect(
      (
        await client.query(
          "select id from proposals where draft::text like '%someone@example.com%'",
        )
      ).rows,
    ).toEqual([])
  })
  it('checks missing Cube definitions and domain mismatch from the stored snapshot', async () => {
    const p = await create({ references: ['demo:orders'], changeMarks: { 'demo:orders': '1' } })
    await client.query("update definitions set area_hint='marketing' where ref='demo:orders'")
    try {
      const response = await submit(p)
      expect(response.statusCode, response.body).toBe(200)
      // The definition and the domain by name, never the ref and the id.
      expect(response.json<ProposalRecord>().findings).toContainEqual(
        expect.objectContaining({
          code: 'domain_mismatch',
          severity: 'warning',
          message: 'Cube puts Orders in Marketing',
        }),
      )
      // A warning is for the reviewer: the format level passes (FR-505).
      expect(
        (
          await client.query<{ outcome: string }>(
            'select outcome from check_results where item_version_id=$1',
            [response.json<ProposalRecord>().itemVersionId],
          )
        ).rows[0]!.outcome,
      ).toBe('passed')
    } finally {
      await client.query("update definitions set area_hint=null where ref='demo:orders'")
    }
  })
  it('rolls back version, children, checks, retry result and state when an outbox write fails', async () => {
    const p = await create({ summaryMarkup: '@[Orders](metric:orders)' })
    const key = randomUUID()
    const before = (await client.query('select count(*) from item_versions')).rows
    await client.query(
      "create function fail_proposal_outbox() returns trigger language plpgsql as $$ begin raise exception 'outbox failure'; end $$; create trigger fail_proposal_outbox before insert on outbox_events for each row execute function fail_proposal_outbox()",
    )
    try {
      expect((await submit(p, key)).statusCode).toBe(500)
      expect((await client.query('select count(*) from item_versions')).rows).toEqual(before)
      expect(
        (await client.query('select state,item_version_id from proposals where id=$1', [p.id]))
          .rows,
      ).toEqual([{ state: 'draft', item_version_id: null }])
      expect(
        (await client.query('select key from idempotency_keys where key=$1', [key])).rows,
      ).toEqual([])
    } finally {
      await client.query(
        'drop trigger fail_proposal_outbox on outbox_events; drop function fail_proposal_outbox()',
      )
    }
    expect((await submit(p, key)).statusCode).toBe(200)
  })
})

it('resubmits changes as a new immutable version, and derives a new draft from rejection', async () => {
  const first = (await submit(await create())).json<ProposalRecord>()
  await client.query("update proposals set state='changes_requested' where id=$1", [first.id])
  let p = (
    await app.inject({ url: `/api/v1/proposals/${first.id}`, headers: headers.author })
  ).json<ProposalRecord>()
  const saved = await save(p, { ...p.draft, title: 'Revised title' })
  expect(saved.statusCode, saved.body).toBe(200)
  p = saved.json<ProposalRecord>()
  const second = await submit(p)
  expect(second.statusCode, second.body).toBe(200)
  p = second.json<ProposalRecord>()
  expect(p.itemVersionId).not.toBe(first.itemVersionId)
  expect(
    (
      await client.query<{
        title: string
        version_no: number
        supersedes_version_id: string | null
      }>(
        'select title,version_no,supersedes_version_id from item_versions where item_id=$1 order by version_no',
        [p.itemId],
      )
    ).rows,
  ).toEqual([
    { title: 'A dated note', version_no: 1, supersedes_version_id: null },
    { title: 'Revised title', version_no: 2, supersedes_version_id: first.itemVersionId },
  ])
  await client.query("update proposals set state='rejected',closed_at=now() where id=$1", [p.id])
  const derived = await write('/proposals', { derivedFrom: p.id, draft: {} })
  expect(derived.statusCode, derived.body).toBe(200)
  expect(derived.json()).toMatchObject({ state: 'draft', draft: { title: 'Revised title' } })
})
it('creates concurrent changes with unique version numbers without modifying or publishing the accepted item', async () => {
  const one = await write('/proposals', {
    itemId: acceptedItem,
    draft: draft({ title: 'One change' }),
  })
  const two = await write(
    '/proposals',
    { itemId: acceptedItem, draft: draft({ title: 'Another change' }) },
    'stranger',
  )
  expect(one.statusCode, one.body).toBe(200)
  expect(two.statusCode, two.body).toBe(200)
  const a = one.json<ProposalRecord>(),
    b = two.json<ProposalRecord>()
  const responses = await Promise.all([
    submit(a),
    write(`/proposals/${b.id}/submit`, { revision: b.revision }, 'stranger'),
  ])
  for (const response of responses) expect(response.statusCode, response.body).toBe(200)
  const versions = (
    await client.query<{ version_no: number }>(
      'select version_no from item_versions where item_id=$1 order by version_no',
      [acceptedItem],
    )
  ).rows
  expect(versions.map((v) => v.version_no)).toEqual([1, 2, 3])
  const live = await livePage(acceptedItem)
  expect(live.json<ItemPage>().item).toMatchObject({ title: 'A note', version: 1 })
  const self = await write('/proposals', {
    itemId: acceptedItem,
    draft: draft({ summaryMarkup: `@[Self](item:${acceptedItem})` }),
  })
  expect((await submit(self.json<ProposalRecord>())).statusCode).toBe(422)
})
it('gives a change that takes away an item’s end date the default review date, so it submits', async () => {
  // An item that ended has no review date; its change starts with the item's empty one.
  const ended = await write('/proposals', {
    itemId: acceptedItem,
    draft: draft({ title: 'Ended', validity: { start: '2026-08-04', end: '2026-09-30' } }),
  })
  expect(ended.statusCode, ended.body).toBe(200)
  const p = ended.json<ProposalRecord>()
  const reopened = await save(
    p,
    draft({
      title: 'Back in service',
      validity: { start: '2026-08-04', end: null },
      reviewDate: null,
    }),
  )
  expect(reopened.statusCode, reopened.body).toBe(200)
  const saved = reopened.json<ProposalRecord>()
  expect(saved.draft).toMatchObject({ validity: { end: null }, reviewDate: '2027-01-06' })
  expect(saved.findings.filter((f) => f.severity === 'error')).toEqual([])
  expect((await submit(saved)).statusCode).toBe(200)
})

it('drops the reference of a metric taken out of the scope, and keeps one given on its own', async () => {
  const both = {
    metrics: ['metric:orders', 'metric:revenue'],
    dimensions: [],
    dimensionValues: [],
  }
  const p = await create({ scope: both, references: ['cube:orders.count'] })
  expect(p.draft.references).toEqual(
    expect.arrayContaining(['demo:orders', 'cube:sales.revenue', 'cube:orders.count']),
  )
  // Its domain warning leaves with it.
  await client.query("update definitions set area_hint='marketing' where ref='cube:sales.revenue'")
  try {
    const narrowed = await save(
      p,
      draft({
        scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
        references: p.draft.references,
        changeMarks: p.draft.changeMarks,
      }),
    )
    expect(narrowed.statusCode, narrowed.body).toBe(200)
    const saved = narrowed.json<ProposalRecord>()
    expect(saved.draft.references).toEqual(
      expect.arrayContaining(['demo:orders', 'cube:orders.count']),
    )
    expect(saved.draft.references).not.toContain('cube:sales.revenue')
    expect(Object.keys(saved.draft.changeMarks ?? {})).not.toContain('cube:sales.revenue')
    expect(saved.findings.map((f) => f.code)).not.toContain('domain_mismatch')
  } finally {
    await client.query("update definitions set area_hint=null where ref='cube:sales.revenue'")
  }
})

it('returns an in-flight conflict and isolates retry keys per person', async () => {
  const key = randomUUID()
  let release!: () => void
  let locked!: () => void
  const ready = new Promise<void>((resolve) => {
    locked = resolve
  })
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const lock = database.transaction(people.author, async (tx) => {
    await tx.query(
      "select pg_advisory_xact_lock(hashtextextended(cl_person()::text || ':' || $1,0))",
      [key],
    )
    locked()
    await hold
  })
  await ready
  try {
    expect((await write('/proposals', { draft: draft() }, 'author', key)).statusCode).toBe(409)
    expect((await write('/proposals', { draft: draft() }, 'stranger', key)).statusCode).toBe(200)
  } finally {
    release()
    await lock
  }
  expect((await write('/proposals', { draft: draft() }, 'author', key)).statusCode).toBe(200)
})
it('lists only readable proposals, paginates, and enforces sign-in and CSRF before writes', async () => {
  const p = await create()
  const stranger = await create({ title: 'Hidden list content' }, 'stranger')
  const listed = await app.inject({
    url: '/api/v1/proposals?own=true&limit=100',
    headers: headers.author,
  })
  expect(listed.statusCode, listed.body).toBe(200)
  expect(
    listed.json<ProposalListResult>().rows.every((row) => row.proposerId === people.author),
  ).toBe(true)
  expect(listed.body).not.toContain(stranger.id)
  const page = await app.inject({
    url: '/api/v1/proposals?limit=1&offset=1',
    headers: headers.author,
  })
  expect(page.statusCode, page.body).toBe(200)
  expect(page.json<ProposalListResult>().rows).toHaveLength(1)
  expect(
    (await app.inject({ method: 'POST', url: '/api/v1/proposals', payload: { draft: draft() } }))
      .statusCode,
  ).toBe(401)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/proposals/${p.id}/submit`,
        headers: { ...headers.author, 'x-heed-csrf': 'wrong', 'idempotency-key': randomUUID() },
        payload: { revision: p.revision },
      })
    ).statusCode,
  ).toBe(403)
})
it('counts beyond the page limit and excludes discarded drafts from the total', async () => {
  const list = async (offset = 0) => {
    const response = await app.inject({
      url: `/api/v1/proposals?own=true&limit=100&offset=${offset}`,
      headers: headers.author,
    })
    expect(response.statusCode, response.body).toBe(200)
    return response.json<ProposalListResult>()
  }
  const before = await list()
  await client.query(
    `insert into proposals(action,area_id,proposer_id,channel,draft)
     select 'create','finance',$1,'form','{}'::jsonb from generate_series(1,105)`,
    [people.author],
  )
  const first = await list()
  expect(first.total).toBe(before.total + 105)
  expect(first.rows).toHaveLength(100)
  const second = await list(100)
  expect(second.total).toBe(first.total)
  expect(new Set([...first.rows, ...second.rows].map((p) => p.id)).size).toBe(first.total)
  await database.transaction(people.author, (tx) =>
    createProposalsService(tx, clock, people.author).discard(
      first.rows[0]!.id,
      first.rows[0]!.revision,
    ),
  )
  expect((await list()).total).toBe(first.total - 1)
})
it('keeps timestamp ordering when the local clock repeats at the end of daylight saving', async () => {
  const earlier = randomUUID()
  const later = randomUUID()
  await client.query(
    `insert into proposals(id,action,area_id,proposer_id,channel,draft,created_at)
     values ($1,'create','finance',$3,'form','{}','2026-10-25T00:30:00Z'),
            ($2,'create','finance',$3,'form','{}','2026-10-25T01:15:00Z')`,
    [earlier, later, people.approver],
  )
  const result = await database.transaction(people.approver, async (tx) => {
    await tx.query("set local timezone = 'Europe/Berlin'")
    return createProposalsService(tx, systemClock('2026-10-25'), people.approver).list({
      own: true,
    })
  })
  expect(result.rows.map((p) => p.id)).toEqual([later, earlier])
})
it('uses the Cube snapshot for mentions without deriving scope, references or domain from them', async () => {
  const p = await create({ summary: 'See @[Revenue](metric:revenue)' })
  expect(p.draft).toMatchObject({
    summary: 'See Revenue',
    summaryMarkup: 'See @[Revenue](metric:revenue)',
    scope: { metrics: ['metric:orders'] },
    references: ['demo:orders'],
    areaId: 'finance',
  })
  await client.query(
    "update definitions set missing_since_snapshot=last_seen_snapshot where ref='cube:sales.revenue'",
  )
  try {
    const blocked = await submit(p)
    expect(blocked.statusCode, blocked.body).toBe(422)
    expect(
      blocked.json<{ data: { findings: { code: string }[] } }>().data.findings.map((f) => f.code),
    ).toContain('mention_source_missing')
  } finally {
    await client.query(
      "update definitions set missing_since_snapshot=null where ref='cube:sales.revenue'",
    )
  }
  expect((await submit(p)).statusCode).toBe(200)
  const scope = await create({
    scope: { metrics: ['metric:revenue'], dimensions: [], dimensionValues: [] },
  })
  expect(scope.draft.references).toContain('cube:sales.revenue')
  expect(scope.draft.changeMarks?.['cube:sales.revenue']).toMatch(/^[a-f0-9]{64}$/)
  expect((await submit(scope)).statusCode).toBe(200)
})
it('excludes proposals outside the validity and dimension overlap and expands metric groups', async () => {
  const p = await create({
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    validity: { start: '2040-01-01', end: '2040-02-01' },
  })
  const other = await create(
    {
      scope: {
        metrics: ['metric:orders'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
      },
      validity: { start: '2040-02-01', end: '2040-03-01' },
    },
    'stranger',
  )
  // The SQL rule the review's overlaps read (FR-109).
  const overlap = async (a: Draft, b: Draft) =>
    (
      await client.query<{ overlap: boolean }>('select cl_scopes_overlap($1,$2) as overlap', [
        JSON.stringify(a),
        JSON.stringify(b),
      ])
    ).rows[0]!.overlap
  expect(await overlap(p.draft, other.draft)).toBe(false)
  expect(
    await overlap(p.draft, {
      ...p.draft,
      scope: {
        metrics: ['metric:orders'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
      },
    }),
  ).toBe(false)
  expect(
    await overlap(p.draft, {
      ...p.draft,
      scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
    }),
  ).toBe(true)
  await client.query("update vocab_terms set parent_key='group:payments' where key='metric:orders'")
  try {
    expect(
      await overlap(p.draft, {
        ...p.draft,
        scope: { metrics: ['group:payments'], dimensions: [], dimensionValues: [] },
      }),
    ).toBe(true)
  } finally {
    await client.query("update vocab_terms set parent_key=null where key='metric:orders'")
  }
})
it('honors the versioned mention limit at submit', async () => {
  const p = await create({
    summaryMarkup: '@[Orders](metric:orders) and @[Finance](area:finance)',
  })
  await client.query(
    "insert into settings_versions(key,version,value,reason) values('limits.mentions_per_version',2,'1','Test lower limit')",
  )
  try {
    const response = await submit(p)
    expect(response.statusCode, response.body).toBe(422)
    expect(
      response.json<{ data: { findings: { code: string }[] } }>().data.findings.map((f) => f.code),
    ).toContain('mention_limit')
  } finally {
    await client.query(
      "insert into settings_versions(key,version,value,reason) values('limits.mentions_per_version',3,'50','Restore limit')",
    )
  }
  expect((await submit(p)).statusCode).toBe(200)
})

it('submits a scope about any market, warns that it is broad, and overlaps every market', async () => {
  const anyMarket = {
    metrics: ['metric:orders'],
    dimensions: ['dim:market'],
    dimensionValues: [],
  }
  const p = await create({ scope: anyMarket, validity: { start: '2041-01-01', end: null } })
  expect(p.draft.scope).toEqual(anyMarket)
  expect(p.findings).toContainEqual(
    expect.objectContaining({ code: 'broad_scope', field: 'scope', severity: 'warning' }),
  )
  const submitted = await submit(p)
  expect(submitted.statusCode, submitted.body).toBe(200)
  const stored = await client.query<{ dimension_key: string }>(
    `select d.dimension_key from item_version_dimensions d
       join proposals p on p.item_version_id = d.version_id where p.id = $1`,
    [p.id],
  )
  expect(stored.rows).toEqual([{ dimension_key: 'dim:market' }])
  // A draft about Norway overlaps it: any market overlaps every market (FR-109).
  const norway = await create({
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    validity: { start: '2041-02-01', end: null },
  })
  const overlap = await client.query<{ overlap: boolean }>(
    'select cl_scopes_overlap($1,$2) as overlap',
    [JSON.stringify(norway.draft), JSON.stringify(p.draft)],
  )
  expect(overlap.rows[0]!.overlap).toBe(true)
})
