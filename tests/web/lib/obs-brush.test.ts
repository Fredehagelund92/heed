import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { shownStates, topicView, type TopicCounts } from '@domain/observability'
import { spanFrom, spanTo, spanWords } from '@/lib/obs-views'
import { observability, SHOWN, type Bar, type Shown } from '@/model/observability'

// Days chosen on Overview's chart: kept in the address as days, read back as the bars they fall in,
// and added up by the numbers from the bars as they show. A sum is only ever of counts the binding
// disclosed: a hidden one makes it "83+", never a number worked out from the others (FR-614).

const DAY = 86_400_000
const at = (day: string) => Date.parse(day)
/** Bars a day each, from a first day. */
const daily = (first: string, n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => ({
    label: `d${i}`,
    at: at(first) + i * DAY,
    counts: { grounded: 10, partial: null, conflict: 0, stale: 0, missing: 5 },
  }))
const q = (s: string) => new URLSearchParams(s)

describe('the days in the address', () => {
  const bars = daily('2026-10-01', 30)
  const last = at('2026-10-30')

  it('read a run of days, or one, as the bars they fall in', () => {
    expect(spanFrom(q('days=2026-10-12..2026-10-18'), bars, last)).toEqual({ from: 11, to: 17 })
    expect(spanFrom(q('days=2026-10-12'), bars, last)).toEqual({ from: 11, to: 11 })
    // Written the other way round, it is the same run.
    expect(spanFrom(q('days=2026-10-18..2026-10-12'), bars, last)).toEqual({ from: 11, to: 17 })
  })

  it('leave out days the range no longer has, and none left is no choice', () => {
    expect(spanFrom(q('days=2026-09-20..2026-10-03'), bars, last)).toEqual({ from: 0, to: 2 })
    expect(spanFrom(q('days=2026-10-29..2026-11-04'), bars, last)).toEqual({ from: 28, to: 29 })
    expect(spanFrom(q('days=2026-08-01..2026-08-09'), bars, last)).toBeNull()
    expect(spanFrom(q('days=2026-11-01'), bars, last)).toBeNull()
    expect(spanFrom(q('days=soon'), bars, last)).toBeNull()
    expect(spanFrom(q(''), bars, last)).toBeNull()
    expect(spanFrom(q('days=2026-10-12'), [], last)).toBeNull()
  })

  it('write the bars chosen back as their days, and say them in words', () => {
    expect(spanTo({ from: 11, to: 17 }, bars, last)).toBe('2026-10-12..2026-10-18')
    expect(spanTo({ from: 11, to: 11 }, bars, last)).toBe('2026-10-12')
    expect(spanTo(null, bars, last)).toBeUndefined()
    expect(spanWords({ from: 11, to: 17 }, bars, last)).toBe('12 to 18 Oct')
    expect(spanWords({ from: 11, to: 11 }, bars, last)).toBe('12 Oct')
    const across = daily('2026-09-28', 10)
    expect(spanWords({ from: 0, to: 6 }, across, at('2026-10-07'))).toBe('28 Sep to 4 Oct')
  })

  it('choose whole weeks over 90 days, the last one ending on the last day counted', () => {
    // Weeks counted back from the last day: the oldest is a few days short.
    const weeks: Bar[] = ['2026-08-01', '2026-08-04', '2026-08-11', '2026-08-18'].map((d) => ({
      label: d,
      at: at(d),
      counts: { grounded: 0, partial: 0, conflict: 0, stale: 0, missing: 0 },
    }))
    const end = at('2026-08-24')
    const span = spanFrom(q('days=2026-08-06..2026-08-12'), weeks, end)
    expect(span).toEqual({ from: 1, to: 2 })
    expect(spanTo(span, weeks, end)).toBe('2026-08-04..2026-08-17')
    expect(spanTo({ from: 3, to: 3 }, weeks, end)).toBe('2026-08-18..2026-08-24')
    expect(spanWords({ from: 1, to: 3 }, weeks, end)).toBe('4 to 24 Aug')
  })

  it('round-trip any run of bars', () => {
    fc.assert(
      fc.property(fc.nat({ max: 29 }), fc.nat({ max: 29 }), (a, b) => {
        const span = { from: Math.min(a, b), to: Math.max(a, b) }
        expect(spanFrom(q(`days=${spanTo(span, bars, last)}`), bars, last)).toEqual(span)
      }),
    )
  })
})

/* ---------- what the numbers add up ---------- */

const MIN = 5
/** The chart's data for some bars, nothing else. */
const withBars = (bars: Bar[]) =>
  observability({ bars, last: bars.at(-1)?.at ?? 0, topics: [], subjects: [] } as never)

describe('the bars chosen, added up', () => {
  it('are exact when every part shows, "83+" with a hidden one, and nothing when none shows', () => {
    const bars = daily('2026-10-01', 4)
    const obs = withBars(bars)
    // Checked and Not found show on every bar; Partial is hidden on every bar.
    expect(obs.barSum(0, 1, ['grounded', 'missing'])).toMatchObject({
      asked: { visible: 30, shown: 30 },
    })
    expect(obs.barSum(0, 3).asked).toEqual({ visible: null, shown: 60 })
    expect(obs.barSum(0, 3).state('grounded')).toEqual({ visible: 40, shown: 40 })
    expect(obs.barSum(0, 3).state('partial')).toEqual({ visible: null, shown: 0 })
    expect(obs.barSum(2, 2).state('conflict')).toEqual({ visible: 0, shown: 0 })
  })

  /** Topics asked on some days, with counts around the minimum so some are hidden. */
  const world = fc.array(
    fc.array(fc.array(fc.nat({ max: 6 }), { minLength: 5, maxLength: 5 }), {
      minLength: 6,
      maxLength: 6,
    }),
    { minLength: 1, maxLength: 5 },
  )

  it('never show more than the disclosed bars add up to, whatever the days and answers', () => {
    fc.assert(
      fc.property(
        world,
        fc.nat({ max: 5 }),
        fc.nat({ max: 5 }),
        fc.subarray([...SHOWN], { minLength: 1 }),
        (cells, a, b, states) => {
          // cells[topic][day][state]: each topic's counts and each day's bar from the same calls.
          const days = cells[0]!.length
          const counts = (c: number[]) =>
            Object.fromEntries(shownStates.map((s, j) => [s, c[j]!])) as TopicCounts['counts']
          const rows: TopicCounts[] = cells.map((t, i) => ({
            id: `t${i}`,
            domain: 'sales',
            subject: `s${i}`,
            counts: counts(shownStates.map((_, j) => t.reduce((n, d) => n + d[j]!, 0))),
          }))
          const raw = Array.from({ length: days }, (_, d) =>
            counts(shownStates.map((_, j) => cells.reduce((n, t) => n + t[d]![j]!, 0))),
          )
          const view = topicView(rows, MIN, {
            bars: raw.map((c, d) => ({ start: `2026-10-${10 + d}`, days: 1, counts: c })),
          })
          const bars: Bar[] = view.bars.map((x) => ({
            label: x.start,
            at: at(x.start),
            counts: x.counts,
          }))
          const obs = withBars(bars)
          const from = Math.min(a, b)
          const to = Math.max(a, b)
          const sums = obs.barSum(from, to, states)
          const truth = (ks: readonly Shown[]) =>
            raw.slice(from, to + 1).reduce((n, c) => n + ks.reduce((m, k) => m + c[k], 0), 0)
          const checks: [{ visible: number | null; shown: number }, readonly Shown[]][] = [
            [sums.asked, states],
            ...SHOWN.map((k) => [sums.state(k), [k]] as [typeof sums.asked, Shown[]]),
          ]
          for (const [got, ks] of checks) {
            // Exact only when it is the truth; else "at least", never more than there is.
            if (got.visible !== null) expect(got.visible).toBe(truth(ks))
            expect(got.shown).toBeLessThanOrEqual(truth(ks))
            // The sum is only ever of the cells that show.
            const shown = bars
              .slice(from, to + 1)
              .reduce((n, x) => n + ks.reduce((m, k) => m + (x.counts[k] ?? 0), 0), 0)
            expect(got.shown).toBe(shown)
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})
