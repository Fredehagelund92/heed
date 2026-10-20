import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { createLoginServer } from '../../src/server/modules/oauth/index.ts'
import { SignJWT, UnsecuredJWT } from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'
import { people } from './fixtures.ts'
import { signInHarness } from './sign-in-harness.ts'

/*
  Every rule of the login server tried the wrong way (NFR-022): the authorize request, client
  registration, the consent answer, the token endpoint, and the MCP server's own check of every
  token, whoever signed it. Each test starts in a fresh minute, so the rate limits of one test do
  not reach the next.
*/

const harness = await signInHarness()
const {
  admin,
  issuer,
  resource,
  redirect,
  logLines,
  browser,
  pkce,
  form,
  token,
  register,
  registered,
  authorizeUrl,
  signInFlow,
  exchange,
  mcpStatus,
} = harness

beforeEach(() => harness.advance(61))

/** An authorize request as a signed-in browser, with good values unless a test says otherwise. */
async function authorize(clientId: string, change: Record<string, string | undefined> = {}) {
  const person = browser()
  await person.signIn('author')
  const proof = pkce()
  return person.go(
    authorizeUrl({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: proof.challenge,
      code_challenge_method: 'S256',
      state: 'state-1',
      ...change,
    }),
  )
}
const errorOf = (response: Response) => {
  expect(response.status).toBe(302)
  const back = new URL(response.headers.get('location')!)
  expect(back.origin + back.pathname).toBe(redirect)
  expect(back.searchParams.get('state')).toBe('state-1')
  expect(back.searchParams.get('iss')).toBe(issuer)
  expect(back.searchParams.get('code')).toBeNull()
  return back.searchParams.get('error')
}
/** A refused authorize request that must not send the browser anywhere. */
async function shownPage(response: Response) {
  expect(response.status).toBe(400)
  expect(response.headers.get('location')).toBeNull()
  expect(response.headers.get('content-type')).toContain('text/html')
  expect(response.headers.get('x-frame-options')).toBe('DENY')
  return response.text()
}

describe('the authorize request', () => {
  it('shows a page and redirects nowhere when the client or its redirect address is unknown', async () => {
    const clientId = await registered()
    expect(await shownPage(await authorize('hc_' + 'a'.repeat(43)))).toContain(
      'We don’t know this app',
    )
    expect(await shownPage(await authorize(''))).toContain('didn’t say')
    for (const address of [
      'http://127.0.0.1:43123/other',
      'https://evil.example/callback',
      'http://127.0.0.1:43123/callback#x',
      'http://evil.example:43123/callback',
      `${redirect}?extra=1`,
    ])
      expect(await shownPage(await authorize(clientId, { redirect_uri: address }))).toContain(
        'didn’t register',
      )
    expect(await shownPage(await authorize(clientId, { redirect_uri: undefined }))).toContain(
      'didn’t register',
    )
  })

  it('lets a desktop client listen on another loopback port, and nothing else differ', async () => {
    const clientId = await registered()
    const moved = await authorize(clientId, { redirect_uri: 'http://127.0.0.1:50999/callback' })
    expect(moved.status).toBe(302)
    expect(moved.headers.get('location')).toMatch(
      /^http:\/\/localhost:5173\/connect\/approve\?request=/,
    )
    const host = await authorize(clientId, { redirect_uri: 'http://localhost:43123/callback' })
    expect(host.status).toBe(400)
  })

  it('requires PKCE with S256, the code flow, known scopes and this resource', async () => {
    const clientId = await registered()
    expect(errorOf(await authorize(clientId, { code_challenge: undefined }))).toBe(
      'invalid_request',
    )
    expect(errorOf(await authorize(clientId, { code_challenge_method: undefined }))).toBe(
      'invalid_request',
    )
    expect(errorOf(await authorize(clientId, { code_challenge_method: 'plain' }))).toBe(
      'invalid_request',
    )
    expect(errorOf(await authorize(clientId, { code_challenge: 'short' }))).toBe('invalid_request')
    expect(errorOf(await authorize(clientId, { response_type: 'token' }))).toBe(
      'unsupported_response_type',
    )
    expect(errorOf(await authorize(clientId, { scope: 'read admin' }))).toBe('invalid_scope')
    expect(errorOf(await authorize(clientId, { scope: 'read edition' }))).toBe('invalid_scope')
    expect(errorOf(await authorize(clientId, { resource: 'http://evil.example/mcp' }))).toBe(
      'invalid_target',
    )
    const longState = await authorize(clientId, { state: 's'.repeat(513) })
    expect(new URL(longState.headers.get('location')!).searchParams.get('error')).toBe(
      'invalid_request',
    )
  })

  it('refuses a repeated parameter and another host', async () => {
    const clientId = await registered()
    const proof = pkce()
    const address = new URL(
      authorizeUrl({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirect,
        code_challenge: proof.challenge,
        code_challenge_method: 'S256',
      }),
    )
    address.searchParams.append('client_id', clientId)
    expect(await shownPage(await fetch(address, { redirect: 'manual' }))).toContain('twice')
    const foreign = await harness.app.inject({
      method: 'GET',
      url: '/oauth/authorize?' + address.searchParams.toString(),
      headers: { host: 'evil.example' },
    })
    expect(foreign.statusCode).toBe(403)
    const discovery = await harness.app.inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
      headers: { host: 'rebound.example:3000' },
    })
    expect(discovery.statusCode).toBe(403)
  })

  it('limits each caller address', async () => {
    const clientId = await registered()
    const answers: number[] = []
    for (let i = 0; i < 31; i++)
      answers.push(
        (await fetch(authorizeUrl({ client_id: clientId }), { redirect: 'manual' })).status,
      )
    expect(answers.slice(0, 30).every((status) => status !== 429)).toBe(true)
    expect(answers[30]).toBe(429)
  })
})

describe('client registration', () => {
  it('refuses redirect addresses that are not https or this computer, wildcards and fragments', async () => {
    for (const uris of [
      ['http://evil.example/callback'],
      ['https://*.example.com/callback'],
      ['https://app.example/callback#frag'],
      ['myapp://callback'],
      ['https://user:pass@app.example/callback'],
      ['javascript:alert(1)'],
      ['/relative'],
      [],
      Array.from({ length: 11 }, (_, i) => `https://app.example/${i}`),
      [42],
    ]) {
      const response = await register({ redirect_uris: uris })
      expect(response.status, JSON.stringify(uris)).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'invalid_client_metadata' })
    }
  })

  it('refuses other grant and response types, odd names, and a body that is not JSON', async () => {
    for (const metadata of [
      { grant_types: ['implicit'] },
      { grant_types: ['refresh_token'] },
      { grant_types: ['authorization_code', 'client_credentials'] },
      { response_types: ['token'] },
      { client_name: 'Bad‮name' },
      { client_name: 'x'.repeat(101) },
      { client_name: '   ' },
    ]) {
      const response = await register(metadata)
      expect(response.status, JSON.stringify(metadata)).toBe(400)
    }
    const text = await fetch(`${issuer}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'client_name=x',
    })
    expect(text.status).toBeGreaterThanOrEqual(400)
  })

  it('registers a client that asks for a secret as a public client with no secret', async () => {
    const response = await register({ token_endpoint_auth_method: 'client_secret_post' })
    expect(response.status).toBe(201)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.token_endpoint_auth_method).toBe('none')
    expect(body).not.toHaveProperty('client_secret')
  })

  it('reads a client ID metadata document and checks that it names itself', async () => {
    const id = 'https://app.example/heed-client.json'
    harness.documents.set(id, {
      client_id: id,
      client_name: 'Example app',
      redirect_uris: [redirect],
    })
    const flow = await signInFlow(id)
    expect(flow.request).toMatchObject({
      clientName: 'Example app',
      clientKind: 'document',
      clientHost: 'app.example',
    })
    expect((await exchange(id, flow.code!, flow.verifier)).status).toBe(200)
    // The document changed: it no longer lists the redirect address.
    harness.documents.set(id, {
      client_id: id,
      client_name: 'Example app',
      redirect_uris: ['https://app.example/elsewhere'],
    })
    expect(await shownPage(await authorize(id))).toContain('didn’t register')
    // A document that names another client, or asks to authenticate with a key, is refused.
    harness.documents.set(id, { client_id: 'https://other.example/x', redirect_uris: [redirect] })
    expect(await shownPage(await authorize(id))).toContain('in a way we can’t accept')
    harness.documents.set(id, {
      client_id: id,
      redirect_uris: [redirect],
      token_endpoint_auth_method: 'private_key_jwt',
    })
    expect(await shownPage(await authorize(id))).toContain('in a way we can’t accept')
    // A document that cannot be read, and addresses that are not acceptable document addresses.
    expect(await shownPage(await authorize('https://unreachable.example/c.json'))).toContain(
      'We couldn’t read the app’s description',
    )
    for (const bad of [
      'https://app.example/',
      'https://app.example/c.json?x=1',
      'https://app.example/a/../c.json',
    ])
      expect(await shownPage(await authorize(bad))).toContain('in a way we can’t accept')
  })
})

describe('the consent answer', () => {
  async function started(clientId: string) {
    const person = browser()
    await person.signIn('author')
    const proof = pkce()
    const response = await person.go(
      authorizeUrl({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirect,
        code_challenge: proof.challenge,
        code_challenge_method: 'S256',
        state: 'state-1',
      }),
    )
    const id = new URL(response.headers.get('location')!).searchParams.get('request')!
    expect(response.headers.getSetCookie().join()).toMatch(
      /heed_oauth_browser=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600/,
    )
    return { person, id, proof }
  }

  it('belongs to the browser that started the sign-in', async () => {
    const { id } = await started(await registered())
    const other = browser()
    await other.signIn('stranger')
    expect((await other.api(`/connections/request?id=${id}`)).status).toBe(404)
    expect((await other.api('/connections/request/decision', { id, allow: true })).status).toBe(404)
    // The other browser copies a sign-in cookie of its own: still not this sign-in.
    other.jar.set('heed_oauth_browser', 'f'.repeat(64))
    expect((await other.api('/connections/request/decision', { id, allow: true })).status).toBe(404)
  })

  it('needs a signed-in person, the page origin and the session token', async () => {
    const { person, id } = await started(await registered())
    const anonymous = browser()
    anonymous.jar.set('heed_oauth_browser', person.jar.get('heed_oauth_browser')!)
    expect((await anonymous.api(`/connections/request?id=${id}`)).status).toBe(401)
    expect(
      (
        await person.api(
          '/connections/request/decision',
          { id, allow: true },
          { 'x-heed-csrf': 'x' },
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await person.api(
          '/connections/request/decision',
          { id, allow: true },
          { origin: 'http://evil.example' },
        )
      ).status,
    ).toBe(403)
    // Refused answers leave the sign-in waiting; a real answer is taken once.
    expect((await person.api('/connections/request/decision', { id, allow: true })).status).toBe(
      200,
    )
    expect((await person.api('/connections/request/decision', { id, allow: true })).status).toBe(
      404,
    )
    expect((await person.api(`/connections/request?id=${id}`)).status).toBe(404)
  })

  it('sends a refusal back to the client, and ends after ten minutes', async () => {
    const clientId = await registered()
    const denied = await signInFlow(clientId, { allow: false })
    expect(denied.code).toBeNull()
    expect(denied.back.searchParams.get('error')).toBe('access_denied')
    const { person, id } = await started(clientId)
    harness.advance(601)
    expect((await person.api(`/connections/request?id=${id}`)).status).toBe(404)
    expect((await person.api('/connections/request/decision', { id, allow: true })).status).toBe(
      404,
    )
  })
})

describe('the token endpoint', () => {
  it('takes a code once; a second use revokes the connection it made', async () => {
    const clientId = await registered()
    const flow = await signInFlow(clientId)
    const first = await exchange(clientId, flow.code!, flow.verifier)
    expect(first.status).toBe(200)
    const second = await exchange(clientId, flow.code!, flow.verifier)
    expect(second).toMatchObject({ status: 400, body: { error: 'invalid_grant' } })
    expect(await mcpStatus(first.body.access_token!)).toBe(401)
    const refresh = await token({
      grant_type: 'refresh_token',
      refresh_token: first.body.refresh_token!,
      client_id: clientId,
    })
    expect(refresh.status).toBe(400)
  })

  it('needs the right verifier, redirect address, client and resource, and uses the code up', async () => {
    const clientId = await registered()
    const otherClient = await registered()
    const cases: [Record<string, string>, string][] = [
      [{ code_verifier: pkce().verifier }, 'invalid_grant'],
      [{ code_verifier: 'not valid!'.repeat(5) }, 'invalid_grant'],
      [{ redirect_uri: 'http://127.0.0.1:43123/other' }, 'invalid_grant'],
      [{ client_id: otherClient }, 'invalid_grant'],
      [{ resource: 'http://evil.example/mcp' }, 'invalid_target'],
      [{ code_verifier: '' }, 'invalid_request'],
    ]
    for (const [change, error] of cases) {
      const flow = await signInFlow(clientId)
      const response = await token({
        grant_type: 'authorization_code',
        code: flow.code!,
        redirect_uri: redirect,
        client_id: clientId,
        code_verifier: flow.verifier,
        ...change,
      })
      expect(response.status, JSON.stringify(change)).toBe(400)
      expect(await response.json()).toMatchObject({ error })
      if (error === 'invalid_grant')
        // The failed attempt used the code up: the right request fails too.
        expect((await exchange(clientId, flow.code!, flow.verifier)).status).toBe(400)
    }
  })

  it('lets a code expire after a minute', async () => {
    const clientId = await registered()
    const flow = await signInFlow(clientId)
    harness.advance(61)
    expect((await exchange(clientId, flow.code!, flow.verifier)).body).toMatchObject({
      error: 'invalid_grant',
    })
  })

  it('refuses a client secret, a repeated parameter, JSON and other grant types', async () => {
    const clientId = await registered()
    const flow = await signInFlow(clientId)
    const good = {
      grant_type: 'authorization_code',
      code: flow.code!,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: flow.verifier,
    }
    const secret = await token({ ...good, client_secret: 'guess' })
    expect(secret.status).toBe(401)
    expect(await secret.json()).toMatchObject({ error: 'invalid_client' })
    const basic = await fetch(`${issuer}/oauth/token`, {
      ...form(good),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: 'Basic ' + Buffer.from(`${clientId}:x`).toString('base64'),
      },
    })
    expect(basic.status).toBe(401)
    const repeated = await fetch(`${issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(good).toString() + `&code=${flow.code!}`,
    })
    expect(repeated.status).toBe(400)
    expect(await repeated.json()).toMatchObject({ error: 'invalid_request' })
    const json = await fetch(`${issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(good),
    })
    expect(json.status).toBe(400)
    const password = await token({ ...good, grant_type: 'password' })
    expect(await password.json()).toMatchObject({ error: 'unsupported_grant_type' })
    // None of those used the code: the right request still works.
    expect((await exchange(clientId, flow.code!, flow.verifier)).status).toBe(200)
  })

  it('revokes a connection whose refresh token another client presents', async () => {
    const clientId = await registered()
    const otherClient = await registered()
    const flow = await signInFlow(clientId)
    const tokens = await exchange(clientId, flow.code!, flow.verifier)
    const stolen = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.body.refresh_token!,
      client_id: otherClient,
    })
    expect(stolen.status).toBe(400)
    const own = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.body.refresh_token!,
      client_id: clientId,
    })
    expect(own.status).toBe(400)
    expect(await mcpStatus(tokens.body.access_token!)).toBe(401)
  })

  it('ends a refresh token unused for a day, and a person who is no longer active', async () => {
    const clientId = await registered()
    const idle = await signInFlow(clientId)
    const idleTokens = await exchange(clientId, idle.code!, idle.verifier)
    harness.advance(24 * 3600 + 1)
    expect(
      (
        await token({
          grant_type: 'refresh_token',
          refresh_token: idleTokens.body.refresh_token!,
          client_id: clientId,
        })
      ).status,
    ).toBe(400)
    const active = await signInFlow(clientId, { person: 'stranger' })
    const activeTokens = await exchange(clientId, active.code!, active.verifier)
    await admin.query('update people set deactivated_at=now() where id=$1', [people.stranger])
    const refused = await token({
      grant_type: 'refresh_token',
      refresh_token: activeTokens.body.refresh_token!,
      client_id: clientId,
    })
    expect(refused.status).toBe(400)
    expect(await mcpStatus(activeTokens.body.access_token!)).toBe(401)
    await admin.query('update people set deactivated_at=null where id=$1', [people.stranger])
  })

  it('limits each caller address', async () => {
    const answers: number[] = []
    for (let i = 0; i < 60; i++)
      answers.push((await token({ grant_type: 'refresh_token', client_id: `c${i}` })).status)
    expect(answers.every((status) => status === 400)).toBe(true)
    const limited = await token({ grant_type: 'refresh_token', client_id: 'another' })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  /** A token request from another caller address. */
  const tokenFrom = (remoteAddress: string, values: Record<string, string>) =>
    harness.app.inject({
      method: 'POST',
      url: '/oauth/token',
      remoteAddress,
      headers: {
        host: new URL(issuer).host,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: new URLSearchParams(values).toString(),
    })

  it('counts only failed requests against a client, and only from the address that failed', async () => {
    const clientId = await registered()
    const flow = await signInFlow(clientId)
    for (let i = 0; i < 30; i++)
      expect((await token({ grant_type: 'refresh_token', client_id: clientId })).status).toBe(400)
    const repeated = await token({ grant_type: 'refresh_token', client_id: clientId })
    expect(repeated.status).toBe(429)
    expect(Number(repeated.headers.get('retry-after'))).toBeGreaterThan(0)
    const exchanged = await tokenFrom('10.0.0.1', {
      grant_type: 'authorization_code',
      code: flow.code!,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: flow.verifier,
      resource,
    })
    expect(exchanged.statusCode).toBe(200)
    harness.advance(61)
    expect((await token({ grant_type: 'refresh_token', client_id: clientId })).status).toBe(400)
  })

  it('answers many valid refreshes of one client across its connections', async () => {
    const clientId = await registered()
    const refreshes: { refresh: string; address: string }[] = []
    for (let i = 0; i < 35; i++) {
      if (i % 8 === 0) harness.advance(61)
      const flow = await signInFlow(clientId)
      const tokens = await exchange(clientId, flow.code!, flow.verifier)
      expect(tokens.status).toBe(200)
      refreshes.push({ refresh: tokens.body.refresh_token!, address: `10.1.0.${i + 1}` })
    }
    harness.advance(61)
    const answers = await Promise.all(
      refreshes.map(({ refresh, address }) =>
        tokenFrom(address, {
          grant_type: 'refresh_token',
          refresh_token: refresh,
          client_id: clientId,
        }),
      ),
    )
    expect(answers.map((answer) => answer.statusCode)).toEqual(refreshes.map(() => 200))
  })

  it('limits the refreshes of one connection', async () => {
    const clientId = await registered()
    const flow = await signInFlow(clientId)
    let refresh = (await exchange(clientId, flow.code!, flow.verifier)).body.refresh_token!
    for (let i = 0; i < 5; i++) {
      const answer = await tokenFrom(`10.2.0.${i + 1}`, {
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: clientId,
      })
      expect(answer.statusCode).toBe(200)
      refresh = answer.json<{ refresh_token: string }>().refresh_token
    }
    const limited = await tokenFrom('10.2.0.9', {
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: clientId,
    })
    expect(limited.statusCode).toBe(429)
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
    harness.advance(61)
    const again = await tokenFrom('10.2.0.9', {
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: clientId,
    })
    expect(again.statusCode).toBe(200)
  })
})

describe('the MCP server checks every token itself', () => {
  async function signed(
    claims: Record<string, unknown>,
    options: { key?: KeyObject; typ?: string; life?: number; kid?: string } = {},
  ) {
    // Signed for the service's own time, which the tests in this file move on.
    const issuedAt = Math.floor(harness.now().getTime() / 1000)
    return new SignJWT({ client_id: 'hc_x', scope: 'read feedback', ...claims })
      .setProtectedHeader({
        alg: 'EdDSA',
        typ: options.typ ?? 'at+jwt',
        kid: options.kid ?? harness.keys.active.kid,
      })
      .setIssuer((claims.iss as string | undefined) ?? issuer)
      .setSubject(people.author)
      .setAudience((claims.aud as string | undefined) ?? resource)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + (options.life ?? 600))
      .sign(options.key ?? harness.keys.active.privateKey)
  }

  it('refuses a forged, foreign, mistargeted, long-lived, expired or odd token, with a reason', async () => {
    const before = logLines.length
    const { privateKey: stranger } = generateKeyPairSync('ed25519')
    const cases: [Promise<string>, string][] = [
      [signed({}, { key: stranger }), 'bad_signature'],
      [signed({ aud: 'http://localhost:1/mcp' }), 'wrong_audience'],
      [signed({ iss: 'https://evil.example' }), 'unknown_issuer'],
      [signed({}, { typ: 'JWT' }), 'bad_claims'],
      [signed({}, { life: 7200 }), 'bad_claims'],
      [signed({}, { life: -60 }), 'expired'],
      [signed({ scope: 'edition' }), 'bad_claims'],
      [signed({ groups: 'all' }), 'bad_claims'],
      [signed({ sid: 42 }), 'bad_claims'],
      [signed({}, { kid: 'unknown' }), 'bad_signature'],
      [Promise.resolve(new UnsecuredJWT({ iss: issuer, aud: resource }).encode()), 'bad_signature'],
      [Promise.resolve('not.a.token'), 'malformed'],
    ]
    for (const [made, reason] of cases) {
      expect(await mcpStatus(await made), reason).toBe(401)
      expect(logLines.at(-1)).toMatchObject({ msg: 'MCP token rejected', reason })
    }
    expect(logLines.length).toBeGreaterThan(before)
    // A well-formed token is served, and one with an unknown scope keeps only what it knows.
    expect(await mcpStatus(await signed({}))).toBe(200)
    expect(await mcpStatus(await signed({ scope: 'propose' }))).toBe(403)
  })

  it('counts the per-person limit by person, across their apps', async () => {
    harness.advance(61)
    await admin.query(
      `insert into settings_versions (key, version, value, reason)
       select 'limits.mcp_requests_per_minute', max(version) + 1, '{"person": 2, "client": 120}', 'test'
         from settings_versions where key='limits.mcp_requests_per_minute'`,
    )
    const clientId = await registered()
    const one = await signInFlow(clientId)
    const two = await signInFlow(clientId)
    const first = await exchange(clientId, one.code!, one.verifier)
    const second = await exchange(clientId, two.code!, two.verifier)
    expect(await mcpStatus(first.body.access_token!)).toBe(200)
    expect(await mcpStatus(second.body.access_token!)).toBe(200)
    expect(await mcpStatus(second.body.access_token!)).toBe(429)
    const other = await signInFlow(clientId, { person: 'owner' })
    const third = await exchange(clientId, other.code!, other.verifier)
    expect(await mcpStatus(third.body.access_token!)).toBe(200)
  })
})

describe('after a restart', () => {
  it('refuses tokens from before it until it has read the recent disconnects', async () => {
    const clientId = await registered()
    const kept = await signInFlow(clientId)
    const keptTokens = await exchange(clientId, kept.code!, kept.verifier)
    const gone = await signInFlow(clientId)
    const goneTokens = await exchange(clientId, gone.code!, gone.verifier)
    const [, payload] = goneTokens.body.access_token!.split('.')
    const sid = (JSON.parse(Buffer.from(payload!, 'base64url').toString()) as { sid: string }).sid
    await gone.person.api(`/connections/${sid}/disconnect`, {})
    // The same keys and settings in a new process, a second later.
    harness.advance(1)
    const restarted = createLoginServer({
      config: harness.login.config,
      resource,
      keys: harness.keys,
      nodeEnv: 'test',
      now: harness.now,
    })
    const accepts = async (token: string) =>
      restarted.verifier.verify(token).then(
        () => true,
        () => false,
      )
    expect(await accepts(keptTokens.body.access_token!)).toBe(false)
    expect(await accepts(goneTokens.body.access_token!)).toBe(false)
    await restarted.loadRevocations({
      query: async <Row extends object>(text: string, values?: unknown[]) =>
        (await admin.query(text, values)).rows as Row[],
    })
    expect(await accepts(keptTokens.body.access_token!)).toBe(true)
    expect(await accepts(goneTokens.body.access_token!)).toBe(false)
  })
})

describe('what anyone can make the login server store', () => {
  it('stores a document app only once a signed-in person allows it', async () => {
    const id = 'https://store.example/client.json'
    harness.documents.set(id, {
      client_id: id,
      client_name: 'Stored app',
      redirect_uris: [redirect],
    })
    const count = async () =>
      (
        await admin.query<{ n: number }>(
          'select count(*)::int as n from auth.oauth_clients where id=$1',
          [id],
        )
      ).rows[0]!.n
    // Sign-ins started and never answered, as anyone can start them, leave no app behind.
    for (let i = 0; i < 3; i++) expect((await authorize(id)).status).toBe(302)
    expect(await count()).toBe(0)
    const denied = await signInFlow(id, { allow: false })
    expect(denied.back.searchParams.get('error')).toBe('access_denied')
    expect(await count()).toBe(0)
    const allowed = await signInFlow(id)
    expect(allowed.request).toMatchObject({ clientName: 'Stored app', clientKind: 'document' })
    expect(await count()).toBe(1)
    expect((await exchange(id, allowed.code!, allowed.verifier)).status).toBe(200)
  })

  it('removes a registration nobody connected with after a day, and refuses no new one', async () => {
    const unused = await registered()
    const used = await registered()
    const flow = await signInFlow(used)
    expect((await exchange(used, flow.code!, flow.verifier)).status).toBe(200)
    harness.advance(86_401)
    // The next registration prunes; it is never refused for the number of others.
    const fresh = await registered()
    expect(await shownPage(await authorize(unused))).toContain('We don’t know this app')
    expect((await authorize(used)).status).toBe(302)
    expect((await authorize(fresh)).status).toBe(302)
  })
})
