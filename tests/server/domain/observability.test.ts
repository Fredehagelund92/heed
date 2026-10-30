import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  barsOf,
  beforeView,
  disclose,
  shownParts,
  shownStates,
  topicView,
  weeklyView,
  type Quantity,
  type StateCounts,
  type TopicCounts,
  type WeekCounts,
} from '../../../src/domain/observability.ts'

/*
  What a reader may see of Observability's counts (FR-614, FR-620): a count from one to just under
  the minimum is hidden, and no count is shown when a hidden one could be worked out from it by
  subtraction. The properties hold for any counts: every count a reader can know leaves out
  nothing, or at least the minimum, of each way it splits.
*/

const min = 5
const counts = (c: number[]): StateCounts => ({
  grounded: c[0]!,
  partial: c[1]!,
  conflict: c[2]!,
  stale: c[3]!,
  missing: c[4]!,
})
const row = (id: string, domain: string | null, subject: string, c: number[]): TopicCounts => ({
  id,
  domain,
  subject,
  counts: counts(c),
})

/** The mockup's demo week: sixteen topics, Germany asked about two months. */
const week = [
  row('orders-norway', 'sales', 'orders|norway', [20, 1, 0, 2, 1]),
  row('orders-norway-sep', 'sales', 'orders|norway', [6, 1, 0, 0, 0]),
  row('net-revenue-norway', 'sales', 'net|norway', [9, 1, 2, 0, 1]),
  row('net-revenue-norway-sep', 'sales', 'net|norway', [3, 0, 1, 0, 0]),
  row('revenue-norway', 'sales', 'revenue|norway', [5, 0, 0, 0, 0]),
  row('units-sold-all', 'sales', 'units|all', [11, 0, 0, 0, 1]),
  row('norway-no-metric', null, '|norway', [4, 1, 0, 0, 0]),
  row('discount-black-friday', 'marketing', 'discount|bf', [10, 1, 0, 3, 0]),
  row('orders-poland', 'sales', 'orders|poland', [4, 2, 0, 1, 6]),
  row('orders-spain', 'sales', 'orders|spain', [1, 2, 0, 0, 9]),
  row('orders-germany', 'sales', 'orders|germany', [0, 0, 0, 0, 3]),
  row('orders-germany-nov', 'sales', 'orders|germany', [0, 0, 0, 0, 3]),
  row('cpa-germany', 'marketing', 'cpa|germany', [8, 1, 1, 0, 0]),
  row('new-customers-norway', 'customer_value', 'customers|norway', [5, 1, 0, 0, 0]),
  row('roas-sweden', 'paid_media', 'roas|sweden', [5, 0, 0, 1, 0]),
  row('repeat-purchases-all', 'customer_value', 'repeat|all', [3, 1, 0, 0, 1]),
]

const fine = (n: number) => n === 0 || n >= min
const left = (total: number, parts: (number | null)[]) =>
  total - parts.reduce<number>((a, b) => a + (b ?? 0), 0)

/**
 * What a reader can work out from a view, independently of `disclose`: every sum the page shows
 * (a topic over its states, a subject over its months and its states, a domain over its subjects,
 * everything over the domains), solved one unknown at a time. No count under the minimum may come
 * out of it that the view hides.
 */
function expectNothingWorkedOut(rows: readonly TopicCounts[], view: ReturnType<typeof topicView>) {
  const value = new Map<string, number>()
  const known = new Map<string, number>()
  const sums: [string, string[]][] = []
  const total = (c: StateCounts) => shownStates.reduce((n, s) => n + c[s], 0)
  const byTopic = new Map(view.topics.map((t) => [t.id, t]))
  for (const r of rows) {
    value.set(`t:${r.id}`, total(r.counts))
    const shown = byTopic.get(r.id)!
    if (shown.total !== null) known.set(`t:${r.id}`, shown.total)
    for (const s of shownStates) {
      value.set(`t:${r.id}:${s}`, r.counts[s])
      if (shown.counts[s] !== null) known.set(`t:${r.id}:${s}`, shown.counts[s])
    }
    sums.push([`t:${r.id}`, shownStates.map((s) => `t:${r.id}:${s}`)])
  }
  for (const g of view.subjects) {
    if (g.topics.length === 1) continue
    const list = rows.filter((r) => g.topics.includes(r.id))
    value.set(
      `s:${g.key}`,
      list.reduce((n, r) => n + total(r.counts), 0),
    )
    if (g.total !== null) known.set(`s:${g.key}`, g.total)
    for (const s of shownStates) {
      value.set(
        `s:${g.key}:${s}`,
        list.reduce((n, r) => n + r.counts[s], 0),
      )
      if (g.counts[s] !== null) known.set(`s:${g.key}:${s}`, g.counts[s])
    }
    sums.push([`s:${g.key}`, g.topics.map((id) => `t:${id}`)])
    sums.push([`s:${g.key}`, shownStates.map((s) => `s:${g.key}:${s}`)])
  }
  const subjectId = (g: (typeof view.subjects)[number]) =>
    g.topics.length === 1 ? `t:${g.topics[0]}` : `s:${g.key}`
  for (const d of view.domains) {
    const id = `d:${d.domain}`
    value.set(
      id,
      rows.filter((r) => r.domain === d.domain).reduce((n, r) => n + total(r.counts), 0),
    )
    if (d.total !== null) known.set(id, d.total)
    sums.push([id, view.subjects.filter((g) => g.domain === d.domain).map(subjectId)])
  }
  value.set(
    'all',
    rows.reduce((n, r) => n + total(r.counts), 0),
  )
  // Everything asked shows on Overview, unless it is under the minimum (then nothing shows).
  if (fine(value.get('all')!)) known.set('all', value.get('all')!)
  sums.push(['all', view.domains.map((d) => `d:${d.domain}`)])
  for (let changed = true; changed;) {
    changed = false
    for (const [whole, parts] of sums) {
      const unknown = parts.filter((p) => !known.has(p))
      if (!unknown.length && !known.has(whole)) {
        known.set(
          whole,
          parts.reduce((n, p) => n + known.get(p)!, 0),
        )
        changed = true
      } else if (unknown.length === 1 && known.has(whole)) {
        known.set(unknown[0]!, value.get(unknown[0]!)!)
        changed = true
      }
    }
  }
  for (const [id, n] of known) expect(fine(n) || id === 'all', `${id} works out to ${n}`).toBe(true)
}

/** Every count shown is zero or at least the minimum, and every shown total leaves out a safe part. */
function expectSafe(rows: readonly TopicCounts[], view: ReturnType<typeof topicView>) {
  expectNothingWorkedOut(rows, view)
  const byId = new Map(view.topics.map((t) => [t.id, t]))
  for (const t of view.topics) {
    for (const n of [t.total, ...Object.values(t.counts)])
      if (n !== null) expect(fine(n)).toBe(true)
    if (t.total !== null) expect(fine(left(t.total, Object.values(t.counts)))).toBe(true)
  }
  for (const s of view.subjects) {
    for (const n of [s.total, ...Object.values(s.counts)])
      if (n !== null) expect(fine(n)).toBe(true)
    if (s.total === null) continue
    expect(
      fine(
        left(
          s.total,
          s.topics.map((id) => byId.get(id)!.total),
        ),
      ),
    ).toBe(true)
    expect(fine(left(s.total, Object.values(s.counts)))).toBe(true)
  }
  for (const d of view.domains) {
    if (d.total === null) continue
    expect(fine(d.total)).toBe(true)
    const subjects = view.subjects.filter((s) => s.domain === d.domain)
    const known = subjects.map(
      (s) => s.total ?? s.topics.reduce((n, id) => n + (byId.get(id)!.total ?? 0), 0),
    )
    expect(fine(left(d.total, known))).toBe(true)
  }
  // Everything asked is always counted when it reaches the minimum (else nothing is shown): what
  // the shown domains leave out is safe, or spread over at least two hidden counts.
  const all = rows.reduce((n, r) => n + Object.values(r.counts).reduce((a, b) => a + b, 0), 0)
  const rest = left(
    all,
    view.domains.map((d) => d.total ?? d.atLeast),
  )
  const hidden = view.topics.flatMap((t) => Object.values(t.counts)).filter((n) => n === null)
  expect(all < min || fine(rest) || hidden.length >= 2).toBe(true)
}

describe('disclose', () => {
  it('hides a count from one to just under the minimum, and shows zero', () => {
    const shown = disclose(
      [0, 1, 4, 5, 9].map((value, i) => ({ id: `q${i}`, value, parts: [] })),
      min,
    )
    expect([...shown].sort()).toEqual(['q0', 'q3', 'q4'])
  })

  it('hides a total that would give a hidden part away, unless it keeps it by hiding a part', () => {
    const parts: Quantity[] = [
      { id: 'a', value: 13, parts: [] },
      { id: 'b', value: 4, parts: [] },
    ]
    expect(disclose([...parts, { id: 't', value: 17, parts: [['a', 'b']] }], min)).toEqual(
      new Set(['a']),
    )
    expect(
      disclose([...parts, { id: 't', value: 17, keep: [0], parts: [['a', 'b']] }], min),
    ).toEqual(new Set(['t']))
  })

  it('never hides an anchor to keep another count safe, and hides a small one itself', () => {
    const parts: Quantity[] = [
      { id: 'a', value: 3, parts: [] },
      { id: 'b', value: 6, parts: [] },
    ]
    // The 3 hidden under 9 would show as 9 - 6: the 6 goes, the 9 stays.
    expect(
      disclose([...parts, { id: 'all', value: 9, anchor: true, parts: [['a', 'b']] }], min),
    ).toEqual(new Set(['all']))
    expect(
      disclose(
        [
          { id: 'a', value: 3, parts: [] },
          { id: 'all', value: 3, anchor: true, parts: [['a']] },
        ],
        min,
      ).size,
    ).toBe(0)
  })

  it('works a part out from its total and the other parts, and hides what would give it away', () => {
    // 6 asked, none found anything: what found nothing is the 6, so it may show; but 4 of 9 is not.
    const shown = disclose(
      [
        { id: 'found', value: 0, parts: [] },
        { id: 'nothing', value: 4, parts: [] },
        { id: 'asked', value: 4, parts: [['found', 'nothing']] },
      ],
      min,
    )
    expect(shown.has('nothing')).toBe(false)
    // A total of 9 over a shown 5 and a hidden 4 gives the 4 away: the total goes.
    expect(
      disclose(
        [
          { id: 'a', value: 5, parts: [] },
          { id: 'b', value: 4, parts: [] },
          { id: 't', value: 9, parts: [['a', 'b']] },
        ],
        min,
      ),
    ).toEqual(new Set(['a']))
  })

  it('hides a count that would differ from the same count over every agent by a hidden one', () => {
    expect(disclose([{ id: 'cursor', value: 5, whole: 7, parts: [] }], min).size).toBe(0)
    expect(disclose([{ id: 'cursor', value: 5, whole: 10, parts: [] }], min).size).toBe(1)
  })
})

describe('topicView', () => {
  it('counts the demo week as the mockup draws it, without giving a small count away', () => {
    const view = topicView(week, min)
    const topic = (id: string) => view.topics.find((t) => t.id === id)!
    const subject = (key: string) => view.subjects.find((s) => s.key === key)!
    // Orders in Norway: 24 and 7, so 31; one call found nothing, hidden with what gives it away.
    expect(subject('orders|norway')).toMatchObject({ total: 31, atLeast: 31 })
    expect(topic('orders-norway')).toMatchObject({ total: 24 })
    expect(topic('orders-norway').counts.missing).toBeNull()
    // Net revenue in Norway: September was asked 4 times, so the total reads "13+".
    expect(subject('net|norway')).toMatchObject({ total: null, atLeast: 13 })
    // Orders in Spain found nothing 9 times: that stays, so the 12 it was asked hides instead.
    expect(topic('orders-spain')).toMatchObject({ total: null, atLeast: 9 })
    expect(topic('orders-spain').counts.missing).toBe(9)
    // Sales keeps its 96: what its shown counts leave out (Net revenue's September and what Spain
    // found) is 7, two hidden counts, so Germany's two months of 3 can show their 6.
    expect(view.domains.find((d) => d.domain === 'sales')!.total).toBe(96)
    expect(subject('orders|germany')).toMatchObject({ total: 6, atLeast: 6 })
    expectSafe(week, view)
  })

  it('holds for any counts', () => {
    const arbitraryRow = fc.record({
      domain: fc.constantFrom('a', 'b', null),
      subject: fc.integer({ min: 0, max: 5 }),
      counts: fc.array(fc.oneof(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 30 })), {
        minLength: 5,
        maxLength: 5,
      }),
    })
    fc.assert(
      fc.property(fc.array(arbitraryRow, { minLength: 1, maxLength: 14 }), (raw) => {
        // A subject belongs to one domain, as a scope's area is part of it.
        const rows = raw.map((r, i) => row(`t${i}`, r.domain, `${r.domain}|${r.subject}`, r.counts))
        expectSafe(rows, topicView(rows, min))
      }),
      { numRuns: 300 },
    )
  })

  it('hides what one kind of agent asked when the others asked a hidden count', () => {
    const rows = [
      { ...row('sweden', 'sales', 's', [40, 0, 0, 0, 0]), whole: counts([42, 0, 0, 0, 0]) },
    ]
    const bars = [
      { start: 'd', days: 1, counts: counts([40, 0, 0, 0, 0]), whole: counts([42, 0, 0, 0, 0]) },
    ]
    expect(topicView(rows, min, { bars }).asked).toBeNull()
  })

  it('narrows to one kind of agent without giving the others away', () => {
    const rows = [
      { ...row('sweden', 'sales', 's', [5, 0, 0, 0, 0]), whole: counts([7, 0, 0, 0, 0]) },
      { ...row('norway', 'sales', 'n', [20, 0, 0, 0, 0]), whole: counts([40, 0, 0, 0, 0]) },
    ]
    const view = topicView(rows, min)
    expect(view.topics.map((t) => t.total)).toEqual([null, 20])
  })
})

describe('topicView with its chart', () => {
  /** The days of the demo week, each split over the topics in the order they come. */
  const chartOf = (rows: readonly TopicCounts[], days: number) => {
    const bars = Array.from({ length: days }, (_, i) => ({
      start: `2026-10-${16 + i}`,
      days: 1,
      counts: counts([0, 0, 0, 0, 0]),
    }))
    let at = 0
    for (const r of rows)
      for (const s of shownStates)
        for (let k = 0; k < r.counts[s]; k++) bars[at++ % days]!.counts[s] += 1
    return bars
  }

  /** What the chart shows leaves nothing hidden that a shown count gives away. */
  function expectSafeChart(view: ReturnType<typeof topicView>) {
    for (const n of [
      ...Object.values(view.counts),
      ...view.bars.flatMap((b) => Object.values(b.counts)),
    ])
      if (n !== null) expect(fine(n)).toBe(true)
    expect(fine(left(view.asked!, Object.values(view.counts)))).toBe(true)
    for (const s of shownStates) {
      const n = view.counts[s]
      if (n === null) continue
      expect(
        fine(
          left(
            n,
            view.bars.map((b) => b.counts[s]),
          ),
        ),
      ).toBe(true)
      const bySubject = view.subjects.map((g) => g.counts[s])
      expect(fine(left(n, bySubject))).toBe(true)
    }
  }

  it('keeps everything asked and what found nothing, and hides a state or a bar before either', () => {
    const view = topicView(week, min, { bars: chartOf(week, 7) })
    expect(view.asked).toBe(142)
    expect(view.counts.missing).toBe(25)
    expect(view.counts.conflict).toBeNull()
    expectSafe(week, view)
    expectSafeChart(view)
  })

  it("narrows the chart to a domain, keeping the domain's count", () => {
    const sales = week.filter((r) => r.domain === 'sales')
    const view = topicView(week, min, { bars: chartOf(sales, 7), domain: 'sales' })
    expect(view.asked).toBe(96)
    expect(view.domains.find((d) => d.domain === 'sales')!.total).toBe(96)
    expectSafe(week, view)
  })

  it('holds for any counts and days', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            domain: fc.constantFrom('a', 'b'),
            subject: fc.integer({ min: 0, max: 4 }),
            counts: fc.array(fc.integer({ min: 0, max: 12 }), { minLength: 5, maxLength: 5 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        fc.integer({ min: 1, max: 9 }),
        (raw, days) => {
          const rows = raw.map((r, i) =>
            row(`t${i}`, r.domain, `${r.domain}|${r.subject}`, r.counts),
          )
          const view = topicView(rows, min, { bars: chartOf(rows, days) })
          if (view.asked! < min) return
          expectSafe(rows, view)
          expectSafeChart(view)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('beforeView', () => {
  it('keeps what was asked before, and what found nothing only when what found something shows', () => {
    expect(beforeView(counts([100, 2, 1, 0, 27]), min)).toEqual({ asked: 130, missing: 27 })
    expect(beforeView(counts([3, 0, 0, 0, 27]), min)).toEqual({ asked: 30, missing: null })
    expect(beforeView(counts([3, 0, 0, 0, 1]), min)).toEqual({ asked: null, missing: null })
    // One kind of agent: what the others asked may not be a hidden count either.
    expect(beforeView(counts([20, 0, 0, 0, 0]), min, counts([22, 0, 0, 0, 0]))).toEqual({
      asked: null,
      missing: null,
    })
    expect(beforeView(counts([20, 0, 0, 0, 5]), min, counts([30, 0, 0, 0, 5]))).toEqual({
      asked: 25,
      missing: 5,
    })
  })
})

describe('barsOf', () => {
  it('draws a bar a day, or a week a bar for 90 days with the oldest week short', () => {
    const days = Array.from({ length: 90 }, (_, i) => ({
      day: `d${String(i).padStart(2, '0')}`,
      counts: counts([1, 0, 0, 0, 0]),
    }))
    expect(barsOf(days.slice(0, 7), 7)).toHaveLength(7)
    const weeks = barsOf(days, 90)
    expect(weeks).toHaveLength(13)
    expect(weeks[0]).toMatchObject({ start: 'd00', days: 6 })
    expect(weeks.at(-1)).toMatchObject({ start: 'd83', days: 7 })
  })
})

describe('shownParts', () => {
  it('hides a small kind of agent, and a total that would give it away', () => {
    expect(shownParts([58, 41, 3], min)).toEqual({ parts: [58, 41, null], total: null })
    expect(shownParts([58, 41, 3, 2], min)).toEqual({ parts: [58, 41, null, null], total: 104 })
    // A total known anyway (the tool calls): a part goes, so the hidden ones are never 3 alone.
    expect(shownParts([58, 41, 3], min, { known: true })).toEqual({
      parts: [58, null, null],
      total: 102,
    })
  })
})

describe('weeklyView', () => {
  const at = (week: string, domain: string | null, c: number[], whole?: number[]): WeekCounts => ({
    week,
    domain,
    counts: counts(c),
    ...(whole ? { whole: counts(whole) } : {}),
  })

  /**
   * What a reader can work out from each week, independently of `disclose`: its total over its
   * answer states and over its domains, one unknown at a time. Nothing under the minimum comes out
   * of it, and no count shown is under it.
   */
  function expectWeeksSafe(rows: readonly WeekCounts[], view: ReturnType<typeof weeklyView>) {
    for (const w of view) {
      const mine = rows.filter((r) => r.week === w.week)
      const value = new Map<string, number>()
      const known = new Map<string, number>()
      const set = (id: string, shown: number | null, actual: number) => {
        value.set(id, actual)
        if (shown !== null) known.set(id, shown)
      }
      const total = (c: StateCounts) => shownStates.reduce((n, s) => n + c[s], 0)
      set(
        'w',
        w.total,
        mine.reduce((n, r) => n + total(r.counts), 0),
      )
      for (const s of shownStates)
        set(
          `w:${s}`,
          w.counts[s],
          mine.reduce((n, r) => n + r.counts[s], 0),
        )
      for (const [i, d] of w.domains.entries()) set(`d:${i}`, d.total, total(mine[i]!.counts))
      const sums: [string, string[]][] = [
        ['w', shownStates.map((s) => `w:${s}`)],
        ['w', w.domains.map((_, i) => `d:${i}`)],
      ]
      for (let changed = true; changed;) {
        changed = false
        for (const [whole, parts] of sums) {
          const unknown = parts.filter((p) => !known.has(p))
          if (!unknown.length && !known.has(whole)) {
            known.set(
              whole,
              parts.reduce((n, p) => n + known.get(p)!, 0),
            )
            changed = true
          } else if (unknown.length === 1 && known.has(whole)) {
            known.set(unknown[0]!, value.get(unknown[0]!)!)
            changed = true
          }
        }
      }
      for (const [id, n] of known) expect(fine(n), `${w.week} ${id} works out to ${n}`).toBe(true)
    }
  }

  it('counts every week asked for, an empty one as 0, and keeps the total before a small state', () => {
    const rows = [
      at('2026-10-05', 'sales', [20, 2, 0, 0, 0]),
      at('2026-10-05', 'marketing', [0, 0, 0, 0, 7]),
      at('2026-10-05', null, [0, 0, 0, 5, 0]),
    ]
    const view = weeklyView(['2026-09-28', '2026-10-05'], rows, min)
    expect(view[0]).toEqual({
      week: '2026-09-28',
      total: 0,
      counts: { grounded: 0, partial: 0, conflict: 0, stale: 0, missing: 0 },
      domains: [],
    })
    // 34 asked: 2 covered part of it, so a second state goes with it, never what found nothing.
    expect(view[1]).toMatchObject({ total: 34, counts: { partial: null, missing: 7 } })
    expect(view[1]!.domains.map((d) => d.total)).toEqual([22, 7, 5])
    expectWeeksSafe(rows, view)
  })

  it('hides a week asked fewer times than the minimum, and every count in it', () => {
    const view = weeklyView(['w'], [at('w', 'sales', [3, 0, 0, 0, 0])], min)
    expect(view[0]).toEqual({
      week: 'w',
      total: null,
      counts: { grounded: null, partial: 0, conflict: 0, stale: 0, missing: 0 },
      domains: [{ domain: 'sales', total: null }],
    })
  })

  it('narrows to one kind of agent without giving the others away', () => {
    const view = weeklyView(['w'], [at('w', 'sales', [6, 0, 0, 0, 0], [8, 0, 0, 0, 0])], min)
    expect(view[0]).toMatchObject({ total: null, counts: { grounded: null } })
    expect(view[0]!.domains[0]!.total).toBeNull()
  })

  it('holds for any counts', () => {
    const arbitraryRow = fc.record({
      week: fc.constantFrom('a', 'b'),
      domain: fc.constantFrom('x', 'y', 'z', null),
      counts: fc.array(fc.oneof(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 30 })), {
        minLength: 5,
        maxLength: 5,
      }),
    })
    fc.assert(
      fc.property(fc.array(arbitraryRow, { maxLength: 10 }), (raw) => {
        // One row a week and domain, as the service adds them up.
        const seen = new Set<string>()
        const rows = raw
          .filter((r) => !seen.has(`${r.week}|${r.domain}`) && seen.add(`${r.week}|${r.domain}`))
          .map((r) => at(r.week, r.domain, r.counts))
        const view = weeklyView(['a', 'b'], rows, min)
        for (const w of view)
          for (const n of [w.total, ...Object.values(w.counts), ...w.domains.map((d) => d.total)])
            if (n !== null) expect(fine(n)).toBe(true)
        expectWeeksSafe(rows, view)
      }),
      { numRuns: 300 },
    )
  })

  it('never shows a count of one kind of agent that differs from every agent by a hidden one', () => {
    const arbitraryRow = fc.record({
      domain: fc.constantFrom('x', 'y', null),
      counts: fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 5, maxLength: 5 }),
      others: fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 5, maxLength: 5 }),
    })
    fc.assert(
      fc.property(fc.array(arbitraryRow, { maxLength: 3 }), (raw) => {
        const seen = new Set<string | null>()
        const rows = raw
          .filter((r) => !seen.has(r.domain) && seen.add(r.domain))
          .map((r) =>
            at(
              'w',
              r.domain,
              r.counts,
              r.counts.map((n, i) => n + r.others[i]!),
            ),
          )
        const [w] = weeklyView(['w'], rows, min)
        const total = (c: StateCounts) => shownStates.reduce((n, s) => n + c[s], 0)
        const others = (f: (r: WeekCounts) => number, g: (r: WeekCounts) => number) =>
          rows.reduce((n, r) => n + f(r) - g(r), 0)
        if (w!.total !== null)
          expect(
            fine(
              others(
                (r) => total(r.whole!),
                (r) => total(r.counts),
              ),
            ),
          ).toBe(true)
        for (const s of shownStates)
          if (w!.counts[s] !== null)
            expect(
              fine(
                others(
                  (r) => r.whole![s],
                  (r) => r.counts[s],
                ),
              ),
            ).toBe(true)
        for (const [i, d] of w!.domains.entries())
          if (d.total !== null)
            expect(fine(total(rows[i]!.whole!) - total(rows[i]!.counts))).toBe(true)
      }),
      { numRuns: 300 },
    )
  })
})
