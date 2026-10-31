import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { TokenError, withAgents, type TokenVerifier } from '../../../src/server/mcp/auth.ts'
import {
  createAccessKeyVerifier,
  isAccessKey,
  withAccessKeys,
} from '../../../src/server/modules/access-keys/index.ts'

// An invented key: the prefix and 43 base64url characters, never one that works anywhere.
const key = `hak_${'x'.repeat(43)}`
const digest = createHash('sha256').update(key).digest('hex')
const agentId = '00000000-0000-4000-8000-0000000000a1'
const open = { state: 'open' as const, agentId, permission: 'read' as const }

const reason = (verifier: TokenVerifier, token: string) =>
  verifier.verify(token).then(
    () => 'accepted',
    (error: unknown) =>
      error instanceof TokenError ? `${error.reason}/${error.client}` : 'thrown',
  )

describe('the MCP server and access keys', () => {
  it('accepts an open key as a service with read and feedback, naming no person', async () => {
    const asked: string[] = []
    const verifier = createAccessKeyVerifier((hash) => {
      asked.push(hash)
      return Promise.resolve(open)
    })
    const principal = await verifier.verify(key)
    expect(principal).toEqual({
      client: 'access-key',
      scopes: ['read', 'feedback'],
      caller: 'agent',
      canSelectEdition: false,
      agent: { kind: 'key', id: agentId, permission: 'read' },
    })
    expect(principal.subject).toBeUndefined()
    // Only the digest is asked about, never the key.
    expect(asked).toEqual([digest])
  })

  it('refuses a revoked key, an unknown one and one of the wrong form, by reason only', async () => {
    const answers = { [digest]: { ...open, state: 'revoked' as const } }
    const verifier = createAccessKeyVerifier((hash) => Promise.resolve(answers[hash] ?? null))
    expect(await reason(verifier, key)).toBe('revoked/access-key')
    expect(await reason(verifier, `hak_${'y'.repeat(43)}`)).toBe('unknown_key/access-key')
    expect(await reason(verifier, 'hak_short')).toBe('malformed/access-key')
    expect(await reason(verifier, `hak_${'x'.repeat(42)}!`)).toBe('malformed/access-key')
  })

  it('holds no scope when an admin set its agent to no access, and still names the agent', async () => {
    const verifier = createAccessKeyVerifier(() => Promise.resolve({ ...open, permission: 'none' }))
    expect(await verifier.verify(key)).toMatchObject({
      scopes: [],
      agent: { kind: 'key', id: agentId, permission: 'none' },
    })
  })

  it("names the agent of a person's connection and narrows its scopes to its permission", async () => {
    const person = {
      client: 'signed-in',
      scopes: ['read', 'feedback', 'propose'],
      caller: 'agent' as const,
      canSelectEdition: false,
      subject: '00000000-0000-4000-8000-000000000001',
      connection: '00000000-0000-4000-8000-0000000000c1',
    }
    const tokens: TokenVerifier = { verify: () => Promise.resolve(person) }
    const asked: string[] = []
    const permissions = { suggest: 'suggest', read: 'read', none: 'none' } as const
    for (const [permission, scopes] of [
      ['suggest', ['read', 'feedback', 'propose']],
      ['read', ['read', 'feedback']],
      ['none', []],
    ] as const) {
      const verifier = withAgents(tokens, (connection) => {
        asked.push(connection)
        return Promise.resolve({ agentId, permission: permissions[permission] })
      })
      expect(await verifier.verify('token')).toMatchObject({
        scopes,
        agent: { kind: 'app', id: agentId, permission },
      })
    }
    expect(asked).toEqual([person.connection, person.connection, person.connection])
    // A permission never widens what the person allowed.
    const narrow: TokenVerifier = {
      verify: () => Promise.resolve({ ...person, scopes: ['read'] }),
    }
    expect(
      await withAgents(narrow, () => Promise.resolve({ agentId, permission: 'suggest' })).verify(
        'token',
      ),
    ).toMatchObject({ scopes: ['read'] })
    // A token that names no connection, such as a dev token, passes as it is.
    const dev = { ...person, connection: undefined }
    const unnamed = withAgents({ verify: () => Promise.resolve(dev) }, () => {
      throw new Error('not asked')
    })
    expect(await unnamed.verify('token')).toBe(dev)
  })

  it('sends a key to the key check and every other token to the issuer check', async () => {
    const seen: string[] = []
    const named = (name: string): TokenVerifier => ({
      verify: (token) => {
        seen.push(`${name}:${token}`)
        return Promise.reject(new TokenError('malformed'))
      },
    })
    const verifier = withAccessKeys(named('issuer'), named('keys'))
    await verifier.verify(key).catch(() => undefined)
    await verifier.verify('eyJhbGciOiJFZERTQSJ9.e30.sig').catch(() => undefined)
    expect(seen).toEqual([`keys:${key}`, 'issuer:eyJhbGciOiJFZERTQSJ9.e30.sig'])
    expect(isAccessKey('hrt_refresh')).toBe(false)
  })
})
