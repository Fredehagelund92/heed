import { describe, expect, it } from 'vitest'
import { differingWords, MOST_MARKS } from '@/lib/differing-words'
import { marksExceptions } from '@/lib/marks'

const marked = (text: string, other: string) =>
  differingWords(text, other)
    ?.filter((w) => w.changed)
    .map((w) => w.text) ?? null

describe('marksExceptions: a list marks its exceptions, never every row', () => {
  it('marks when some rows are not marked', () => {
    expect(marksExceptions([1, 2, 3], (n) => n === 2)).toBe(true)
  })

  it('marks nothing when every row of two or more would carry the same mark', () => {
    expect(marksExceptions([1, 2, 3], () => true)).toBe(false)
  })

  it('marks a list of one, and an empty list has nothing to mark', () => {
    expect(marksExceptions([1], () => true)).toBe(true)
    expect(marksExceptions([], () => true)).toBe(true)
  })
})

describe('differingWords: the words of one text the other does not have', () => {
  const saved = 'A new customs rule stopped online sales to Norway from 4 August 2026.'
  const now =
    'A new customs rule stopped all online sales to Norway from 4 August 2026, so orders there fell to almost nothing.'

  it('marks the words that came in, from the first word of a run to its last', () => {
    expect(marked(now, saved)).toEqual(['all', 'so orders there fell to almost nothing'])
  })

  it('keeps the text whole, so the marks read in place', () => {
    expect(
      differingWords(now, saved)
        ?.map((w) => w.text)
        .join(''),
    ).toBe(now)
  })

  it('marks a changed number, never the full stop beside it', () => {
    expect(marked('Units sold went up by 340.', 'Units sold went up by 312.')).toEqual(['340'])
  })

  it('marks nothing when the texts are the same, or when only marks differ', () => {
    expect(marked(saved, saved)).toBeNull()
    expect(marked('Orders fell in Norway!', 'Orders fell in Norway.')).toBeNull()
  })

  it('marks nothing in a rewrite: under half the words are shared', () => {
    expect(marked('Not found. The item it answered from is archived.', saved)).toBeNull()
  })

  it(`marks nothing past ${MOST_MARKS} places in a block`, () => {
    expect(marked('one two three four five six seven eight', 'one 2 three 4 five 6 seven 8')).toBe(
      null,
    )
    expect(
      marked('one two three four five six seven eight', 'one 2 three 4 five 6 seven eight'),
    ).toEqual(['two', 'four', 'six'])
  })
})
