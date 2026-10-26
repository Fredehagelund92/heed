import { generateKeyPairSync } from 'node:crypto'
import pg from 'pg'
import Fastify from 'fastify'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { registerMcpRoutes } from '../../src/server/mcp/gateway.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { foundation, version, accept, openEdition, people } from './fixtures.ts'
import { ignoreTeardownDisconnects, testDatabase, transaction } from './support.ts'

const { client: admin, url } = testDatabase()
const pool = ignoreTeardownDisconnects(
  new pg.Pool({
    connectionString: url,
    options: '-c role=context_layer_serve',
    types: {
      getTypeParser(oid, format): (value: string) => unknown {
        return oid === pg.types.builtins.DATE
          ? (value) => value
          : (pg.types.getTypeParser(oid, format) as (value: string) => unknown)
      },
    },
  }),
)
const source = createEditionSource(pool),
  store = createAnonymousStore(pool)
let edition: string, item: string, wire: Client, base: string
const app = Fastify({ logger: false })
const resource = 'http://localhost:3000/mcp'
const { privateKey } = generateKeyPairSync('ed25519')
const gateway = registerMcpRoutes(app, {
  source,
  store,
  resource,
  verifier: createDevVerifier(privateKey, resource, 'test'),
  now: () => new Date(),
})

beforeAll(async () => {
  await foundation(admin)
  await transaction(admin, async () => {
    const v = await version(admin, {
      summary: 'Orders',
      markup: '@[Orders](metric:orders)',
      body: 'Norway closed on 4 August.',
      owner: people.owner,
    })
    item = v.item
    await admin.query(
      "insert into item_version_mentions (version_id,field,position,term_key,label) values ($1,'summary',0,'metric:orders','Orders')",
      [v.id],
    )
    await admin.query(
      "insert into item_version_evidence (version_id,position,url,quote,read_on) values ($1,0,'https://example.test/law','Online sales stopped','2026-08-05')",
      [v.id],
    )
    await accept(admin, v.id)
    edition = await openEdition(admin)
    await admin.query('select edition_serve_item_version($1,$2)', [edition, v.id])
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
    await admin.query('select edition_serve_vocab_version($1,$2)', [edition, term.rows[0]!.id])
    await admin.query('select edition_seal($1)', [edition])
    await admin.query('select edition_publish($1)', [edition])
  })
  base = await app.listen({ host: '127.0.0.1', port: 0 })
  wire = new Client(
    { name: 'database-conformance', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
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

it('delivers accepted PostgreSQL content over MCP using only serving-role privileges', async () => {
  expect(
    (await pool.query<{ current_user: string }>('select current_user')).rows[0]!.current_user,
  ).toBe('context_layer_serve')
  const reply = await wire.callTool({
    name: 'get_facts',
    arguments: { question: 'CANARY-private@example.test orders August 2026' },
  })
  expect(reply.isError).not.toBe(true)
  expect(reply.structuredContent).toMatchObject({
    status: 'matched',
    items: [
      {
        id: item,
        evidence: [{ url: 'https://example.test/law' }],
        // The role, never the person's name (FR-326), read without the people table.
        owner: { role: 'the owner of Finance' },
        reviewed: { accepted_by: 'the owner of Finance' },
      },
    ],
  })
  expect(
    (await wire.callTool({ name: 'read_item', arguments: { id: item } })).structuredContent,
  ).toMatchObject({ item: { id: item } })
  await gateway.flush()
  const delivered = (await admin.query('select * from deliveries')).rows
  expect(delivered).toHaveLength(1)
  expect(JSON.stringify(delivered)).not.toContain('CANARY')
  expect(JSON.stringify(delivered)).not.toContain('private@example.test')
  expect(delivered[0]).toMatchObject({
    edition_seq: edition,
    client_label: 'claude-code',
    status: 'matched',
  })
  expect((await admin.query('select * from mcp_requests')).rows.length).toBeGreaterThan(0)
  await expect(pool.query('select * from item_versions')).rejects.toThrow(/permission denied/)
  await expect(pool.query('select * from people')).rejects.toThrow(/permission denied/)
})

it('refreshes a cached edition immediately for a stop switch and fails closed on database failure', async () => {
  const first = await source.bundle()
  expect(await source.bundle()).toBe(first)
  await admin.query(
    "insert into overlay_events (kind,scope,item_id,reason) values ('stop_on','item',$1,'Stop')",
    [item],
  )
  const stopped = await source.bundle()
  expect(stopped).not.toBe(first)
  expect(stopped.stopped.items).toContain(item)
  expect(
    (await wire.callTool({ name: 'read_item', arguments: { id: item } })).structuredContent,
  ).toMatchObject({ message: 'Not found' })
  await admin.query(
    "insert into overlay_events (kind,scope,item_id,reason) values ('stop_off','item',$1,'Resume')",
    [item],
  )
})

it('persists anonymous feedback and atomically counts simultaneous reports for one topic', async () => {
  const scope = { question: 'Orders August 2026' }
  for (let i = 0; i < 2; i++)
    expect((await wire.callTool({ name: 'report_gap', arguments: scope })).isError).not.toBe(true)
  expect((await admin.query('select reports from gap_weekly_counts')).rows).toEqual([
    { reports: 2 },
  ])
  const delivery = (await admin.query<{ id: string }>('select id from deliveries limit 1')).rows[0]!
    .id
  expect(
    (
      await wire.callTool({
        name: 'give_feedback',
        arguments: { delivery_id: delivery, verdict: 'helpful' },
      })
    ).isError,
  ).not.toBe(true)
  expect((await admin.query('select verdict,client_label from feedback')).rows).toEqual([
    { verdict: 'helpful', client_label: 'claude-code' },
  ])
})

it('answers the agent contract over PostgreSQL: the short reply, the item, and a report with its domain', async () => {
  const reply = await wire.callTool({
    name: 'get_context',
    arguments: { question: 'Orders August 2026' },
  })
  expect(reply.isError).not.toBe(true)
  const short = reply.structuredContent as { reply_id: string; context: { id: string }[] }
  expect(short).toMatchObject({
    status: 'matched',
    say: expect.stringMatching(/^Checked\. /) as string,
    context: [{ id: item, checked: { role: 'the owner of Finance' } }],
    edition: expect.stringMatching(/^\d{4}-\d{2}-\d{2}\.\d+$/) as string,
  })
  expect(
    (await wire.callTool({ name: 'read_context', arguments: { id: item } })).structuredContent,
  ).toMatchObject({ context: { id: item } })
  const reported = await wire.callTool({
    name: 'report',
    arguments: { kind: 'unclear', reply_id: short.reply_id, context_id: item },
  })
  expect(reported.structuredContent).toMatchObject({ recorded: true, to: 'the owner of Finance' })
  expect(
    (
      await admin.query('select verdict,client_label,area_id from feedback where delivery_id=$1', [
        short.reply_id,
      ])
    ).rows,
  ).toEqual([{ verdict: 'unclear', client_label: 'claude-code', area_id: 'finance' }])
  // The delivery is recorded with the resolver's outcome, which the request log reads too.
  await gateway.flush()
  expect(
    (await admin.query('select status from deliveries where id=$1', [short.reply_id])).rows,
  ).toEqual([{ status: 'matched' }])
})

it('refuses a batch of report_gap calls whole: no report counted, one refusal logged (FR-408)', async () => {
  const before = (
    await admin.query<{ reports: number }>(
      'select coalesce(sum(reports),0)::int as reports from gap_weekly_counts',
    )
  ).rows[0]!.reports
  await gateway.flush()
  const seen = (await admin.query<{ id: string }>('select id from mcp_requests')).rows.map(
    (r) => r.id,
  )
  const response = await fetch(base + '/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${await mintDevToken(privateKey, resource, { scopes: ['feedback'] })}`,
    },
    body: JSON.stringify(
      Array.from({ length: 60 }, (_, n) => ({
        jsonrpc: '2.0',
        id: n + 1,
        method: 'tools/call',
        params: { name: 'report_gap', arguments: { question: 'Orders August 2026' } },
      })),
    ),
  })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600 } })
  await gateway.flush()
  expect(
    (
      await admin.query<{ reports: number }>(
        'select coalesce(sum(reports),0)::int as reports from gap_weekly_counts',
      )
    ).rows[0]!.reports,
  ).toBe(before)
  expect(
    (
      await admin.query(
        'select client_label,tool,status from mcp_requests where id <> all($1::uuid[])',
        [seen],
      )
    ).rows,
  ).toEqual([{ client_label: 'claude-code', tool: 'protocol', status: 'error' }])
})

it('loads an earlier edition as it was and refuses stale cached data after a connection failure', async () => {
  const before = await source.bundle()
  const added = await transaction(admin, async () => {
    const v = await version(admin, { summary: 'Returns', owner: people.owner })
    await accept(admin, v.id)
    const seq = await openEdition(admin)
    await admin.query('select edition_serve_item_version($1,$2)', [seq, v.id])
    await admin.query('select edition_seal($1)', [seq])
    await admin.query('select edition_publish($1)', [seq])
    return v.item
  })
  expect((await source.bundle()).items.map((i) => i.id)).toContain(added)
  expect((await source.bundle(before.edition)).items.map((i) => i.id)).not.toContain(added)
  const brokenPool = new pg.Pool({
    connectionString: 'postgres://127.0.0.1:1/unreachable',
    connectionTimeoutMillis: 100,
  })
  try {
    await expect(createEditionSource(brokenPool).bundle()).rejects.toThrow()
  } finally {
    await brokenPool.end()
  }
})
