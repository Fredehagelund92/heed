import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Comment } from '../../src/contract/comments.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { deprecatedTools } from '../../src/domain/mcp-text.ts'
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
  Agents never read comments (FR-817; docs/product.md, section 9, rule 5). People comment on a
  live context item, and on a suggestion that changes it, with words that contradict it; a reply,
  a mention and reactions too, and what the screens add: an edit that writes the words again, and
  a return whose note is the suggestion's first comment. Then an owner publishes, which seals a new edition while those
  comments stand. Every tool an agent may call answers about the item, and no reply holds a word
  of any comment, and neither does what people read of the same answers (Ask, and Try it on a
  suggestion). Three more locks: the serving and analytics roles may read none of the comment
  tables; the edition the agents read is built without them; and no code on the agents' read path
  names them.
*/

const canary = 'CANARY-COMMENT-7731'
const contradiction = `${canary} This is wrong: since 1 October the 312 test accounts are counted in Norway orders.`

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
    now: () => new Date(),
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

const draft = (extra: Draft = {}): Draft => ({
  areaId: 'finance',
  kind: 'note',
  title: 'Units sold excludes test accounts',
  summary: 'Orders in Norway leave out the 312 accounts our teams use to test the webshop.',
  scope: {
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
  },
  validity: { start: '2026-01-01', end: null },
  evidence: [
    {
      url: 'https://wiki.example/units-sold',
      quote: 'Test accounts are left out',
      date: '2026-10-01',
    },
  ],
  ...extra,
})
async function submitted(extra: Draft = {}, itemId?: string) {
  const p = await ok<ProposalRecord>(
    call('POST', '/proposals', 'author', { draft: draft(extra), ...(itemId ? { itemId } : {}) }),
  )
  return ok<ProposalRecord>(
    call('POST', `/proposals/${p.id}/submit`, 'author', { revision: p.revision }),
  )
}
const publish = (p: ProposalRecord, relations: { itemId: string; relation: string }[] = []) =>
  ok<{ edition: { label: string } | null }>(
    call('POST', `/review/${p.id}/publish`, 'owner', {
      revision: p.revision,
      ...(relations.length ? { relations } : {}),
    }),
  )
const words = (text: string, mention?: Who) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text },
        ...(mention
          ? [{ type: 'mention', attrs: { id: `person:${people[mention]}`, label: mention } }]
          : []),
      ],
    },
  ],
})

let wire: Client
let item: string
let sealed: string
/** The suggestion that changes the item, with a comment on it, still waiting. */
let change: ProposalRecord

beforeAll(async () => {
  await foundation(admin)
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

  // The item agents get, live.
  const first = await submitted()
  await publish(first)
  item = first.itemId!

  // Comments that contradict it, everywhere a comment can be.
  const subject = `context:${item}`
  const top = await ok<Comment>(
    call('POST', '/comments', 'stranger', { subject, body: words(contradiction) }),
  )
  await ok(
    call('POST', '/comments', 'admin', {
      subject,
      parentId: top.id,
      body: words(`${canary} Agreed, ask`, 'owner'),
    }),
  )
  await ok(call('POST', '/reactions/toggle', 'admin', { subject, emoji: '👍' }))
  await ok(call('POST', '/reactions/toggle', 'owner', { subject, commentId: top.id, emoji: '🤔' }))
  change = await submitted(
    {
      summary:
        'Orders in Norway leave out the 312 accounts our teams use to test the webshop, and the returns team.',
    },
    item,
  )
  await ok(
    call('POST', '/comments', 'owner', {
      subject: `review:${change.id}`,
      body: words(contradiction),
    }),
  )
  // An edit writes the words again; a return's note is the first comment of its suggestion.
  await ok(
    call('PUT', `/comments/${top.id}`, 'stranger', {
      body: words(`${contradiction} Edited to be sure.`),
    }),
  )
  const returned = await submitted(
    {
      summary:
        'Orders in Norway leave out the 312 accounts our teams use to test the webshop, and support.',
    },
    item,
  )
  await ok(
    call('POST', `/review/${returned.id}/return`, 'owner', {
      revision: returned.revision,
      note: contradiction,
      body: words(contradiction, 'author'),
    }),
  )

  // An owner publishes while the comments stand: a new edition is sealed and served.
  const other = await submitted({
    title: 'Staff orders count in Norway',
    summary: 'Orders in Norway include the orders our staff place for themselves.',
  })
  const published = await publish(other, [{ itemId: item, relation: 'unrelated' }])
  sealed = published.edition!.label
  await ok(
    call('POST', '/comments', 'stranger', {
      subject: `context:${other.itemId!}`,
      body: words(contradiction),
    }),
  )

  await admin.query("update tool_config set enabled=true where tool='get_related'")
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  wire = new Client(
    { name: 'comments-agents', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await wire.connect(
    new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: {
        headers: { Authorization: `Bearer ${await mintDevToken(privateKey, resource)}` },
      },
    }),
  )
}, 60_000)
afterAll(async () => {
  await wire?.close()
  await app.close()
  await pool.end()
})

it('gives agents the item, and no word of a comment, from every tool', async () => {
  const listed = (await wire.listTools()).tools.map((t) => t.name)
  const question = { question: 'Orders in Norway 2026' }
  const calls: { name: string; arguments: Record<string, unknown> }[] = [
    { name: 'get_context', arguments: question },
    { name: 'get_context', arguments: { ...question, response_format: 'full' } },
    { name: 'find_context', arguments: { query: 'test accounts Norway' } },
    { name: 'find_context', arguments: { query: canary } },
    { name: 'read_context', arguments: { id: item } },
    { name: 'get_related', arguments: { id: item, depth: 2 } },
    { name: 'get_facts', arguments: question },
    { name: 'find_facts', arguments: { query: 'test accounts Norway' } },
    { name: 'search_facts', arguments: { query: 'test accounts' } },
    { name: 'search_context', arguments: { query: 'test accounts' } },
    { name: 'read_item', arguments: { id: item } },
  ]
  // Every read tool an agent is offered is called here; report and the suggestion tools write.
  const writes = ['report', 'report_gap', 'give_feedback', 'suggest_context', 'draft_context']
  expect(listed.filter((t) => !writes.includes(t)).sort()).toEqual(
    [...new Set(calls.map((c) => c.name))].filter((t) => listed.includes(t)).sort(),
  )
  let replyId: string | undefined
  for (const request of calls) {
    if (!listed.includes(request.name)) continue
    const reply = await wire.callTool(request)
    expect(reply.isError, `${request.name}: ${JSON.stringify(reply.content)}`).not.toBe(true)
    const text = JSON.stringify(reply)
    expect(text, request.name).not.toContain(canary)
    expect(text, request.name).not.toContain('since 1 October the 312 test accounts')
    if (request.name === 'get_context') {
      const short = reply.structuredContent as {
        reply_id: string
        edition: string
        context: { id: string }[]
      }
      expect(short.edition).toBe(sealed)
      expect(short.context.map((c) => c.id)).toContain(item)
      replyId = short.reply_id
    }
    if (request.name === 'read_context') expect(text).toContain('312 accounts')
  }
  const reported = await wire.callTool({
    name: 'report',
    arguments: { kind: 'wrong', reply_id: replyId!, context_id: item },
  })
  expect(reported.isError).not.toBe(true)
  expect(JSON.stringify(reported)).not.toContain(canary)
  for (const name of Object.keys(deprecatedTools))
    if (listed.includes(name) && !writes.includes(name))
      expect(
        calls.map((c) => c.name),
        name,
      ).toContain(name)
})

it("gives people's Ask and Try it, built on the same answers, no word of a comment", async () => {
  const scope = {
    metrics: ['metric:orders'],
    dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
  }
  const reads: [string, object][] = [
    ['/ask/lookup', { question: 'Orders in Norway 2026' }],
    ['/ask/lookup', { question: 'test accounts in Norway' }],
    ['/try-it', scope],
    ['/try-it', { ...scope, draft: change.id }],
  ]
  for (const [path, body] of reads) {
    const response = await call('POST', path, 'owner', body)
    expect(response.statusCode, `${path}: ${response.body}`).toBe(200)
    for (const words of [canary, 'This is wrong', 'Edited to be sure'])
      expect(response.body, `${path} ${JSON.stringify(body)}`).not.toContain(words)
  }
  // The items people read there are the item, with its own words.
  const tried = await ok<{ result: { items?: { id: string }[] } }>(
    call('POST', '/try-it', 'owner', scope),
  )
  expect(tried.result.items?.map((i) => i.id)).toContain(item)
})

it('builds the edition agents read without the comments', async () => {
  const [edition] = (
    await admin.query<{ seq: string; label: string }>(
      'select e.seq::text, e.label from editions e join live_edition l on l.seq=e.seq',
    )
  ).rows
  expect(edition!.label).toBe(sealed)
  await admin.query(`set role ${identifier(localRoles.serve)}`)
  try {
    const served = await admin.query('select * from serving_items($1)', [edition!.seq])
    expect(served.rows.length).toBeGreaterThan(0)
    expect(JSON.stringify(served.rows)).not.toContain(canary)
    const reviews = await admin.query('select * from serving_reviews($1)', [edition!.seq])
    expect(JSON.stringify(reviews.rows)).not.toContain(canary)
  } finally {
    await admin.query(`set role ${identifier(localRoles.owner)}`)
  }
})

it('grants the serving and analytics roles nothing on the comment tables', async () => {
  for (const role of [localRoles.serve, localRoles.readonly])
    for (const table of ['comments', 'comment_mentions', 'reactions', 'thread_reads']) {
      await admin.query(`set role ${identifier(role)}`)
      try {
        await expect(
          admin.query(`select 1 from ${identifier(table)} limit 1`),
          `${role} ${table}`,
        ).rejects.toMatchObject({
          code: '42501',
        })
      } finally {
        await admin.query(`set role ${identifier(localRoles.owner)}`)
      }
    }
})

it('names the comment tables nowhere on the agents’ read path', async () => {
  const reads =
    /\b(from|join|into|update)\s+(public\.)?(comments|comment_mentions|reactions|thread_reads)\b/i
  const files = async (dir: string): Promise<string[]> =>
    (await readdir(dir, { withFileTypes: true, recursive: true }))
      .filter((f) => f.isFile() && f.name.endsWith('.ts'))
      .map((f) => join(f.parentPath, f.name))
  const path = [
    ...(await files('src/server/mcp')),
    ...(await files('src/server/modules/editions')),
    ...(await files('src/server/modules/answer')),
  ]
  expect(path.length).toBeGreaterThan(10)
  for (const file of path) expect(await readFile(file, 'utf8'), file).not.toMatch(reads)
  // Nor does any function an edition is opened, sealed, served or exported with.
  const functions = await admin.query<{ name: string; source: string }>(
    `select proname as name, prosrc as source from pg_proc
      where pronamespace='public'::regnamespace
        and (proname like 'edition\\_%' or proname like 'serving\\_%' or proname like 'cl\\_edition%')`,
  )
  expect(functions.rows.length).toBeGreaterThan(5)
  for (const f of functions.rows) expect(f.source, f.name).not.toMatch(reads)
})
