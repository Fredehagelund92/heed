import { afterEach, describe, expect, it } from 'vitest'
import { createHttpApi } from '@/api/http'
import { setToday, today, DEMO_TODAY } from '@/lib/today'
import { relativeDate } from '@/model/history'
import { dateLabel } from '@/model/validity'

// The web has no day of its own: a library read names the service's day, and every screen after it
// dates by that day, not by the demo world's.

afterEach(() => setToday(DEMO_TODAY))

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )

describe("the web reads the service's day", () => {
  it('moves off the demo day once the library index names another', async () => {
    const fetch: typeof globalThis.fetch = (input, init) => {
      const path = new URL(new Request(input, init).url).pathname
      if (path.endsWith('/library')) {
        return json({ today: '2027-01-20', loadedAt: '2027-01-20T09:00:00.000Z', items: [] })
      }
      if (path.endsWith('/auth/session')) {
        return json({
          csrfToken: 'csrf',
          person: { id: 'per_demo', name: 'Demo Person', permissions: { roles: [] } },
        })
      }
      if (path.endsWith('/people') || path.endsWith('/areas')) return json([])
      return json({
        rows: [],
        total: 0,
        items: [],
        people: [],
        areas: [],
        proposals: [],
        metrics: [],
        dimensions: [],
      })
    }
    const api = createHttpApi({ baseUrl: 'https://heed.example/api/v1', fetch })
    expect(today()).toBe(DEMO_TODAY)
    await api.contextPage({})
    expect(today()).toBe('2027-01-20')
    expect(relativeDate('2027-01-19')).toBe('yesterday')
    // What a recheck stamps as checked on: the service's day, not a literal.
    expect(dateLabel(today())).toBe('20 Jan 2027')
  })
})
