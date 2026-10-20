import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Database } from '../../../src/server/db/database.ts'
import { createLoginServer, loadKeyRing } from '../../../src/server/modules/oauth/index.ts'
import {
  browserToken,
  createRevocations,
  pkceMatches,
  sameText,
} from '../../../src/server/modules/oauth/service.ts'

const dir = await mkdtemp(join(tmpdir(), 'heed-oauth-service-'))
afterAll(() => rm(dir, { recursive: true, force: true }))
const keys = await loadKeyRing({ file: join(dir, 'k.pem'), previousFiles: [], nodeEnv: 'test' })
const config = {
  kind: 'builtin' as const,
  issuer: 'http://localhost:3000',
  consentUrl: 'http://localhost:5173/connect/approve',
  signingKeyFile: '',
  previousKeyFiles: [],
  dynamicRegistration: false,
  refreshIdleHours: 24,
  connectionDays: 7,
}
/** A database that must not be reached: these answers come before any query. */
const untouched = new Proxy({} as Database, {
  get: () => () => Promise.reject(new Error('The database must not be used here')),
})
const log = { info: () => undefined, warn: () => undefined }

describe('with dynamic registration off', () => {
  const login = createLoginServer({
    config,
    resource: 'http://localhost:3000/mcp',
    keys,
    nodeEnv: 'test',
  })
  it('publishes no registration address and refuses a registration', async () => {
    expect(login.metadata()).not.toHaveProperty('registration_endpoint')
    expect(login.metadata()).toMatchObject({ client_id_metadata_document_supported: true })
    expect(
      await login.register(untouched, { redirect_uris: ['https://a.example/cb'] }, log),
    ).toMatchObject({ ok: false, status: 404 })
  })
  it('does not know a registered client id', async () => {
    const answer = await login.authorize(
      untouched,
      { client_id: 'hc_' + 'a'.repeat(43), redirect_uri: 'https://a.example/cb' },
      undefined,
      log,
    )
    expect(answer).toMatchObject({ kind: 'page', reason: 'unknown_client' })
  })
})

it('refuses to run in production without an https MCP address', () => {
  expect(() =>
    createLoginServer({
      config,
      resource: 'http://localhost:3000/mcp',
      keys,
      nodeEnv: 'production',
    }),
  ).toThrow(/https/)
})

it('checks the S256 proof and compares in constant time', () => {
  const verifier = 'a'.repeat(43)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  expect(pkceMatches(verifier, challenge)).toBe(true)
  expect(pkceMatches('b'.repeat(43), challenge)).toBe(false)
  expect(pkceMatches(verifier, verifier)).toBe(false)
  expect(sameText('abc', 'abc')).toBe(true)
  expect(sameText('abc', 'abd')).toBe(false)
  expect(sameText('abc', 'abcd')).toBe(false)
})

it('reads exactly one well-formed browser cookie', () => {
  const value = 'a'.repeat(64)
  expect(browserToken(`heed_oauth_browser=${value}`)).toBe(value)
  expect(browserToken(`x=1; heed_oauth_browser=${value}; y=2`)).toBe(value)
  expect(browserToken(`heed_oauth_browser=${value}; heed_oauth_browser=${value}`)).toBeUndefined()
  expect(browserToken('heed_oauth_browser=short')).toBeUndefined()
  expect(browserToken(undefined)).toBeUndefined()
})

it('fails closed for tokens issued before the start until recent disconnects are read', () => {
  let time = 1_000_000
  const revocations = createRevocations(() => new Date(time))
  // Issued by an earlier process: refused, whatever the connection, until the list is read.
  expect(revocations.has('g1', 999)).toBe(true)
  // Issued since the start, by this process, which knows its own disconnects.
  expect(revocations.has('g1', 1000)).toBe(false)
  revocations.loaded()
  expect(revocations.has('g1', 999)).toBe(false)
  revocations.add('g2')
  expect(revocations.has('g2', 999)).toBe(true)
  time += 1000
  expect(revocations.has('g2', 1000)).toBe(true)
})

it('remembers a revoked connection for as long as its access tokens can live', () => {
  let time = 0
  const revocations = createRevocations(() => new Date(time))
  revocations.loaded()
  revocations.add('g1')
  expect(revocations.has('g1')).toBe(true)
  time = 600_000 + 59_000
  expect(revocations.has('g1')).toBe(true)
  time = 600_000 + 61_000
  expect(revocations.has('g1')).toBe(false)
})
