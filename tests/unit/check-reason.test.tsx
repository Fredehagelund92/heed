import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { rememberCheckReason, useCheckReason } from '@/lib/check-reason'

describe('the reason kept from the last check', () => {
  it('fills in the same kind of check for the same person, and never for another', () => {
    const jon = renderHook(() => useCheckReason('per_jon', 'checked'))
    const issue = renderHook(() => useCheckReason('per_jon', 'still_going_on'))
    const sofia = renderHook(() => useCheckReason('per_sofia', 'checked'))
    act(() => rememberCheckReason('per_jon', 'checked', 'Compared it with the source.'))
    expect(jon.result.current).toBe('Compared it with the source.')
    expect(issue.result.current).toBe('')
    expect(sofia.result.current).toBe('')
    // Another person's first check clears what the one before kept.
    act(() => rememberCheckReason('per_sofia', 'still_going_on', 'Asked the odds team.'))
    expect(jon.result.current).toBe('')
    expect(sofia.result.current).toBe('')
  })

  it('keeps nothing while nobody is signed in', () => {
    const nobody = renderHook(() => useCheckReason('', 'checked'))
    act(() => rememberCheckReason('', 'checked', 'Anything.'))
    expect(nobody.result.current).toBe('')
  })
})
