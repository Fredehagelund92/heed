import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { heedApiMethods, readMethods, type HeedApi, type HeedApiMethod } from '@/api/client'
import { createMockApi } from '@/api/mock'

// Every write the app makes can fail or be refused offline in the mock, so a journey can see each
// failed state. The input is empty on purpose: a switch answers before the write reads it.
const writes = heedApiMethods.filter(
  (method) => !(readMethods as readonly string[]).includes(method),
)

const attempt = (api: HeedApi, method: HeedApiMethod) =>
  (api[method] as (input: unknown) => Promise<unknown>)({})

const mockAt = (query: Record<string, string>) => {
  const { api, controls } = createMockApi()
  controls.setAddress({ path: '/context', query })
  return api
}

describe('a failure switch on every mock write', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(writes)('%s fails on its first try under ?state=failed', async (method) => {
    const api = mockAt({ state: 'failed' })
    const failure = attempt(api, method).then(
      () => 'answered',
      (error: unknown) => (error as { kind?: string }).kind,
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(await failure).toBe('failed')
  })

  it.each(writes)('%s is refused under ?state=offline', async (method) => {
    const api = mockAt({ state: 'offline' })
    await expect(attempt(api, method)).rejects.toMatchObject({ kind: 'unanswered' })
  })
})
