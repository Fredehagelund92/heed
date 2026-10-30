import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { changeWords, diffStats, hunks, isBreak, lineDiff, wordDiff } from '@/lib/line-diff'
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
      'From 1 October 2026 the 28 [@ id="term:Test account" label="accounts"] the returns team uses to test refunds are left out as well.',
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
    expect(diffStats(lineDiff('', 'a\n\nb'))).toEqual({ sentences: 2, changes: 1 })
  })
})

describe('the words of a changed block', () => {
  // The France guide's suggestion: its paragraph split after the first sentence, a few words
  // changed, and a sentence on refunds added.
  const r = reviewFor('sug-ines-long')!
  const rows = lineDiff(r.source.before, r.source.after)
  const side = (t: '-' | '+') => rows.filter((x) => x.t === t)

  it('compares a split paragraph across its lines, marking only the words that changed', () => {
    expect(rows.map((x) => x.t)).toEqual(['-', '+', '+', '+'])
    expect(rows.every((x) => x.words)).toBe(true)
    // The first sentence moved to its own line, and stays plain on both sides.
    const [first, , rest] = side('+')
    expect(changed(first!.words)).toEqual([])
    expect(changed(side('-')[0]!.words)).toEqual([
      'weekend files together',
      'those late',
      ', not',
      'a full week',
      'week',
    ])
    expect(changed(rest!.words)).toEqual([
      "Saturday's file",
      "Sunday and Sunday's on",
      'arriving late rather than more',
      'Then check refunds: a batch of refunds booked on one day reads as a drop.',
      'whole weeks, Monday to Sunday,',
      'weeks',
    ])
  })

  it('reads the blank line between the two paragraphs as a paragraph break', () => {
    expect(side('+').map(isBreak)).toEqual([false, true, false])
    expect(isBreak(side('-')[0]!)).toBe(false)
  })

  it('says how many sentences changed: the two reworded, and the one added', () => {
    expect(diffStats(rows)).toEqual({ sentences: 3, changes: 1 })
    expect(changeWords(diffStats(rows))).toBe('3 sentences changed')
  })

  it('marks nothing when nothing changed', () => {
    const t = 'One line.\n\nAnother line.'
    expect(lineDiff(t, t).every((x) => x.t === ' ' && !x.words)).toBe(true)
    expect(
      wordDiff(t, t)
        .flat()
        .every((w) => !w.changed),
    ).toBe(true)
  })

  it('reads a whole replacement as whole lines', () => {
    const whole = lineDiff('Orders fell in Spain.', 'Margins rose in Norway last week.')
    expect(whole.map((x) => x.t)).toEqual(['-', '+'])
    expect(whole.some((x) => x.words)).toBe(false)
    expect(diffStats(whole).sentences).toBe(1)
  })

  it('keeps words that moved to another line plain, wherever they went', () => {
    const joined = lineDiff(
      'Check the file dates.\n\nThen check refunds.',
      'Check the file dates, then check refunds.',
    )
    expect(joined.filter((x) => x.t === '-').map((x) => changed(x.words))).toEqual([
      ['.'],
      [],
      ['Then'],
    ])
    expect(changed(joined.find((x) => x.t === '+')!.words)).toEqual([', then'])
  })

  it('marks a change of punctuation alone, and counts its sentence', () => {
    const rows = lineDiff('Check the dates, then refunds.', 'Check the dates; then refunds.')
    expect(changed(rows[0]!.words)).toEqual([','])
    expect(changed(rows[1]!.words)).toEqual([';'])
    expect(changeWords(diffStats(rows))).toBe('1 sentence changed')
  })

  it('marks the one repeated word that was added, not the ones that stay', () => {
    const [, after] = wordDiff('the week and the week', 'the week and the week and the week')
    expect(changed(after)).toEqual(['and the week'])
  })

  it('reads letters beyond English as words, and keeps them whole', () => {
    const [before, after] = wordDiff('Commandes en été à Zürich', 'Commandes en hiver à Zürich 🚚')
    expect(changed(before)).toEqual(['été'])
    expect(changed(after)).toEqual(['hiver', '🚚'])
  })

  it('shows a block too long to compare as whole lines, and says so', () => {
    const long = (w: string) => Array.from({ length: 1200 }, (_, i) => `${w}${i}`).join(' ')
    const rows = lineDiff(long('a'), long('b'))
    expect(rows.some((x) => x.words)).toBe(false)
    expect(rows.every((x) => x.long)).toBe(true)
    expect(lineDiff('a b', 'a c').some((x) => x.long)).toBe(false)
  })

  it('says a change of spacing alone in words', () => {
    expect(changeWords(diffStats(lineDiff('a\nb', 'a\n\nb')))).toBe('Spacing changed')
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
