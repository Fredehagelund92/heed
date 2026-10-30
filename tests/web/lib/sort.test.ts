import { describe, expect, it } from 'vitest'
import {
  clicked,
  flipped,
  flips,
  sortingFrom,
  sortingTo,
  startOf,
  wayOf,
  type SortKey,
} from '@/lib/sort'

const keys = {
  checked: {
    label: 'Last checked',
    first: 'desc',
    ways: { desc: 'Newest first', asc: 'Oldest first' },
  },
  title: { label: 'Title', first: 'asc', ways: { asc: 'A to Z', desc: 'Z to A' } },
  best: { label: 'Best match', first: 'desc', ways: { desc: 'Closest first' } },
} satisfies Record<string, SortKey>

describe('a key', () => {
  it('starts its own way', () => {
    expect(startOf(keys, 'title')).toEqual({ key: 'title', dir: 'asc' })
    expect(startOf(keys, 'checked')).toEqual({ key: 'checked', dir: 'desc' })
  })
  it('says its direction in words', () => {
    expect(wayOf(keys, { key: 'title', dir: 'desc' })).toBe('Z to A')
    expect(wayOf(keys, { key: 'checked', dir: 'asc' })).toBe('Oldest first')
  })
  it('flips only when it has two ways', () => {
    expect(flips(keys.title)).toBe(true)
    expect(flips(keys.best)).toBe(false)
  })
  it('knows when it runs against its own way', () => {
    expect(flipped(keys, { key: 'title', dir: 'desc' })).toBe(true)
    expect(flipped(keys, { key: 'checked', dir: 'desc' })).toBe(false)
  })
})

describe('a header click', () => {
  it('flips the sorted column, and flips it back', () => {
    const once = clicked(keys, startOf(keys, 'title'), 'title')
    expect(once).toEqual({ key: 'title', dir: 'desc' })
    expect(clicked(keys, once, 'title')).toEqual({ key: 'title', dir: 'asc' })
  })
  it('starts another column its own way, whatever the last one was', () => {
    expect(clicked(keys, { key: 'title', dir: 'desc' }, 'checked')).toEqual({
      key: 'checked',
      dir: 'desc',
    })
  })
  it('leaves a ranking as it is', () => {
    expect(clicked(keys, startOf(keys, 'best'), 'best')).toEqual({ key: 'best', dir: 'desc' })
  })
})

describe('the address', () => {
  const from = (q: string) => sortingFrom(keys, new URLSearchParams(q), 'checked')
  it('reads the key and the direction', () => {
    expect(from('sort=title&dir=desc')).toEqual({ key: 'title', dir: 'desc' })
    expect(from('dir=asc')).toEqual({ key: 'checked', dir: 'asc' })
  })
  it('falls back on what it does not know', () => {
    expect(from('')).toEqual({ key: 'checked', dir: 'desc' })
    expect(from('sort=nonsense&dir=sideways')).toEqual({ key: 'checked', dir: 'desc' })
    expect(from('sort=toString')).toEqual({ key: 'checked', dir: 'desc' })
    expect(from('sort=best&dir=asc')).toEqual({ key: 'best', dir: 'desc' })
  })
  it("leaves out the fallback key and a key's own way", () => {
    expect(sortingTo(keys, { key: 'checked', dir: 'desc' }, 'checked')).toEqual({
      sort: undefined,
      dir: undefined,
    })
    expect(sortingTo(keys, { key: 'title', dir: 'desc' }, 'checked')).toEqual({
      sort: 'title',
      dir: 'desc',
    })
  })
  it('reads back what it writes', () => {
    for (const s of [
      { key: 'title', dir: 'asc' },
      { key: 'title', dir: 'desc' },
      { key: 'checked', dir: 'asc' },
      { key: 'best', dir: 'desc' },
    ] as const) {
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries(sortingTo(keys, s, 'checked'))) if (v) q.set(k, v)
      expect(sortingFrom(keys, q, 'checked')).toEqual(s)
    }
  })
})
