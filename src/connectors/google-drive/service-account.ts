/*
  A Google service account's key, and the signed request that trades it for a short-lived access
  token (the OAuth 2.0 JWT bearer grant, RFC 7523). The key comes from the source's secret only
  (`ctx.secret`), lives in memory for one piece of work, and is never logged, returned or put in
  a warning: what leaves this file is the account's address, which is not a secret, and the
  signed request, which goes only to the sign-in address the manifest declares.

  Signing uses Web Crypto, which is pure computation: a connector imports no Node module.
*/

/** What a read needs of a key: who it is, and the private key it signs with. */
export interface ServiceAccountKey {
  /** The service account's address, which folders are shared with. Not a secret. */
  readonly clientEmail: string
  /** The private key, PKCS #8 in PEM. */
  readonly privateKey: string
  /** The key's id, which tells Google which of the account's keys signed. */
  readonly keyId: string | null
}

/** The least access a read needs: to view the files shared with the account (CON-106). */
export const DRIVE_READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

/** How long a signed request is good for, in seconds: Google takes at most an hour. */
const ASSERTION_SECONDS = 3_600

const email = /^[^\s@]{1,64}@[^\s@]{1,255}$/
const pem = /^-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----\s*$/

/**
 * The key from a service account's JSON key file, as Google Cloud gives it; null for anything
 * else. Only the fields a read uses are kept.
 */
export function parseServiceAccountKey(text: string): ServiceAccountKey | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const key = parsed as Record<string, unknown>
  const { type, client_email: clientEmail, private_key: privateKey } = key
  if (type !== 'service_account') return null
  if (typeof clientEmail !== 'string' || !email.test(clientEmail)) return null
  if (typeof privateKey !== 'string' || !pem.test(privateKey)) return null
  const keyId = typeof key.private_key_id === 'string' ? key.private_key_id : null
  return {
    clientEmail,
    privateKey,
    keyId: keyId && /^[A-Za-z0-9]{1,100}$/.test(keyId) ? keyId : null,
  }
}

const base64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
const encodeJson = (value: object) => base64Url(new TextEncoder().encode(JSON.stringify(value)))

/** The DER bytes of a PEM private key. */
function derOf(privateKey: string): Uint8Array<ArrayBuffer> {
  const body = pem.exec(privateKey)![1]!.replace(/\s+/g, '')
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * The signed request (a JWT, RS256) that asks the sign-in address for an access token to read
 * Drive: issued by the account, for that address, with the read-only scope, good for an hour.
 * Throws when the private key cannot sign, which the caller says is a key Google would refuse.
 */
export async function signedAssertion(
  key: ServiceAccountKey,
  { audience, now }: { audience: string; now: Date },
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const header = { alg: 'RS256', typ: 'JWT', ...(key.keyId ? { kid: key.keyId } : {}) }
  const claims = {
    iss: key.clientEmail,
    scope: DRIVE_READ_SCOPE,
    aud: audience,
    iat: issuedAt,
    exp: issuedAt + ASSERTION_SECONDS,
  }
  const unsigned = `${encodeJson(header)}.${encodeJson(claims)}`
  const signer = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    derOf(key.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await globalThis.crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signer,
    new TextEncoder().encode(unsigned),
  )
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`
}
