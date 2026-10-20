import { describe, expect, it } from 'vitest'
import { selectionRange } from '@/lib/list-selection'

describe('selection range', () => {
  const ids = Array.from({ length: 15 }, (_, index) => `row-${index + 1}`)

  it('includes both endpoints in either direction', () => {
    expect(selectionRange(ids, 'row-1', 'row-10')).toEqual(ids.slice(0, 10))
    expect(selectionRange(ids, 'row-10', 'row-1')).toEqual(ids.slice(0, 10))
  })

  it('includes a single row when the anchor and target coincide', () => {
    expect(selectionRange(ids, 'row-5', 'row-5')).toEqual(['row-5'])
  })

  it('uses displayed order, including filtered and grouped lists', () => {
    const displayed = ['row-8', 'row-3', 'row-12', 'row-1']
    expect(selectionRange(displayed, 'row-1', 'row-3')).toEqual(['row-3', 'row-12', 'row-1'])
    expect(displayed).toEqual(['row-8', 'row-3', 'row-12', 'row-1'])
  })

  it('selects nothing when either endpoint is no longer displayed', () => {
    expect(selectionRange(ids, 'hidden', 'row-10')).toEqual([])
    expect(selectionRange(ids, 'row-1', 'hidden')).toEqual([])
    expect(selectionRange([], 'row-1', 'row-10')).toEqual([])
  })
})
