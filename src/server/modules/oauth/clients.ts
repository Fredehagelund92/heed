import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { redirectProblem } from './redirects.ts'

/**
 * Who a client is (FR-403). A client ID metadata document is preferred: the client's id is the
 * https address of a small JSON document that names it and lists its redirect addresses, and the
 * login server reads it at every sign-in. Dynamic registration (RFC 7591) is the fallback, behind
 * a setting. Both are public clients: no secret, PKCE with S256 on every sign-in.
 */
export interface ClientMetadata {
  name: string
  redirectUris: string[]
}

export const supportedGrantTypes = ['authorization_code', 'refresh_token'] as const

/** Control and format characters (bidirectional overrides among them) and line separators. */
const controlCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

/**
 * Checks a client's own description of itself. `id` is the document's own address when it came
 * from a metadata document, which must name itself. The answer is the problem, or the metadata.
 */
export function readClientMetadata(
  document: unknown,
  options: { metadataDocument?: string } = {},
): { problem: string } | { metadata: ClientMetadata } {
  if (!document || typeof document !== 'object' || Array.isArray(document))
    return { problem: 'The client metadata must be a JSON object' }
  const fields = document as Record<string, unknown>
  if (options.metadataDocument !== undefined && fields.client_id !== options.metadataDocument)
    return { problem: 'The document must name its own address as client_id' }
  const uris = fields.redirect_uris
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10)
    return { problem: 'redirect_uris must list one to ten addresses' }
  for (const uri of uris) {
    if (typeof uri !== 'string') return { problem: 'Every redirect address must be text' }
    const problem = redirectProblem(uri)
    if (problem) return { problem: `A redirect address ${problem}` }
  }
  const method = fields.token_endpoint_auth_method
  // A metadata document is the client's fixed description: a client that authenticates with a
  // key this server cannot check is refused. A registration that asks for a secret is
  // registered as a public client instead, which RFC 7591 (section 3.2.1) allows.
  if (options.metadataDocument !== undefined && method !== undefined && method !== 'none')
    return { problem: 'Only public clients (token_endpoint_auth_method none) can sign in' }
  const grants = fields.grant_types
  if (
    grants !== undefined &&
    (!Array.isArray(grants) ||
      !grants.includes('authorization_code') ||
      grants.some((g) => !(supportedGrantTypes as readonly unknown[]).includes(g)))
  )
    return { problem: 'grant_types may hold authorization_code and refresh_token only' }
  const responses = fields.response_types
  if (responses !== undefined && (!Array.isArray(responses) || responses.some((r) => r !== 'code')))
    return { problem: 'response_types may hold code only' }
  const name = fields.client_name
  if (
    name !== undefined &&
    (typeof name !== 'string' || !name.trim() || name.length > 100 || controlCharacters.test(name))
  )
    return { problem: 'client_name must be 1 to 100 characters of plain text' }
  // Without a name, the consent screen names the client by where it sends the person.
  const fallback = new URL(options.metadataDocument ?? (uris[0] as string)).hostname
  return {
    metadata: {
      name: typeof name === 'string' ? name.trim() : fallback,
      redirectUris: [...new Set(uris as string[])],
    },
  }
}

/**
 * Whether a client id is a metadata document's address, and if so, whether it is an acceptable
 * one: https with a path, no query, fragment, credentials or dot segments.
 */
export function isMetadataDocumentId(id: string) {
  return id.startsWith('https://')
}
export function metadataDocumentProblem(id: string): string | null {
  if (id.length > 512 || !URL.canParse(id)) return 'is not an acceptable address'
  const url = new URL(id)
  if (url.protocol !== 'https:') return 'must use https'
  if (url.pathname === '/' || !url.pathname) return 'must have a path'
  if (url.search || id.includes('?') || id.includes('#') || url.username || url.password)
    return 'must not hold a query, a fragment or credentials'
  if (/(^|\/)\.\.?(\/|$)/.test(id.slice(url.origin.length))) return 'must not hold dot segments'
  return null
}

/**
 * Addresses the login server never fetches a document from: this computer, private networks,
 * link-local, shared, documentation, multicast and reserved ranges. A metadata address is chosen
 * by whoever starts a sign-in, so reading it must not reach anything inside the network.
 */
const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(network, prefix, 'ipv6')

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family !== 6) return false
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is judged as the IPv4 address it is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) return isPublicAddress(mapped[1]!)
  if (/^::ffff:/i.test(address)) return false
  return !blocked.check(address, 'ipv6')
}

/** Resolves a name and refuses it when any of its addresses is not public. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, '', 0)
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
      return callback(
        Object.assign(new Error('The address is not public'), { code: 'ENOTPUBLIC' }),
        '',
        0,
      )
    if (options.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, addresses)
    return callback(null, addresses[0]!.address, addresses[0]!.family)
  })
}

export type FetchMetadataDocument = (id: string) => Promise<unknown>

export class MetadataFetchError extends Error {
  override name = 'MetadataFetchError'
}

/**
 * Reads a client ID metadata document: https only, to a public address, no redirects, at most
 * 5 KB within five seconds, and JSON. Every failure is the same plain error, so nothing about
 * the network behind the address reaches the person or the client.
 */
export const fetchMetadataDocument: FetchMetadataDocument = (id) => {
  const url = new URL(id)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !isPublicAddress(host))
    return Promise.reject(new MetadataFetchError('The address is not public'))
  return new Promise((resolve, reject) => {
    const fail = (message: string) => reject(new MetadataFetchError(message))
    const call = request(
      url,
      {
        method: 'GET',
        lookup: publicLookup,
        headers: { accept: 'application/json' },
        timeout: 5000,
        agent: false,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          return fail('The document did not answer 200')
        }
        if (
          !/^application\/([a-z0-9.+-]+\+)?json\b/i.test(response.headers['content-type'] ?? '')
        ) {
          response.resume()
          return fail('The document is not JSON')
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 5120) {
            call.destroy()
            fail('The document is larger than 5 KB')
          } else chunks.push(chunk)
        })
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            fail('The document is not JSON')
          }
        })
        response.on('error', () => fail('The document could not be read'))
      },
    )
    call.on('timeout', () => {
      call.destroy()
      fail('The document took too long')
    })
    call.on('error', () => fail('The document could not be read'))
    call.end()
  })
}
