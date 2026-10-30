import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConnectInfo } from '../../src/contract/connect.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { toolNames } from '../../src/server/mcp/tools.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, servingEdition } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/*
  Connect your AI, over HTTP on a service that also serves MCP: it tells every signed-in person
  the address, the tools on and the clients that may connect, and nothing an administrator alone
  may read. And how an agent is told each fact was reviewed (FR-326).
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
  await transaction(client, async () => {
    const served = await servingEdition(client)
    expect(served.item).toBeTruthy()
    servedItem = served.item
  })
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  wire = new Client({ name: 'connect', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
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
      // Every tool in the gateway's registry, so none can be left off the page, and every one on:
      // get_related and suggest_context too (FR-121, FR-332 as changed).
      tools: toolNames.map((tool) => ({
        tool,
        enabled: true,
        personOnly: tool === 'suggest_context',
      })),
      // The evaluation runner is the gateway's own client, not a person's.
      clients: [{ label: 'claude-code', name: 'Claude Code with a token' }],
      // This app has no login server, so a person's own client cannot sign in.
      signIn: false,
    })
  })

  it('follows the administrators: a tool switched off is marked off, a client is not offered', async () => {
    const off = await call('POST', '/tools/find_context', 'admin', {
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
    expect(info.tools).toContainEqual({ tool: 'find_context', enabled: false, personOnly: false })
    // Only a label and a name: never a client's tools, limits or switch.
    expect(info.clients).toEqual([
      { label: 'claude-code', name: 'Claude Code with a token' },
      { label: 'cursor', name: 'Cursor' },
    ])
    const on = await call('POST', '/tools/find_context', 'admin', {
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

describe('reviewed before served (FR-326)', () => {
  it('tells an agent by role how each fact was reviewed, and never a name', async () => {
    // An owner with a real name: what an agent receives must not carry it.
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
        name: 'get_facts',
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
    // The agent contract's reply names who checked it, as a role, and the day.
    const short = await wire.callTool({
      name: 'get_context',
      arguments: { question: '', ...august },
    })
    const entry = (short.structuredContent as { context: Record<string, unknown>[] }).context[0]!
    expect(entry.checked).toEqual({ role: 'the owner of Finance', date: today })
    expect((short.content as { text: string }[]).map((part) => part.text).join('\n')).toContain(
      'by the owner of Finance.',
    )
    expect(JSON.stringify(short)).not.toContain('Jon Abara')
    expect(JSON.stringify(short)).not.toContain(people.owner)
  })
})
