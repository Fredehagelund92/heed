import { createServer as netServer, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { builtInConnectors } from '../../../src/connectors/index.ts'
import { SourceError } from '../../../src/domain/connector-runtime.ts'
import type { ConnectorManifest } from '../../../src/domain/connector-manifest.ts'
import { nextReadAt } from '../../../src/domain/source-schedule.ts'
import { SourceReadError } from '../../../src/server/modules/connectors/types.ts'
import {
  figureFetch,
  guardedFetch,
  registerConnectors,
  type StoredSource,
} from '../../../src/server/modules/connectors/platform.ts'
import { legacyManifest } from './dbt-metricflow-fixture.ts'
import { objectHost, type ObjectHost } from './object-server.ts'

/*
  What a host can do to a read of dbt's file, against servers on this machine: a status no
  response can hold, a connection that drops, a wait that never ends, a redirect to another port,
  a request that writes, and a cursor left under other settings.
*/

const connector = registerConnectors(
  builtInConnectors.filter(({ manifest }) => manifest.id === 'dbt-metricflow'),
  [],
)[0]!
const manifest: ConnectorManifest = connector.manifest

let store: ObjectHost
let raw: Server
let rawPort = 0
const rawRequests: string[] = []
const sockets = new Set<Socket>()
const behaviours = new Map<string, (socket: Socket) => void>()

beforeAll(async () => {
  store = await objectHost()
  store.put('/public/shop.json', JSON.stringify(legacyManifest))
  raw = netServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('data', (data) => {
      const line = data.toString().split('\r\n')[0]!
      rawRequests.push(line)
      const path = line.split(' ')[1]!
      const behave = behaviours.get(path)
      if (behave) behave(socket)
      else socket.end('HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n')
    })
  })
  await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve))
  rawPort = (raw.address() as AddressInfo).port
})
afterAll(async () => {
  await store.close()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((resolve) => raw.close(() => resolve()))
})
afterEach(() => vi.unstubAllEnvs())

const rawAddress = (path: string) => `http://127.0.0.1:${rawPort}${path}`
const stored = (config: StoredSource['config'], secrets: Record<string, string>): StoredSource => ({
  id: 'test',
  name: 'Test',
  config,
  secrets,
})
const address = (fileAddress: string, scopes?: StoredSource['scopes']): StoredSource => ({
  ...stored({ location: 'address' }, { fileAddress }),
  ...(scopes ? { scopes } : {}),
})
const fetcher = (fileAddress: string) =>
  guardedFetch(manifest, {}, AbortSignal.timeout(5_000), { fileAddress })
const codeOf = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(SourceError)
  return (error as SourceError).code
}
const failure = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(SourceReadError)
  return error as SourceReadError
}

describe('a status no response can hold', () => {
  it('is a bad gateway through ctx.fetch and through a figure, and does not stop the server', async () => {
    behaviours.set('/seven-hundred', (socket) =>
      socket.end('HTTP/1.1 700 Nope\r\nconnection: close\r\ncontent-length: 2\r\n\r\nno'),
    )
    const link = rawAddress('/seven-hundred')
    expect((await fetcher(link)(link)).status).toBe(502)
    expect((await figureFetch(link, AbortSignal.timeout(5_000))(link)).status).toBe(502)
    const read = await failure(connector.source(address(link)).read({ cursor: null }))
    expect(read.warnings[0]).toMatchObject({ code: 'unreachable' })
  })
})

describe('a connection that drops while the file arrives', () => {
  it('is unreachable and tried again, naming the host', async () => {
    behaviours.set('/dropped', (socket) => {
      socket.write('HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 1000\r\n\r\n{"semantic')
      setTimeout(() => socket.destroy(), 20)
    })
    const error = await failure(
      connector.source(address(rawAddress('/dropped'))).read({ cursor: null }),
    )
    expect(error.warnings[0]).toEqual({ code: 'unreachable', target: `127.0.0.1:${rawPort}` })
    expect(error.errorClass).toBe('transient')
  })

  it('still says a file over the cap is unreadable', async () => {
    behaviours.set('/huge', (socket) =>
      socket.end('HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 5000000\r\n\r\n'),
    )
    const error = await failure(
      connector.source(address(rawAddress('/huge'))).read({ cursor: null }),
    )
    expect(error.warnings[0]).toMatchObject({ code: 'unreadable_file' })
  })
})

describe('what a host may ask of a read', () => {
  it('a HEAD that says a large length is not refused, as it has no body', async () => {
    behaviours.set('/head', (socket) =>
      socket.end('HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 50000000\r\n\r\n'),
    )
    const link = rawAddress('/head')
    expect((await fetcher(link)(link, { method: 'HEAD' })).status).toBe(200)
  })

  it('never writes: only GET, HEAD and a sign-in POST go', async () => {
    const link = store.address('/public/shop.json')
    const asked = store.requests.length
    for (const method of ['DELETE', 'PUT', 'PATCH'])
      expect(
        await codeOf(
          fetcher(link)(link, { method } as unknown as Parameters<ReturnType<typeof fetcher>>[1]),
        ),
      ).toBe('invalid_output')
    expect(store.requests).toHaveLength(asked)
  })

  it('follows no redirect to another port of the same host', async () => {
    store.redirect('/public/other-port.json', rawAddress('/seven-hundred'))
    const link = store.address('/public/other-port.json')
    const asked = rawRequests.length
    expect(await codeOf(fetcher(link)(link))).toBe('redirect_refused')
    expect(rawRequests).toHaveLength(asked)
  })
})

describe('a cursor left under other settings', () => {
  const first = async (source: StoredSource) => connector.source(source).read({ cursor: null })

  it('is kept within the limit and tied to the settings it was left under', async () => {
    const link = store.address('/public/shop.json')
    const read = await first(address(link))
    expect(read.cursor).toMatch(/^[0-9a-f]{16}:/)
    expect(read.cursor!.length).toBeLessThanOrEqual(500)
    const again = await connector.source(address(link)).read({ cursor: read.cursor! })
    expect(again).toMatchObject({ unchanged: true, cursor: read.cursor })
  })

  it('is not trusted by a read with other settings or other scopes', async () => {
    const link = store.address('/public/shop.json')
    const { cursor } = await first(address(link))
    const other = stored(
      { location: 'address', domainNames: { sales: 'finance' } },
      { fileAddress: link },
    )
    const changed = await connector.source(other).read({ cursor: cursor! })
    expect(changed.unchanged).toBeUndefined()
    expect(changed.definitions.length).toBeGreaterThan(0)
    const scoped = await connector
      .source(address(link, [{ id: 'shop', title: 'Shop', domain: null }]))
      .read({ cursor: cursor! })
    expect(scoped.unchanged).toBeUndefined()
    expect(store.requests.at(-1)).toMatchObject({ ifNoneMatch: null, status: 200 })
  })
})

describe('Retry-After from a host', () => {
  it('is passed on up to six digits, and ignored beyond', async () => {
    const wait = async (value: string) => {
      store.refuse('/public/busy.json', 429, value)
      const error = await failure(
        connector.source(address(store.address('/public/busy.json'))).read({ cursor: null }),
      )
      return error.retryAfter
    }
    expect(await wait('120')).toBe(120)
    expect(await wait('999999')).toBe(999_999)
    expect(await wait('315360000')).toBeUndefined()
    expect(await wait('1e20')).toBeUndefined()
    expect(await wait('-5')).toBeUndefined()
  })

  it('cannot park a source or make its next read an invalid date, whatever a connector says', () => {
    const now = new Date('2026-11-04T12:00:00Z')
    const after = (retryAfterSeconds: number) =>
      nextReadAt(now, {
        periodSeconds: 3_600,
        staleAfterSeconds: 21_600,
        failures: 1,
        failure: 'transient',
        retryAfterSeconds,
      })
    expect(after(7_200).toISOString()).toBe('2026-11-04T14:00:00.000Z')
    for (const asked of [315_360_000, 1e20, Number.POSITIVE_INFINITY, Number.NaN, -5])
      expect(after(asked).toISOString()).toBe('2026-11-04T12:01:00.000Z')
  })
})

describe('the region of an Amazon S3 address', () => {
  it('shows the Region setting for Amazon S3 as well as an S3-compatible store', () => {
    const config = {
      location: 'storage',
      provider: 's3',
      objectAddress: 'https://b.s3-accelerate.amazonaws.com/dbt/semantic_manifest.json',
      region: 'eu-west-1',
    }
    expect(connector.parse(config)).toEqual({ config })
  })
})
