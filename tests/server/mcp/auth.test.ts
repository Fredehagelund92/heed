import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SignJWT } from 'jose'
import { afterEach, expect, it, vi } from 'vitest'
import { createDevVerifier, devKey, devIssuer, mintDevToken } from '../../../src/server/mcp/auth.ts'

const { privateKey } = generateKeyPairSync('ed25519')
const resource = 'http://localhost:3000/mcp'
afterEach(() => vi.useRealTimers())
it('verifies issuer, audience, signature and expiry, and drops identity claims', async () => {
  const verifier = createDevVerifier(privateKey, resource, 'test')
  const token = await new SignJWT({
    sub: 'person-canary',
    groups: ['secret-group'],
    client_id: 'claude-code',
    scope: 'read feedback',
  })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(devIssuer)
    .setAudience(resource)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(privateKey)
  expect(await verifier.verify(token)).toEqual({
    client: 'claude-code',
    scopes: ['read', 'feedback'],
    caller: 'agent',
    canSelectEdition: false,
  })
  for (const issuer of ['https://wrong.example', undefined]) {
    let jwt = new SignJWT({ client_id: 'claude-code', scope: 'read' })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setAudience(resource)
      .setIssuedAt()
      .setExpirationTime('8h')
    if (issuer) jwt = jwt.setIssuer(issuer)
    await expect(verifier.verify(await jwt.sign(privateKey))).rejects.toThrow()
  }
  await expect(
    verifier.verify(await mintDevToken(generateKeyPairSync('ed25519').privateKey, resource)),
  ).rejects.toThrow()
  await expect(
    verifier.verify(await mintDevToken(privateKey, 'http://wrong/mcp')),
  ).rejects.toThrow()
})
it('does not let the verifier cache extend a token lifetime', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-07T12:00:00Z') })
  const verifier = createDevVerifier(privateKey, resource, 'test')
  const token = await mintDevToken(privateKey, resource, { expiresIn: '1s' })
  await verifier.verify(token)
  vi.setSystemTime(new Date('2026-10-07T12:00:02Z'))
  await expect(verifier.verify(token)).rejects.toThrow()
})
it('creates a private reusable local key and refuses production', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'heed-token-')),
    file = join(dir, 'dev.pem')
  try {
    const key = await devKey(file, 'test')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await devKey(file, 'test')).export({ format: 'pem', type: 'pkcs8' })).toEqual(
      key.export({ format: 'pem', type: 'pkcs8' }),
    )
    await expect(devKey(file, 'production')).rejects.toThrow('refused in production')
    expect(() => createDevVerifier(key, resource, 'production')).toThrow('refused in production')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
