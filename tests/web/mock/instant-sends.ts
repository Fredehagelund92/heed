import { afterEach, beforeEach, vi } from 'vitest'

/**
 * A write takes as long as a send does in the mock (0.6s). Call this in a file that makes many of
 * them: the time they wait passes as soon as they ask for it.
 */
export function instantSends() {
  let ticker: ReturnType<typeof setInterval>
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    ticker = setInterval(() => vi.advanceTimersByTime(1000), 1)
  })
  afterEach(() => {
    clearInterval(ticker)
    vi.useRealTimers()
  })
}
