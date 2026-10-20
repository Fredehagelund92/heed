import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createPageReader,
  PageReadError,
  readableAddress,
  type ReadFailure,
} from '../../../src/server/modules/web/index.ts'

/*
  read_source's reader against a fake web server on this machine. The tests' reader may open
  http on loopback (as CL_WEB_READ_LOOPBACK lets the end-to-end suite); every other address rule
  holds: a redirect to a private or metadata address is refused at its hop, and so are a page too
  large (also once decompressed), one too slow, a PDF, a file that is not text and an error page.
  The service's own reader refuses this machine outright.
*/

const latin1Page = Buffer.from(
  '<html><head><title>Regras de devolução</title></head><body><p>Art. 1º&nbsp;Ficam os comerciantes obrigados a aceitar a devolução.</p></body></html>',
  'latin1',
)

let server: Server
let base = ''
const hits: string[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? '/'
    hits.push(path)
    const send = (status: number, headers: Record<string, string>, body: string | Buffer = '') => {
      response.writeHead(status, headers)
      response.end(body)
    }
    switch (path) {
      case '/page':
        return send(
          200,
          { 'content-type': 'text/html; charset=utf-8' },
          '<title>A page</title><p>Online sales to Spain stopped on 2 September 2026.</p>',
        )
      case '/returns-rules':
        return send(200, { 'content-type': 'text/html' }, latin1Page)
      case '/gzip':
        return send(
          200,
          { 'content-type': 'text/html', 'content-encoding': 'gzip' },
          gzipSync('<p>Packed words.</p>'),
        )
      case '/redirect':
        return send(302, { location: '/page' })
      case '/loop':
        return send(302, { location: '/loop' })
      case '/to-private':
        return send(302, { location: 'http://10.0.0.1/admin' })
      case '/to-metadata':
        return send(301, { location: 'https://169.254.169.254/latest/meta-data/' })
      case '/to-ftp':
        return send(302, { location: 'ftp://files.example.com/x' })
      case '/big':
        return send(200, { 'content-type': 'text/plain' }, Buffer.alloc(3 * 1024 * 1024, 97))
      case '/bomb':
        return send(
          200,
          { 'content-type': 'text/html', 'content-encoding': 'gzip' },
          gzipSync(Buffer.alloc(8 * 1024 * 1024, 32)),
        )
      case '/slow':
        return // never answers
      case '/pdf':
        return send(200, { 'content-type': 'application/pdf' }, '%PDF-1.7')
      case '/image':
        return send(200, { 'content-type': 'image/png' }, 'png')
      case '/missing':
        return send(404, { 'content-type': 'text/html' }, 'Not here')
      case '/no-type':
        return send(200, {}, '<p>No type, still a page.</p>')
      default:
        return send(500, {}, '')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

const read = createPageReader({ loopback: true, timeoutMs: 1500, maxBytes: 2 * 1024 * 1024 })

async function refusal(promise: Promise<unknown>): Promise<ReadFailure> {
  try {
    await promise
  } catch (error) {
    if (error instanceof PageReadError) return error.reason
    throw error
  }
  throw new Error('The page was read')
}

describe('reading a page', () => {
  it('reads its title and paragraphs', async () => {
    const page = await read(`${base}/page`)
    expect(page).toMatchObject({
      url: `${base}/page`,
      finalUrl: `${base}/page`,
      contentType: 'text/html',
      charset: 'utf-8',
      title: 'A page',
      paragraphs: ['Online sales to Spain stopped on 2 September 2026.'],
    })
  })

  it('reads a Windows-1252 page that names no set, as some official sites serve their rules', async () => {
    const page = await read(`${base}/returns-rules`)
    expect(page.charset).toBe('windows-1252')
    expect(page.paragraphs).toEqual([
      'Art. 1º Ficam os comerciantes obrigados a aceitar a devolução.',
    ])
  })

  it('reads a compressed page, and a page that names no type when it is markup', async () => {
    expect((await read(`${base}/gzip`)).paragraphs).toEqual(['Packed words.'])
    expect((await read(`${base}/no-type`)).paragraphs).toEqual(['No type, still a page.'])
  })

  it('follows a redirect and says where the page answered', async () => {
    const page = await read(`${base}/redirect#part`)
    expect(page.url).toBe(`${base}/redirect`)
    expect(page.finalUrl).toBe(`${base}/page`)
  })
})

describe('what it refuses', () => {
  it('refuses a redirect to a private or metadata address at that hop, before any request', async () => {
    const before = hits.length
    expect(await refusal(read(`${base}/to-private`))).toBe('not_public')
    expect(await refusal(read(`${base}/to-metadata`))).toBe('not_public')
    expect(await refusal(read(`${base}/to-ftp`))).toBe('not_https')
    // Only the fake server was asked: the redirect's target never was.
    expect(hits.slice(before)).toEqual(['/to-private', '/to-metadata', '/to-ftp'])
  })

  it('stops after five redirects', async () => {
    expect(await refusal(read(`${base}/loop`))).toBe('redirects')
  })

  it('refuses a page over 2 MB, also when it only grows that large decompressed', async () => {
    expect(await refusal(read(`${base}/big`))).toBe('too_large')
    expect(await refusal(read(`${base}/bomb`))).toBe('too_large')
  })

  it('gives up on a site that does not answer in time', async () => {
    expect(await refusal(read(`${base}/slow`))).toBe('timeout')
  })

  it('refuses a PDF, a file that is not text and an error page', async () => {
    expect(await refusal(read(`${base}/pdf`))).toBe('pdf')
    expect(await refusal(read(`${base}/image`))).toBe('not_text')
    await expect(read(`${base}/missing`)).rejects.toMatchObject({ reason: 'status', status: 404 })
  })

  it("refuses this machine with the service's own reader", async () => {
    const service = createPageReader()
    expect(await refusal(service(`${base}/page`))).toBe('not_public')
    expect(await refusal(service(base.replace('127.0.0.1', 'localhost') + '/page'))).toBe(
      'not_public',
    )
    expect(hits.filter((hit) => hit === '/page')).toHaveLength(2)
  })
})

describe('the addresses Heed may open', () => {
  const rule = (address: string, loopback = false) => {
    const result = readableAddress(address, loopback)
    return typeof result === 'string' ? result : result.href
  }

  it('opens https on public hosts, reads plain http as https and drops the fragment', () => {
    expect(rule('https://consumer.example/eu/right-of-withdrawal#art1')).toBe(
      'https://consumer.example/eu/right-of-withdrawal',
    )
    expect(rule('http://www.example.gov/acts?x=1')).toBe('https://www.example.gov/acts?x=1')
  })

  it('refuses private, loopback, link-local and mapped addresses, credentials and other schemes', () => {
    for (const address of [
      'https://10.1.2.3/',
      'https://192.168.0.1/',
      'https://172.16.0.1/',
      'https://169.254.169.254/latest/meta-data/',
      'https://100.64.0.1/',
      'https://[fd00::1]/',
      'https://[fe80::1]/',
      'https://[::ffff:10.0.0.1]/',
      'https://[::ffff:7f00:1]/',
      'https://127.0.0.1/',
      'https://2130706433/',
      'https://[::1]/',
      'https://localhost/',
      'https://intranet.localhost/',
    ])
      expect(rule(address), address).toBe('not_public')
    expect(rule('https://user:secret@example.com/')).toBe('credentials')
    expect(rule('ftp://example.com/')).toBe('not_https')
    expect(rule('file:///etc/passwd')).toBe('not_https')
    expect(rule('javascript:alert(1)')).toBe('not_https')
    expect(rule('not a link')).toBe('not_https')
  })

  it('lets the tests read this machine over http, and still no other private address', () => {
    expect(rule('http://127.0.0.1:8080/x', true)).toBe('http://127.0.0.1:8080/x')
    expect(rule('http://localhost:8080/x', true)).toBe('http://localhost:8080/x')
    expect(rule('http://10.0.0.1/x', true)).toBe('not_public')
  })
})
