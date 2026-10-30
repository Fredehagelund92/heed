import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  coarseStates,
  mondayOf,
  piecesOf,
  summaryPeriod,
  summaryView,
  trendWeeks,
  weekSpan,
  type Coarse,
  type Span,
  type SummaryCounts,
  type SummaryView,
} from '../../../src/domain/obs-summary.ts'
import { shiftDate } from '../../../src/domain/validity.ts'

/*
  Observability's Summary (FR-614, FR-620): the last whole calendar month or quarter, its trend in
  whole weeks, and one disclosure pass over every number on the page, so no count from one to just
  under the minimum is shown or can be worked out from what is.
*/

const min = 5

/** The pieces of a Summary as of `today`, each day's calls given by `day`. */
function countsOf(
  kind: 'month' | 'quarter',
  today: string,
  day: (d: string) => Coarse,
  open: number[] = [],
): SummaryCounts {
  const { now, before } = summaryPeriod(kind, today)
  const weeks = trendWeeks(now)
  const pieces = piecesOf([now, before, ...weeks.map(weekSpan)]).map((p) => {
    const counts: Coarse = { checked: 0, warned: 0, missing: 0 }
    for (let d = p.start; d < p.end; d = shiftDate(d, 1))
      for (const k of coarseStates) counts[k] += day(d)[k]
    return { ...p, counts }
  })
  return { pieces, now, before, weeks, open }
}

const fine = (n: number) => n === 0 || n >= min
const inside = (p: Span, s: Span) => p.start >= s.start && p.end <= s.end

/**
 * What a reader can work out from a Summary, independently of `disclose`: every sum the page's
 * numbers are (a span over its pieces, a span and a piece over its three ways, what found nothing
 * over the open spots and the rest), solved one unknown at a time. No count under the minimum may
 * come out of it that the page hides.
 */
function expectNothingWorkedOut(input: SummaryCounts, view: SummaryView) {
  const value = new Map<string, number>()
  const known = new Map<string, number>()
  const sums: [string, string[]][] = []
  const total = (c: Coarse) => c.checked + c.warned + c.missing
  input.pieces.forEach((p, i) => {
    value.set(`p${i}`, total(p.counts))
    for (const k of coarseStates) value.set(`p${i}:${k}`, p.counts[k])
    sums.push([`p${i}`, coarseStates.map((k) => `p${i}:${k}`)])
  })
  function span(id: string, s: Span, shown: Partial<Record<string, number | null>>) {
    const mine = input.pieces.map((p, i) => ({ p, i })).filter(({ p }) => inside(p, s))
    value.set(
      id,
      mine.reduce((n, { p }) => n + total(p.counts), 0),
    )
    sums.push([id, mine.map(({ i }) => `p${i}`)])
    sums.push([id, coarseStates.map((k) => `${id}:${k}`)])
    for (const k of coarseStates) {
      value.set(
        `${id}:${k}`,
        mine.reduce((n, { p }) => n + p.counts[k], 0),
      )
      sums.push([`${id}:${k}`, mine.map(({ i }) => `p${i}:${k}`)])
    }
    for (const [k, n] of Object.entries(shown))
      if (n !== null && n !== undefined) known.set(k === 'asked' ? id : `${id}:${k}`, n)
  }
  span('n', input.now, view.now)
  if (input.before && view.before) span('b', input.before, view.before)
  view.weeks.forEach((w) => span(`w${w.start}`, weekSpan(w.start), { checked: w.checked }))
  if (input.open.length) {
    input.open.forEach((v, i) => {
      value.set(`o${i}`, v)
      if (view.open[i] !== null) known.set(`o${i}`, view.open[i]!)
    })
    value.set('o:rest', value.get('n:missing')! - input.open.reduce((a, b) => a + b, 0))
    sums.push(['n:missing', [...input.open.map((_, i) => `o${i}`), 'o:rest']])
  }
  for (const [id, n] of known) expect(n, `${id} shows its own value`).toBe(value.get(id))
  for (let changed = true; changed;) {
    changed = false
    for (const [whole, parts] of sums) {
      const unknown = parts.filter((p) => !known.has(p))
      if (!unknown.length && !known.has(whole)) {
        known.set(whole, value.get(whole)!)
        changed = true
      } else if (unknown.length === 1 && known.has(whole)) {
        known.set(unknown[0]!, value.get(unknown[0]!)!)
        changed = true
      }
    }
  }
  for (const [id, n] of known) expect(fine(n), `${id} works out to ${n}`).toBe(true)
}

describe('summaryPeriod', () => {
  it('reads the last whole calendar month, and the month before it', () => {
    expect(summaryPeriod('month', '2026-10-23')).toEqual({
      now: { start: '2026-09-01', end: '2026-10-01' },
      before: { start: '2026-08-01', end: '2026-09-01' },
    })
    // On the first of a month, the month that ended yesterday.
    expect(summaryPeriod('month', '2026-10-01').now).toEqual({
      start: '2026-09-01',
      end: '2026-10-01',
    })
    expect(summaryPeriod('month', '2027-01-15')).toEqual({
      now: { start: '2026-12-01', end: '2027-01-01' },
      before: { start: '2026-11-01', end: '2026-12-01' },
    })
  })

  it('reads the last whole calendar quarter, and the quarter before it', () => {
    expect(summaryPeriod('quarter', '2026-10-23')).toEqual({
      now: { start: '2026-07-01', end: '2026-10-01' },
      before: { start: '2026-04-01', end: '2026-07-01' },
    })
    expect(summaryPeriod('quarter', '2026-09-30').now).toEqual({
      start: '2026-04-01',
      end: '2026-07-01',
    })
    expect(summaryPeriod('quarter', '2027-02-10')).toEqual({
      now: { start: '2026-10-01', end: '2027-01-01' },
      before: { start: '2026-07-01', end: '2026-10-01' },
    })
  })
})

describe('trendWeeks and piecesOf', () => {
  it('draws the last 13 whole weeks the period ends by, Monday to Sunday', () => {
    const weeks = trendWeeks({ start: '2026-09-01', end: '2026-10-01' })
    expect(weeks).toHaveLength(13)
    expect(weeks.at(-1)).toBe('2026-09-21')
    expect(weeks[0]).toBe('2026-06-29')
    for (const w of weeks) expect(mondayOf(w)).toBe(w)
    // A period that ends on a Monday ends with the week before it.
    expect(trendWeeks({ start: '2026-05-01', end: '2026-06-01' }).at(-1)).toBe('2026-05-25')
  })

  it('cuts the days at every Monday and every edge, each piece inside one week', () => {
    const now = { start: '2026-09-01', end: '2026-10-01' }
    const pieces = piecesOf([now, weekSpan('2026-08-24')])
    expect(pieces[0]).toEqual({
      start: '2026-08-24',
      end: '2026-08-31',
      week: '2026-08-24',
      whole: true,
    })
    expect(pieces[1]).toEqual({
      start: '2026-08-31',
      end: '2026-09-01',
      week: '2026-08-31',
      whole: false,
    })
    expect(pieces.at(-1)).toEqual({
      start: '2026-09-28',
      end: '2026-10-01',
      week: '2026-09-28',
      whole: false,
    })
    for (const [i, p] of pieces.entries()) {
      if (i) expect(p.start).toBe(pieces[i - 1]!.end)
      expect(p.end <= shiftDate(p.week, 7)).toBe(true)
      expect(inside(p, now) || p.end <= now.start || p.start >= now.end).toBe(true)
    }
  })
})

describe('summaryView', () => {
  it('shows every number of a busy month, each the sum of its days', () => {
    const day = (d: string) => {
      const n = Number(d.slice(8))
      return { checked: 10 + (n % 7), warned: 2 + (n % 3), missing: 2 + (n % 4) }
    }
    const input = countsOf('month', '2026-10-23', day, [39, 27, 18])
    const view = summaryView(input, min)
    expect(view.hidden).toBe(0)
    let checked = 0
    for (let d = '2026-09-01'; d < '2026-10-01'; d = shiftDate(d, 1)) checked += day(d).checked
    expect(view.now.checked).toBe(checked)
    expect(view.weeks.every((w) => w.checked !== null)).toBe(true)
    expect(view.open).toEqual([39, 27, 18])
    expectNothingWorkedOut(input, view)
  })

  it("keeps the period's own count and hides an open spot's before it", () => {
    // Every week of the trend shows; the one open spot's 28 would leave 2 of what found nothing.
    const input = countsOf(
      'month',
      '2026-10-23',
      () => ({ checked: 6, warned: 0, missing: 1 }),
      [28],
    )
    const view = summaryView(input, min)
    expect(view.now).toEqual({ asked: 210, checked: 180, warned: 0, missing: 30 })
    expect(view.weeks.every((w) => w.checked === 42)).toBe(true)
    expect(view.open).toEqual([null])
    expect(view.hidden).toBe(1)
    expectNothingWorkedOut(input, view)
  })

  it("hides a small count at the period's edge, which no week of the trend covers", () => {
    // Three calls with a warning on the last three days of September: the only piece of the
    // month outside the trend's whole weeks, so September's own count with a warning is 3.
    const input = countsOf('month', '2026-10-23', (d) =>
      d >= '2026-09-28' && d < '2026-10-01'
        ? { checked: 6, warned: 1, missing: 0 }
        : { checked: 6, warned: 0, missing: 0 },
    )
    const view = summaryView(input, min)
    expect(view.now.warned).toBeNull()
    expect(view.now.asked).toBe(183)
    expectNothingWorkedOut(input, view)
  })

  it('hides a small count in the period, and what would give it away', () => {
    const input = countsOf('month', '2026-10-23', (d) =>
      d === '2026-09-15'
        ? { checked: 9, warned: 0, missing: 3 }
        : d >= '2026-09-01' && d < '2026-10-01'
          ? { checked: 1, warned: 0, missing: 0 }
          : { checked: 0, warned: 0, missing: 0 },
    )
    const view = summaryView(input, min)
    expect(view.now.asked).toBe(41)
    expect(view.now.missing).toBeNull()
    expect(view.now.checked).toBeNull()
    expectNothingWorkedOut(input, view)
  })

  it('holds for any counts, as of any day', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('month', 'quarter'),
        fc.integer({ min: 0, max: 700 }),
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 21, maxLength: 21 }),
        fc.array(fc.integer({ min: 0, max: 40 }), { maxLength: 3 }),
        (kind, offset, pattern, open) => {
          const today = shiftDate('2026-01-01', offset)
          // A day's calls repeat every week, with a little more on some days of the period.
          const day = (d: string) => {
            const i = new Date(`${d}T00:00:00Z`).getUTCDay() * 3
            return { checked: pattern[i]!, warned: pattern[i + 1]!, missing: pattern[i + 2]! }
          }
          const input = countsOf(kind, today, day)
          const missing = input.pieces
            .filter((p) => inside(p, input.now))
            .reduce((n, p) => n + p.counts.missing, 0)
          let left = missing
          const spots = open.map((v) => {
            const take = Math.min(v, left)
            left -= take
            return take
          })
          const withOpen = { ...input, open: spots }
          const view = summaryView(withOpen, min)
          for (const n of [
            ...Object.values(view.now),
            ...Object.values(view.before ?? {}),
            ...view.weeks.map((w) => w.checked),
            ...view.open,
          ])
            if (n !== null) expect(fine(n)).toBe(true)
          expectNothingWorkedOut(withOpen, view)
        },
      ),
      { numRuns: 200 },
    )
  })
})
