import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { createLocalJWKSet, exportJWK, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import {
  createDevVerifier,
  createIssuerVerifier,
  createPersonVerifier,
  devIssuer,
  mintDevToken,
  TokenError,
} from '../../../src/server/mcp/auth.ts'

const resource = 'http://localhost:3000/mcp'
const issuer = 'http://localhost:3000'
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1' }] })
const revoked = new Set<string>()
const verifier = createPersonVerifier({
  issuer,
  resource,
  keys,
  algorithms: ['EdDSA'],
  requireAccessTokenType: true,
  isRevoked: (id) => revoked.has(id),
})

function token(
  claims: Record<string, unknown> = {},
  options: { key?: KeyObject; typ?: string; life?: number; iss?: string; aud?: string } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    client_id: 'hc_1',
    scope: 'read feedback',
    sid: 'g1',
    sub: 'person-1',
    ...claims,
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: options.typ ?? 'at+jwt', kid: 'k1' })
    .setIssuer(options.iss ?? issuer)
    .setAudience(options.aud ?? resource)
    .setIssuedAt(now)
    .setExpirationTime(now + (options.life ?? 600))
    .sign(options.key ?? privateKey)
}
const reason = async (made: Promise<string>, check = verifier) => {
  try {
    await check.verify(await made)
    return 'accepted'
  } catch (error) {
    return error instanceof TokenError ? error.reason : 'other'
  }
}

describe("a person's token", () => {
  it('becomes the shared client label, the person, their groups and known scopes only', async () => {
    expect(
      await verifier.verify(
        await token({ client_id: 'eval', scope: 'read edition feedback', groups: ['finance'] }),
      ),
    ).toEqual({
      client: 'signed-in',
      scopes: ['read', 'feedback'],
      caller: 'agent',
      canSelectEdition: false,
      subject: 'person-1',
      groups: ['finance'],
    })
  })

  it('is refused with a reason when anything is off', async () => {
    const { privateKey: other } = generateKeyPairSync('ed25519')
    expect(await reason(token({}, { key: other }))).toBe('bad_signature')
    expect(await reason(token({}, { aud: 'http://localhost:3000/other' }))).toBe('wrong_audience')
    expect(await reason(token({}, { iss: 'http://localhost:4000' }))).toBe('unknown_issuer')
    expect(await reason(token({}, { typ: 'JWT' }))).toBe('bad_claims')
    expect(await reason(token({}, { life: 3601 }))).toBe('bad_claims')
    expect(await reason(token({}, { life: -10 }))).toBe('expired')
    expect(await reason(token({ scope: 'edition admin' }))).toBe('bad_claims')
    expect(await reason(token({ groups: [''] }))).toBe('bad_claims')
    expect(await reason(token({ groups: Array.from({ length: 101 }, (_, i) => `g${i}`) }))).toBe(
      'bad_claims',
    )
    expect(await reason(token({ sub: '' }))).toBe('bad_claims')
    expect(await reason(token({ client_id: 7 }))).toBe('bad_claims')
    revoked.add('g1')
    expect(await reason(token())).toBe('revoked')
    revoked.clear()
    expect(await reason(token())).toBe('accepted')
  })

  it('may come from another login server without the access token type', async () => {
    const external = createPersonVerifier({
      issuer: 'https://login.example',
      resource,
      keys,
      algorithms: ['EdDSA', 'RS256'],
      requireAccessTokenType: false,
    })
    expect(await reason(token({}, { iss: 'https://login.example', typ: 'JWT' }), external)).toBe(
      'accepted',
    )
  })
})

describe('choosing the verifier by issuer', () => {
  const { privateKey: devKey } = generateKeyPairSync('ed25519')
  const both = createIssuerVerifier(
    new Map([
      [devIssuer, createDevVerifier(devKey, resource, 'test')],
      [issuer, verifier],
    ]),
  )
  it('verifies dev tokens and login server tokens, each with its own keys', async () => {
    expect((await both.verify(await mintDevToken(devKey, resource))).client).toBe('claude-code')
    expect((await both.verify(await token())).client).toBe('signed-in')
    // A dev key cannot sign for the login server, nor the login server's key for dev tokens.
    expect(await reason(token({}, { key: devKey }), both)).toBe('bad_signature')
    expect(await reason(mintDevToken(privateKey, resource), both)).toBe('bad_signature')
  })
  it('refuses an issuer nobody configured, and text that is no token', async () => {
    expect(await reason(token({}, { iss: 'https://evil.example' }), both)).toBe('unknown_issuer')
    expect(await reason(Promise.resolve('abc'), both)).toBe('malformed')
  })
})
