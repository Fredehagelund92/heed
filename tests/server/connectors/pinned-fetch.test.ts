import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SourceError } from '../../../src/domain/connector-runtime.ts'

/*
  A figure's fetch (CON-113): one GET to the data endpoint's own origin, the host's name looked up
  once and the connection pinned to an answer that is public, so a name cannot answer with a
  private address on the way (DNS rebinding). The name service is a stand-in here.
*/

const answers = new Map<string, { address: string; family: number }[]>()
vi.mock('node:dns/promises', () => ({
  lookup: (host: string) => {
    const found = answers.get(host)
    return found ? Promise.resolve(found) : Promise.reject(new Error('ENOTFOUND'))
  },
}))

const { figureFetch } = await import('../../../src/server/modules/connectors/platform.ts')

let server: Server
const seen: { host: string | undefined; authorization: string | undefined }[] = []
let port = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ host: req.headers.host, authorization: req.headers.authorization })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const code = async (work: () => Promise<unknown>) => {
  try {
    await work()
    return null
  } catch (error) {
    return error instanceof SourceError ? error.code : String(error)
  }
}

describe("a figure's fetch", () => {
  it('reaches the endpoint, with its headers, at the address the name was looked up at', async () => {
    const endpoint = `http://127.0.0.1:${port}/cubejs-api/v1/load`
    const fetch = figureFetch(endpoint, AbortSignal.timeout(2_000))
    const response = await fetch(`${endpoint}?query=%7B%7D`, { headers: { authorization: 'tok' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(seen.at(-1)).toEqual({ host: `127.0.0.1:${port}`, authorization: 'tok' })
  })

  it('reaches no other origin: another port, scheme or host of the same name is refused', async () => {
    const endpoint = `http://127.0.0.1:${port}/cubejs-api/v1/load`
    const fetch = figureFetch(endpoint, AbortSignal.timeout(2_000))
    const asked = seen.length
    expect(await code(() => fetch(`http://127.0.0.1:${port + 1}/cubejs-api/v1/load`))).toBe(
      'private_address',
    )
    expect(await code(() => fetch(`https://127.0.0.1:${port}/cubejs-api/v1/load`))).toBe(
      'private_address',
    )
    expect(await code(() => fetch(endpoint, { method: 'POST', body: '{}' }))).toBe('invalid_output')
    expect(seen).toHaveLength(asked)
  })

  it('in production, refuses a public name that answers with a private address', async () => {
    const was = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      answers.set('cube.example.com', [
        { address: '203.0.114.7', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ])
      const fetch = figureFetch(
        'https://cube.example.com/cubejs-api/v1/load',
        AbortSignal.timeout(2_000),
      )
      expect(await code(() => fetch('https://cube.example.com/cubejs-api/v1/load'))).toBe(
        'private_address',
      )
      // An address given as an IP is checked as it is.
      const byIp = figureFetch('https://10.0.0.5/cubejs-api/v1/load', AbortSignal.timeout(2_000))
      expect(await code(() => byIp('https://10.0.0.5/cubejs-api/v1/load'))).toBe('private_address')
    } finally {
      process.env.NODE_ENV = was
    }
  })
})
