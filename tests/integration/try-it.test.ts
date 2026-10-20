import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConnectInfo, TryIt } from '../../src/contract/connect.ts'
import type { ItemReview } from '../../src/contract/review.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { toolNames } from '../../src/server/mcp/tools.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, people, servingEdition, version } from './fixtures.ts'
import { apiDatabase, servingPool, tableContents, testDatabase, transaction } from './support.ts'

/*
  Connect your AI and What an agent would get (Try it), over HTTP on a service that also serves
  MCP. Connect tells every signed-in person the address, the tools on and the clients that may
  connect, and nothing an administrator alone may read. Try it answers exactly what get_context
  answers an agent for the same scope, records nothing, takes no question and no audience.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const pool = servingPool(url)
const resource = 'http://localhost:3000/mcp'
const { privateKey } = generateKeyPairSync('ed25519')
const devPeople = Object.keys(people).map((name) => ({
  name,
  email: `${name}@example.test`,
  roles: [],
}))
const app = buildApp({
  database,
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock(),
  devPeople,
  mcp: {
    source: createEditionSource(pool),
    store: createAnonymousStore(pool),
    verifier: createDevVerifier(privateKey, resource, 'test'),
    resource,
  },
})
// The same service without MCP, as a deployment that does not serve it.
const noMcp = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock(),
  devPeople,
})

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  who: Who | null,
  payload?: object,
  on = app,
) =>
  on.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...(who ? headers[who] : {}), 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })

const august = {
  metrics: ['metric:orders'],
  window: { from: '2026-08-01', to: '2026-08-31' },
}
let wire: Client
let beforeLive: { statusCode: number; message: string }
let restricted = ''
let servedItem = ''

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
  const before = await call('POST', '/try-it', 'author', august)
  beforeLive = {
    statusCode: before.statusCode,
    message: before.json<{ message: string }>().message,
  }
  await transaction(client, async () => {
    const served = await servingEdition(client)
    // An item for a narrower audience, in the same scope: no person's agent receives it.
    const v = await version(client, {
      title: 'For the board only',
      summary: 'A board note about orders.',
      audience: ['board'],
      owner: people.owner,
    })
    restricted = v.item
    await accept(client, v.id)
    const seq = (
      await client.query<{ seq: string }>("select edition_open('proposal_accepted',null) as seq")
    ).rows[0]!.seq
    await client.query('select edition_serve_item_version($1,$2)', [seq, v.id])
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
    expect(served.item).toBeTruthy()
    servedItem = served.item
  })
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  wire = new Client({ name: 'try-it', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
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
  await noMcp.close()
  await pool.end()
})

describe('connect', () => {
  it('tells every signed-in person the address, every tool and the clients that may connect', async () => {
    const response = await call('GET', '/connect', 'author')
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json<ConnectInfo>()).toEqual({
      address: resource,
      // Every tool in the gateway's registry, so none can be left off the page. get_related
      // ships switched off (FR-332), and draft_context until an administrator turns it on (FR-121).
      tools: toolNames.map((tool) => ({
        tool,
        enabled: tool !== 'get_related' && tool !== 'draft_context',
        personOnly: tool === 'draft_context',
      })),
      // The evaluation runner is the gateway's own client, not a person's.
      clients: [{ label: 'claude-code', name: 'Claude Code with a token' }],
      // This app has no login server, so a person's own client cannot sign in.
      signIn: false,
    })
  })

  it('follows the administrators: a tool switched off is marked off, a client is not offered', async () => {
    const off = await call('POST', '/tools/search_context', 'admin', {
      enabled: false,
      reason: 'Trying it without search',
    })
    expect(off.statusCode, off.body).toBe(200)
    for (const [label, displayName, enabled] of [
      ['cursor', 'Cursor', true],
      ['vscode', 'VS Code', false],
    ] as const) {
      const saved = await call('PUT', `/clients/${label}`, 'admin', {
        displayName,
        toolsAllowed: ['get_context'],
        ratePerMinute: 10,
        maxResponseBytes: 50_000,
        enabled,
        reason: 'A client for the team',
      })
      expect(saved.statusCode, saved.body).toBe(200)
    }
    const info = (await call('GET', '/connect', 'stranger')).json<ConnectInfo>()
    expect(info.tools).toContainEqual({ tool: 'search_context', enabled: false, personOnly: false })
    // Only a label and a name: never a client's tools, limits or switch.
    expect(info.clients).toEqual([
      { label: 'claude-code', name: 'Claude Code with a token' },
      { label: 'cursor', name: 'Cursor' },
    ])
    const on = await call('POST', '/tools/search_context', 'admin', {
      enabled: true,
      reason: 'Search back on',
    })
    expect(on.statusCode, on.body).toBe(200)
  })

  it('has no address where the service serves no MCP, and asks a visitor to sign in', async () => {
    const info = await call('GET', '/connect', 'author', undefined, noMcp)
    expect(info.statusCode, info.body).toBe(200)
    expect(info.json<ConnectInfo>().address).toBeNull()
    expect((await call('GET', '/connect', null)).statusCode).toBe(401)
  })
})

describe('try it', () => {
  it('says so when no edition is live yet', () => {
    expect(beforeLive).toEqual({
      statusCode: 412,
      message:
        'Nothing is shared with AI apps yet. They get facts once an owner accepts the first one.',
    })
  })

  it("answers exactly what get_context answers an agent for the same scope, and the agent's size", async () => {
    const response = await call('POST', '/try-it', 'author', august)
    expect(response.statusCode, response.body).toBe(200)
    const tried = response.json<TryIt>()
    const agent = await wire.callTool({
      name: 'get_context',
      arguments: { question: '', ...august },
    })
    const { delivery_id: deliveryId, ...delivered } = agent.structuredContent as Record<
      string,
      unknown
    >
    expect(deliveryId).toBeTruthy()
    // The tools' digest reaches an agent's client in _meta, kept from its model (FR-346).
    expect(tried.result).toEqual({
      ...delivered,
      tool_schema_digest: (agent._meta as { tool_schema_digest: string }).tool_schema_digest,
    })
    expect(tried.result).toMatchObject({
      status: 'matched',
      items: [{ title: 'A note', summary: 'Orders' }],
      check_report: { matched: 1, withheld: 1 },
    })
    expect(tried.result.instructions).toMatch(/^State the documented fact/)
    expect(tried.result).not.toHaveProperty('delivery_id')
    expect(tried.limit).toBe(100_000)
    expect(tried.bytes).toBeGreaterThan(Buffer.byteLength(JSON.stringify(tried.result)))
    expect(tried.bytes).toBeLessThan(tried.limit)
  })

  it("never delivers another audience's item, whoever asks", async () => {
    for (const who of ['author', 'owner', 'admin'] as const) {
      const tried = (await call('POST', '/try-it', who, august)).json<TryIt>()
      expect(tried.result.items?.map((item) => item.id)).not.toContain(restricted)
      // Nor linked: a page in Heed is given for a delivered item only (FR-347).
      expect(JSON.stringify(tried.result)).not.toContain(restricted)
    }
    // There is no way to ask as someone else: an audience is not an input.
    for (const extra of [{ groups: ['board'] }, { audience: ['board'] }]) {
      const response = await call('POST', '/try-it', 'author', { ...august, ...extra })
      expect(response.statusCode, response.body).toBe(400)
    }
  })

  it('takes no question and records nothing: no delivery, topic, gap or request', async () => {
    const asked = await call('POST', '/try-it', 'author', {
      ...august,
      question: 'Why did orders drop in Norway?',
    })
    expect(asked.statusCode, asked.body).toBe(400)
    const before = await tableContents(client, ['public.sessions'])
    for (const scope of [
      august,
      { ...august, window: { from: '2020-01-01', to: '2020-01-31' } },
      { metrics: ['metric:nothing_like_this'] },
      {},
    ]) {
      const response = await call('POST', '/try-it', 'stranger', scope)
      expect(response.statusCode, response.body).toBe(200)
    }
    expect(await tableContents(client, ['public.sessions'])).toEqual(before)
  })

  it('says what an agent would be told when nothing applies, or when no dates were given', async () => {
    const outside = (
      await call('POST', '/try-it', 'author', {
        ...august,
        window: { from: '2020-01-01', to: '2020-01-31' },
      })
    ).json<TryIt>()
    expect(outside.result).toMatchObject({ status: 'no_match', items: [] })
    expect(outside.result.check_report.statements).toEqual([
      'No match does not prove that no caveat exists.',
    ])
    // Without dates the scope is read at today, and the reply says so.
    const open = (
      await call('POST', '/try-it', 'author', { metrics: ['metric:orders'] })
    ).json<TryIt>()
    expect(open.result).toMatchObject({
      assumed_date: { reason: 'no date given', time_zone: 'UTC' },
      options: [],
    })
    expect(open.result.check_report.statements.join(' ')).toContain('today was assumed')
    const backwards = await call('POST', '/try-it', 'author', {
      ...august,
      window: { from: '2026-08-31', to: '2026-08-01' },
    })
    expect(backwards.statusCode).toBe(400)
  })

  it('asks a visitor to sign in', async () => {
    expect((await call('POST', '/try-it', null, august)).statusCode).toBe(401)
  })
})

describe('reviewed before served (FR-326)', () => {
  it('tells an agent by role how each fact was reviewed, and never a name', async () => {
    // An owner with a real name: what an AI app receives must not carry it.
    await client.query("update people set display_name='Jon Abara' where id=$1", [people.owner])
    const edition = (
      await client.query<{ label: string }>(
        'select e.label from editions e join item_version_service s on s.editions @> e.seq join item_versions v on v.id = s.version_id where v.item_id = $1 order by e.seq limit 1',
        [servedItem],
      )
    ).rows[0]!.label
    const today = new Date().toISOString().slice(0, 10)
    const reviewed = {
      accepted_on: today,
      accepted_by: 'the owner of Finance',
      in_edition: edition,
    }
    for (const response_format of ['full', 'concise'] as const) {
      const agent = await wire.callTool({
        name: 'get_context',
        arguments: { question: '', ...august, response_format },
      })
      const item = (agent.structuredContent as { items: Record<string, unknown>[] }).items[0]!
      expect(item.reviewed).toEqual(reviewed)
      if (response_format === 'full')
        expect(item.owner).toEqual({ team: null, role: 'the owner of Finance' })
      const text = (agent.content as { text: string }[]).map((part) => part.text).join('\n')
      expect(text).toContain('by the owner of Finance, in edition ' + edition)
      expect(JSON.stringify(agent)).not.toContain('Jon Abara')
      expect(JSON.stringify(agent)).not.toContain(people.owner)
    }
    const overview = await wire.callTool({
      name: 'domain_overview',
      arguments: { domain: 'Finance' },
    })
    expect(overview.structuredContent).toMatchObject({
      owners: {
        reviewed_by: expect.stringMatching(/^(the owner of Finance|an admin)$/) as string,
      },
    })
    expect(JSON.stringify(overview)).not.toContain('Jon Abara')
    // Try it shows exactly what the agent gets.
    const tried = (await call('POST', '/try-it', 'author', august)).json<TryIt>()
    expect(tried.result.items![0]!.reviewed).toEqual(reviewed)
  })

  it('names who accepted it only behind sign-in, with the checks it passed', async () => {
    const response = await call('POST', '/library/reviews', 'author', {
      ids: [servedItem, restricted, 'itm_zzzzzzzz'],
    })
    expect(response.statusCode, response.body).toBe(200)
    const [review, ...rest] = response.json<ItemReview[]>()
    expect(rest).toEqual([])
    expect(review).toEqual({
      id: servedItem,
      version: 1,
      acceptedOn: new Date().toISOString().slice(0, 10),
      acceptedAs: 'owner',
      areaId: 'finance',
      personId: people.owner,
      edition: expect.stringMatching(/^\d{4}-\d{2}-\d{2}\.\d+$/) as string,
      checks: ['format', 'matching', 'delivery', 'answer_impact'],
    })
    expect((await call('POST', '/library/reviews', null, { ids: [servedItem] })).statusCode).toBe(
      401,
    )
  })
})
