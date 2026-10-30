import { describe, expect, it } from 'vitest'
import {
  caughtLines,
  notComparedWords,
  periodName,
  shareWords,
  summaryNumbers,
  summarySentences,
  type SummaryData,
} from '@/model/obs-summary'

// Summary's words (model/obs-summary.ts): fixed templates over counts the binding already
// disclosed. A share is a whole per cent from 100 questions, words from 30, nothing below; a move
// is up or down only beyond what chance would make; a sentence shows only when its count does.

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)

function data(over: Partial<SummaryData> = {}): SummaryData {
  return {
    state: 'normal',
    period: 'month',
    last: day(2026, 10, 22),
    now: { start: day(2026, 9, 1), end: day(2026, 10, 1) },
    before: { start: day(2026, 8, 1), end: day(2026, 9, 1) },
    since: day(2026, 4, 17),
    complete: true,
    numbers: { asked: 532, checked: 335, warned: 82, missing: 115 },
    previous: { asked: 483, checked: 290, missing: 110 },
    notCompared: null,
    weeks: [],
    open: { total: 3, spots: [] },
    changes: { total: 1, before: 1, latest: [] },
    hidden: 0,
    ...over,
  }
}

describe('periodName', () => {
  it('names a month, a quarter, and a quarter across a year', () => {
    expect(periodName({ start: day(2026, 9, 1), end: day(2026, 10, 1) })).toBe('September 2026')
    expect(periodName({ start: day(2026, 7, 1), end: day(2026, 10, 1) })).toBe(
      'July to September 2026',
    )
    expect(periodName({ start: day(2026, 12, 1), end: day(2027, 3, 1) })).toBe(
      'December 2026 to February 2027',
    )
  })
})

describe('shareWords', () => {
  it('gives a whole per cent from 100 questions, words from 30, and nothing below', () => {
    expect(shareWords(335, 532)).toBe('63%')
    expect(shareWords(31, 47)).toBe('about two in three')
    expect(shareWords(15, 30)).toBe('about half')
    expect(shareWords(0, 40)).toBe('none')
    expect(shareWords(40, 40)).toBe('all')
    expect(shareWords(20, 29)).toBeNull()
    expect(shareWords(null, 532)).toBeNull()
    expect(shareWords(5, null)).toBeNull()
  })
})

describe('summaryNumbers', () => {
  it('says about the same for a move chance would make, with no per cent', () => {
    const s = summaryNumbers(data())
    expect(s.askedMove).toEqual({ direction: 'same', words: 'About the same' })
    expect(s.checkedShare).toBe('63%')
    expect(s.checkedMove?.direction).toBe('same')
  })

  it('moves a share in points only when both periods give it in per cent', () => {
    const up = summaryNumbers(
      data({ previous: { asked: 500, checked: 250, missing: 110 } }),
    ).checkedMove
    expect(up).toEqual({ direction: 'up', words: '+13 pts' })
    const words = summaryNumbers(
      data({
        numbers: { asked: 90, checked: 80, warned: 5, missing: 5 },
        previous: { asked: 90, checked: 40, missing: 40 },
      }),
    ).checkedMove
    expect(words).toEqual({ direction: 'up', words: 'Higher' })
  })

  it('compares nothing too small, hidden, or with no period before', () => {
    const small = summaryNumbers(
      data({
        numbers: { asked: 20, checked: 15, warned: 0, missing: 5 },
        previous: { asked: 9, checked: 5, missing: 0 },
      }),
    )
    expect(small.askedMove).toBeNull()
    expect(small.checkedMove).toBeNull()
    expect(small.checkedShare).toBeNull()
    const none = summaryNumbers(data({ previous: null, notCompared: 'started' }))
    expect(none.askedMove).toBeNull()
    expect(none.askedBefore).toBeNull()
  })
})

describe('summarySentences', () => {
  it('says the period in fixed sentences over its counts', () => {
    expect(summarySentences(data())).toEqual([
      'Agents asked 532 questions in September 2026, about the same as in August 2026 (483).',
      '335 (63%) had an answer fully based on checked context.',
      '115 found nothing written down; 3 topics like that are still open.',
      'One change was approved by an owner and published.',
    ])
  })

  it('leaves out a sentence whose count is hidden, and never says a count under 5', () => {
    const lines = summarySentences(
      data({
        numbers: { asked: 47, checked: null, warned: 0, missing: null },
        previous: null,
        notCompared: 'started',
        open: { total: 0, spots: [] },
        changes: { total: 0, before: 0, latest: [] },
      }),
    )
    expect(lines).toEqual([
      'Agents asked 47 questions in September 2026.',
      'No change was approved and published in September 2026.',
    ])
    expect(
      summarySentences(data({ numbers: { asked: 532, checked: 3, warned: 0, missing: 0 } }))[1],
    ).toBe('Fewer than 5 (1%) had an answer fully based on checked context.')
  })
})

describe('caughtLines', () => {
  it('keeps three separate lines, two of them not measured yet, and never a total', () => {
    const lines = caughtLines(data())
    expect(lines.map((l) => [l.key, l.measured])).toEqual([
      ['warned', true],
      ['saved', false],
      ['alerts', false],
    ])
    expect(lines[0]!.text).toMatch(/^82 answers went out with a warning/)
    expect(lines[1]!.text).toMatch(/^Not measured yet\./)
    for (const l of lines) expect(l.text).not.toMatch(/prevent/i)
    expect(
      caughtLines(data({ numbers: { asked: 9, checked: 9, warned: 0, missing: 0 } }))[0]!.text,
    ).toBe('No answer went out with a warning.')
  })
})

describe('notComparedWords', () => {
  it('says why the period before is not compared', () => {
    expect(
      notComparedWords(
        data({
          period: 'quarter',
          notCompared: 'started',
          previous: null,
          now: { start: day(2026, 7, 1), end: day(2026, 10, 1) },
          before: { start: day(2026, 4, 1), end: day(2026, 7, 1) },
        }),
      ),
    ).toBe('No comparison with April to June 2026: agents first asked on 17 Apr 2026.')
    expect(notComparedWords(data({ notCompared: 'not_kept', previous: null }))).toBe(
      'No comparison with August 2026: its records are no longer all kept.',
    )
    expect(notComparedWords(data())).toBeNull()
  })
})
