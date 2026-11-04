/*
  What reading one object takes, as pure code: Signature Version 4 for S3 and the stores that
  speak it (Google Cloud Storage takes it with an HMAC key), a shared access signature for Azure
  Blob, which has no such API, and when a signed link stops working. No network, no clock: the
  runtime sends what this builds through `ctx.fetch`.
*/

const encoder = new TextEncoder()
const subtle = () => globalThis.crypto.subtle
const hex = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as Uint8Array).toString('hex')

const sha256 = async (text: string) => hex(await subtle().digest('SHA-256', encoder.encode(text)))

async function hmac(key: Uint8Array<ArrayBuffer>, text: string) {
  const usable = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return new Uint8Array(await subtle().sign('HMAC', usable, encoder.encode(text)))
}

/** A path as Signature Version 4 writes it: each part decoded, then strictly encoded. */
function canonicalPath(pathname: string): string {
  return pathname
    .split('/')
    .map((part) => {
      let plain = part
      try {
        plain = decodeURIComponent(part)
      } catch {
        // A stray % is sent as it is, and signed so.
      }
      return encodeURIComponent(plain).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      )
    })
    .join('/')
}

export interface SigningKey {
  accessKey: string
  secretKey: string
  region: string
}

/** The headers that sign a GET of an object: its signature covers the host, the date, the path. */
export async function signedHeaders(
  address: URL,
  { accessKey, secretKey, region }: SigningKey,
  now: Date,
): Promise<Record<string, string>> {
  const stamp = now.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const day = stamp.slice(0, 8)
  const scope = `${day}/${region}/s3/aws4_request`
  const nothing = await sha256('')
  const signed = 'host;x-amz-content-sha256;x-amz-date'
  const request = [
    'GET',
    canonicalPath(address.pathname),
    '',
    `host:${address.host}\nx-amz-content-sha256:${nothing}\nx-amz-date:${stamp}\n`,
    signed,
    nothing,
  ].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256(request)].join('\n')
  let key = Uint8Array.from(encoder.encode(`AWS4${secretKey}`))
  for (const part of [day, region, 's3', 'aws4_request']) key = await hmac(key, part)
  const signature = hex(await hmac(key, toSign))
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    'x-amz-content-sha256': nothing,
    'x-amz-date': stamp,
  }
}

/**
 * The region an object's address signs for: the one in an S3 address, `auto` at Google Cloud
 * Storage, or the one the settings give. A store that has no regions takes `us-east-1`.
 */
export function regionOf(address: URL, provider: string, region: string | undefined): string {
  if (provider === 'gcs') return 'auto'
  const named = /(?:^|\.)s3[.-](?:dualstack\.)?([a-z0-9-]+)\.amazonaws\.com$/.exec(address.hostname)
  return named?.[1] ?? region ?? 'us-east-1'
}

/** A shared access signature as it goes in a query: without the `?` it is often copied with. */
export const sasQuery = (token: string) => token.trim().replace(/^\?/, '')

/**
 * False for a shared access signature that says it may do more than read and list. One that names
 * a stored policy says nothing of what it may do, so only Azure can tell.
 */
export function sasReadsOnly(token: string): boolean {
  const permissions = new URLSearchParams(sasQuery(token)).get('sp')
  return permissions === null || /^[rl]+$/.test(permissions)
}

/**
 * When a signed link stops working, by what S3, Google Cloud Storage and Azure write in it; null
 * for a link that says nothing, such as a public file.
 */
export function linkExpiry(address: string): Date | null {
  const query = URL.parse(address)?.searchParams
  if (!query) return null
  const at = (value: string | null) => {
    const date = value === null ? null : new Date(value)
    return date && !Number.isNaN(date.getTime()) ? date : null
  }
  const azure = at(query.get('se'))
  if (azure) return azure
  const signedAt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(
    query.get('X-Amz-Date') ?? query.get('X-Goog-Date') ?? '',
  )
  const seconds = Number(query.get('X-Amz-Expires') ?? query.get('X-Goog-Expires'))
  if (!signedAt || !seconds) return null
  const [, year, month, day, hours, minutes, secs] = signedAt
  const start = Date.parse(`${year}-${month}-${day}T${hours}:${minutes}:${secs}Z`)
  return new Date(start + seconds * 1000)
}
