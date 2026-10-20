import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDensity, usePreference } from '@/lib/preferences'

describe('usePreference with unusable storage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the choice when storage is fully blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => usePreference('test.blocked', 'compact', isDensity))
    expect(result.current[0]).toBe('compact')
    act(() => result.current[1]('comfortable'))
    expect(result.current[0]).toBe('comfortable')
  })

  it('keeps the choice when only writing fails', () => {
    window.localStorage.setItem('test.quota', JSON.stringify('compact'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const { result } = renderHook(() => usePreference('test.quota', 'compact', isDensity))
    act(() => result.current[1]('comfortable'))
    expect(result.current[0]).toBe('comfortable')
  })
})
