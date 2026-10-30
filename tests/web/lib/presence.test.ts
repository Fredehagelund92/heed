import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Rows that leave (docs/design/motion.md): a row collapses in 150ms, then the change is made, and it
// stays collapsed until the change has landed, so it never shows again on its way out.

let reduce = false

beforeEach(() => {
  vi.useFakeTimers()
  reduce = false
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    matchMedia: () => ({ matches: reduce }),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

/** The presence module, fresh for each test. */
const load = () => import('@/lib/presence')

describe('a row that leaves', () => {
  it('collapses for 150ms before the change is made', async () => {
    const { leaveThen, LEAVE_MS, isLeaving } = await load()
    const commit = vi.fn()
    void leaveThen('a', commit)
    expect(isLeaving('a')).toBe(true)
    expect(commit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(LEAVE_MS)
    expect(commit).toHaveBeenCalledOnce()
    expect(isLeaving('a')).toBe(false)
  })

  it('stays collapsed until the save and the refreshed list have landed', async () => {
    const { leaveThen, LEAVE_MS, isLeaving } = await load()
    let land!: () => void
    const done = leaveThen('a', () => new Promise<void>((resolve) => (land = resolve)))
    await vi.advanceTimersByTimeAsync(LEAVE_MS + 500)
    expect(isLeaving('a')).toBe(true)
    land()
    await done
    expect(isLeaving('a')).toBe(false)
  })

  it('opens again when the save fails, and says so to the caller', async () => {
    const { leaveAllThen, LEAVE_MS, isLeaving } = await load()
    const done = leaveAllThen(['a', 'b'], () => Promise.reject(new Error('offline')))
    const failed = expect(done).rejects.toThrow('offline')
    await vi.advanceTimersByTimeAsync(LEAVE_MS)
    await failed
    expect(isLeaving('a')).toBe(false)
    expect(isLeaving('b')).toBe(false)
  })

  it('with reduced motion, makes the change at once', async () => {
    reduce = true
    const { leaveThen, isLeaving } = await load()
    const commit = vi.fn()
    void leaveThen('a', commit)
    expect(commit).toHaveBeenCalledOnce()
    expect(isLeaving('a')).toBe(false)
  })
})
