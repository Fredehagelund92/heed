import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useQueueSelection } from '@/components/proposals/use-queue-selection'

/*
  The proposals' selection (FR-223) holds only the rows the person may decide: a click, a
  Shift range, Shift with j or k and Select all pass over the others.
*/

const ids = ['a', 'b', 'c', 'd'] as const
const decidable = ['a', 'c', 'd']

describe('useQueueSelection', () => {
  it('never selects a row the person may not decide', () => {
    const { result } = renderHook(() => useQueueSelection(ids, decidable))
    act(() => result.current.toggle('b'))
    expect([...result.current.selected]).toEqual([])
    act(() => result.current.toggle('a'))
    act(() => result.current.toggle('d', true))
    expect([...result.current.selected]).toEqual(['a', 'c', 'd'])
    expect(result.current.capacity).toBe(3)
  })

  it('selects and clears every row it may hold', () => {
    const { result } = renderHook(() => useQueueSelection(ids, decidable))
    act(() => result.current.toggleAll())
    expect([...result.current.selected]).toEqual(['a', 'c', 'd'])
    act(() => result.current.toggleAll())
    expect(result.current.size).toBe(0)
    act(() => result.current.extend('a', 'c'))
    expect([...result.current.selected]).toEqual(['a', 'c'])
  })

  it('holds every row when the person may decide them all', () => {
    const { result } = renderHook(() => useQueueSelection(ids))
    act(() => result.current.selectAll())
    expect(result.current.size).toBe(4)
  })
})
