import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Comment } from '../../src/contract/comments.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Term, TermChangeResult } from '../../src/contract/terms.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { identifier, localRoles } from '../../src/server/db/roles.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/*
  Agents get the terms and synonyms people write in Definitions (FR-138; docs/product.md, sections
  3 and 10), through the MCP gateway as a client calls it. An owner of Finance writes a term with
  its own meaning (Peak season), a synonym of it (Busy season) and a synonym of a metric
  (Purchases, for Orders). Then get_context, find_context and read_context name each word used,
  with its meaning as written, who wrote it as a role and when, and its page: a synonym of a
  metric reads as the metric, and the answer states and items are those the same question gets
  without the terms. No reply names a person or holds a word of a comment, the deprecated ids keep
  their replies, and a term a person deletes is no longer served, from the next call on.
*/

const canary = 'CANARY-COMMENT-4410'
const ownerName = 'Ingrid Canaryname'
const meaning = 'The weeks from 1 November to 24 December, when online sales double.'

const { client: admin, url } = testDatabase()
const pool = servingPool(url)
const resource = 'http://localhost:3000/mcp'
const { privateKey } = generateKeyPairSync('ed25519')
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
  mcp: {
    source: createEditionSource(pool),
    store: createAnonymousStore(pool),
    resource,
    verifier: createDevVerifier(privateKey, resource, 'test'),
    now: () => new Date('2026-10-08T12:00:00Z'),
  },
})

type Who = keyof typeof people
const headers: Record<string, Record<string, string>> = {}
const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })
const ok = async <T>(response: Promise<{ statusCode: number; body: string; json: <U>() => U }>) => {
  const r = await response
  expect(r.statusCode, r.body).toBe(200)
  return r.json<T>()
}

const draft: Draft = {
  areaId: 'finance',
  kind: 'event',
  title: 'Norway webshop closed in peak season',
  summary: 'Online sales to Norway stopped on 4 August 2026, ahead of peak season.',
  scope: {
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
  },
  validity: { start: '2026-08-04', end: null },
  evidence: [
    { url: 'https://wiki.example/norway', quote: 'Sales to Norway stop', date: '2026-08-05' },
  ],
}

let wire: Client
let item: string
type Reply = {
  status: string
  say: string
  next?: string
  asked?: string | null
  context?: { id: string }[] | { id: string }
  terms?: Record<string, unknown>[]
  items?: { id: string }[]
  definitions?: { key: string; other_names?: string[] }[]
}
const tool = async (name: string, args: Record<string, unknown>) => {
  const reply = await wire.callTool({ name, arguments: args })
  expect(reply.isError, `${name}: ${JSON.stringify(reply.content)}`).not.toBe(true)
  const text = JSON.stringify(reply)
  expect(text, name).not.toContain(canary)
  expect(text, name).not.toContain(ownerName)
  return { reply: reply.structuredContent as Reply, text }
}
/** What a reply answers, without what changes from one call to the next, nor what terms add. */
const answered = (reply: Reply) => {
  const { reply_id: _id, terms: _terms, next, ...rest } = reply as Reply & { reply_id?: string }
  const kept = next?.replace(/ ?terms says .*$/, '')
  return { ...rest, next: kept || undefined }
}

const questions = {
  peak: 'Why did orders in Norway drop in peak season 2026?',
  busy: 'Why did orders in Norway drop in busy season 2026?',
  bought: 'Why did purchases in Norway drop in busy season 2026?',
  meaning: 'What does peak season mean?',
}
const before: Record<string, Reply> = {}
let peak: Term
let busy: Term
let purchases: Term

beforeAll(async () => {
  await foundation(admin)
  await admin.query('update people set display_name = $2 where id = $1', [people.owner, ownerName])
  // This file asks more than the default limits allow in a minute.
  await admin.query(
    `insert into settings_versions (key, version, value, reason)
     select key, max(version) + 1, $2::jsonb, 'test' from settings_versions where key = $1 group by key`,
    ['limits.mcp_requests_per_minute', { person: 600, client: 600 }],
  )
  await admin.query(
    `insert into settings_versions (key, version, value, reason)
     select key, max(version) + 1, $2::jsonb, 'test' from settings_versions where key = $1 group by key`,
    ['limits.mcp_rate_per_minute', { get_context: 600, find_context: 600, read_context: 600 }],
  )
  await transaction(admin, async () => {
    const [{ seq }] = (
      await admin.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area] of [
      ['metric:orders', 'Orders', 'finance'],
      ['dim:market', 'Market', null],
      ['val:market/norway', 'Norway', null],
    ]) {
      const term = await admin.query<{ id: string }>(
        `insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest)
         values($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id`,
        [key, name, area],
      )
      await admin.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await admin.query('select edition_seal($1)', [seq])
    await admin.query('select edition_publish($1)', [seq])
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

  // The item agents get, live, and a comment on it that agents never read.
  const created = await ok<ProposalRecord>(call('POST', '/proposals', 'author', { draft }))
  const sent = await ok<ProposalRecord>(
    call('POST', `/proposals/${created.id}/submit`, 'author', { revision: created.revision }),
  )
  await ok(call('POST', `/review/${sent.id}/publish`, 'owner', { revision: sent.revision }))
  item = sent.itemId!
  await ok<Comment>(
    call('POST', '/comments', 'stranger', {
      subject: `context:${item}`,
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `${canary} Peak season means only December.` }],
          },
        ],
      },
    }),
  )

  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  wire = new Client(
    { name: 'terms-agents', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await wire.connect(
    new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: {
        headers: { Authorization: `Bearer ${await mintDevToken(privateKey, resource)}` },
      },
    }),
  )

  // What agents get before anyone writes a term.
  for (const [key, question] of Object.entries(questions))
    before[key] = (await tool('get_context', { question })).reply

  // An owner of Finance writes the term, a synonym of it, and a synonym of a metric.
  peak = await ok<Term>(
    call('POST', '/terms', 'owner', { name: 'Peak season', meaning, areaId: 'finance' }),
  )
  busy = await ok<Term>(
    call('POST', '/terms', 'owner', { name: 'Busy season', sameAs: `term:${peak.id}` }),
  )
  purchases = await ok<Term>(
    call('POST', '/terms', 'owner', { name: 'Purchases', sameAs: 'metric:orders' }),
  )
}, 60_000)
afterAll(async () => {
  await wire?.close()
  await app.close()
  await pool.end()
})

const today = new Date().toISOString().slice(0, 10)
const peakEntry = (word: string, synonym = false) => ({
  word,
  name: 'Peak season',
  kind: 'term',
  ...(synonym ? { synonym: true } : {}),
  meaning,
  domain: 'Finance',
  written: { role: 'the owner of Finance', date: today },
  url: '/definitions/Peak%20season',
})

it('names the term a question uses, and answers as before it was written', async () => {
  for (const [key, word, synonym] of [
    ['peak', 'peak season', false],
    ['busy', 'busy season', true],
  ] as const) {
    const { reply, text } = await tool('get_context', { question: questions[key] })
    expect(answered(reply)).toEqual(answered(before[key]!))
    expect(reply.terms).toEqual([peakEntry(word, synonym)])
    expect(reply.next).toMatch(/never give a term as a checked source\.$/)
    expect(text).toContain(`Open in Heed - Peak season: /definitions/Peak%20season - Written`)
    const full = (await tool('get_context', { question: questions[key], response_format: 'full' }))
      .reply
    expect(full.terms).toEqual([peakEntry(word, synonym)])
  }
  // The question did name a metric with a fact that applies: the fact, not the term, checks it.
  expect(before.peak!.status).toBe('matched')
  expect((before.peak!.context as { id: string }[]).map((c) => c.id)).toEqual([item])
})

it('never makes a term on its own checked', async () => {
  const { reply } = await tool('get_context', { question: questions.meaning })
  expect(reply.status).toBe('need_more_detail')
  expect(reply.status).toBe(before.meaning!.status)
  expect(reply.context).toEqual([])
  expect(reply.terms).toEqual([peakEntry('peak season')])
  expect(answered(reply)).toEqual(answered(before.meaning!))
})

it('reads a synonym of a metric as that metric', async () => {
  const { reply } = await tool('get_context', { question: questions.bought })
  // Before the synonym, "purchases" was no name: only Norway was read, and nothing applied.
  expect(before.bought).toMatchObject({ status: 'no_match', context: [] })
  const asOrders = (await tool('get_context', { question: questions.busy })).reply
  expect(answered(reply)).toEqual(answered(asOrders))
  expect(reply.terms).toEqual([
    {
      word: 'purchases',
      name: 'Orders',
      kind: 'metric',
      synonym: true,
      domain: 'Finance',
      written: { role: 'the owner of Finance', date: today },
      url: '/definitions/Orders',
    },
    peakEntry('busy season', true),
  ])
  // Structured names take it too, as one of the metric's other names.
  const named = (
    await tool('get_context', {
      question: 'drop',
      metrics: ['Purchases'],
      window: { from: '2026-08-01', to: '2026-08-31' },
    })
  ).reply
  expect((named.context as { id: string }[]).map((c) => c.id)).toEqual([item])
})

it('names the terms of a query and of an item', async () => {
  const found = (await tool('find_context', { query: 'busy season' })).reply
  expect(found.terms).toEqual([peakEntry('busy season', true)])
  const bought = (await tool('find_context', { query: 'purchases' })).reply
  expect(bought.definitions).toEqual([
    expect.objectContaining({ key: 'metric:orders', other_names: ['Purchases'] }),
  ])
  const read = (await tool('read_context', { id: item })).reply
  expect((read.context as { id: string }).id).toBe(item)
  expect(read.terms).toEqual([peakEntry('peak season')])
})

it('keeps the deprecated ids answering with their replies', async () => {
  for (const [name, args] of [
    ['get_facts', { question: questions.bought }],
    ['find_facts', { query: 'peak season' }],
    ['search_facts', { query: 'peak season' }],
    ['read_item', { id: item }],
  ] as const) {
    const { reply, text } = await tool(name, args)
    expect(reply, name).not.toHaveProperty('terms')
    expect(text, name).toContain('use ')
  }
  // get_facts reads the synonym as the metric too: one word, one meaning.
  const { reply } = await tool('get_facts', { question: questions.bought })
  expect(reply.items!.map((i) => i.id)).toEqual([item])
})

it('serves a deleted term no more, from the next call on, and a restored one again', async () => {
  const deleted = await ok<TermChangeResult>(
    call('POST', '/terms/delete', 'owner', { ids: [peak.id, purchases.id] }),
  )
  expect(deleted.done.map((t) => t.id)).toEqual(expect.arrayContaining([peak.id, purchases.id]))
  for (const [key, question] of Object.entries(questions)) {
    const { reply } = await tool('get_context', { question })
    expect(reply, key).not.toHaveProperty('terms')
    expect(answered(reply), key).toEqual(answered(before[key]!))
  }
  expect((await tool('find_context', { query: 'busy season' })).reply).not.toHaveProperty('terms')
  expect((await tool('read_context', { id: item })).reply).not.toHaveProperty('terms')
  // Its synonym went with it.
  const listed = await ok<{ terms: Term[] }>(call('GET', '/terms', 'owner'))
  expect(listed.terms.map((t) => t.id)).not.toContain(busy.id)

  await ok(call('POST', '/terms/restore', 'owner', { ids: [peak.id] }))
  const { reply } = await tool('get_context', { question: questions.busy })
  expect(reply.terms).toEqual([peakEntry('busy season', true)])
})

it('lets the serving role read the live terms through one function, never the tables', async () => {
  await admin.query(`set role ${identifier(localRoles.serve)}`)
  try {
    const served = await admin.query<Record<string, unknown>>('select * from serving_terms()')
    expect(served.rows.map((r) => r.name)).toEqual(['Busy season', 'Peak season'])
    expect(Object.keys(served.rows[0]!).sort()).toEqual(
      [
        'area_id',
        'conflict',
        'id',
        'meaning',
        'name',
        'same_as',
        'written_as',
        'written_on',
      ].sort(),
    )
    expect(JSON.stringify(served.rows)).not.toContain(people.owner)
    for (const table of ['terms', 'term_versions', 'term_changes'])
      await expect(
        admin.query(`select 1 from ${identifier(table)} limit 1`),
        table,
      ).rejects.toMatchObject({
        code: '42501',
      })
  } finally {
    await admin.query(`set role ${identifier(localRoles.owner)}`)
  }
})

it('serves no word a sync gave a second meaning, nor a synonym of it', async () => {
  // A sync: the definitions source now lists "Peak season" as another name for Orders.
  await transaction(admin, async () => {
    await admin.query(
      "insert into connector_snapshots (connector_id, status, definitions_seen) values ('demo', 'ok', 1)",
    )
    await admin.query("update definitions set synonyms = '{Peak season}' where ref = 'demo:orders'")
    await admin.query(
      `insert into vocab_term_refs (version_id, definition_ref)
       select s.version_id, 'demo:orders' from vocab_term_service s where s.term_key = 'metric:orders'`,
    )
  })
  const listed = await ok<{ terms: Term[] }>(call('GET', '/terms', 'owner'))
  expect(listed.terms.find((t) => t.id === peak.id)!.conflict).toMatchObject({ code: 'source' })
  for (const question of [questions.peak, questions.busy]) {
    const { reply } = await tool('get_context', { question })
    expect(reply, question).not.toHaveProperty('terms')
  }
  expect((await tool('read_context', { id: item })).reply).not.toHaveProperty('terms')
})
