import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { calculateJwkThumbprint, createLocalJWKSet, exportJWK, type JWK } from 'jose'

/**
 * The login server's signing keys (docs/ai-sign-in.md, "Keys"). One Ed25519 key signs; earlier
 * keys listed after a rotation only verify, until the tokens they signed have expired. A key's id
 * (`kid`) is its RFC 7638 thumbprint, so nobody picks or reuses one by hand. Key material never
 * appears in an error, a log line or the key set the service publishes, which holds public keys.
 */
export interface KeyRing {
  active: { kid: string; privateKey: KeyObject }
  /** The public keys that verify, the active one first: the published key set. */
  jwks: { keys: JWK[] }
}

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

async function readPrivateKey(file: string): Promise<KeyObject> {
  // A signing key readable by others is refused, as ssh refuses such a private key.
  if (((await stat(file)).mode & 0o077) !== 0)
    throw new Error(`${file} must be readable by its owner only (chmod 600)`)
  const key = createPrivateKey(await readFile(file))
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`${file} must hold an Ed25519 key`)
  return key
}

/** Creates the key outside production when it does not exist yet, with owner-only permissions. */
async function activeKey(file: string, nodeEnv: string): Promise<KeyObject> {
  try {
    return await readPrivateKey(file)
  } catch (error) {
    if (!missing(error)) throw error
    if (nodeEnv === 'production')
      throw new Error(
        `CL_OAUTH_SIGNING_KEY_FILE (${file}) does not exist. Create it with: openssl genpkey -algorithm ed25519 -out ${file} && chmod 600 ${file} (in the service image: node src/server/create-keys.ts)`,
        { cause: error },
      )
    const { privateKey } = generateKeyPairSync('ed25519')
    try {
      await writeFile(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), {
        flag: 'wx',
        mode: 0o600,
      })
    } catch (writeError) {
      if (!(writeError instanceof Error && 'code' in writeError && writeError.code === 'EEXIST'))
        throw writeError
    }
    return readPrivateKey(file)
  }
}

/** An earlier key: a private key file, or the public key alone, which is all verifying needs. */
async function earlierKey(file: string): Promise<KeyObject> {
  const text = await readFile(file, 'utf8')
  const key = text.includes('PRIVATE KEY')
    ? createPublicKey(await readPrivateKey(file))
    : createPublicKey(text)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`${file} must hold an Ed25519 key`)
  return key
}

async function publicJwk(key: KeyObject): Promise<JWK> {
  const { kty, crv, x } = await exportJWK(key.type === 'public' ? key : createPublicKey(key))
  const jwk = { kty, crv, x }
  return { ...jwk, kid: await calculateJwkThumbprint(jwk, 'sha256'), alg: 'EdDSA', use: 'sig' }
}

export async function loadKeyRing(options: {
  file: string
  previousFiles: readonly string[]
  nodeEnv: string
}): Promise<KeyRing> {
  const privateKey = await activeKey(options.file, options.nodeEnv)
  const active = await publicJwk(privateKey)
  const keys = [active]
  for (const file of options.previousFiles) {
    const jwk = await publicJwk(await earlierKey(file))
    if (!keys.some((known) => known.kid === jwk.kid)) keys.push(jwk)
  }
  return { active: { kid: active.kid!, privateKey }, jwks: { keys } }
}

/** Verifies with the ring's own public keys, by `kid`, without a network call. */
export const localKeys = (ring: KeyRing) => createLocalJWKSet(ring.jwks)
