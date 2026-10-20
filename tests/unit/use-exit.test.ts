import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIT_MS, useExit } from '@/hooks/use-exit'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** The hook, with a value that comes and goes through `rerender`. */
function renderExit(value: string | null) {
  return renderHook((props: { value: string | null }) => useExit(props.value), {
    initialProps: { value },
  })
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('a panel that leaves', () => {
  it('stays for its 100 ms exit with what it showed, then goes', () => {
    const { result, rerender } = renderExit('agent')
    expect(result.current).toEqual({ shown: 'agent', leaving: false })
    rerender({ value: null })
    expect(result.current).toEqual({ shown: 'agent', leaving: true })
    wait(EXIT_MS - 1)
    expect(result.current).toEqual({ shown: 'agent', leaving: true })
    wait(1)
    expect(result.current).toEqual({ shown: null, leaving: false })
  })

  it('is not there before it opens, and opens at once', () => {
    const { result, rerender } = renderExit(null)
    expect(result.current).toEqual({ shown: null, leaving: false })
    rerender({ value: 'ask' })
    expect(result.current).toEqual({ shown: 'ask', leaving: false })
  })

  it('stays without leaving when it comes back during its exit, with what it shows now', () => {
    const { result, rerender } = renderExit('ask')
    rerender({ value: null })
    wait(EXIT_MS / 2)
    rerender({ value: 'agent' })
    expect(result.current).toEqual({ shown: 'agent', leaving: false })
    wait(EXIT_MS)
    expect(result.current).toEqual({ shown: 'agent', leaving: false })
  })
})
