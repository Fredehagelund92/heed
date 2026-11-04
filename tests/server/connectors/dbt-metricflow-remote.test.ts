import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { builtInConnectors } from '../../../src/connectors/index.ts'
import {
  linkExpiry,
  regionOf,
  sasReadsOnly,
  signedHeaders,
} from '../../../src/connectors/dbt-metricflow/object-storage.ts'
import { SourceReadError } from '../../../src/server/modules/connectors/types.ts'
import {
  guardedFetch,
  registerConnectors,
  type StoredSource,
} from '../../../src/server/modules/connectors/platform.ts'
import { SourceError } from '../../../src/domain/connector-runtime.ts'
import { checkManifest, type ConnectorManifest } from '../../../src/domain/connector-manifest.ts'
import { latestManifest, legacyManifest } from './dbt-metricflow-fixture.ts'
import { objectHost, type ObjectHost } from './object-server.ts'

/*
  The dbt connector's address and storage routes through the core, against an object store on this
  machine: both YAML specs give one meaning, a file not changed is not read again, and the rules
  of `ctx.fetch` hold: declared hosts, redirects, the size cap, https and private addresses.
*/

const connector = registerConnectors(
  builtInConnectors.filter(({ manifest }) => manifest.id === 'dbt-metricflow'),
  [],
)[0]!
let store: ObjectHost

beforeAll(async () => {
  store = await objectHost()
  store.put('/link/legacy.json', JSON.stringify(legacyManifest))
  store.put('/link/latest.json', JSON.stringify(latestManifest))
  store.put('/bucket/dbt/legacy.json', JSON.stringify(legacyManifest))
  store.put('/bucket/dbt/latest.json', JSON.stringify(latestManifest))
  store.put('/blob/legacy.json', JSON.stringify(legacyManifest))
  store.put('/public/legacy.json', JSON.stringify(legacyManifest))
})
afterAll(() => store.close())
afterEach(() => {
  vi.unstubAllEnvs()
})

const stored = (config: StoredSource['config'], secrets: Record<string, string>): StoredSource => ({
  id: 'test',
  name: 'Test',
  config,
  secrets,
})
const address = (fileAddress: string) => stored({ location: 'address' }, { fileAddress })
const object = (path: string, overrides: Record<string, string> = {}) =>
  stored(
    {
      location: 'storage',
      provider: 's3-compatible',
      objectAddress: store.address(path),
      ...overrides,
    },
    { accessKey: store.accessKey, secretKey: store.secretKey },
  )

const failure = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(SourceReadError)
  return (error as SourceReadError).warnings[0]
}

describe('reading the file at an address', () => {
  it('reads a public file, and a signed link with its signature, under both YAML specs', async () => {
    const legacy = await connector
      .source(address(store.link('/link/legacy.json')))
      .read({ cursor: null })
    const latest = await connector
      .source(address(store.link('/link/latest.json')))
      .read({ cursor: null })
    const open = await connector
      .source(address(store.address('/public/legacy.json')))
      .read({ cursor: null })
    expect(legacy.complete).toBe(true)
    expect(legacy.definitions.length).toBeGreaterThan(0)
    expect(open.definitions).toEqual(legacy.definitions)
    expect(latest.definitions.map((d) => d.ref).sort()).toEqual(
      legacy.definitions.map((d) => d.ref).sort(),
    )
  })

  it('says only the host in a check, and never the signature', async () => {
    const link = store.link('/link/legacy.json')
    const report = await connector.check(address(link))
    const words = JSON.stringify(report)
    expect(words).toContain(new URL(link).host)
    expect(words).not.toContain(new URL(link).search.slice(1))
    expect(words).not.toContain('/link/')
  })

  it('says a link has stopped working, or will soon, before it is refused', async () => {
    const report = async (query: string) =>
      (await connector.check(address(store.link('/link/legacy.json', query)))).steps.find(
        (step) => step.id === 'link',
      )
    expect(await report('&se=2020-01-01T00%3A00%3A00Z')).toMatchObject({
      status: 'failed',
      detail: 'It stopped working on 2020-01-01.',
    })
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString()
    expect(await report(`&se=${encodeURIComponent(soon)}`)).toMatchObject({ status: 'warning' })
    expect(await report('&se=2100-01-01T00%3A00%3A00Z')).toMatchObject({ status: 'ok' })
    expect(await report('')).toBeUndefined()
  })

  it('fails with the host alone, whatever the host answers', async () => {
    store.refuse('/link/gone.json', 410)
    store.refuse('/link/busy.json', 429, '120')
    store.refuse('/link/down.json', 503)
    const read = (path: string) =>
      connector.source(address(store.link(path))).read({ cursor: null })
    const host = new URL(store.address('/')).host
    expect(await failure(read('/link/nothing.json'))).toEqual({ code: 'not_found', target: host })
    expect(await failure(read('/link/gone.json'))).toEqual({ code: 'fetch_failed', target: host })
    expect(await failure(read('/link/down.json'))).toEqual({ code: 'unreachable', target: host })
    const busy = await read('/link/busy.json').catch((error: unknown) => error as SourceReadError)
    expect(busy).toMatchObject({ errorClass: 'transient', retryAfter: 120 })
  })

  it('refuses a file over 2 MB, said first or found on the way, and one it cannot read', async () => {
    store.put('/public/big.json', Buffer.alloc(2_000_001, 0x20))
    store.trickle('/public/stream.json', 3_000_000)
    store.put('/public/packed.json', Buffer.from([0x1f, 0x8b]), { encoding: 'gzip' })
    store.put('/public/binary.json', Buffer.from([0xff, 0xfe, 0x00]))
    for (const path of ['big', 'stream', 'packed', 'binary'])
      expect(
        await failure(
          connector.source(address(store.address(`/public/${path}.json`))).read({ cursor: null }),
        ),
      ).toMatchObject({ code: 'unreadable_file' })
  })
})

describe('reading the file from object storage', () => {
  it('signs each read with the key, and the store checks it, under both YAML specs', async () => {
    const legacy = await connector.source(object('/bucket/dbt/legacy.json')).read({ cursor: null })
    const latest = await connector.source(object('/bucket/dbt/latest.json')).read({ cursor: null })
    expect(legacy.definitions.length).toBeGreaterThan(0)
    expect(latest.definitions.map((d) => d.ref).sort()).toEqual(
      legacy.definitions.map((d) => d.ref).sort(),
    )
    const sent = store.requests.filter((r) => r.path === '/bucket/dbt/legacy.json').at(-1)!
    expect(sent.status).toBe(200)
    expect(sent.authorization).toContain(`Credential=${store.accessKey}/`)
    expect(sent.authorization).not.toContain(store.secretKey)
  })

  it('signs a path with characters a path may not hold as they are', async () => {
    store.put('/bucket/my%20files/semantic+manifest%20(1).json', JSON.stringify(legacyManifest))
    const read = await connector
      .source(object('/bucket/my%20files/semantic+manifest%20(1).json'))
      .read({ cursor: null })
    expect(read.complete).toBe(true)
  })

  it('refuses a key the store does not take', async () => {
    const source = stored(object('/bucket/dbt/legacy.json').config, {
      accessKey: store.accessKey,
      secretKey: 'not-the-secret-key',
    })
    expect(await failure(connector.source(source).read({ cursor: null }))).toMatchObject({
      code: 'unauthorized',
    })
  })

  it('reads a blob with a read-only shared access signature, and refuses one that may write', async () => {
    const blob = (sasToken: string) =>
      stored(
        {
          location: 'storage',
          provider: 'azure',
          objectAddress: store.address('/blob/legacy.json'),
        },
        { sasToken },
      )
    expect((await connector.source(blob(`?${store.sas}`)).read({ cursor: null })).complete).toBe(
      true,
    )
    expect(
      await failure(
        connector.source(blob(store.sas.replace('sp=r', 'sp=rw'))).read({ cursor: null }),
      ),
    ).toEqual({ code: 'dbt-metricflow.not_read_only', target: 'sasToken' })
  })

  it('says which secret is missing, by its slot', async () => {
    expect(
      await failure(
        connector
          .source(stored(object('/bucket/dbt/legacy.json').config, {}))
          .read({ cursor: null }),
      ),
    ).toEqual({ code: 'secret_missing', target: 'accessKey' })
  })
})

describe('a read of a file that has not changed', () => {
  it('sends the mark it was given, reads nothing, and says so', async () => {
    store.put('/bucket/dbt/marked.json', JSON.stringify(legacyManifest))
    const source = connector.source(object('/bucket/dbt/marked.json'))
    const first = await source.read({ cursor: null })
    const again = await source.read({ cursor: first.cursor! })
    expect(first.cursor).toContain('etag')
    expect(again).toMatchObject({
      unchanged: true,
      complete: true,
      definitions: [],
      sourceVersion: first.sourceVersion,
      cursor: first.cursor,
    })
    const last = store.requests.filter((r) => r.path === '/bucket/dbt/marked.json').at(-1)!
    expect(last).toMatchObject({ status: 304 })
    expect(last.ifNoneMatch).toMatch(/^"v\d+"$/)
  })

  it('reads a changed file in full, and a store with only a date by its date', async () => {
    store.put('/bucket/dbt/moves.json', JSON.stringify(legacyManifest))
    const source = connector.source(object('/bucket/dbt/moves.json'))
    const first = await source.read({ cursor: null })
    store.put('/bucket/dbt/moves.json', JSON.stringify(latestManifest))
    const changed = await source.read({ cursor: first.cursor! })
    expect(changed.unchanged).toBeUndefined()
    expect(changed.definitions.length).toBeGreaterThan(0)

    const modified = 'Mon, 02 Nov 2026 06:00:00 GMT'
    store.put('/public/dated.json', JSON.stringify(legacyManifest), { etag: false, modified })
    const dated = connector.source(address(store.address('/public/dated.json')))
    const once = await dated.read({ cursor: null })
    expect(await dated.read({ cursor: once.cursor! })).toMatchObject({ unchanged: true })
    expect(store.requests.at(-1)).toMatchObject({ ifModifiedSince: modified, status: 304 })
  })

  it('reads in full when the host gives no mark, or the mark is an older mapping’s', async () => {
    store.put('/public/plain.json', JSON.stringify(legacyManifest), { etag: false })
    const plain = connector.source(address(store.address('/public/plain.json')))
    expect((await plain.read({ cursor: null })).cursor).toBeUndefined()
    store.put('/public/old.json', JSON.stringify(legacyManifest))
    const old = connector.source(address(store.address('/public/old.json')))
    const first = await old.read({ cursor: null })
    const tie = first.cursor!.slice(0, first.cursor!.indexOf(':') + 1)
    const mark = JSON.parse(first.cursor!.slice(tie.length)) as object
    const earlier = `${tie}${JSON.stringify({ ...mark, reader: '0.9.0/1' })}`
    expect((await old.read({ cursor: earlier })).definitions.length).toBeGreaterThan(0)
    expect(store.requests.at(-1)).toMatchObject({ ifNoneMatch: null, status: 200 })
  })
})

describe('the rules of ctx.fetch', () => {
  const declared = checkManifest({
    ...builtInConnectors.find(({ manifest }) => manifest.id === 'dbt-metricflow')!.manifest,
  })
  const manifest = (declared as { manifest: ConnectorManifest }).manifest
  const secrets = (fileAddress: string) => ({ fileAddress })
  const fetcher = (fileAddress: string) =>
    guardedFetch(manifest, {}, AbortSignal.timeout(5_000), secrets(fileAddress))
  const codeOf = async (work: Promise<unknown>) => {
    const error = await work.then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(SourceError)
    return (error as SourceError).code
  }

  it('reaches the host of the secret address, and no other', async () => {
    const link = store.address('/public/legacy.json')
    expect((await fetcher(link)(link)).status).toBe(200)
    expect(await codeOf(fetcher(link)('http://localhost:1/other'))).toBe('private_address')
    expect(await codeOf(fetcher(link)('https://example.com/other'))).toBe('private_address')
  })

  it('follows a redirect on the same host, three at most, and refuses any other', async () => {
    store.redirect('/public/moved.json', '/public/legacy.json')
    store.redirect('/public/away.json', 'https://elsewhere.example/file.json')
    store.redirect('/public/loop.json', '/public/loop.json')
    store.redirect('/public/plain-away.json', 'ftp://127.0.0.1/file.json')
    const link = store.address('/public/moved.json')
    expect((await fetcher(link)(link)).status).toBe(200)
    for (const path of ['away', 'loop', 'plain-away']) {
      const start = store.address(`/public/${path}.json`)
      expect(await codeOf(fetcher(start)(start))).toBe('redirect_refused')
    }
    const hops = store.requests.filter((r) => r.path === '/public/loop.json').length
    expect(hops).toBe(4)
  })

  it('never asks a host to write', async () => {
    const link = store.address('/public/legacy.json')
    expect(await codeOf(fetcher(link)(link, { method: 'POST', body: '{}' }))).toBe('invalid_output')
    expect(store.requests.every((r) => r.method === 'GET')).toBe(true)
  })

  it('in production refuses plain http and this machine, unless the host is allowed', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const plain = store.address('/public/legacy.json')
    expect(await codeOf(fetcher(plain)(plain))).toBe('private_address')
    expect(await failure(connector.source(address(plain)).read({ cursor: null }))).toMatchObject({
      code: 'private_address',
    })
    vi.stubEnv('HEED_EGRESS_PRIVATE_HOSTS', '127.0.0.1')
    // Allowed by name, it is still https only.
    expect(await codeOf(fetcher(plain)(plain))).toBe('private_address')
    const https = plain.replace('http:', 'https:')
    expect(await codeOf(fetcher(https)(https))).toBe('unreachable')
    vi.stubEnv('HEED_EGRESS_PRIVATE_HOSTS', '')
    expect(await codeOf(fetcher(https)(https))).toBe('private_address')
  })

  it('refuses an object address on a private host with the settings, in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const config = {
      location: 'storage',
      provider: 's3-compatible',
      objectAddress: 'https://10.0.0.5/bucket/file.json',
    }
    expect(connector.parse(config)).toMatchObject({ problems: [{ field: 'objectAddress' }] })
    vi.stubEnv('HEED_EGRESS_PRIVATE_HOSTS', '10.0.0.5')
    expect(connector.parse(config)).toEqual({ config })
  })
})

describe('object-storage.ts', () => {
  it('signs as a signer written apart from it does', async () => {
    // AWS's example key and request; the signature comes from a few lines of Python's hmac.
    const headers = await signedHeaders(
      new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      {
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
      },
      new Date('2013-05-24T00:00:00Z'),
    )
    expect(headers['x-amz-date']).toBe('20130524T000000Z')
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=df548e2ce037944d03f3e68682813b093763996d597cf890ca3d9037fd231eb4',
    )
  })

  it('finds the region an address signs for', () => {
    const of = (address: string, provider: string, region?: string) =>
      regionOf(new URL(address), provider, region)
    expect(of('https://b.s3.eu-west-1.amazonaws.com/f', 's3')).toBe('eu-west-1')
    expect(of('https://s3.eu-west-1.amazonaws.com/b/f', 's3')).toBe('eu-west-1')
    expect(of('https://b.s3.dualstack.us-west-2.amazonaws.com/f', 's3')).toBe('us-west-2')
    expect(of('https://b.s3.amazonaws.com/f', 's3')).toBe('us-east-1')
    expect(of('https://b.s3.amazonaws.com/f', 's3', 'eu-west-1')).toBe('eu-west-1')
    expect(of('https://b.s3-accelerate.amazonaws.com/f', 's3')).toBe('us-east-1')
    expect(of('https://b.s3-accelerate.amazonaws.com/f', 's3', 'ap-south-1')).toBe('ap-south-1')
    expect(of('https://b.s3.cn-north-1.amazonaws.com.cn/f', 's3')).toBe('cn-north-1')
    expect(of('https://s3-fips.us-east-2.amazonaws.com/b/f', 's3')).toBe('us-east-2')
    expect(of('https://b.s3-fips.dualstack.us-gov-west-1.amazonaws.com/f', 's3')).toBe(
      'us-gov-west-1',
    )
    expect(of('https://b.s3-eu-west-1.amazonaws.com/f', 's3', 'us-west-2')).toBe('eu-west-1')
    expect(of('https://storage.googleapis.com/b/f', 'gcs')).toBe('auto')
    expect(of('https://minio.example.test/b/f', 's3-compatible', 'eu-1')).toBe('eu-1')
    expect(of('https://minio.example.test/b/f', 's3-compatible')).toBe('us-east-1')
  })

  it('reads what a shared access signature may do', () => {
    expect(sasReadsOnly('sp=r&sig=a')).toBe(true)
    expect(sasReadsOnly('?sp=rl&sig=a')).toBe(true)
    expect(sasReadsOnly('si=policy&sig=a')).toBe(true)
    expect(sasReadsOnly('sp=rw&sig=a')).toBe(false)
    expect(sasReadsOnly('sp=racwd&sig=a')).toBe(false)
  })

  it('reads when a signed link stops working, as each store writes it', () => {
    const at = (query: string) => linkExpiry(`https://h.example/f?${query}`)?.toISOString()
    expect(at('X-Amz-Date=20261104T120000Z&X-Amz-Expires=3600')).toBe('2026-11-04T13:00:00.000Z')
    expect(at('X-Goog-Date=20261104T120000Z&X-Goog-Expires=60')).toBe('2026-11-04T12:01:00.000Z')
    expect(at('se=2027-01-01T00%3A00%3A00Z&sp=r')).toBe('2027-01-01T00:00:00.000Z')
    expect(at('sig=abc')).toBeUndefined()
    expect(linkExpiry('not an address')).toBeNull()
  })
})
