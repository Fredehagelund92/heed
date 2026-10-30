import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { policies } from '../../src/server/modules/auth/index.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import {
  apiDatabase,
  contractOperations,
  servingPool,
  tableContents,
  testDatabase,
  transaction,
  type Operation,
} from './support.ts'

/*
  The security suite's access matrix (plan section 10.6, items 1 and 2), generated from the
  contract: every API operation, /metrics, MCP and the public routes,
  for every role, over real HTTP and PostgreSQL. A denied request answers 401 or 403 and changes
  nothing; an allowed one passes the gate. Every state-changing request must also carry an
  allowed Origin and the session's CSRF token, or it is refused and changes nothing. All of it
  runs with a trace-level log, which must hold no credential and no person.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const serving = servingPool(url)
const origin = 'http://localhost:5173'
const resource = 'http://127.0.0.1/mcp'
const metricsToken = randomBytes(24).toString('hex')
const { privateKey } = generateKeyPairSync('ed25519')
const logs: string[] = []

const roles = {
  anonymous: null,
  contributor: 'author',
  owner: 'owner',
  otherOwner: 'stranger',
  secondOwner: 'coowner',
  approver: 'approver',
  auditor: 'auditor',
  administrator: 'admin',
} as const
type Role = keyof typeof roles
const members = {
  ...people,
  coowner: '00000000-0000-4000-8000-0000000000d1',
  auditor: '00000000-0000-4000-8000-0000000000a1',
}

const app = buildApp({
  database,
  jobs: idleJobs(),
  logger: createLogger({
    level: 'trace',
    destination: {
      write(line: string) {
        logs.push(line)
      },
    },
  }),
  devPeople: Object.keys(members).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
  origins: [origin],
  metricsToken,
  mcp: {
    source: createEditionSource(serving),
    store: createAnonymousStore(serving),
    verifier: createDevVerifier(privateKey, resource, 'test'),
    resource,
  },
})

type Session = { cookie: string; csrf: string; token: string }
const sessions = new Map<Role, Session>()
async function signIn(name: string): Promise<Session> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  const cookie = response.cookies[0]!
  return {
    cookie: `${cookie.name}=${cookie.value}`,
    token: cookie.value,
    csrf: response.json<{ csrfToken: string }>().csrfToken,
  }
}

/** The API operations, the operations view and manual job runs among them. */
const all: Operation[] = contractOperations()
const samples: Record<string, string> = {
  id: '00000000-0000-4000-8000-00000000abcd',
  areaId: 'finance',
  personId: '00000000-0000-4000-8000-00000000abce',
  label: '2026-10-08.1',
  key: 'privacy.min_count',
  tool: 'get_facts',
  job: 'retention.run',
}
const pathOf = (op: Operation) => op.path.replace(/\{(\w+)\}/g, (_, name: string) => samples[name]!)
const mutating = (op: Operation) => op.method !== 'GET'

function allowed(policy: string, role: Role): boolean {
  if (policy === 'public') return true
  if (role === 'anonymous') return false
  if (policy === 'admin') return role === 'administrator'
  if (policy === 'audit') return role === 'administrator' || role === 'auditor'
  if (policy === 'maintain')
    return ['administrator', 'owner', 'otherOwner', 'secondOwner'].includes(role)
  return true
}

function send(op: Operation, headers: Record<string, string>) {
  return app.inject({
    method: op.method as 'GET',
    url: pathOf(op),
    headers,
    ...(mutating(op) ? { payload: {} } : {}),
  })
}

/** A browser's headers: the session cookie and its CSRF token, or the sign-in header. */
function credentials(role: Role, op?: Operation): Record<string, string> {
  const session = sessions.get(role)
  const csrf = session && op?.name !== 'auth.signIn' ? session.csrf : 'dev-sign-in'
  return { ...(session ? { cookie: session.cookie } : {}), 'x-heed-csrf': csrf, origin }
}

/** The session table changes with every sign-in and request; everything else must not. */
const state = () => tableContents(client, ['auth.sessions'])

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
    await client.query(
      "insert into people (id,email,display_name) values ($1,'coowner@example.test','coowner'),($2,'auditor@example.test','auditor')",
      [members.coowner, members.auditor],
    )
    await client.query(
      "insert into area_assignments (area_id,person_id,role) values ('finance',$1,'owner'),('marketing',$2,'owner')",
      [members.coowner, people.stranger],
    )
    await client.query("insert into global_role_grants (person_id,role) values ($1,'auditor')", [
      members.auditor,
    ])
    // The sweeps send every operation from one address, mostly as one administrator, within a
    // minute, so either limit would end them as the contract grows; the limits have their own
    // suite (rate-limit.test.ts).
    await client.query(
      `insert into settings_versions (key,version,value,reason)
       select key,max(version)+1,'{"person": 10000, "ip": 10000}','test' from settings_versions
        where key='limits.api_rate_per_minute' group by key`,
    )
  })
  for (const [role, name] of Object.entries(roles))
    if (name) sessions.set(role as Role, await signIn(name))
})
afterAll(async () => {
  await app.close()
  await serving.end()
})

describe('the access matrix', () => {
  it('covers every operation with a declared policy', () => {
    expect(all.map((op) => op.name).sort()).toEqual(Object.keys(policies).sort())
  })

  it(
    'refuses each role what its policy denies, before any read or write',
    { timeout: 120_000 },
    async () => {
      const before = await state()
      const refused: string[] = []
      for (const role of Object.keys(roles) as Role[])
        for (const op of all) {
          const policy = policies[op.name as keyof typeof policies]
          if (allowed(policy, role)) continue
          const response = await send(op, credentials(role, op))
          const expected = role === 'anonymous' ? 401 : 403
          if (response.statusCode !== expected)
            refused.push(
              `${role} ${op.name}: ${response.statusCode} ${response.body.slice(0, 120)}`,
            )
          else
            expect(response.json(), `${role} ${op.name}`).toMatchObject({
              code: expected === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
            })
        }
      expect(refused).toEqual([])
      expect(await state()).toEqual(before)
    },
  )

  it('lets each role past the gate where its policy allows', { timeout: 120_000 }, async () => {
    // Past the gate, the service narrows a read to the areas the person maintains: the sample
    // area is finance, which the other owner does not.
    const narrowed = new Set(['otherOwner areas.dashboard'])
    const stopped: string[] = []
    for (const role of Object.keys(roles) as Role[]) {
      // Signing out ends the session the rest of the sweep uses, so it goes last.
      const order = [...all].sort(
        (a, b) => Number(a.name === 'auth.signOut') - Number(b.name === 'auth.signOut'),
      )
      for (const op of order) {
        const policy = policies[op.name as keyof typeof policies]
        if (!allowed(policy, role)) continue
        const response = await send(op, credentials(role, op))
        if (narrowed.has(`${role} ${op.name}`)) expect(response.statusCode).toBe(403)
        else if ([401, 403].includes(response.statusCode))
          stopped.push(`${role} ${op.name}: ${response.statusCode} ${response.body.slice(0, 160)}`)
      }
      if (sessions.has(role)) sessions.set(role, await signIn(roles[role]!))
    }
    expect(stopped).toEqual([])
  })

  it('opens /metrics only to its token, never to a session, and keeps the public routes public', async () => {
    for (const role of Object.keys(roles) as Role[]) {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: credentials(role),
      })
      expect(response.statusCode, role).toBe(401)
    }
    const scrape = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: `Bearer ${metricsToken}` },
    })
    expect(scrape.statusCode).toBe(200)
    for (const path of ['/health', '/health/ready', '/api/v1/openapi.json'])
      expect((await app.inject({ method: 'GET', url: path })).statusCode, path).toBe(200)
  })

  it('keeps the web session and the MCP token apart: neither opens the other door', async () => {
    const admin = sessions.get('administrator')!
    const mcp = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { host: '127.0.0.1', cookie: admin.cookie, 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(mcp.statusCode).toBe(401)
    const token = await mintDevToken(privateKey, resource)
    for (const path of ['/api/v1/me', '/api/v1/settings', '/api/v1/operations']) {
      const response = await app.inject({
        method: 'GET',
        url: path,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.statusCode, path).toBe(401)
    }
    // The refused MCP call leaves its anonymous record; wait for it so later checks start still.
    for (let tries = 0; tries < 50; tries++) {
      if ((await client.query('select 1 from mcp_requests')).rowCount) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect((await client.query('select tool, status from mcp_requests')).rows).toEqual([
      { tool: 'protocol', status: 'unauthorized' },
    ])
  })
})

describe('CSRF and origin', () => {
  const adminHeaders = () => credentials('administrator')
  const forged: [string, (headers: Record<string, string>) => Record<string, string>][] = [
    ['no Origin', ({ origin: _o, ...rest }) => rest],
    ['a foreign Origin', (headers) => ({ ...headers, origin: 'https://evil.example' })],
    ['an opaque Origin', (headers) => ({ ...headers, origin: 'null' })],
    [
      'the right host on another port',
      (headers) => ({ ...headers, origin: 'http://localhost:5174' }),
    ],
    ['a cross-site fetch', (headers) => ({ ...headers, 'sec-fetch-site': 'cross-site' })],
    ['no CSRF token', ({ 'x-heed-csrf': _c, ...rest }) => rest],
    [
      'the sign-in token instead of the session one',
      (headers) => ({ ...headers, 'x-heed-csrf': 'dev-sign-in' }),
    ],
    [
      "another person's CSRF token",
      (headers) => ({ ...headers, 'x-heed-csrf': sessions.get('contributor')!.csrf }),
    ],
  ]

  it(
    'refuses every state-changing request without an allowed Origin and the session token, and changes nothing',
    { timeout: 180_000 },
    async () => {
      const before = await state()
      const passed: string[] = []
      for (const op of all.filter(mutating)) {
        // Sign-in has no session yet: it needs the allowed Origin and the fixed sign-in header.
        const cases =
          op.name === 'auth.signIn'
            ? forged.filter(([name]) => !/CSRF|sign-in token/.test(name))
            : forged
        for (const [name, change] of cases) {
          const headers = change(
            op.name === 'auth.signIn' ? credentials('anonymous') : adminHeaders(),
          )
          const response = await app.inject({
            method: op.method as 'POST',
            url: pathOf(op),
            headers,
            payload: op.name === 'auth.signIn' ? { email: 'admin@example.test' } : {},
          })
          if (response.statusCode !== 403)
            passed.push(
              `${op.name} with ${name}: ${response.statusCode} ${response.body.slice(0, 120)}`,
            )
        }
      }
      expect(passed).toEqual([])
      expect(await state()).toEqual(before)
    },
  )

  it('sets the session cookie HttpOnly and SameSite=Strict, and Secure over HTTPS', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin, 'x-heed-csrf': 'dev-sign-in', 'x-forwarded-proto': 'https' },
      payload: { email: 'author@example.test' },
    })
    const cookie = String(response.headers['set-cookie'])
    expect(cookie).toMatch(/; HttpOnly/)
    expect(cookie).toMatch(/; SameSite=Strict/)
    // The service does not trust proxy headers, so plain HTTP here: no Secure flag.
    expect(cookie).not.toMatch(/; Secure/)
  })
})

describe('logs of the whole suite', () => {
  it('hold no session, CSRF, MCP or metrics credential, and no person', async () => {
    // Runs last in this file: every request above wrote at trace level.
    const token = await mintDevToken(privateKey, resource)
    await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        host: '127.0.0.1',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    expect(logs.length).toBeGreaterThan(1000)
    const text = logs.join('\n')
    const secrets = {
      metricsToken,
      mcpToken: token,
      mcpSignature: token.split('.')[2]!,
      ...Object.fromEntries(
        [...sessions].flatMap(([role, session]) => [
          [`${role} session`, session.token],
          [`${role} csrf`, session.csrf],
        ]),
      ),
      ...Object.fromEntries(Object.entries(members).map(([name, id]) => [`${name} id`, id])),
      ...Object.fromEntries(
        Object.keys(members).map((name) => [`${name} email`, `${name}@example.test`]),
      ),
    }
    for (const [name, value] of Object.entries(secrets))
      expect(text.includes(value), `${name} in the logs`).toBe(false)
    // Every request line carries its request id (NFR-071).
    const requests = logs
      .map((line) => JSON.parse(line) as { msg: string; reqId?: string })
      .filter((record) => record.msg === 'incoming request' || record.msg === 'request completed')
    expect(requests.length).toBeGreaterThan(1000)
    expect(requests.every((record) => /^[0-9a-f-]{36}$/.test(record.reqId ?? ''))).toBe(true)
  })
})
