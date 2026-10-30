import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Feed } from '../../src/contract/inbox.ts'
import type { ReviewSheet } from '../../src/contract/review-path.ts'
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
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  A content source end to end (CON-601 to CON-611), on the real service and PostgreSQL 18, with a
  Git host on this machine that wants a token: an admin tests Markdown in Git, chooses its folders
  and maps each to a domain, and the read turns each document into one suggestion for that
  domain's owners. A read never publishes: an owner does. A changed document replaces its
  suggestion, a deleted one withdraws it, a returned mark is not offered again, a document that
  names people is skipped, the day's cap makes the rest wait, and nothing of a document is kept
  but what CON-605 allows.
*/

const TOKEN = 'content-it-token-5d1f0a77'
const LINK = 'https://git.example.test/handbook/blob/{commit}/{path}'
const { client, url } = testDatabase()
const database = apiDatabase(url)
const logger = createLogger({ level: 'silent' })
const clock = systemClock('2026-10-08')
const secretsDir = await mkdtemp(join(tmpdir(), 'heed-content-secrets-'))
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
    await client.query<{
      id: string
      state: string
      document: string
      title: string
      proposer: string | null
      channel: string
      revision: number
      item: string | null
    }>(
      `select p.id::text, p.state::text as state, p.source_document_id as document,
              p.draft->>'title' as title, p.proposer_id::text as proposer, p.channel::text as channel,
              p.revision, p.item_id as item
         from proposals p where p.source_id = $1 order by p.created_at, p.number`,
      [source],
    )
  ).rows
const open = async (source: string) =>
  (await suggestions(source)).filter((s) => ['submitted', 'in_review'].includes(s.state))

const doc = (title: string, text: string) => `# ${title}\n\n${text}\n`
const handbook = {
  'docs/finance/orders-norway.md': doc(
    'Orders in Norway include marketplace orders',
    'From 1 October 2026, orders in Norway include orders placed through the marketplace. The webshop alone is no longer the whole picture.',
  ),
  'docs/finance/orders-spain.md': doc(
    'Orders in Spain leave out test accounts',
    'Orders in Spain leave out the accounts our teams use to test the webshop.',
  ),
  'docs/finance/contacts.md': doc(
    'Who to ask about orders',
    'Ask anna@example.test about orders in Norway.',
  ),
  'docs/finance/lunch.md': doc('Lunch', 'The canteen opens at noon on weekdays.'),
  'docs/people/onboarding.md': doc('Onboarding', 'Orders are reviewed weekly.'),
}

let sourceId = ''

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query(
      "insert into vocab_terms(key,kind,parent_key) values ('val:market/spain','dimension_value','dim:market')",
    )
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area] of [
      ['metric:orders', 'Orders', 'finance'],
      ['dim:market', 'Market', null],
      ['val:market/norway', 'Norway', null],
      ['val:market/spain', 'Spain', null],
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
}, 120_000)
afterAll(async () => {
  await app.close()
  await host.close()
  await rm(secretsDir, { recursive: true, force: true })
})

const config = () => ({
  repository: host.address('handbook'),
  ref: 'main',
  folder: 'docs',
  fileLink: LINK,
})

describe('adding Markdown in Git (CON-601, CON-602)', () => {
  it('is a connector an admin may add, and its test lists the folders to choose from', async () => {
    const types = await ok<{ manifest: { id: string; kind: string } }[]>(
      call('GET', '/sources/types', 'admin'),
    )
    expect(types.find((t) => t.manifest.id === 'git-markdown')?.manifest.kind).toBe('content')
    const check = await ok<SourceCheck>(
      call('POST', '/sources/test', 'admin', {
        type: 'git-markdown',
        config: config(),
        secrets: { token: TOKEN },
      }),
    )
    expect(check.ok, JSON.stringify(check)).toBe(true)
    expect(check.steps.map((step) => [step.id, step.status])).toEqual([
      ['reach', 'ok'],
      ['folders', 'ok'],
      ['documents', 'ok'],
    ])
    // A folder suggests the domain its name says only when that is one of the workspace's.
    expect(check.scopes).toEqual([
      { id: 'finance', title: 'docs/finance', suggestedDomain: 'finance' },
      { id: 'people', title: 'docs/people', suggestedDomain: null },
    ])
    // A refused token says so in its own step, and nothing is kept.
    const refused = await ok<SourceCheck>(
      call('POST', '/sources/test', 'admin', {
        type: 'git-markdown',
        config: config(),
        secrets: { token: 'not-the-token' },
      }),
    )
    expect(refused.steps).toMatchObject([{ id: 'reach', status: 'failed' }])
    expect(
      (
        await call('POST', '/sources/test', 'owner', {
          type: 'git-markdown',
          config: config(),
          secrets: {},
        })
      ).statusCode,
    ).toBe(403)
  })

  it('needs a folder mapped to a domain, at or above its schedule minimum', async () => {
    const base = {
      type: 'git-markdown',
      name: 'Handbook',
      config: config(),
      secrets: { token: TOKEN },
      reason: 'Read the handbook',
    }
    const none = await call('POST', '/sources', 'admin', base)
    expect(none.statusCode, none.body).toBe(422)
    const unknown = await call('POST', '/sources', 'admin', {
      ...base,
      scopes: [{ id: 'finance', title: 'docs/finance', domain: 'people' }],
    })
    expect(unknown.statusCode).toBe(422)
    expect(unknown.body).toContain("people isn't a domain")
    const often = await call('POST', '/sources', 'admin', {
      ...base,
      scopes: [{ id: 'finance', title: 'docs/finance', domain: 'finance' }],
      schedule: 'PT5M',
    })
    expect(often.statusCode).toBe(422)
    const added = await ok<SourceSettings>(
      call('POST', '/sources', 'admin', {
        ...base,
        scopes: [{ id: 'finance', title: 'docs/finance', domain: 'finance' }],
        schedule: 'P1D',
      }),
      201,
    )
    expect(added).toMatchObject({
      type: 'git-markdown',
      scopes: [{ id: 'finance', domain: 'finance' }],
      schedule: 'P1D',
      secrets: [{ key: 'token', set: true }],
    })
    sourceId = added.id
  })
})

describe('a read of a content source (CON-603 to CON-611)', () => {
  it('turns each document into one suggestion for its domain, and never publishes (CON-604)', async () => {
    const before = await client.query<{ editions: string; served: string; decisions: string }>(
      `select (select max(seq) from editions)::text as editions,
              (select count(*) from item_version_service)::text as served,
              (select count(*) from decisions)::text as decisions`,
    )
    const result = await read()
    expect(result.connectors[sourceId]).toMatchObject({
      status: 'ok',
      documentsSeen: 4,
      suggested: 2,
      skipped: 2,
    })
    const made = await suggestions(sourceId)
    expect(made.map((s) => [s.document, s.state, s.channel, s.proposer])).toEqual([
      ['docs/finance/orders-norway.md', 'submitted', 'source', null],
      ['docs/finance/orders-spain.md', 'submitted', 'source', null],
    ])
    // Nothing published, decided or served: a read only suggests.
    const after = await client.query(
      `select (select max(seq) from editions)::text as editions,
              (select count(*) from item_version_service)::text as served,
              (select count(*) from decisions)::text as decisions`,
    )
    expect(after.rows).toEqual(before.rows)
    // A document that names people is skipped (CON-608), and so is one that applies nowhere.
    const kept = await client.query<{
      document_id: string
      state: string
      skip_reason: string | null
    }>(
      `select document_id, state, skip_reason from connector_documents where source_id=$1 order by document_id`,
      [sourceId],
    )
    expect(kept.rows).toEqual([
      { document_id: 'docs/finance/contacts.md', state: 'skipped', skip_reason: 'names_people' },
      { document_id: 'docs/finance/lunch.md', state: 'skipped', skip_reason: 'no_scope' },
      { document_id: 'docs/finance/orders-norway.md', state: 'drafted', skip_reason: null },
      { document_id: 'docs/finance/orders-spain.md', state: 'drafted', skip_reason: null },
    ])
  })

  it('keeps per document only its id, link, title, mark and a quote, never the text (CON-605)', async () => {
    const rows = await client.query<{ row: string }>(
      `select row_to_json(d)::text as row from connector_documents d where source_id=$1`,
      [sourceId],
    )
    const kept = rows.rows.map((r) => r.row).join('\n')
    expect(kept).not.toContain('The webshop alone is no longer the whole picture')
    // A skipped document keeps none of its words: the one that names a person has no quote.
    expect(kept).not.toContain('anna@example.test')
    const [contacts] = (
      await client.query<{ quote: string }>(
        `select quote from connector_documents where document_id='docs/finance/contacts.md'`,
      )
    ).rows
    expect(contacts!.quote).toBe('')
    const [norway] = (
      await client.query<{ quote: string; link: string }>(
        `select quote, link from connector_documents where document_id='docs/finance/orders-norway.md'`,
      )
    ).rows
    expect(norway!.quote).toBe(
      'From 1 October 2026, orders in Norway include orders placed through the marketplace.',
    )
    expect(norway!.link).toMatch(
      /^https:\/\/git\.example\.test\/handbook\/blob\/[0-9a-f]{40}\/docs\/finance\/orders-norway\.md$/,
    )
    // The token is in the secret store only.
    const everything = await client.query<{ all: string }>(
      `select (select json_agg(c)::text from connectors c) || (select json_agg(s)::text from connector_snapshots s)
              || (select json_agg(a)::text from audit_log a) as all`,
    )
    expect(everything.rows[0]!.all).not.toContain(TOKEN)
  })

  it('shows its suggestions in the owners’ Inbox under the read, created by the read', async () => {
    const feed = await ok<Feed>(call('GET', '/inbox/feed?tab=needs', 'owner'))
    const cards = feed.cards.filter((c) => c.group === 'suggestion' && c.synced)
    expect(cards).toHaveLength(2)
    const [card] = cards
    if (card?.group !== 'suggestion') throw new Error('not a suggestion')
    expect(card.from).toBeNull()
    expect(card.writtenBy).toBe('source')
    expect(card.synced).toMatchObject({
      source: { id: sourceId, name: 'Handbook', tool: 'Markdown in Git' },
      scope: 'docs/finance',
    })
    expect(
      new Set(cards.map((c) => (c.group === 'suggestion' ? c.synced?.read.id : null))).size,
    ).toBe(1)
    const sheet = await ok<ReviewSheet>(call('GET', `/review/${card.proposalId}/sheet`, 'owner'))
    expect(sheet.from).toBeNull()
    expect(sheet.synced?.document.title).toBe(card.synced!.document.title)
    expect(sheet.readiness).toMatchObject({ ok: true })
    // Owners were told once for the read, not once per suggestion.
    const told = await client.query<{ topic: string }>(
      `select topic from outbox_events where topic like 'source.%' or (topic like 'proposal.%' and aggregate_id in
         (select id::text from proposals where source_id=$1))`,
      [sourceId],
    )
    expect(told.rows.map((r) => r.topic)).toEqual(['source.suggested'])
  })

  it('reads a source again on an admin’s word, whatever its schedule (CON-115)', async () => {
    await client.query(
      `update connectors set next_read_at = now() + interval '1 day' where id=$1`,
      [sourceId],
    )
    expect((await call('POST', `/sources/${sourceId}/read`, 'owner')).statusCode).toBe(403)
    // The job runner is not running here, so it says so; the source is due all the same.
    const asked = await call('POST', `/sources/${sourceId}/read`, 'admin')
    expect(asked.statusCode, asked.body).toBe(503)
    const [due] = (
      await client.query<{ due: boolean }>(
        'select next_read_at <= now() as due from connectors where id=$1',
        [sourceId],
      )
    ).rows
    expect(due!.due).toBe(true)
    expect((await call('POST', '/sources/nothing-here/read', 'admin')).statusCode).toBe(404)
  })

  it('reads an unchanged repository as nothing new', async () => {
    const result = await read()
    expect(result.connectors[sourceId]).toMatchObject({ status: 'ok', suggested: 0, skipped: 0 })
    expect(await open(sourceId)).toHaveLength(2)
    // Its own schedule (CON-115): once a day, so the job's next turn leaves it alone.
    const [next] = (
      await client.query<{ hours: number }>(
        `select round(extract(epoch from next_read_at - now()) / 3600)::int as hours
           from connectors where id=$1`,
        [sourceId],
      )
    ).rows
    expect(next!.hours).toBe(24)
    const again = await connectorSyncJob(registry, { clock }).run({
      database,
      logger,
      signal: new AbortController().signal,
    })
    expect(again).toEqual({ connectors: {} })
  })

  it('replaces the suggestion of a changed document instead of adding one (CON-606)', async () => {
    await host.commit('handbook', {
      ...handbook,
      'docs/finance/orders-spain.md': doc(
        'Orders in Spain leave out test accounts',
        'Orders in Spain leave out the 340 accounts our teams use to test the webshop.',
      ),
    })
    const result = await read()
    expect(result.connectors[sourceId]).toMatchObject({ suggested: 1, replaced: 1 })
    const spain = (await suggestions(sourceId)).filter(
      (s) => s.document === 'docs/finance/orders-spain.md',
    )
    expect(spain.map((s) => s.state)).toEqual(['withdrawn', 'submitted'])
    expect(await open(sourceId)).toHaveLength(2)
  })

  it('does not offer a returned document again until it changes (CON-606)', async () => {
    const norway = (await open(sourceId)).find(
      (s) => s.document === 'docs/finance/orders-norway.md',
    )!
    await ok(
      call('POST', `/review/${norway.id}/return`, 'owner', {
        revision: norway.revision,
        note: 'We count the marketplace apart',
      }),
    )
    await read()
    expect(
      (await suggestions(sourceId)).filter((s) => s.document === 'docs/finance/orders-norway.md'),
    ).toMatchObject([{ state: 'changes_requested' }])
  })

  it('lets an owner publish one, and tells them when its document is gone (CON-609)', async () => {
    const spain = (await open(sourceId)).find((s) => s.document === 'docs/finance/orders-spain.md')!
    const published = await ok<{ proposal: { state: string } }>(
      call('POST', `/review/${spain.id}/publish`, 'owner', { revision: spain.revision }),
    )
    expect(published.proposal.state).toBe('accepted')
    const { item } = (await suggestions(sourceId)).find((s) => s.id === spain.id)!
    // The library and the item read like any other once published.
    const library = await call('GET', '/library', 'owner')
    expect(library.statusCode, library.body).toBe(200)
    await host.commit('handbook', {
      'docs/finance/orders-norway.md': handbook['docs/finance/orders-norway.md'],
      'docs/finance/contacts.md': handbook['docs/finance/contacts.md'],
      'docs/finance/lunch.md': handbook['docs/finance/lunch.md'],
    })
    await read()
    const gone = await client.query<{ topic: string; area_id: string; aggregate_id: string }>(
      `select topic, area_id, aggregate_id from outbox_events where topic='source.document_gone'`,
    )
    expect(gone.rows).toEqual([
      { topic: 'source.document_gone', area_id: 'finance', aggregate_id: item },
    ])
    // The item stays: only its owners decide what becomes of it.
    const served = await client.query(
      `select 1 from item_version_service where item_id=$1 and editions @> (select seq from live_edition)`,
      [item],
    )
    expect(served.rowCount).toBe(1)
  })

  it('withdraws the open suggestion of a deleted document', async () => {
    await host.commit('handbook', {
      ...handbook,
      'docs/finance/orders-denmark.md': doc(
        'Orders in Norway exclude refunds',
        'Orders in Norway exclude refunds.',
      ),
    })
    await read()
    expect((await open(sourceId)).map((s) => s.document)).toContain(
      'docs/finance/orders-denmark.md',
    )
    await host.commit('handbook', { ...handbook })
    const result = await read()
    expect(result.connectors[sourceId]).toMatchObject({ withdrawn: 1 })
    expect((await open(sourceId)).map((s) => s.document)).not.toContain(
      'docs/finance/orders-denmark.md',
    )
  })

  it('withdraws what leaves the chosen folders when an admin changes them', async () => {
    const settings = await ok<SourceSettings>(call('GET', `/sources/${sourceId}`, 'admin'))
    await ok(
      call('PUT', `/sources/${sourceId}`, 'admin', {
        id: sourceId,
        revision: settings.revision,
        name: settings.name,
        config: settings.config,
        secrets: {},
        scopes: [{ id: 'people', title: 'docs/people', domain: 'finance' }],
        reason: 'Read the people folder only',
      }),
    )
    // A day on, so the day's cap leaves room.
    await client.query(
      `update proposals set created_at = created_at - interval '25 hours' where source_id=$1`,
      [sourceId],
    )
    await read()
    expect((await open(sourceId)).map((s) => s.document)).toEqual(['docs/people/onboarding.md'])
  })

  it('makes the rest wait past the day’s cap, and holds the cursor for them (CON-607)', async () => {
    const many: Record<string, string> = {}
    for (const market of ['Norway', 'Spain'])
      for (let n = 1; n <= 4; n++)
        many[`docs/people/orders-${market.toLowerCase()}-${n}.md`] = doc(
          `Orders in ${market}, note ${n}`,
          `Orders in ${market} follow rule ${n} of the handbook.`,
        )
    const yesterday = () =>
      client.query(
        `update proposals set created_at = created_at - interval '25 hours' where source_id=$1`,
        [sourceId],
      )
    const reads = () =>
      client.query<{ cursor: string | null; waiting: number; version: string }>(
        `select cursor, waiting, source_version as version from connector_snapshots
          where connector_id=$1 and status <> 'failed' order by fetched_at desc`,
        [sourceId],
      )
    await yesterday()
    const held = (await reads()).rows[0]!.cursor
    await host.commit('handbook', { ...handbook, ...many })
    // Five a day (the manifest): the other three wait, and the read keeps the cursor it had.
    const result = await read()
    expect(result.connectors[sourceId]).toMatchObject({ suggested: 5, waiting: 3 })
    const [waited] = (await reads()).rows
    expect(waited).toMatchObject({ waiting: 3, cursor: held })
    expect(waited!.version).not.toBe(held)
    // A day later the waiting documents go first, and the cursor moves on.
    await yesterday()
    const next = await read()
    expect(next.connectors[sourceId]).toMatchObject({ suggested: 3, waiting: 0 })
    expect((await reads()).rows[0]).toMatchObject({ waiting: 0, cursor: waited!.version })
  })

  it('keeps every suggestion when a read would withdraw too many at once', async () => {
    const before = await open(sourceId)
    expect(before.length).toBeGreaterThan(5)
    await host.commit('handbook', {
      'docs/people/onboarding.md': handbook['docs/people/onboarding.md'],
    })
    const result = await read()
    expect(result.connectors[sourceId]).toMatchObject({ status: 'partial', withdrawn: 0 })
    expect(await open(sourceId)).toEqual(before)
    const [last] = (
      await client.query<{ warnings: { code: string }[] }>(
        `select warnings from connector_snapshots where connector_id=$1 order by fetched_at desc limit 1`,
        [sourceId],
      )
    ).rows
    expect(last!.warnings.map((w) => w.code)).toContain('too_many_removals')
  })

  it('withdraws the old suggestion of a changed document whose new one the checks refuse', async () => {
    const onboarding = 'docs/people/onboarding.md'
    expect((await open(sourceId)).map((s) => s.document)).toContain(onboarding)
    await host.commit('handbook', {
      'docs/people/onboarding.md': doc('Onboarding', 'Orders are reviewed every week.'),
    })
    await client.query("update areas set archived_at = now() where id = 'finance'")
    try {
      const result = await read()
      expect(result.connectors[sourceId]).toMatchObject({ withdrawn: 1 })
    } finally {
      await client.query("update areas set archived_at = null where id = 'finance'")
    }
    expect((await open(sourceId)).map((s) => s.document)).not.toContain(onboarding)
    const [kept] = (
      await client.query<{ state: string; skip_reason: string | null }>(
        `select state, skip_reason from connector_documents where source_id=$1 and document_id=$2`,
        [sourceId, onboarding],
      )
    ).rows
    expect(kept).toEqual({ state: 'skipped', skip_reason: 'not_valid' })
    expect(
      (await suggestions(sourceId)).filter((s) => s.document === onboarding).at(-1)?.state,
    ).toBe('withdrawn')
  })

  it('reads as nobody in its own transaction, which may write only its own suggestions', async () => {
    // Row security: a transaction that names no source may not write a suggestion nobody proposed.
    await expect(
      database.transaction(null, (tx) =>
        tx
          .query(`update proposals set reason='x' where source_id=$1`, [sourceId])
          .then((rows) => rows.length),
      ),
    ).resolves.toBe(0)
    await expect(
      database.transaction(
        null,
        (tx) =>
          tx.query(
            `insert into proposals (action, area_id, channel, source_id, source_read_id, source_document_id)
             select 'create', 'finance', 'source', 'other', source_read_id, source_document_id
               from proposals where source_id=$1 limit 1`,
            [sourceId],
          ),
        { source: 'other' },
      ),
    ).rejects.toThrow()
    await expect(
      database.transaction(people.admin, () => Promise.resolve(), { source: sourceId }),
    ).rejects.toThrow(/no person/)
  })
})

describe('disconnecting a content source (CON-118)', () => {
  it('reads it no more, withdraws its open suggestions and forgets its token; what owners published stays', async () => {
    const waiting = await open(sourceId)
    expect(waiting.length).toBeGreaterThan(0)
    const [{ ref }] = (
      await client.query<{ ref: string }>('select secret_ref as ref from connectors where id=$1', [
        sourceId,
      ])
    ).rows as [{ ref: string }]
    expect(await store.read(ref)).toEqual({ token: TOKEN })
    const live = async () =>
      (
        await client.query<{ n: string }>(
          `select count(*)::text as n from item_version_service
            where editions @> (select seq from live_edition)`,
        )
      ).rows[0]!.n
    const served = await live()
    const reason = { reason: 'The handbook moved to the wiki' }
    const refused = await call('POST', `/sources/${sourceId}/disconnect`, 'owner', reason)
    expect(refused.statusCode).toBe(403)
    expect(
      await ok<{ id: string }>(call('POST', `/sources/${sourceId}/disconnect`, 'admin', reason)),
    ).toEqual({
      id: sourceId,
    })
    // Its open suggestions are withdrawn, as the source; what owners published is still served.
    expect(await open(sourceId)).toEqual([])
    const withdrawn = await client.query<{ reason: string }>(
      `select reason from proposals where id = any($1::uuid[])`,
      [waiting.map((s) => s.id)],
    )
    expect(withdrawn.rows.map((r) => r.reason)).toEqual(
      waiting.map(() => 'The source was disconnected.'),
    )
    expect(await live()).toBe(served)
    // Its token is gone from the store, and the history log says so without it.
    expect(await store.read(ref)).toBeNull()
    const logged = await client.query<{ details: Record<string, unknown> }>(
      `select details from audit_log where action='source.removed' and subject_id=$1`,
      [sourceId],
    )
    expect(logged.rows).toHaveLength(1)
    expect(logged.rows[0]!.details).toMatchObject({
      type: 'git-markdown',
      secrets: { token: 'removed' },
      reason: reason.reason,
    })
    expect(JSON.stringify(logged.rows)).not.toContain(TOKEN)
    // It leaves Integrations, and nothing finds it again: settings, reads, Read again, Pause.
    const list = await ok<{ id: string }[]>(call('GET', '/sources', 'admin'))
    expect(list.map((s) => s.id)).not.toContain(sourceId)
    for (const [method, path, payload] of [
      ['GET', `/sources/${sourceId}`, undefined],
      ['GET', `/sources/${sourceId}/activity`, undefined],
      ['POST', `/sources/${sourceId}/read`, {}],
      ['PUT', `/sources/${sourceId}/paused`, { paused: true, reason: 'x' }],
      ['POST', `/sources/${sourceId}/disconnect`, reason],
    ] as const) {
      const response = await call(method, path, 'admin', payload)
      expect(response.statusCode, `${method} ${path}`).toBe(404)
    }
    // The job reads it no more.
    const result = await read()
    expect(result.connectors[sourceId]).toBeUndefined()
    expect(result.connectors[`${sourceId}.disconnected`]).toEqual({ withdrawn: 0 })
  })
})
