import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import Fastify from 'fastify'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { registerMcpRoutes } from '../../src/server/mcp/gateway.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { accept, foundation, openEdition, people, version } from './fixtures.ts'
import { servingPool, testDatabase, transaction } from './support.ts'

/*
  Access across links (FR-314, FR-333 to FR-335) through the real serving role and MCP wire. A
  hidden item carries a canary marker in its title, summary and body; a retired item carries
  another in its own text. Whatever an agent asks, with get_related switched on, no reply may hold
  the hidden item's id, any canary, or the retired item's content: only the author's words.
*/
const { client: admin, url } = testDatabase()
const pool = servingPool(url)
const source = createEditionSource(pool)
const app = Fastify({ logger: false })
const resource = 'http://localhost:3000/mcp'
const { privateKey } = generateKeyPairSync('ed25519')
registerMcpRoutes(app, {
  source,
  store: createAnonymousStore(pool),
  resource,
  verifier: createDevVerifier(privateKey, resource, 'test'),
  now: () => new Date('2026-10-07T12:00:00Z'),
})
const canary = `CANARY${randomBytes(6).toString('hex')}`
const retiredText = `RETIRED${randomBytes(6).toString('hex')}`
const ids = { hidden: '', retired: '', closure: '', mentioning: '' }
let wire: Client

const mention = (
  versionId: string,
  field: 'summary' | 'body',
  position: number,
  target: { term?: string; item?: string },
  label: string,
) =>
  admin.query(
    'insert into item_version_mentions (version_id,field,position,term_key,item_id,label) values ($1,$2,$3,$4,$5,$6)',
    [versionId, field, position, target.term ?? null, target.item ?? null, label],
  )

beforeAll(async () => {
  await foundation(admin)
  await transaction(admin, async () => {
    const hidden = await version(admin, {
      title: `${canary} title`,
      summary: `Orders ${canary}`,
      body: `Only the secret group may read ${canary}.`,
      audience: ['secret'],
      owner: people.owner,
    })
    const retired = await version(admin, {
      title: `${retiredText} title`,
      summary: `Orders ${retiredText}`,
      owner: people.owner,
    })
    ids.hidden = hidden.item
    ids.retired = retired.item
    const closure = await version(admin, {
      title: 'Norway closure',
      summary: 'Orders',
      markup: '@[Orders](metric:orders)',
      body: 'See the restricted note and the old rule.',
      bodyMarkup: `See @[the restricted note](item:${hidden.item}) and @[the old rule](item:${retired.item}).`,
      owner: people.owner,
    })
    ids.closure = closure.item
    await mention(closure.id, 'summary', 0, { term: 'metric:orders' }, 'Orders')
    await mention(closure.id, 'body', 0, { item: hidden.item }, 'the restricted note')
    await mention(closure.id, 'body', 1, { item: retired.item }, 'the old rule')
    const mentioning = await version(admin, {
      title: 'Tax change',
      summary: 'Orders',
      body: 'Compare with the closure.',
      bodyMarkup: `Compare with @[the closure](item:${closure.item}).`,
      owner: people.owner,
    })
    ids.mentioning = mentioning.item
    await mention(mentioning.id, 'body', 0, { item: closure.item }, 'the closure')
    for (const v of [hidden, retired, closure, mentioning]) await accept(admin, v.id)
    const first = await openEdition(admin)
    for (const v of [hidden, retired, closure, mentioning])
      await admin.query('select edition_serve_item_version($1,$2)', [first, v.id])
    const term = await admin.query<{ id: string }>(
      "with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values('metric:orders',1,'Orders','finance',sha256('orders')) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,'demo:orders' from v where 'demo:orders'::text is not null) select id from v",
    )
    const proposal = await admin.query<{ id: string }>(
      "insert into proposals (subject,action,state,area_id,vocab_version_id,proposer_id,channel) values ('vocabulary','create','submitted','finance',$1,$2,'form') returning id",
      [term.rows[0]!.id, people.author],
    )
    await admin.query(
      "insert into decisions (proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason) values ($1,$2,'finance',$3,'owner','accept','Reviewed vocabulary')",
      [proposal.rows[0]!.id, term.rows[0]!.id, people.owner],
    )
    await admin.query('select edition_serve_vocab_version($1,$2)', [first, term.rows[0]!.id])
    await admin.query('select edition_seal($1)', [first])
    await admin.query('select edition_publish($1)', [first])
    // The rule is retired in the next edition; the closure still mentions it.
    await admin.query(
      "insert into decisions (item_version_id,area_id,decided_by,capacity,outcome,reason) values ($1,'finance',$2,'owner','retire','Ended')",
      [retired.id, people.owner],
    )
    const second = await openEdition(admin)
    await admin.query('select edition_close_item($1,$2)', [second, retired.item])
    await admin.query('select edition_seal($1)', [second])
    await admin.query('select edition_publish($1)', [second])
  })
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  wire = new Client({ name: 'links', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
  await wire.connect(
    new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
      requestInit: {
        headers: { Authorization: `Bearer ${await mintDevToken(privateKey, resource)}` },
      },
    }),
  )
})
afterAll(async () => {
  await wire?.close()
  await app.close()
  await pool.end()
})

const ask = async (name: string, args: Record<string, unknown>) => {
  const reply = await wire.callTool({ name, arguments: args })
  return { reply, text: JSON.stringify(reply) }
}

it('ships get_related switched on, with its own switch (FR-332 as changed)', async () => {
  expect((await wire.listTools()).tools.map((t) => t.name)).toContain('get_related')
  await admin.query("update tool_config set enabled=false where tool='get_related'")
  expect((await wire.listTools()).tools.map((t) => t.name)).not.toContain('get_related')
  await expect(
    wire.callTool({ name: 'get_related', arguments: { id: ids.closure } }),
  ).rejects.toThrow()
  await admin.query("update tool_config set enabled=true where tool='get_related'")
  expect((await wire.listTools()).tools.map((t) => t.name)).toContain('get_related')
})

it('follows visible links and shows a retired target only as the author’s words', async () => {
  const { reply } = await ask('get_related', { id: ids.closure, depth: 2 })
  expect(reply.isError).not.toBe(true)
  const out = reply.structuredContent as {
    root: { id: string }
    nodes: { id: string; status: string; label: string; distance: number }[]
    counts: Record<string, number>
    check_report: { links_withheld: number }
  }
  expect(out.root.id).toBe(ids.closure)
  expect(out.nodes).toContainEqual(
    expect.objectContaining({ id: ids.retired, status: 'retired', label: 'the old rule' }),
  )
  expect(out.nodes).toContainEqual(
    expect.objectContaining({ id: ids.mentioning, status: 'current', distance: 1 }),
  )
  expect(out.nodes).toContainEqual(expect.objectContaining({ id: 'metric:orders', distance: 1 }))
  // Counts hold visible neighbours only; the hidden note is one withheld link.
  expect(out.counts).toMatchObject({ mentions: 2, mentioned_by: 1, applies_to: 1 })
  expect(out.check_report.links_withheld).toBe(1)
})

it('never names a hidden target, nor shows a canary, through any tool', async () => {
  const replies = await Promise.all([
    ask('get_facts', { question: 'Orders in August 2026' }),
    ask('read_item', { id: ids.closure }),
    ask('read_item', { id: ids.hidden }),
    ask('search_facts', { query: canary }),
    ask('search_facts', { mentions: ids.hidden }),
    ask('get_related', { id: ids.closure, depth: 2 }),
    ask('get_related', { id: ids.mentioning, depth: 2 }),
    ask('get_related', { id: 'metric:orders', depth: 2, max_nodes: 50 }),
    ask('get_related', { id: 'area:finance', relations: ['in_area', 'mentioned_by'], depth: 2 }),
    ask('get_related', { id: ids.hidden }),
    ask('get_related', { id: ids.retired }),
    ask('get_context', { question: 'Orders in August 2026' }),
    ask('get_context', { question: 'Orders in August 2026', response_format: 'full' }),
    ask('find_context', { query: canary }),
    ask('read_context', { id: ids.closure }),
    ask('read_context', { id: ids.hidden }),
  ])
  for (const { text } of replies) {
    expect(text).not.toContain(canary)
    expect(text).not.toContain(ids.hidden)
    expect(text).not.toContain(retiredText)
  }
  // The delivery itself is unchanged by links: the hidden and retired items are not in it (FR-335).
  const delivered = (replies[0].reply.structuredContent as { items: { id: string }[] }).items
  expect(delivered.map((i) => i.id).sort()).toEqual([ids.closure, ids.mentioning].sort())
})

it('answers a hidden or retired start exactly as a start that does not exist', async () => {
  const missing = (await ask('get_related', { id: 'itm_doesnotexist' })).reply.structuredContent
  for (const id of [ids.hidden, ids.retired]) {
    const reply = (await ask('get_related', { id })).reply.structuredContent
    expect(reply).toEqual(missing)
  }
  expect(missing).toMatchObject({ status: 'no_match', message: 'Not found' })
})

it('hides a stopped item at once, as a start and as a neighbour', async () => {
  await admin.query(
    "insert into overlay_events (kind,scope,item_id,reason) values ('stop_on','item',$1,'Stop')",
    [ids.closure],
  )
  try {
    expect((await ask('get_related', { id: ids.closure })).reply.structuredContent).toMatchObject({
      message: 'Not found',
    })
    const from = (await ask('get_related', { id: ids.mentioning })).reply.structuredContent as {
      nodes: { id: string }[]
      check_report: { links_withheld: number }
    }
    expect(from.nodes.map((n) => n.id)).not.toContain(ids.closure)
    expect(from.check_report.links_withheld).toBe(1)
  } finally {
    await admin.query(
      "insert into overlay_events (kind,scope,item_id,reason) values ('stop_off','item',$1,'Resume')",
      [ids.closure],
    )
  }
})
