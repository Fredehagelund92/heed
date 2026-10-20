import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people, servingEdition } from './fixtures.ts'
import { apiDatabase, servingPool, tableContents, testDatabase, transaction } from './support.ts'

/*
  Injection (plan section 10.6, item 6): SQL metacharacters, LIKE wildcards and control
  characters in every parameter of every reading API operation, in MCP tool arguments, and in
  stored text. Each must be refused or treated as a value: never a 500, never a database error
  in the reply, never a change to the data.
*/

const { client, url } = testDatabase()
const serving = servingPool(url)
const origin = 'http://localhost:5173'
const resource = 'http://127.0.0.1/mcp'
const { privateKey } = generateKeyPairSync('ed25519')
const logs: string[] = []
const app = buildApp({
  database: apiDatabase(url),
  jobs: idleJobs(),
  logger: createLogger({
    level: 'info',
    destination: {
      write(line: string) {
        logs.push(line)
      },
    },
  }),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
  origins: [origin],
  mcp: {
    source: createEditionSource(serving),
    store: createAnonymousStore(serving),
    verifier: createDevVerifier(privateKey, resource, 'test'),
    resource,
  },
})

const payloads = [
  "' or '1'='1",
  "'; drop table items; --",
  '1); delete from audit_log; --',
  "%' union select email from people --",
  "finance' or area_id is not null --",
  '\\',
  "\\'",
  '$1',
  '%',
  '_',
  '"; select pg_sleep(5); --',
  'null',
  '../../../etc/passwd',
  '\u0000',
  'line\nbreak',
  'a'.repeat(5000),
]
/** What a database error looks like when it reaches a reply. */
const databaseError =
  /syntax error|pg_catalog|relation "|column "|invalid input syntax|unterminated|violates|SQLSTATE|stack/i

let headers: Record<string, string> = {}
type Parameter = { name: string; in: 'path' | 'query'; required?: boolean }
type Document = { paths: Record<string, Record<string, { parameters?: Parameter[] }>> }
let document: Document

const sample: Record<string, string> = {
  id: '00000000-0000-4000-8000-00000000abcd',
  areaId: 'finance',
  label: '2026-10-08.1',
  key: 'privacy.min_count',
}

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
    await servingEdition(client)
    // The sweep sends thousands of requests a minute as one person, far past the default limit.
    await client.query(
      `insert into settings_versions(key,version,value,reason)
       values ('limits.api_rate_per_minute',2,'{"person":10000,"ip":10000}','injection sweep')`,
    )
  })
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: 'admin@example.test' },
  })
  expect(response.statusCode, response.body).toBe(200)
  const cookie = response.cookies[0]!
  headers = {
    cookie: `${cookie.name}=${cookie.value}`,
    'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    origin,
  }
  document = JSON.parse(
    await readFile(new URL('../../docs/api/openapi.json', import.meta.url), 'utf8'),
  ) as Document
  await app.listen({ host: '127.0.0.1', port: 0 })
})
afterAll(async () => {
  await app.close()
  await serving.end()
})

describe('SQL and control characters in reading operations', () => {
  it(
    'never reach SQL as code, in any parameter of any GET operation',
    { timeout: 180_000 },
    async () => {
      const before = await tableContents(client, ['auth.sessions'])
      const failures: string[] = []
      let requests = 0
      for (const [path, methods] of Object.entries(document.paths)) {
        const operation = methods.get
        // The live event stream has no parameters and stays open.
        if (!operation || path === '/events') continue
        const parameters = operation.parameters ?? []
        for (const parameter of parameters)
          for (const payload of payloads) {
            const value = (p: Parameter) => (p === parameter ? payload : (sample[p.name] ?? ''))
            const target =
              '/api/v1' +
              path.replace(/\{(\w+)\}/g, (_, name: string) =>
                encodeURIComponent(value(parameters.find((p) => p.name === name)!)),
              )
            const query = new URLSearchParams()
            for (const p of parameters)
              if (p.in === 'query' && (p === parameter || p.required)) query.set(p.name, value(p))
            const response = await app.inject({
              method: 'GET',
              url: `${target}${query.size ? '?' + query.toString() : ''}`,
              headers,
            })
            requests++
            if (response.statusCode >= 500 || databaseError.test(response.body))
              failures.push(
                `${path} ${parameter.name}=${JSON.stringify(payload.slice(0, 40))}: ${response.statusCode} ${response.body.slice(0, 160)}`,
              )
          }
      }
      expect(failures).toEqual([])
      expect(requests).toBeGreaterThan(800)
      expect(logs.filter((line) => line.includes('API operation failed'))).toEqual([])
      expect(await tableContents(client, ['auth.sessions'])).toEqual(before)
    },
  )

  it('matches search wildcards literally', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/v1/items', headers })
    expect(all.json<{ total: number }>().total).toBeGreaterThan(0)
    for (const q of ['%', '_', '%%', '\\'])
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/items?${new URLSearchParams({ q }).toString()}`,
            headers,
          })
        ).json<{ total: number }>().total,
        q,
      ).toBe(0)
  })
})

describe('SQL in stored text', () => {
  it('stores and returns text exactly as written', async () => {
    const title = "Robert'); drop table items; --"
    const summary = "%' union select email from people -- \\ $1"
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: { draft: { areaId: 'finance', title, summary } },
    })
    expect(created.statusCode, created.body).toBe(200)
    const { id } = created.json<{ id: string }>()
    const read = await app.inject({ method: 'GET', url: `/api/v1/proposals/${id}`, headers })
    expect(read.json()).toMatchObject({ draft: { title, summary } })
    expect((await client.query('select count(*)::int as n from items')).rows[0]).toEqual({ n: 2 })
    // PostgreSQL text cannot hold NUL: refused at the door, not failed in SQL.
    const nul = await app.inject({
      method: 'POST',
      url: '/api/v1/proposals',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      payload: { draft: { areaId: 'finance', title: 'Before\u0000after' } },
    })
    expect(nul.statusCode).toBe(400)
    expect(nul.json()).toEqual({
      code: 'BAD_REQUEST',
      message: 'Remove the hidden NUL character from the text.',
    })
  })
})

describe('SQL and control characters in MCP tool arguments', () => {
  it(
    'are values: tool errors at most, no database error, no change to governed data',
    { timeout: 60_000 },
    async () => {
      const governed = () =>
        tableContents(client, [
          'auth.sessions',
          'public.deliveries',
          'public.mcp_requests',
          'public.topics',
          'public.topic_week_counts',
          'public.gaps',
          'public.gap_weekly_counts',
          'public.feedback',
        ])
      const before = await governed()
      const { port } = app.server.address() as { port: number }
      const wire = new Client({ name: 'injection', version: '1.0.0' })
      await wire.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: {
            headers: { Authorization: `Bearer ${await mintDevToken(privateKey, resource)}` },
          },
        }),
      )
      const failures: string[] = []
      try {
        for (const payload of payloads) {
          const calls = [
            { name: 'get_context', arguments: { question: payload } },
            { name: 'get_context', arguments: { question: 'Orders', metrics: [payload] } },
            { name: 'search_context', arguments: { query: payload } },
            { name: 'read_item', arguments: { id: payload } },
            { name: 'improve_question', arguments: { question: payload } },
            { name: 'report_gap', arguments: { question: payload } },
          ]
          for (const call of calls) {
            const result = await wire.callTool(call).catch((error: unknown) => ({
              isError: true,
              content: [{ type: 'text', text: String(error) }],
            }))
            const text = JSON.stringify(result)
            if (databaseError.test(text) || /internal error/i.test(text))
              failures.push(
                `${call.name} ${JSON.stringify(payload.slice(0, 40))}: ${text.slice(0, 160)}`,
              )
          }
        }
      } finally {
        await wire.close()
      }
      expect(failures).toEqual([])
      expect(await governed()).toEqual(before)
      // The anonymous records of these calls were written, none dropped.
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(logs.filter((line) => line.includes('records dropped'))).toEqual([])
    },
  )
})
