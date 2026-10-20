import { generateKeyPairSync } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { calculateJwkThumbprint, SignJWT, jwtVerify } from 'jose'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { loadKeyRing } from '../../../src/server/modules/oauth/index.ts'
import { localKeys } from '../../../src/server/modules/oauth/keys.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'heed-oauth-keys-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const pem = (type: 'ed25519' | 'ec') => {
  const { privateKey } =
    type === 'ed25519'
      ? generateKeyPairSync('ed25519')
      : generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return privateKey.export({ format: 'pem', type: 'pkcs8' })
}

it('creates an owner-only key outside production and reads the same key again', async () => {
  const file = join(dir, 'oauth.pem')
  const first = await loadKeyRing({ file, previousFiles: [], nodeEnv: 'development' })
  expect((await stat(file)).mode & 0o777).toBe(0o600)
  const again = await loadKeyRing({ file, previousFiles: [], nodeEnv: 'development' })
  expect(again.active.kid).toBe(first.active.kid)
  // The key id is the RFC 7638 thumbprint, and the published set holds public keys only.
  const [jwk] = first.jwks.keys
  expect(first.active.kid).toBe(await calculateJwkThumbprint(jwk!, 'sha256'))
  expect(Object.keys(jwk!).sort()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x'])
  expect(jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', kid: first.active.kid, alg: 'EdDSA' })
})

it('refuses to start in production without a key, and names no key material', async () => {
  const file = join(dir, 'missing.pem')
  await expect(loadKeyRing({ file, previousFiles: [], nodeEnv: 'production' })).rejects.toThrow(
    /CL_OAUTH_SIGNING_KEY_FILE .*openssl genpkey -algorithm ed25519/,
  )
})

it('refuses a key others can read, and a key that is not Ed25519', async () => {
  const open = join(dir, 'open.pem')
  await writeFile(open, pem('ed25519'), { mode: 0o644 })
  await chmod(open, 0o644)
  await expect(loadKeyRing({ file: open, previousFiles: [], nodeEnv: 'test' })).rejects.toThrow(
    /owner only/,
  )
  const ec = join(dir, 'ec.pem')
  await writeFile(ec, pem('ec'), { mode: 0o600 })
  await expect(loadKeyRing({ file: ec, previousFiles: [], nodeEnv: 'test' })).rejects.toThrow(
    /Ed25519/,
  )
})

it('rotates: tokens signed by the earlier key keep verifying until they expire', async () => {
  const old = join(dir, 'old.pem')
  const before = await loadKeyRing({ file: old, previousFiles: [], nodeEnv: 'test' })
  const signedBefore = await new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', kid: before.active.kid })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(before.active.privateKey)
  // The earlier key may be listed as its private file or as its public key alone.
  const publicOnly = join(dir, 'old.pub.pem')
  const { createPublicKey } = await import('node:crypto')
  await writeFile(
    publicOnly,
    createPublicKey(await readFile(old, 'utf8')).export({ format: 'pem', type: 'spki' }),
  )
  for (const previous of [old, publicOnly]) {
    const after = await loadKeyRing({
      file: join(dir, `new-${previous === old ? 'a' : 'b'}.pem`),
      previousFiles: [previous],
      nodeEnv: 'test',
    })
    expect(after.active.kid).not.toBe(before.active.kid)
    expect(after.jwks.keys.map((k) => k.kid)).toEqual([after.active.kid, before.active.kid])
    await expect(jwtVerify(signedBefore, localKeys(after))).resolves.toBeTruthy()
  }
  // Once the earlier key is no longer listed, its tokens no longer verify.
  const dropped = await loadKeyRing({
    file: join(dir, 'new-a.pem'),
    previousFiles: [],
    nodeEnv: 'test',
  })
  await expect(jwtVerify(signedBefore, localKeys(dropped))).rejects.toThrow()
})
