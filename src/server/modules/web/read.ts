import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { Readable } from 'node:stream'
import { isPublicAddress, publicLookup } from '../oauth/index.ts'
import { decodePage, pageText, charsetOf } from './page-text.ts'

/*
  Heed opens a web page a person linked, for the assistant to draft from (read_source). It is
  the service reaching out to an address someone else chose, so it reaches only the public web:
  https only; a name resolved here with every answer public and the connection made to that
  answer, so a second lookup cannot point it inside the network (DNS rebinding); no credentials
  in the address; every redirect checked again, at most five; at most 2 MB, decompressed, within
  15 seconds; text pages only. Every failure is one plain reason, so nothing about the network
  behind an address reaches the person or the model. The page is kept in memory for the call and
  never stored (FR-116).
*/

export const readFailures = [
  'not_https',
  'credentials',
  'not_public',
  'unreachable',
  'timeout',
  'too_large',
  'status',
  'pdf',
  'not_text',
  'redirects',
] as const
export type ReadFailure = (typeof readFailures)[number]

export class PageReadError extends Error {
  override name = 'PageReadError'
  readonly reason: ReadFailure
  /** The status the page answered with, for `status`. */
  readonly status: number | undefined
  constructor(reason: ReadFailure, status?: number) {
    super(reason)
    this.reason = reason
    this.status = status
  }
}

/** A page as Heed read it: where it ended up, its title and its paragraphs. */
export type PageRead = {
  /** The address asked for. */
  url: string
  /** The address that answered, after any redirects. */
  finalUrl: string
  contentType: string
  charset: string
  /** The page's size as read, decompressed. */
  bytes: number
  title: string | null
  paragraphs: string[]
}

export type PageReaderOptions = {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  /**
   * Also reads plain http on this machine (127.0.0.1, ::1, localhost): the tests and the
   * end-to-end suite serve their pages there. Never another private address. Refused in
   * production by the configuration (CL_WEB_READ_LOOPBACK).
   */
  loopback?: boolean
}

/** Opens one address; rejects with a PageReadError. */
export type PageReader = (address: string, signal?: AbortSignal) => Promise<PageRead>

const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 5

/** Said plainly to every site Heed reads, so its owner can tell what reads it. */
const headers = {
  // eslint-disable-next-line brand/no-product-name -- the user agent sites see, a technical name (docs/rename-checklist.md)
  'user-agent': 'Mozilla/5.0 (compatible; Heed/1.0; reads a page a person linked)',
  accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
  'accept-language': 'en;q=0.9, pt;q=0.8, es;q=0.8, *;q=0.5',
  'accept-encoding': 'gzip, deflate, br',
}

const loopbackAddress = (address: string) =>
  /^127\./.test(address) || address === '::1' || /^::ffff:127\./i.test(address)

/** Resolves a name for the tests' loopback mode: every answer public or on this machine. */
const loopbackLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, '', 0)
    if (
      !addresses.length ||
      addresses.some((a) => !isPublicAddress(a.address) && !loopbackAddress(a.address))
    )
      return callback(
        Object.assign(new Error('The address is not public'), { code: 'ENOTPUBLIC' }),
        '',
        0,
      )
    if (options.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, addresses)
    return callback(null, addresses[0]!.address, addresses[0]!.family)
  })
}

/**
 * An address Heed may open, as a URL without its fragment, or the reason it may not. Plain http
 * is read as https: the same page, over the only protocol Heed uses.
 */
export function readableAddress(address: string, loopback = false): URL | ReadFailure {
  const url = URL.parse(address.trim())
  if (!url) return 'not_https'
  url.hash = ''
  if (url.username || url.password) return 'credentials'
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
  const local =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    (isIP(host) !== 0 && loopbackAddress(host))
  if (local) return loopback && /^https?:$/.test(url.protocol) ? url : 'not_public'
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:') return 'not_https'
  if (isIP(host) !== 0 && !isPublicAddress(host)) return 'not_public'
  return url
}

function send(url: URL, lookup: LookupFunction, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const call = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      { method: 'GET', headers, lookup, agent: false, signal },
      resolve,
    )
    call.on('error', reject)
    call.end()
  })
}

/** The response body as read, decompressed, refused past `max` bytes. */
async function body(response: IncomingMessage, max: number): Promise<Uint8Array> {
  const encoding = (response.headers['content-encoding'] ?? '').trim().toLowerCase()
  const stream: Readable =
    encoding === 'gzip' || encoding === 'x-gzip'
      ? response.pipe(createGunzip())
      : encoding === 'deflate'
        ? response.pipe(createInflate())
        : encoding === 'br'
          ? response.pipe(createBrotliDecompress())
          : response
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > max) {
      response.destroy()
      throw new PageReadError('too_large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const failureOf = (error: unknown, signal: AbortSignal): PageReadError => {
  if (error instanceof PageReadError) return error
  if (signal.aborted) return new PageReadError('timeout')
  const code = (error as { code?: unknown } | null)?.code
  return new PageReadError(code === 'ENOTPUBLIC' ? 'not_public' : 'unreachable')
}

export function createPageReader(options: PageReaderOptions = {}): PageReader {
  const max = options.maxBytes ?? MAX_BYTES
  const loopback = options.loopback ?? false
  const lookup = loopback ? loopbackLookup : publicLookup
  return async (address, outer) => {
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      ...(outer ? [outer] : []),
    ])
    const first = readableAddress(address, loopback)
    if (typeof first === 'string') throw new PageReadError(first)
    let url = first
    const asked = url.href
    try {
      for (let hops = 0; ; hops++) {
        const response = await send(url, lookup, signal)
        const status = response.statusCode ?? 0
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume()
          if (hops >= (options.maxRedirects ?? MAX_REDIRECTS)) throw new PageReadError('redirects')
          const next: URL | ReadFailure = URL.canParse(response.headers.location, url)
            ? readableAddress(new URL(response.headers.location, url).href, loopback)
            : 'not_https'
          if (typeof next === 'string') throw new PageReadError(next)
          url = next
          continue
        }
        if (status !== 200) {
          response.resume()
          throw new PageReadError('status', status)
        }
        const contentType = (response.headers['content-type'] ?? '').toLowerCase()
        if (/^application\/pdf\b/.test(contentType)) {
          response.resume()
          throw new PageReadError('pdf')
        }
        const declared = /^(?:text\/html|application\/xhtml\+xml)\b/.test(contentType)
          ? 'html'
          : /^text\/plain\b/.test(contentType)
            ? 'text'
            : contentType
              ? null
              : 'sniff'
        if (!declared) {
          response.resume()
          throw new PageReadError('not_text')
        }
        const bytes = await body(response, max)
        const text = decodePage(bytes, contentType)
        const kind = declared === 'sniff' ? (/^\s*</.test(text) ? 'html' : 'text') : declared
        return {
          url: asked,
          finalUrl: url.href,
          contentType: contentType.split(';')[0]!.trim() || 'unknown',
          charset: charsetOf(bytes, contentType),
          bytes: bytes.length,
          ...pageText(text, kind),
        }
      }
    } catch (error) {
      throw failureOf(error, signal)
    }
  }
}
