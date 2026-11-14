import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import { createHttpApi } from '@/api/http'

// A failure the service answered names the id it gave the request (`x-request-id`), so the app's
// error page can show it and an admin can look it up. A read that got no answer has none.

const REQUEST_ID = '0b5e2c1a-7d4f-4e8a-9c3b-2f6a1d8e5b70'

const failing: typeof globalThis.fetch = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({
        defined: false,
        code: 'INTERNAL_SERVER_ERROR',
        status: 500,
        message: 'Internal server error',
      }),
      { status: 500, headers: { 'content-type': 'application/json', 'x-request-id': REQUEST_ID } },
    ),
  )

const failure = (read: Promise<unknown>) =>
  read.then(
    () => expect.unreachable('the read worked'),
    (error: unknown) => error as ApiError,
  )

describe('the request id of a failed read', () => {
  it('goes with the error the service answered', async () => {
    const api = createHttpApi({ baseUrl: 'https://heed.example/api/v1', fetch: failing })
    const error = await failure(api.getLibrary())
    expect(error).toBeInstanceOf(ApiError)
    expect(error.kind).toBe('failed')
    expect(error.requestId).toBe(REQUEST_ID)
  })

  it('is missing when nothing answered', async () => {
    const offline: typeof globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'))
    const api = createHttpApi({ baseUrl: 'https://heed.example/api/v1', fetch: offline })
    const error = await failure(api.getLibrary())
    expect(error.kind).toBe('unanswered')
    expect(error.requestId).toBeUndefined()
  })
})
