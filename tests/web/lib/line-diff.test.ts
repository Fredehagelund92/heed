import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { diffStats, hunks, lineDiff, sharedWords, wordDiff } from '@/lib/line-diff'
import { reviewFor } from '@/api/mock/data/review'

const changed = (words: { text: string; changed: boolean }[] | undefined) =>
  words?.filter((w) => w.changed).map((w) => w.text)

describe("the review's Text diff", () => {
  it('shows what was removed before what was added', () => {
    const rows = lineDiff('a\nold\nc', 'a\nnew\nc')
    expect(rows.map((r) => r.t)).toEqual([' ', '-', '+', ' '])
  })

  it('numbers each line on its own side', () => {
    const rows = lineDiff('a\nold\nc', 'a\nnew\nmore\nc')
    expect(rows.map((r) => [r.t, r.a, r.b])).toEqual([
      [' ', 1, 1],
      ['-', 2, undefined],
      ['+', undefined, 2],
      ['+', undefined, 3],
      [' ', 3, 4],
    ])
  })

  it('marks only the words that changed: 312 to 340, not the whole sentence', () => {
    const r = reviewFor('sug-ines')!
    const rows = lineDiff(r.source.before, r.source.after)
    const removed = rows.find((x) => x.t === '-')!
    const added = rows.find((x) => x.t === '+')!
    expect(changed(removed.words)).toEqual(['312'])
    expect(changed(added.words)![0]).toBe('340')
    // The added sentence is one run, not a box per word, and its link stays whole.
    expect(changed(added.words)![1]).toBe(
      ' From 1 October 2026 the 28 [@ id="term:Test account" label="accounts"] the returns team uses to test refunds are left out as well.',
    )
    expect(rows.indexOf(removed)).toBeLessThan(rows.indexOf(added))
  })

  it("diffs a link's address by its parts", () => {
    const [, after] = wordDiff(
      'Source: [Units sold](https://wiki.example/units-sold)',
      'Source: [Units sold](https://wiki.example/units-sold-october)',
    )
    expect(changed(after)).toEqual(['-october'])
  })

  it('never splits a mention, even when only its words differ', () => {
    const [before, after] = wordDiff(
      'See [@ id="term:A" label="test account"] here',
      'See [@ id="term:A" label="test accounts"] here',
    )
    expect(changed(before)).toEqual(['[@ id="term:A" label="test account"]'])
    expect(changed(after)).toEqual(['[@ id="term:A" label="test accounts"]'])
  })

  it('marks words only when at least half of them are shared: a rewrite reads as whole lines', () => {
    expect(sharedWords('one two three four', 'one two three five')).toBe(0.75)
    const edit = lineDiff('Orders fell in Spain this week.', 'Orders rose in Spain this week.')
    expect(edit.every((r) => r.words)).toBe(true)
    const rewrite = lineDiff(
      'Before you explain a jump, check the file dates.',
      'Compare whole weeks with the same weeks last year, Monday to Sunday.',
    )
    expect(rewrite.map((r) => r.t)).toEqual(['-', '+'])
    expect(rewrite.some((r) => r.words)).toBe(false)
  })

  it('reads a new text as all added, and an archived one as all removed', () => {
    expect(lineDiff('', 'a\nb').map((r) => r.t)).toEqual(['+', '+'])
    expect(lineDiff('a\nb', '').map((r) => r.t)).toEqual(['-', '-'])
    expect(diffStats(lineDiff('', 'a\n\nb'))).toEqual({ added: 3, removed: 0, changes: 1 })
  })
})

describe('the hunks of the Text diff', () => {
  const text = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`)

  it('keeps three lines around a change and folds the rest', () => {
    const before = text(20)
    const after = [...before]
    after[9] = 'line ten'
    const parts = hunks(lineDiff(before.join('\n'), after.join('\n')))
    expect(parts.map((p) => [p.t, p.rows.length])).toEqual([
      ['fold', 6],
      ['same', 3],
      ['change', 2],
      ['same', 3],
      ['fold', 7],
    ])
  })

  it('numbers the changes for N and P, and keeps a short stretch between two changes open', () => {
    const before = text(8)
    const after = [...before]
    after[0] = 'first'
    after[7] = 'last'
    const parts = hunks(lineDiff(before.join('\n'), after.join('\n')))
    expect(parts.map((p) => p.t)).toEqual(['change', 'same', 'change'])
    expect(parts.flatMap((p) => (p.t === 'change' ? [p.n] : []))).toEqual([0, 1])
  })

  it('never folds a single line', () => {
    const before = text(8)
    const after = [...before]
    after[4] = 'five'
    const parts = hunks(lineDiff(before.join('\n'), after.join('\n')))
    expect(parts.map((p) => p.t)).toEqual(['same', 'change', 'same'])
  })

  it('folds a text with no change into one fold', () => {
    const t = text(5).join('\n')
    expect(hunks(lineDiff(t, t)).map((p) => p.t)).toEqual(['fold'])
  })

  it('loses no line, and leaves no change folded, whatever the two texts', () => {
    const lines = fc.array(fc.constantFrom('a', 'b', 'c', 'd', ''), { maxLength: 30 })
    fc.assert(
      fc.property(lines, lines, (a, b) => {
        const rows = lineDiff(a.join('\n'), b.join('\n'))
        const parts = hunks(rows)
        expect(parts.flatMap((p) => p.rows)).toEqual(rows)
        for (const p of parts)
          if (p.t !== 'change') expect(p.rows.every((r) => r.t === ' ')).toBe(true)
        // The text after is the unchanged and added lines, in order.
        expect(rows.filter((r) => r.t !== '-').map((r) => r.line)).toEqual(
          b.length && b.join('\n') ? b.join('\n').split('\n') : [],
        )
      }),
    )
  })
})
