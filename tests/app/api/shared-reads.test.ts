import { describe, expect, it } from 'vitest'
import { sharedReads } from '@/api/http'

/** A service that answers each request with how many it has had, and counts what it was sent. */
function service(status = 200) {
  const sent: string[] = []
  const send: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init)
    sent.push(`${request.method} ${new URL(request.url).pathname}`)
    return Promise.resolve(new Response(JSON.stringify({ n: sent.length }), { status }))
  }
  return { send, sent }
}

const at = (path: string) => `https://heed.example/api/v1${path}`

describe('the http binding shares identical reads', () => {
  it('sends a read in flight once, and each caller reads its own copy', async () => {
    const { send, sent } = service()
    const fetch = sharedReads(send)
    const [a, b] = await Promise.all([fetch(at('/people')), fetch(at('/people'))])
    expect(await a.json()).toEqual({ n: 1 })
    expect(await b.json()).toEqual({ n: 1 })
    expect(sent).toEqual(['GET /api/v1/people'])
  })

  it('serves a read answered a moment ago, and asks again once it is older', async () => {
    const { send, sent } = service()
    let now = 0
    const fetch = sharedReads(send, () => now)
    await fetch(at('/inbox/feed'))
    now = 2_000
    expect(await (await fetch(at('/inbox/feed'))).json()).toEqual({ n: 1 })
    now = 3_000
    expect(await (await fetch(at('/inbox/feed'))).json()).toEqual({ n: 2 })
    expect(sent).toHaveLength(2)
  })

  it('reads again after any change, so a read after it sees it', async () => {
    const { send, sent } = service()
    const fetch = sharedReads(send, () => 0)
    await fetch(at('/inbox/feed'))
    await fetch(at('/inbox/cards/read'), { method: 'POST', body: '{}' })
    await fetch(at('/inbox/feed'))
    expect(sent).toEqual([
      'GET /api/v1/inbox/feed',
      'POST /api/v1/inbox/cards/read',
      'GET /api/v1/inbox/feed',
    ])
  })

  it('does not keep a read that was in flight while a change was sent', async () => {
    const sent: string[] = []
    const pending: Array<() => void> = []
    const send: typeof globalThis.fetch = (input, init) => {
      const request = new Request(input, init)
      sent.push(`${request.method} ${new URL(request.url).pathname}`)
      const body = sent.length
      return new Promise((resolve) =>
        pending.push(() => resolve(new Response(JSON.stringify({ n: body })))),
      )
    }
    const fetch = sharedReads(send, () => 0)
    const read = fetch(at('/inbox/feed'))
    const write = fetch(at('/inbox/cards/read'), { method: 'POST', body: '{}' })
    pending[0]()
    await read
    pending[1]()
    await write
    const after = fetch(at('/inbox/feed'))
    pending[2]()
    expect(await (await after).json()).toEqual({ n: 3 })
    expect(sent).toEqual([
      'GET /api/v1/inbox/feed',
      'POST /api/v1/inbox/cards/read',
      'GET /api/v1/inbox/feed',
    ])
  })

  it('does not keep a read sent while a change is in flight, once the change settles', async () => {
    const sent: string[] = []
    const pending: Array<() => void> = []
    const send: typeof globalThis.fetch = (input, init) => {
      const request = new Request(input, init)
      sent.push(`${request.method} ${new URL(request.url).pathname}`)
      const body = sent.length
      return new Promise((resolve) =>
        pending.push(() => resolve(new Response(JSON.stringify({ n: body })))),
      )
    }
    const fetch = sharedReads(send, () => 0)
    const write = fetch(at('/inbox/cards/read'), { method: 'POST', body: '{}' })
    const during = fetch(at('/inbox/feed'))
    pending[1]()
    await during
    pending[0]()
    await write
    const after = fetch(at('/inbox/feed'))
    pending[2]()
    expect(await (await after).json()).toEqual({ n: 3 })
    expect(sent).toHaveLength(3)
  })

  it('never keeps a refusal: the same read is asked again', async () => {
    const { send, sent } = service(503)
    const fetch = sharedReads(send, () => 0)
    await fetch(at('/people'))
    await fetch(at('/people'))
    expect(sent).toHaveLength(2)
  })

  it('tells different reads apart by their whole address', async () => {
    const { send, sent } = service()
    const fetch = sharedReads(send, () => 0)
    await Promise.all([fetch(at('/proposals?offset=0')), fetch(at('/proposals?offset=100'))])
    expect(sent).toHaveLength(2)
  })
})
