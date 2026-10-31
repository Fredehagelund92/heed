import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  caughtTriggers,
  coarseStates,
  mondayOf,
  noCaught,
  piecesOf,
  summaryPeriod,
  summaryView,
  trendWeeks,
  weekSpan,
  type CaughtCounts,
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
  since: string | null = null,
): SummaryCounts {
  const { now, before } = summaryPeriod(kind, today)
  const weeks = trendWeeks(now)
  const pieces = piecesOf([now, before, ...weeks.map(weekSpan)]).map((p) => {
    const counts: Coarse = { checked: 0, warned: 0, missing: 0 }
    for (let d = p.start; d < p.end; d = shiftDate(d, 1))
      for (const k of coarseStates) counts[k] += day(d)[k]
    return { ...p, counts }
  })
  return {
    pieces,
    now,
    before,
    weeks,
    open,
    since,
    changes: { now: 0, before: 0 },
    caught: noCaught(),
  }
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
    // The page says when agents first asked: what ends on or before that day is known to be zero.
    if (input.since !== null && p.end <= input.since && total(p.counts) === 0) {
      known.set(`p${i}`, 0)
      for (const k of coarseStates) known.set(`p${i}:${k}`, 0)
    }
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

  it('knows what lies before the first day agents asked is zero, and hides what that gives away', () => {
    // September 2026 starts on a Tuesday, and agents first asked on 2 September: the page says so,
    // so 31 August and 1 September are zero for a reader. Every full week of the trend is shown;
    // the last three days, in no week of the trend, hold 3 checked answers, which September's own
    // count would give away as what the weeks leave over.
    const day = (d: string) =>
      d < '2026-09-02'
        ? { checked: 0, warned: 0, missing: 0 }
        : d >= '2026-09-28' && d < '2026-10-01'
          ? { checked: 1, warned: 0, missing: 0 }
          : { checked: 6, warned: 0, missing: 0 }
    const input = countsOf('month', '2026-10-23', day, [], '2026-09-02')
    const view = summaryView(input, min)
    expect(view.now.checked).toBeNull()
    expect(view.now.asked).toBe(26 * 6 + 3)
    expectNothingWorkedOut(input, view)
    // Without the first day, the same numbers leave a reader nothing to add: the checker, which
    // knows the first day, would find the count under 5 in what is shown.
    const unaware = summaryView({ ...input, since: null }, min)
    expect(unaware.now.checked).not.toBeNull()
    expect(() => expectNothingWorkedOut(input, unaware)).toThrow()
  })

  it('hides a change count under the minimum and keeps one that is not', () => {
    const input = countsOf('month', '2026-10-23', () => ({ checked: 6, warned: 0, missing: 0 }))
    expect(summaryView({ ...input, changes: { now: 2, before: 4 } }, min).changes).toEqual({
      now: null,
      before: null,
    })
    expect(summaryView({ ...input, changes: { now: 0, before: 12 } }, min).changes).toEqual({
      now: 0,
      before: 12,
    })
    const view = summaryView({ ...input, changes: { now: 2, before: 4 } }, min)
    expect(view.hidden).toBe(2)
  })

  it('shows what was caught as its own lines, apart from what was asked', () => {
    const input = countsOf('month', '2026-10-23', () => ({ checked: 6, warned: 1, missing: 1 }))
    const caught: CaughtCounts = {
      saved: { publish: 7, archive: 0, restore: 0, sync: 5, check_date: 0 },
      alerts: { raised: 9, acted: 6 },
    }
    const view = summaryView({ ...input, caught }, min)
    expect(view.caught).toEqual({
      saved: {
        total: 12,
        triggers: { publish: 7, archive: 0, restore: 0, sync: 5, check_date: 0 },
      },
      alerts: { raised: 9, acted: 6 },
    })
    // The rest of the page is as it was without them.
    expect(view.now).toEqual(summaryView(input, min).now)
    expect(view.hidden).toBe(summaryView(input, min).hidden)
  })

  it("keeps a saved question's count and hides its kinds of change first", () => {
    const input = countsOf('month', '2026-10-23', () => ({ checked: 6, warned: 0, missing: 0 }))
    const saved = { publish: 7, archive: 1, restore: 0, sync: 6, check_date: 1 }
    const view = summaryView({ ...input, caught: { ...noCaught(), saved } }, min)
    // 1 and 1 are hidden; their 2 would come out of 15 less 7 and 6, so 6 is hidden too.
    expect(view.caught.saved).toEqual({
      total: 15,
      triggers: { publish: 7, archive: null, restore: 0, sync: null, check_date: null },
    })
    const small = summaryView(
      { ...input, caught: { ...noCaught(), saved: { ...noCaught().saved, publish: 3 } } },
      min,
    )
    expect(small.caught.saved.total).toBeNull()
    expect(small.caught.saved.triggers.publish).toBeNull()
  })

  it('hides an alert count under the minimum, each on its own', () => {
    const input = countsOf('month', '2026-10-23', () => ({ checked: 6, warned: 0, missing: 0 }))
    const view = summaryView(
      { ...input, caught: { ...noCaught(), alerts: { raised: 8, acted: 3 } } },
      min,
    )
    expect(view.caught.alerts).toEqual({ raised: 8, acted: null })
    const none = summaryView(
      { ...input, caught: { ...noCaught(), alerts: { raised: 3, acted: 0 } } },
      min,
    )
    expect(none.caught.alerts).toEqual({ raised: null, acted: 0 })
    expect(none.hidden).toBe(summaryView(input, min).hidden + 1)
  })

  it('never lets the kinds of change give a small one away', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 12 }), { minLength: 5, maxLength: 5 }),
        (values) => {
          const input = countsOf('month', '2026-10-23', () => ({
            checked: 6,
            warned: 0,
            missing: 0,
          }))
          const saved = Object.fromEntries(
            caughtTriggers.map((t, i) => [t, values[i]!]),
          ) as CaughtCounts['saved']
          const view = summaryView({ ...input, caught: { ...noCaught(), saved } }, min).caught.saved
          const total = values.reduce((a, b) => a + b, 0)
          if (fine(total)) expect(view.total).toBe(total)
          else expect(view.total).toBeNull()
          const shown = caughtTriggers.filter((t) => view.triggers[t] !== null)
          for (const t of shown) expect(fine(view.triggers[t]!)).toBe(true)
          // What the hidden kinds add up to, from the total less those shown, is never small.
          if (view.total !== null) {
            const rest = view.total - shown.reduce((n, t) => n + view.triggers[t]!, 0)
            expect(fine(rest)).toBe(true)
            const hidden = caughtTriggers.filter((t) => view.triggers[t] === null)
            expect(hidden.length === 1 && values[caughtTriggers.indexOf(hidden[0]!)]! > 0).toBe(
              false,
            )
          }
        },
      ),
      { numRuns: 200 },
    )
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
        fc.integer({ min: -20, max: 150 }),
        (kind, offset, pattern, open, first) => {
          const today = shiftDate('2026-01-01', offset)
          // A day's calls repeat every week, with a little more on some days of the period.
          // Agents first asked on `since`: nothing before it.
          const since = shiftDate(summaryPeriod(kind, today).before.start, first)
          const day = (d: string) => {
            if (d < since) return { checked: 0, warned: 0, missing: 0 }
            const i = new Date(`${d}T00:00:00Z`).getUTCDay() * 3
            return { checked: pattern[i]!, warned: pattern[i + 1]!, missing: pattern[i + 2]! }
          }
          const input = countsOf(kind, today, day, [], since)
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
