import { describe, expect, it, vi } from 'vitest'
import { createHttpApi } from '@/api/http'

// An item's own read, as the quick view makes it: the item is asked for at once, beside the names
// and words it is read with. Waiting for those first put a whole round trip in front of the item,
// behind whatever else was in flight.

describe("an item's own read", () => {
  it('asks for the item beside the names and words, not after them', async () => {
    const sent: string[] = []
    let open = () => {}
    const names = new Promise<void>((resolve) => (open = resolve))
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const path = new URL(new Request(input, init).url).pathname
      sent.push(path)
      // Everything but the item waits, as a busy service's shared reads do.
      if (!path.endsWith('/page')) await names
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const api = createHttpApi({ baseUrl: 'https://heed.example/api/v1', fetch })
    const read = api.itemPage({ id: 'itm_norway01' }).catch(() => null)
    await vi.waitFor(() => expect(sent).toContain('/api/v1/items/itm_norway01/page'))
    expect(sent).toEqual(expect.arrayContaining(['/api/v1/people', '/api/v1/areas']))
    open()
    await read
  })
})
