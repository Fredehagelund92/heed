import { describe, expect, it } from 'vitest'
import { standingOf } from '../../../src/domain/suggestion-standing.ts'

/*
  A waiting suggestion is current while the version it was written against is the one agents get,
  and stale once the item has a new live version or was archived another way.
*/

describe('whether a suggestion is still written against what agents get', () => {
  it('is current while agents get the version it was written against', () => {
    expect(standingOf({ written: 'v3', live: 'v3' })).toBe('current')
  })

  it('is stale once the item has a new live version: a check, or another publish', () => {
    expect(standingOf({ written: 'v3', live: 'v5' })).toBe('stale')
  })

  it('is stale once the item was archived another way', () => {
    expect(standingOf({ written: 'v3', live: null })).toBe('stale')
  })

  it('is current for a new item, which agents get no version of yet', () => {
    expect(standingOf({ written: null, live: null })).toBe('current')
  })
})
