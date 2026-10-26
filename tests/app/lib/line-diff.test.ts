import { describe, expect, it } from 'vitest'
import { lineDiff } from '@/lib/line-diff'
import { reviewFor } from '@/data/review'

describe("the Source view's diff", () => {
  it('shows what was removed before what was added', () => {
    const rows = lineDiff('a\nold\nc', 'a\nnew\nc')
    expect(rows.map((r) => r.t)).toEqual([' ', '-', '+', ' '])
  })

  it('marks only the words that changed: 312 to 340, not the whole sentence', () => {
    const r = reviewFor('sug-ines')!
    const rows = lineDiff(r.source.before, r.source.after)
    const removed = rows.find((x) => x.t === '-' && x.line.includes('312'))!
    const added = rows.find((x) => x.t === '+' && x.line.includes('340'))!
    expect(removed.words!.filter((w) => w.changed).map((w) => w.text)).toEqual(['312'])
    expect(added.words!.filter((w) => w.changed).map((w) => w.text)[0]).toBe('340')
    // The added sentence is one run, not a box per word.
    expect(added.words!.filter((w) => w.changed)[1].text).toBe(
      ' From 1 October 2026 the 28 accounts the returns team uses to test refunds are left out as well.',
    )
    expect(rows.indexOf(removed)).toBeLessThan(rows.indexOf(added))
  })

  it("diffs a link's address by its parts", () => {
    const r = reviewFor('sug-ines')!
    const rows = lineDiff(r.source.before, r.source.after)
    const added = rows.find((x) => x.t === '+' && x.line.startsWith('Source'))!
    expect(added.words!.filter((w) => w.changed).map((w) => w.text)).toEqual(['-october'])
  })
})
