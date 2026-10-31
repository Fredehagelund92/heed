import { describe, expect, it } from 'vitest'
import { anchorFields } from '@domain/comments'
import { fieldKeys } from '@/model/review-fields'
import { onVersions, placeFromKey, placeKey, placeLabel, placeOf } from '@/model/source-places'
import { threadCount } from '@/components/heed/source-threads'

// Where a thread hangs on a review's source: a field of the Fields table, or a line of the text
// on the side it was read on, against the two versions the review compares.

describe('a place on the source', () => {
  it('is one of the Fields table rows, which are the fields the service takes', () => {
    expect([...anchorFields]).toEqual([...fieldKeys])
  })

  it('reads back from its key, and a key that is no place is none', () => {
    for (const at of [
      { field: 'dontConclude' as const },
      { side: 'after' as const, line: 7 },
      { side: 'before' as const, line: 1 },
    ])
      expect(placeFromKey(placeKey(at))).toEqual(at)
    for (const key of ['', 'after:0', 'after:x', 'middle:3', 'after:1.5'])
      expect(placeFromKey(key)).toBeNull()
  })

  it('is named as the review names it', () => {
    expect(placeLabel({ field: 'reviewDate' })).toBe('Check date')
    expect(placeLabel({ side: 'after', line: 7 })).toBe('Line 7')
    expect(placeLabel({ side: 'before', line: 3 })).toBe('Removed line 3')
  })

  it('is on these versions only when both are the ones it was written against', () => {
    const anchor = { before: 'v1', after: 'v2', side: 'after' as const, line: 2 }
    expect(placeOf(anchor)).toEqual({ side: 'after', line: 2 })
    expect(onVersions(anchor, { before: 'v1', after: 'v2' })).toBe(true)
    expect(onVersions(anchor, { before: 'v1', after: 'v3' })).toBe(false)
    expect(onVersions({ ...anchor, before: null }, { before: null, after: 'v2' })).toBe(true)
  })
})

describe('the count of threads on the source', () => {
  it('says what is open and what is resolved, and nothing for none', () => {
    expect(threadCount(2, 1)).toBe('2 open, 1 resolved')
    expect(threadCount(0, 3)).toBe('3 resolved')
    expect(threadCount(1, 0)).toBe('1 open')
    expect(threadCount(0, 0)).toBe('')
  })
})
