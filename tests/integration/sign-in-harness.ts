import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, expect } from 'vitest'
import { buildApp } from '../../src/server/app.ts'
import type { LoginServerConfig } from '../../src/server/config/env.ts'
import { createDevVerifier, createIssuerVerifier, devIssuer } from '../../src/server/mcp/auth.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import type { DevPerson } from '../../src/server/modules/auth/index.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import {
  createLoginServer,
  loadKeyRing,
  type FetchMetadataDocument,
  type KeyRing,
  type LoginServer,
} from '../../src/server/modules/oauth/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, servingEdition } from './fixtures.ts'
import { apiDatabase, servingPool, testDatabase, transaction } from './support.ts'

/**
 * The login server and the MCP server in one app on a real port, on a test database, with a
 * browser, a test AI client and helpers for each step of a sign-in (tests/integration/ai-sign-in*).
 */
async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise((resolve) => server.close(resolve))
  return port
}

export async function signInHarness(options: { dynamicRegistration?: boolean } = {}) {
  const port = await freePort()
  const { client: admin, url } = testDatabase()
  const database = apiDatabase(url)
  const pool = servingPool(url)
  const issuer = `http://localhost:${port}`
  const resource = `${issuer}/mcp`
  const web = 'http://localhost:5173'
  const redirect = 'http://127.0.0.1:43123/callback'
  const logLines: Record<string, unknown>[] = []
  const rawLog: string[] = []
  const logger = createLogger({
    level: 'info',
    destination: new Writable({
      write(chunk: Buffer, _encoding, done) {
        rawLog.push(chunk.toString())
        logLines.push(JSON.parse(chunk.toString()) as Record<string, unknown>)
        done()
      },
    }),
  })
  // The administrator of the fixtures, who sees and disconnects everyone's apps.
  const devPeople: DevPerson[] = ['author', 'owner', 'stranger', 'admin'].map((name) => ({
    email: `${name}@example.test`,
    name,
    roles: [],
  }))
  let skew = 0
  const now = () => new Date(Date.now() + skew)
  const documents = new Map<string, unknown>()
  const fetchDocument: FetchMetadataDocument = (id) =>
    documents.has(id)
      ? Promise.resolve(documents.get(id))
      : Promise.reject(new Error('unreachable'))
  const config: Extract<LoginServerConfig, { kind: 'builtin' }> = {
    kind: 'builtin',
    issuer,
    consentUrl: `${web}/connect/approve`,
    signingKeyFile: '',
    previousKeyFiles: [],
    dynamicRegistration: options.dynamicRegistration ?? true,
    refreshIdleHours: 24,
    connectionDays: 7,
  }
  const { privateKey: devKey } = generateKeyPairSync('ed25519')
  const stateKey = Uint8Array.from(randomBytes(32))
  let keyDir: string
  let keys: KeyRing
  let login: LoginServer
  let app: ReturnType<typeof buildApp>

  beforeAll(async () => {
    keyDir = await mkdtemp(join(tmpdir(), 'heed-oauth-'))
    keys = await loadKeyRing({
      file: join(keyDir, 'oauth.pem'),
      previousFiles: [],
      nodeEnv: 'test',
    })
    login = createLoginServer({ config, resource, keys, nodeEnv: 'test', fetchDocument, now })
    app = buildApp({
      database,
      logger,
      devPeople,
      origins: [web],
      jobs: idleJobs(),
      clock: { now, today: () => now().toISOString().slice(0, 10) },
      login,
      mcp: {
        source: createEditionSource(pool),
        store: createAnonymousStore(pool),
        resource,
        authorizationServers: [issuer],
        now,
        // Seals draft_context's question rounds (tests/integration/draft-questions.test.ts).
        stateKey,
        verifier: createIssuerVerifier(
          new Map([
            [devIssuer, createDevVerifier(devKey, resource, 'test')],
            [issuer, login.verifier],
          ]),
        ),
      },
    })
    await transaction(admin, async () => {
      await foundation(admin)
      await servingEdition(admin)
    })
    await admin.query(
      "insert into people (id,email,display_name) values ($1,'gone@example.test','Gone')",
      ['00000000-0000-4000-8000-000000000009'],
    )
    await app.listen({ host: 'localhost', port })
  })
  afterAll(async () => {
    await app?.close()
    await pool.end()
    await rm(keyDir, { recursive: true, force: true })
  })

  /** A browser: a cookie jar, no automatic redirects. */
  function browser() {
    const jar = new Map<string, string>()
    const go = async (address: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
      const response = await fetch(address, { ...init, headers, redirect: 'manual' })
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';')
        const [name, value] = pair!.split('=')
        if (/Max-Age=0/i.test(line)) jar.delete(name!)
        else jar.set(name!, value!)
      }
      return response
    }
    let csrf = ''
    return {
      jar,
      go,
      async signIn(name: string) {
        const response = await go(`${issuer}/api/v1/auth/sign-in`, {
          method: 'POST',
          headers: {
            origin: web,
            'x-heed-csrf': 'dev-sign-in',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ email: `${name}@example.test` }),
        })
        expect(response.status).toBe(200)
        csrf = ((await response.json()) as { csrfToken: string }).csrfToken
      },
      api(path: string, body?: object, headers: Record<string, string> = {}) {
        return go(`${issuer}/api/v1${path}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            origin: web,
            'x-heed-csrf': csrf,
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...headers,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
      },
    }
  }

  const pkce = () => {
    const verifier = randomBytes(32).toString('base64url')
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
  }
  const form = (values: Record<string, string>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values).toString(),
  })
  const token = (values: Record<string, string>) => fetch(`${issuer}/oauth/token`, form(values))

  async function register(metadata: object = {}) {
    const response = await fetch(`${issuer}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Test client',
        redirect_uris: [redirect],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        ...metadata,
      }),
    })
    return response
  }
  async function registered() {
    const response = await register()
    expect(response.status).toBe(201)
    return ((await response.json()) as { client_id: string }).client_id
  }

  function authorizeUrl(parameters: Record<string, string | undefined>) {
    const address = new URL(`${issuer}/oauth/authorize`)
    for (const [key, value] of Object.entries(parameters))
      if (value !== undefined) address.searchParams.append(key, value)
    return address.href
  }

  /** One sign-in up to the consent answer: the code, or the redirect the browser was sent to. */
  async function signInFlow(
    clientId: string,
    options: {
      person?: string
      scope?: string
      allow?: boolean
      proof?: ReturnType<typeof pkce>
    } = {},
  ) {
    const person = browser()
    await person.signIn(options.person ?? 'author')
    const proof = options.proof ?? pkce()
    const state = randomBytes(8).toString('hex')
    const started = await person.go(
      authorizeUrl({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirect,
        code_challenge: proof.challenge,
        code_challenge_method: 'S256',
        state,
        scope: options.scope ?? 'read feedback',
        resource,
      }),
    )
    expect(started.status).toBe(302)
    const consent = new URL(started.headers.get('location')!)
    expect(consent.origin + consent.pathname).toBe(`${web}/connect/approve`)
    const id = consent.searchParams.get('request')!
    const shown = await person.api(`/connections/request?id=${id}`)
    expect(shown.status).toBe(200)
    const decided = await person.api('/connections/request/decision', {
      id,
      allow: options.allow ?? true,
    })
    expect(decided.status).toBe(200)
    const back = new URL(((await decided.json()) as { redirectTo: string }).redirectTo)
    expect(back.searchParams.get('state')).toBe(state)
    expect(back.searchParams.get('iss')).toBe(issuer)
    return {
      person,
      id,
      request: (await shown.json()) as Record<string, unknown>,
      back,
      code: back.searchParams.get('code'),
      verifier: proof.verifier,
    }
  }

  async function exchange(clientId: string, code: string, verifier: string) {
    const response = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    })
    return { status: response.status, body: (await response.json()) as Record<string, string> }
  }

  async function mcpClient(accessToken: string) {
    const wire = new Client(
      { name: 'sign-in-conformance', version: '1.0.0' },
      {
        versionNegotiation: { mode: 'auto' },
      },
    )
    await wire.connect(
      new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
    )
    return wire
  }
  const mcpStatus = async (accessToken: string) =>
    (
      await fetch(resource, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
    ).status

  return {
    admin,
    issuer,
    resource,
    web,
    redirect,
    devKey,
    documents,
    logLines,
    rawLog,
    get keys() {
      return keys
    },
    get login() {
      return login
    },
    get app() {
      return app
    },
    now,
    /** Moves the service's clock on, for expiry, and to start fresh rate windows. */
    advance(seconds: number) {
      skew += seconds * 1000
    },
    browser,
    pkce,
    form,
    token,
    register,
    registered,
    authorizeUrl,
    signInFlow,
    exchange,
    mcpClient,
    mcpStatus,
  }
}
