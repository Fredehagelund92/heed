import { describe, expect, it } from 'vitest'
import { pairOfItems, pairOfKey } from '@/model/conflicts'

// Which conflict pair an alert or a topic's answer is about: found by the ids of its two items,
// never by the words of a topic, so topics that share a beginning keep their own pairs.

const row = (key: string, holder: string, other: string, topic: string) => ({
  key,
  topic,
  holder: { id: holder },
  other: { id: other },
})
const rows = [
  row('a.b', 'a', 'b', 'Orders in Spain'),
  row('d.c', 'd', 'c', 'Orders in Spain, October 2026'),
  row('e.f', 'e', 'f', 'Orders'),
]

describe('pairOfItems', () => {
  it('finds the pair of two items, whichever holds the link', () => {
    expect(pairOfItems(rows, ['c', 'd'])?.key).toBe('d.c')
    expect(pairOfItems(rows, ['d', 'c'])?.key).toBe('d.c')
    expect(pairOfItems(rows, ['e', 'f'])?.key).toBe('e.f')
  })
  it('finds nothing unless the answer names exactly two items that are a pair', () => {
    expect(pairOfItems(rows, undefined)).toBeUndefined()
    expect(pairOfItems(rows, ['a'])).toBeUndefined()
    expect(pairOfItems(rows, ['a', 'c', 'e'])).toBeUndefined()
    expect(pairOfItems(rows, ['a', 'b', 'c'])).toBeUndefined()
    expect(pairOfItems(rows, ['a', 'c'])).toBeUndefined()
  })
})

describe('pairOfKey', () => {
  it('reads an alert’s pair key in either order', () => {
    expect(pairOfKey(rows, 'c.d')?.key).toBe('d.c')
    expect(pairOfKey(rows, 'a.b')?.key).toBe('a.b')
    expect(pairOfKey(rows, undefined)).toBeUndefined()
  })
})
