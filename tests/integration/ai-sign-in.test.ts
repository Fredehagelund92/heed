import { describe, expect, it, vi } from 'vitest'
import { mintDevToken } from '../../src/server/mcp/auth.ts'
import { people } from './fixtures.ts'
import { signInHarness } from './sign-in-harness.ts'
/*
  The login server for a person's own AI client (FR-402 to FR-406, FR-414, NFR-022), end to end
  on PostgreSQL: a test client walks discovery, registration, sign-in with PKCE, the consent
  answer, the token, a tool call over MCP, refresh with rotation, reuse detection, revocation and
  a disconnect, and every rule is tried the wrong way too.
*/

const harness = await signInHarness()
const {
  admin,
  issuer,
  resource,
  devKey,
  redirect,
  logLines,
  rawLog,
  token,
  form,
  registered,
  signInFlow,
  exchange,
  mcpClient,
  mcpStatus,
  browser,
} = harness

describe('a person connects their own AI client', () => {
  it('walks discovery, registration, consent, token, a tool call, refresh, reuse and revocation', async () => {
    // Discovery: the MCP address says where to sign in (RFC 9728), the login server describes itself (RFC 8414).
    const challenge = await fetch(resource, { method: 'POST' })
    expect(challenge.status).toBe(401)
    const header = challenge.headers.get('www-authenticate')!
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)![1]!
    const protectedResource = (await (await fetch(metadataUrl)).json()) as Record<string, unknown>
    expect(protectedResource).toMatchObject({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ['read', 'feedback', 'propose'],
    })
    const server = (await (
      await fetch(`${issuer}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>
    expect(server).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      grant_types_supported: ['authorization_code', 'refresh_token'],
    })
    const jwks = (await (await fetch(server.jwks_uri as string)).json()) as { keys: object[] }
    expect(jwks.keys).toEqual([
      expect.objectContaining({ kty: 'OKP', crv: 'Ed25519', kid: harness.keys.active.kid }),
    ])
    expect(JSON.stringify(jwks)).not.toContain('"d"')

    // Registration (RFC 7591) and sign-in with PKCE, as the author.
    // Connect your AI says a client can sign in, and offers no token setup for the shared label.
    const reader = browser()
    await reader.signIn('stranger')
    expect(await (await reader.api('/connect')).json()).toMatchObject({
      address: resource,
      signIn: true,
      clients: [{ label: 'claude-code', name: 'Claude Code with a token' }],
    })
    const clientId = await registered()
    const flow = await signInFlow(clientId)
    expect(flow.request).toMatchObject({
      clientName: 'Test client',
      clientKind: 'registered',
      clientHost: '127.0.0.1',
      redirectHost: '127.0.0.1',
      scopes: ['read', 'feedback'],
    })
    expect(flow.back.origin + flow.back.pathname).toBe(redirect)
    const first = await exchange(clientId, flow.code!, flow.verifier)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'read feedback',
    })

    // The access token is for exactly this person, this resource and these scopes.
    const [, payload] = first.body.access_token!.split('.')
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<
      string,
      unknown
    >
    expect(claims).toMatchObject({
      iss: issuer,
      aud: resource,
      sub: people.author,
      client_id: clientId,
      scope: 'read feedback',
      groups: [],
    })
    expect(Number(claims.exp) - Number(claims.iat)).toBe(600)

    // A tool call over MCP with the signed-in token: the client label is the shared one.
    const wire = await mcpClient(first.body.access_token!)
    const listed = await wire.listTools()
    expect(listed.tools.map((t) => t.name)).toContain('get_context')
    const reply = await wire.callTool({
      name: 'get_context',
      arguments: { question: 'Orders in Norway, August 2026' },
    })
    expect(reply.isError).not.toBe(true)
    expect(reply.structuredContent).toMatchObject({ status: 'matched' })
    // Selecting an edition needs edition scope, which a person's token never carries.
    const edition = await wire.callTool({
      name: 'get_context',
      arguments: { question: 'Orders in Norway, August 2026', edition: '1' },
    })
    expect(edition.isError).toBe(true)
    await wire.close()

    // Refresh rotates: the new refresh token works, the old one is used up.
    const refreshed = await token({
      grant_type: 'refresh_token',
      refresh_token: first.body.refresh_token!,
      client_id: clientId,
    })
    expect(refreshed.status).toBe(200)
    const second = (await refreshed.json()) as Record<string, string>
    expect(second.refresh_token).not.toBe(first.body.refresh_token)
    expect(await mcpStatus(second.access_token!)).toBe(200)
    // A narrower scope on refresh is allowed; a wider one is not.
    const narrower = await token({
      grant_type: 'refresh_token',
      refresh_token: second.refresh_token!,
      client_id: clientId,
      scope: 'read',
    })
    expect(narrower.status).toBe(200)
    const third = (await narrower.json()) as Record<string, string>
    expect(third.scope).toBe('read')
    const wider = await token({
      grant_type: 'refresh_token',
      refresh_token: third.refresh_token!,
      client_id: clientId,
      scope: 'read propose',
    })
    expect(wider.status).toBe(400)
    expect(await wider.json()).toMatchObject({ error: 'invalid_scope' })

    // Reuse detection: presenting a used refresh token revokes the whole connection.
    const reused = await token({
      grant_type: 'refresh_token',
      refresh_token: first.body.refresh_token!,
      client_id: clientId,
    })
    expect(reused.status).toBe(400)
    expect(await reused.json()).toMatchObject({ error: 'invalid_grant' })
    for (const refreshToken of [second.refresh_token!, third.refresh_token!]) {
      const after = await token({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      })
      expect(after.status).toBe(400)
    }
    // The MCP server refuses the connection's access tokens at once, not when they expire.
    expect(await mcpStatus(second.access_token!)).toBe(401)
    expect(await mcpStatus(first.body.access_token!)).toBe(401)

    // A new sign-in, revoked by the client (RFC 7009).
    const again = await signInFlow(clientId)
    const tokens = await exchange(clientId, again.code!, again.verifier)
    expect(await mcpStatus(tokens.body.access_token!)).toBe(200)
    const revoked = await fetch(
      `${issuer}/oauth/revoke`,
      form({ token: tokens.body.refresh_token!, client_id: clientId }),
    )
    expect(revoked.status).toBe(200)
    expect(await mcpStatus(tokens.body.access_token!)).toBe(401)
    expect(
      (
        await token({
          grant_type: 'refresh_token',
          refresh_token: tokens.body.refresh_token!,
          client_id: clientId,
        })
      ).status,
    ).toBe(400)

    // A third sign-in, listed for the person and disconnected from Heed.
    const third2 = await signInFlow(clientId)
    const kept = await exchange(clientId, third2.code!, third2.verifier)
    const listedApps = (await (await third2.person.api('/connections')).json()) as {
      id: string
      clientName: string
      scopes: string[]
    }[]
    expect(listedApps).toEqual([
      expect.objectContaining({ clientName: 'Test client', scopes: ['read', 'feedback'] }),
    ])
    // Another person sees none of them and cannot disconnect it.
    const stranger = browser()
    await stranger.signIn('stranger')
    expect(await (await stranger.api('/connections')).json()).toEqual([])
    expect((await stranger.api(`/connections/${listedApps[0]!.id}/disconnect`, {})).status).toBe(
      404,
    )
    expect(await mcpStatus(kept.body.access_token!)).toBe(200)
    const disconnected = await third2.person.api(`/connections/${listedApps[0]!.id}/disconnect`, {})
    expect(disconnected.status).toBe(200)
    expect(await (await third2.person.api('/connections')).json()).toEqual([])
    expect(await mcpStatus(kept.body.access_token!)).toBe(401)

    // History: connections, the reuse revocation, the client's revocation and the disconnect.
    const audit = await admin.query<{ action: string; reason: string | null }>(
      "select action, details->>'reason' as reason from audit_log where subject_type='ai_connection' order by seq",
    )
    expect(audit.rows).toEqual([
      { action: 'ai_client.connected', reason: null },
      { action: 'ai_client.revoked', reason: 'refresh_reuse' },
      { action: 'ai_client.connected', reason: null },
      { action: 'ai_client.revoked', reason: 'revoked_by_client' },
      { action: 'ai_client.connected', reason: null },
      { action: 'ai_client.disconnected', reason: 'disconnected' },
    ])
  })

  it('keeps working with dev tokens beside the login server', async () => {
    expect(await mcpStatus(await mintDevToken(devKey, resource))).toBe(200)
  })

  it('records the shared client label and never the person, a token or a code', async () => {
    const clientId = await registered()
    const flow = await signInFlow(clientId)
    const tokens = await exchange(clientId, flow.code!, flow.verifier)
    const wire = await mcpClient(tokens.body.access_token!)
    await wire.callTool({
      name: 'get_context',
      arguments: { question: 'Orders in Norway, August 2026' },
    })
    await wire.close()
    // The gateway writes its anonymous records in batches just after the answers.
    await vi.waitFor(async () => {
      const requests = await admin.query<{ client_label: string }>(
        "select distinct client_label from deliveries where client_label='signed-in'",
      )
      expect(requests.rows).toEqual([{ client_label: 'signed-in' }])
    })
    const records = JSON.stringify(
      (await admin.query('select * from mcp_requests')).rows.concat(
        (await admin.query('select * from deliveries')).rows,
      ),
    )
    expect(records).not.toContain(people.author)
    const log = rawLog.join('\n')
    for (const secret of [
      tokens.body.access_token!,
      tokens.body.refresh_token!,
      flow.code!,
      flow.verifier,
      flow.id,
      people.author,
      clientId,
    ])
      expect(log).not.toContain(secret)
    const signIns = logLines.filter((line) => line.event === 'ai_sign_in')
    expect(signIns.length).toBeGreaterThan(0)
    for (const line of signIns) expect(line.client).toBe('signed-in')
    expect(signIns.map((line) => line.result)).toEqual(
      expect.arrayContaining(['registered', 'requested', 'approved', 'token_issued', 'refreshed']),
    )
    expect(signIns.map((line) => line.reason)).toContain('refresh_reuse')
  })
})
