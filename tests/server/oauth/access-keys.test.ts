import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { TokenError, type TokenVerifier } from '../../../src/server/mcp/auth.ts'
import {
  createAccessKeyVerifier,
  isAccessKey,
  withAccessKeys,
} from '../../../src/server/modules/access-keys/index.ts'

// An invented key: the prefix and 43 base64url characters, never one that works anywhere.
const key = `hak_${'x'.repeat(43)}`
const digest = createHash('sha256').update(key).digest('hex')

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
      return Promise.resolve('open')
    })
    const principal = await verifier.verify(key)
    expect(principal).toEqual({
      client: 'access-key',
      scopes: ['read', 'feedback'],
      caller: 'agent',
      canSelectEdition: false,
    })
    expect(principal.subject).toBeUndefined()
    // Only the digest is asked about, never the key.
    expect(asked).toEqual([digest])
  })

  it('refuses a revoked key, an unknown one and one of the wrong form, by reason only', async () => {
    const answers = { [digest]: 'revoked' as const }
    const verifier = createAccessKeyVerifier((hash) => Promise.resolve(answers[hash] ?? null))
    expect(await reason(verifier, key)).toBe('revoked/access-key')
    expect(await reason(verifier, `hak_${'y'.repeat(43)}`)).toBe('unknown_key/access-key')
    expect(await reason(verifier, 'hak_short')).toBe('malformed/access-key')
    expect(await reason(verifier, `hak_${'x'.repeat(42)}!`)).toBe('malformed/access-key')
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
