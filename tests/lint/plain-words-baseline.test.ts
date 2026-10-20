import { describe, expect, it } from 'vitest'
import { compareToBaseline, countWords, wordKey } from '../../scripts/plain-words-baseline.ts'

/** `npm run lint:words` fails only on a rise, word by word; a fall is a note. */
describe('the plain words baseline', () => {
  const baseline = { 'a.tsx': { item: 2, steward: 1 } }

  it('counts a word in lower case, a plural with its base word', () => {
    expect(wordKey('Items')).toBe('item')
    expect(wordKey('do not')).toBe('do not')
    expect(wordKey('scope')).toBe('scope')
    expect(
      countWords([
        { path: 'b.tsx', found: 'Items' },
        { path: 'a.tsx', found: 'item' },
        { path: 'a.tsx', found: 'item' },
      ]),
    ).toEqual({ 'a.tsx': { item: 2 }, 'b.tsx': { item: 1 } })
  })

  it('passes when nothing changed', () => {
    expect(compareToBaseline(baseline, baseline)).toEqual({ more: [], notes: [] })
  })

  it('fails on a rise', () => {
    expect(compareToBaseline({ 'a.tsx': { item: 3, steward: 1 } }, baseline).more).toEqual([
      { path: 'a.tsx', word: 'item', count: 3, allowed: 2 },
    ])
  })

  it('passes a fall with a note', () => {
    const { more, notes } = compareToBaseline({ 'a.tsx': { item: 1, steward: 1 } }, baseline)
    expect(more).toEqual([])
    expect(notes).toEqual([
      '1 fewer hits in a.tsx; run `npm run lint:words -- --update` when convenient to lower the baseline.',
    ])
  })

  it('fails on a new file with hits', () => {
    expect(compareToBaseline({ ...baseline, 'b.tsx': { scope: 1 } }, baseline).more).toEqual([
      { path: 'b.tsx', word: 'scope', count: 1, allowed: 0 },
    ])
  })

  it('does not let a fixed word hide a new one in the same file', () => {
    const { more, notes } = compareToBaseline({ 'a.tsx': { item: 2, scope: 1 } }, baseline)
    expect(more).toEqual([{ path: 'a.tsx', word: 'scope', count: 1, allowed: 0 }])
    expect(notes).toHaveLength(1)
  })
})
