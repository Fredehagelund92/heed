import { createHash, createHmac, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/*
  An object store on this machine for tests: the one call the dbt connector makes, GET of an
  object, over plain http on 127.0.0.1, as S3 and the stores that speak its API take it (an
  `Authorization` header it checks with Signature Version 4, written here apart from the
  connector's so one cannot agree with itself), as a signed link takes it (a `sig` of its own, in
  the query), and as Azure Blob takes it (a shared access signature in the query). Its keys are
  invented when it starts and live in memory only.

  It answers `If-None-Match` and `If-Modified-Since`, and records every request, so a test can
  prove where a key went, that a file not changed was not read again, and that nothing was
  written.
*/

export interface ObjectRequest {
  method: string
  path: string
  authorization: string | null
  ifNoneMatch: string | null
  ifModifiedSince: string | null
  status: number
}

interface StoredObject {
  body: Buffer
  etag: string | null
  modified: string | null
  encoding: string | null
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const hmac = (key: Buffer | string, text: string) => createHmac('sha256', key).update(text).digest()

/** A path as S3 writes it to sign it: each part encoded on its own, `/` kept. */
const canonicalPath = (raw: string) =>
  raw
    .split('/')
    .map((part) =>
      encodeURIComponent(decodeURIComponent(part)).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/')

/** Starts the fake store, with one read-only key, one signature and one link signature. */
export async function objectHost() {
  const objects = new Map<string, StoredObject>()
  const requests: ObjectRequest[] = []
  const redirects = new Map<string, string>()
  const trickled = new Map<string, number>()
  const refusals = new Map<string, { status: number; retryAfter?: string }>()
  const accessKey = `AKIATEST${randomBytes(6).toString('hex').toUpperCase()}`
  const secretKey = randomBytes(24).toString('base64url')
  const linkSignature = randomBytes(16).toString('hex')
  const sas = `sv=2024-11-04&sr=b&sp=r&se=2036-01-01T00%3A00%3A00Z&sig=${randomBytes(16).toString('hex')}`
  let port = 0

  /** Whether a request's Signature Version 4 is the one the key gives. */
  function signatureHolds(req: IncomingMessage, path: string): boolean {
    const match =
      /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, ?SignedHeaders=([^,]+), ?Signature=([0-9a-f]{64})$/.exec(
        req.headers.authorization ?? '',
      )
    if (!match) return false
    const [, key, day, region, signed, signature] = match as unknown as string[]
    if (key !== accessKey) return false
    const names = signed!.split(';')
    const canonical = [
      req.method,
      canonicalPath(path),
      '',
      names.map((name) => `${name}:${String(req.headers[name] ?? '').trim()}\n`).join(''),
      signed,
      req.headers['x-amz-content-sha256'] ?? '',
    ].join('\n')
    const stamp = String(req.headers['x-amz-date'])
    const scope = `${day}/${region}/s3/aws4_request`
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n')
    let derived = hmac(`AWS4${secretKey}`, day!)
    for (const part of [region!, 's3', 'aws4_request']) derived = hmac(derived, part)
    return hmac(derived, toSign).toString('hex') === signature
  }

  /** Whether a request may have the object: the key's signature, a link's, or a shared one. */
  const allowed = (req: IncomingMessage, path: string, query: URLSearchParams) => {
    if (path.startsWith('/public/')) return true
    if (path.startsWith('/link/')) return query.get('sig') === linkSignature
    if (path.startsWith('/blob/')) return query.toString() === new URLSearchParams(sas).toString()
    return signatureHolds(req, path)
  }

  function answer(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    const path = url.pathname
    const entry: ObjectRequest = {
      method: req.method ?? '',
      path,
      authorization: req.headers.authorization ?? null,
      ifNoneMatch: req.headers['if-none-match'] ?? null,
      ifModifiedSince: req.headers['if-modified-since'] ?? null,
      status: 200,
    }
    requests.push(entry)
    const done = (status: number, headers: Record<string, string> = {}) => {
      entry.status = status
      res.writeHead(status, headers).end()
    }
    const refusal = refusals.get(path)
    if (refusal)
      return done(refusal.status, refusal.retryAfter ? { 'retry-after': refusal.retryAfter } : {})
    const location = redirects.get(path)
    if (location !== undefined) return done(302, { location })
    if (req.method !== 'GET') return done(405)
    if (!allowed(req, path, url.searchParams)) return done(403)
    const object = objects.get(path)
    const size = trickled.get(path)
    if (size !== undefined) {
      // Chunks, with no length said first, so only counting what arrives can stop it.
      res.writeHead(200, { 'content-type': 'application/json' })
      for (let sent = 0; sent < size; sent += 65_536) res.write(Buffer.alloc(65_536, 0x20))
      return res.end()
    }
    if (!object) return done(404)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(object.etag ? { etag: object.etag } : {}),
      ...(object.modified ? { 'last-modified': object.modified } : {}),
      ...(object.encoding ? { 'content-encoding': object.encoding } : {}),
    }
    const unchanged =
      (object.etag !== null && req.headers['if-none-match'] === object.etag) ||
      (object.etag === null &&
        object.modified !== null &&
        req.headers['if-modified-since'] === object.modified)
    if (unchanged) return done(304, headers)
    res.writeHead(200, headers).end(object.body)
  }

  const server = createServer(answer)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
  let version = 0

  return {
    accessKey,
    secretKey,
    sas,
    requests,
    /** The address of a path of the store. */
    address: (path: string) => `http://127.0.0.1:${port}${path}`,
    /** The signed link of a path under `/link/`, with what else its query says. */
    link: (path: string, query = '') =>
      `http://127.0.0.1:${port}${path}?sig=${linkSignature}${query}`,
    /** Puts an object, with a new ETag unless it says it has none. */
    put(
      path: string,
      body: string | Buffer,
      {
        etag = true,
        modified = null,
        encoding = null,
      }: { etag?: boolean; modified?: string | null; encoding?: string | null } = {},
    ) {
      objects.set(path, {
        body: Buffer.from(body),
        etag: etag ? `"v${++version}"` : null,
        modified,
        encoding,
      })
    },
    /** A path that answers with a redirect to this address. */
    redirect: (path: string, location: string) => redirects.set(path, location),
    /** A path that sends this many bytes in chunks, saying no length first. */
    trickle: (path: string, size: number) => trickled.set(path, size),
    /** A path that answers with a status and nothing else. */
    refuse: (path: string, status: number, retryAfter?: string) =>
      refusals.set(path, { status, ...(retryAfter ? { retryAfter } : {}) }),
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

export type ObjectHost = Awaited<ReturnType<typeof objectHost>>
