import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { Readable } from 'node:stream'
import { SourceError } from '../../../domain/connector-runtime.ts'
import { isPublicIp, reachesLocal } from './git.ts'

/*
  A GET to one address, pinned (CON-113): the host's name is looked up once, every answer must be
  on the public internet, and the request connects to the first of them, so the name cannot be
  looked up again in between and answer with a private address (DNS rebinding). Outside production
  a host on this machine or a private network may be reached, for a test server. Nothing is
  followed: a redirect is an answer like any other. A refusal is a `SourceError`.
*/

const local = (ip: string) => !isPublicIp(ip)

const refused = (target: string) =>
  new SourceError({ code: 'private_address', target, class: 'config' })

/** Where to connect for a URL's host: one address, checked. */
async function pinned(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (isIP(host)) {
    if (local(host) && !reachesLocal()) throw refused(url.host)
    return { address: host, family: isIP(host) === 6 ? 6 : 4 }
  }
  let found: { address: string; family: number }[]
  try {
    found = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new SourceError({ code: 'unreachable', target: url.host, class: 'transient' })
  }
  if (!found.length)
    throw new SourceError({ code: 'unreachable', target: url.host, class: 'transient' })
  // Every answer public, or, outside production, every answer this machine or a private network.
  const ok = found.every((entry) => isPublicIp(entry.address))
  if (!ok && !(reachesLocal() && found.every((entry) => local(entry.address))))
    throw refused(url.host)
  return { address: found[0]!.address, family: found[0]!.family === 6 ? 6 : 4 }
}

/** The answer as a fetch `Response`, its body streamed as it arrives. */
function responseOf(message: IncomingMessage): Response {
  const headers = new Headers()
  for (const [name, value] of Object.entries(message.headers))
    if (value !== undefined)
      for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one)
  const status = message.statusCode ?? 502
  // A status without a body takes none.
  if ([204, 205, 304].includes(status) || status < 200) {
    message.resume()
    return new Response(null, { status: status < 200 ? 502 : status, headers })
  }
  return new Response(Readable.toWeb(message) as ReadableStream<Uint8Array>, { status, headers })
}

/** One GET of an http or https URL at a pinned address, within the signal. */
export async function pinnedGet(
  url: URL,
  { headers = {}, signal }: { headers?: Record<string, string>; signal: AbortSignal },
): Promise<Response> {
  const at = await pinned(url)
  // The connection goes to the address checked; the name still names the host for TLS and Host.
  const lookupPinned: LookupFunction = (_host, options, done) => {
    if (options.all) done(null, [at])
    else done(null, at.address, at.family)
  }
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise<Response>((resolve, reject) => {
    const sent = request(url, { method: 'GET', headers, signal, lookup: lookupPinned }, (message) =>
      resolve(responseOf(message)),
    )
    sent.on('error', reject)
    sent.end()
  })
}
