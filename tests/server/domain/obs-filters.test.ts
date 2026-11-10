import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ANY_VALUE,
  counter,
  dimensionOf,
  dimensionRows,
  filterFits,
  meets,
  passes,
  searchable,
  valuePage,
  valueSearch,
  VALUE_PAGE,
  type Disclosed,
  type FilterTopic,
  type ObsFilter,
  type ObsTerm,
} from '../../../src/domain/obs-filters.ts'
import {
  sumCounts,
  topicView,
  type StateCounts,
  type TopicCounts,
} from '../../../src/domain/observability.ts'

/*
  Observability's filters by dimension (FR-620): a dimension first, then its values, counted by
  what agents asked in the range. Every count is what the topics' shown counts add up to (FR-614):
  with a filter on and off, two counts differ by shown counts only, so subtracting one from the
  other never gives a hidden count away.
*/

const min = 5
const counts = (grounded: number, missing = 0): StateCounts => ({
  grounded,
  partial: 0,
  conflict: 0,
  stale: 0,
  missing,
})

type Row = {
  id: string
  domain: string | null
  subject?: string
  month?: string
  metrics?: string[]
  values?: string[]
  dimensions?: string[]
  counts: StateCounts
}

/** The rows through topicView, as the service does, then as the filters read them. */
function viewOf(rows: readonly Row[]): Disclosed {
  const counted: TopicCounts[] = rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    subject: r.subject ?? r.id,
    counts: r.counts,
  }))
  const view = topicView(counted, min, { bars: [] })
  const shown = new Map(view.topics.map((t) => [t.id, t]))
  return {
    topics: rows.map((r): FilterTopic => {
      const t = shown.get(r.id)!
      return {
        id: r.id,
        domain: r.domain,
        subject: r.subject ?? r.id,
        month: r.month ?? '2026-10',
        metrics: r.metrics ?? ['metric:orders'],
        values: r.values ?? [],
        dimensions: r.dimensions ?? [],
        answers: [],
        notFound: false,
        reported: false,
        gap: null,
        total: t.total,
        atLeast: t.atLeast,
        counts: t.counts,
      }
    }),
    subjects: view.subjects,
    domains: view.domains,
  }
}

const term = (key: string, name: string, aliases: string[] = []): ObsTerm => ({
  key,
  name,
  aliases,
})

describe('a filter', () => {
  it("takes a dimension's own values or any value, and what a fixed field takes", () => {
    const fits = (key: string, ...values: string[]) => filterFits({ key, values })
    expect(fits('dim:channel', 'val:channel/webshop', ANY_VALUE)).toBe(true)
    // A value of another dimension is not one of this dimension's.
    expect(fits('dim:channel', 'val:market/norway')).toBe(false)
    expect(fits('dim:channel', 'webshop')).toBe(false)
    expect(fits('dim:channel')).toBe(false)
    expect(fits('metric', 'metric:orders', 'group:payments')).toBe(true)
    expect(fits('metric', 'Orders')).toBe(false)
    expect(fits('month', '2026-10')).toBe(true)
    expect(fits('month', '2026-13')).toBe(false)
    expect(fits('answer', 'missing', 'stale')).toBe(true)
    expect(fits('answer', 'failed')).toBe(false)
    expect(fits('gap', 'draft')).toBe(true)
    expect(fits('reported', 'maybe')).toBe(false)
    expect(fits('market', 'Norway')).toBe(false)
  })

  it('reads the dimension of a value from its key', () => {
    expect(dimensionOf('val:product_line/tents')).toBe('dim:product_line')
    expect(dimensionOf('metric:orders')).toBeNull()
  })

  it('keeps topics by value, by any value of a dimension, by "is not" and by fixed fields', () => {
    const view = viewOf([
      { id: 'webshop', domain: 'sales', values: ['val:channel/webshop'], counts: counts(20) },
      { id: 'by-channel', domain: 'sales', dimensions: ['dim:channel'], counts: counts(8) },
      {
        id: 'stores-norway',
        domain: 'sales',
        values: ['val:channel/stores', 'val:market/norway'],
        counts: counts(7),
        month: '2026-09',
      },
      { id: 'returns', domain: 'finance', metrics: ['metric:returns'], counts: counts(9) },
    ])
    const ids = (...filters: ObsFilter[]) =>
      view.topics.filter((t) => passes(t, filters)).map((t) => t.id)
    expect(ids({ key: 'dim:channel', values: ['val:channel/webshop'] })).toEqual(['webshop'])
    // Any value: a topic that names the dimension at all, with a value or "by" it.
    expect(ids({ key: 'dim:channel', values: [ANY_VALUE] })).toEqual([
      'webshop',
      'by-channel',
      'stores-norway',
    ])
    // Is not, with any value: the topics that never name it.
    expect(ids({ key: 'dim:channel', not: true, values: [ANY_VALUE] })).toEqual(['returns'])
    expect(ids({ key: 'dim:channel', not: true, values: ['val:channel/webshop'] })).toEqual([
      'by-channel',
      'stores-norway',
      'returns',
    ])
    expect(
      ids(
        { key: 'dim:channel', values: [ANY_VALUE] },
        { key: 'dim:market', values: ['val:market/norway'] },
      ),
    ).toEqual(['stores-norway'])
    expect(ids({ key: 'metric', values: ['metric:returns'] })).toEqual(['returns'])
    expect(ids({ key: 'domain', not: true, values: ['sales'] })).toEqual(['returns'])
    expect(ids({ key: 'month', values: ['2026-09'] })).toEqual(['stores-norway'])
    // A count without its own filter: the filter on `skip` is left out.
    const topic = view.topics.find((t) => t.id === 'returns')!
    expect(passes(topic, [{ key: 'dim:channel', values: [ANY_VALUE] }], 'dim:channel')).toBe(true)
  })
})

describe('counts with filters on and off', () => {
  // Norway: asked 20 times on the webshop and 3 times in the stores. The 3 is hidden.
  const view = viewOf([
    {
      id: 'norway-webshop',
      domain: 'sales',
      values: ['val:market/norway', 'val:channel/webshop'],
      counts: counts(20),
    },
    {
      id: 'norway-stores',
      domain: 'sales',
      values: ['val:market/norway', 'val:channel/stores'],
      counts: counts(3),
    },
    { id: 'sweden', domain: 'sales', values: ['val:market/sweden'], counts: counts(12) },
  ])
  const market = term('dim:market', 'Market')
  const markets = [term('val:market/norway', 'Norway'), term('val:market/sweden', 'Sweden')]
  const norway = (filters: ObsFilter[]) =>
    valuePage(view, filters, market, markets, { q: '', sort: 'asked' }).values.find(
      (v) => v.key === 'val:market/norway',
    )!.asked

  it('never gives a hidden count away by subtracting a filtered count from an unfiltered one', () => {
    expect(view.topics.find((t) => t.id === 'norway-stores')!.total).toBeNull()
    const off = norway([])
    const on = norway([{ key: 'dim:channel', values: ['val:channel/webshop'] }])
    // Counted on its own, Norway is 23 and the webshop's Norway 20: 23 - 20 would be the hidden 3.
    // Its total is the shown counts added up instead, "20+", so nothing can be subtracted.
    expect(off).toEqual({ topics: 2, total: null, atLeast: 20 })
    expect(on).toEqual({ topics: 1, total: 20, atLeast: 20 })
    // The dimension's own count, without the value filter, is never 35: Sweden's 12 is hidden
    // too (else 35 less 20 and 12 would be the 3), so it is "20+".
    expect(view.topics.find((t) => t.id === 'sweden')!.total).toBeNull()
    const rows = dimensionRows(
      view,
      [{ key: 'dim:market', values: ['val:market/norway'] }],
      [market],
      new Map([[market.key, markets]]),
    )
    expect(rows[0]!.asked).toEqual({ topics: 3, total: null, atLeast: 20 })
  })

  it("uses a whole domain's or subject's own total when every one of its topics is in", () => {
    // A subject over two months, each asked 3 times: both months hidden, the subject's 6 shown.
    const months = viewOf([
      {
        id: 'oct',
        domain: 'sales',
        subject: 's',
        values: ['val:market/norway'],
        counts: counts(3),
      },
      {
        id: 'sep',
        domain: 'sales',
        subject: 's',
        values: ['val:market/norway'],
        counts: counts(3),
      },
      { id: 'third', domain: 'sales', values: ['val:market/sweden'], counts: counts(8) },
      { id: 'other', domain: 'finance', values: ['val:market/sweden'], counts: counts(9) },
    ])
    const count = counter(months)
    const by = (...ids: string[]) => months.topics.filter((t) => ids.includes(t.id))
    expect(count.asked(by('oct', 'sep'))).toEqual({ topics: 2, total: 6, atLeast: 6 })
    // The whole domain: its own total.
    expect(count.asked(by('oct', 'sep', 'third'))).toEqual({ topics: 3, total: 14, atLeast: 14 })
    // One month alone is hidden: no number, not even "0+" of it.
    expect(count.asked(by('oct'))).toEqual({ topics: 1, total: null, atLeast: 0 })
    expect(count.asked(by('oct', 'other'))).toEqual({ topics: 2, total: null, atLeast: 9 })
  })

  it('gives a total only when shown counts of whole groups inside the set add up to it', () => {
    const arbitrary = fc.array(
      fc.record({
        domain: fc.constantFrom('a', 'b', null),
        subject: fc.integer({ min: 0, max: 4 }),
        calls: fc.oneof(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 40 })),
        missing: fc.integer({ min: 0, max: 6 }),
        values: fc.subarray(['val:d/x', 'val:d/y', 'val:e/z']),
      }),
      { minLength: 1, maxLength: 12 },
    )
    fc.assert(
      fc.property(
        arbitrary,
        fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
        (raw, pick) => {
          // A subject is one domain's: the months of one scope.
          const rows: Row[] = raw.map((r, i) => ({
            id: `t${i}`,
            domain: r.domain,
            subject: `${r.domain}|${r.subject}`,
            values: r.values,
            counts: counts(r.calls, r.missing),
          }))
          if (rows.every((r) => sumCounts(r.counts) === 0)) return
          const view = viewOf(rows)
          const truth = new Map(rows.map((r) => [r.id, sumCounts(r.counts)]))
          const set = view.topics.filter((_, i) => pick[i])
          const ids = new Set(set.map((t) => t.id))
          const got = counter(view).asked(set)
          const real = set.reduce((n, t) => n + truth.get(t.id)!, 0)
          expect(got.atLeast).toBeLessThanOrEqual(real)
          if (got.total === null) return
          expect(got.total).toBe(real)
          // Every topic of the set is in a group the reader was shown whole, inside the set: so the
          // total is no more than the reader could add up from what Overview shows.
          for (const t of set) {
            const subject = view.subjects.find((s) => s.key === t.subject)!
            const domain = view.domains.find((d) => d.domain === t.domain)!
            const inside = (list: readonly string[]) => list.every((id) => ids.has(id))
            const covered =
              t.total !== null ||
              (subject.total !== null && inside(subject.topics)) ||
              (domain.total !== null &&
                inside(view.topics.filter((x) => x.domain === t.domain).map((x) => x.id)))
            expect(covered, `topic ${t.id}`).toBe(true)
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('the dimensions and their values', () => {
  const channel = term('dim:channel', 'Channel')
  const campaign = term('dim:campaign', 'Campaign')
  const store = term('dim:store', 'Store')
  const stores = Array.from({ length: 60 }, (_, i) =>
    term(`val:store/s${String(i).padStart(2, '0')}`, `Store ${String(i).padStart(2, '0')}`),
  )
  const valuesOf = new Map<string, ObsTerm[]>([
    [
      channel.key,
      [term('val:channel/webshop', 'Webshop', ['Online']), term('val:channel/stores', 'Stores')],
    ],
    [store.key, stores],
  ])
  const view = viewOf([
    { id: 'web', domain: 'sales', values: ['val:channel/webshop'], counts: counts(40) },
    { id: 'by-campaign', domain: 'sales', dimensions: ['dim:campaign'], counts: counts(15) },
    ...stores.slice(0, 55).map((s, i) => ({
      id: `store-${i}`,
      domain: 'stores',
      values: [s.key],
      counts: counts(5 + i),
    })),
  ])

  it('lists every dimension, the most asked first, each without its own filter', () => {
    const rows = dimensionRows(
      view,
      [{ key: 'dim:channel', values: ['val:channel/stores'] }],
      [campaign, channel, store],
      valuesOf,
    )
    expect(rows.map((d) => [d.name, d.values, d.asked.topics])).toEqual([
      ['Channel', 2, 1],
      // The channel filter keeps no topic of Store or Campaign.
      ['Campaign', 0, 0],
      ['Store', 60, 0],
    ])
    // Unfiltered, Store is the most asked.
    expect(dimensionRows(view, [], [campaign, channel, store], valuesOf)[0]!.name).toBe('Store')
  })

  it('says how many values of each dimension were asked about, as many as its values step finds', () => {
    // So the filter keeps a row for each before they are read, and no row moves when they come.
    for (const filters of [[], [{ key: 'dim:channel', values: ['val:channel/stores'] }]])
      for (const row of dimensionRows(view, filters, [campaign, channel, store], valuesOf)) {
        const d = [campaign, channel, store].find((x) => x.key === row.key)!
        const page = valuePage(view, filters, d, valuesOf.get(d.key) ?? [], {
          q: '',
          sort: 'asked',
        })
        expect(row.valuesAsked).toBe(page.matched)
      }
    expect(
      dimensionRows(view, [], [campaign, channel, store], valuesOf).map((d) => [
        d.name,
        d.valuesAsked,
      ]),
    ).toEqual([
      ['Store', 55],
      ['Channel', 1],
      ['Campaign', 0],
    ])
  })

  it('answers "any value" alone for a dimension the definitions give no values', () => {
    const page = valuePage(view, [], campaign, [], { q: '', sort: 'asked' })
    expect(page).toEqual({
      dimension: { key: 'dim:campaign', name: 'Campaign' },
      asked: { topics: 1, total: 15, atLeast: 15 },
      values: [],
      matched: 0,
      notAsked: 0,
      nextCursor: null,
    })
  })

  it('pages a dimension 50 values at a time, the most asked first or A to Z', () => {
    const first = valuePage(view, [], store, stores, { q: '', sort: 'asked' })
    expect(first.values).toHaveLength(VALUE_PAGE)
    expect(first.values[0]!.name).toBe('Store 54')
    expect(first).toMatchObject({ matched: 55, notAsked: 5, nextCursor: '50' })
    const next = valuePage(view, [], store, stores, { q: '', sort: 'asked', cursor: '50' })
    expect(next.values.map((v) => v.name)).toEqual([
      'Store 04',
      'Store 03',
      'Store 02',
      'Store 01',
      'Store 00',
    ])
    expect(next.nextCursor).toBeNull()
    const az = valuePage(view, [], store, stores, { q: '', sort: 'name' })
    expect(az.values[0]!.name).toBe('Store 00')
  })

  it('finds a value by its name or another name, and says how many match but were not asked', () => {
    expect(
      valuePage(view, [], channel, valuesOf.get(channel.key)!, { q: 'onl', sort: 'asked' }).values,
    ).toEqual([
      { key: 'val:channel/webshop', name: 'Webshop', asked: { topics: 1, total: 40, atLeast: 40 } },
    ])
    const stored = valuePage(view, [], channel, valuesOf.get(channel.key)!, {
      q: 'stores',
      sort: 'asked',
    })
    expect(stored).toMatchObject({ values: [], matched: 0, notAsked: 1 })
  })

  it('does not count a value another filter left out as not asked', () => {
    const wsView = viewOf([
      {
        id: 'no-web',
        domain: 'sales',
        values: ['val:market/norway', 'val:channel/webshop'],
        counts: counts(20),
      },
      {
        id: 'se-stores',
        domain: 'sales',
        values: ['val:market/sweden', 'val:channel/stores'],
        counts: counts(12),
      },
    ])
    const market = term('dim:market', 'Market')
    const markets = [
      term('val:market/norway', 'Norway'),
      term('val:market/sweden', 'Sweden'),
      term('val:market/denmark', 'Denmark'),
    ]
    const filters: ObsFilter[] = [{ key: 'dim:channel', values: ['val:channel/webshop'] }]
    const page = valuePage(wsView, filters, market, markets, { q: '', sort: 'asked' })
    expect(page.values.map((v) => v.key)).toEqual(['val:market/norway'])
    expect(page.notAsked).toBe(1)
    const search = (q: string) =>
      valueSearch(wsView, filters, [market], new Map([[market.key, markets]]), { q, sort: 'asked' })
    expect(search('den').notAsked).toBe(1)
    expect(search('swe').notAsked).toBe(0)
  })

  it('matches nothing for a search of punctuation alone, and everything for an empty one', () => {
    const terms = [term('val:channel/webshop', 'Webshop'), term('val:channel/stores', 'Stores')]
    expect(terms.filter(meets('--'))).toEqual([])
    expect(terms.filter(meets(''))).toEqual(terms)
    expect(searchable('--')).toBe(false)
    expect(searchable('a-')).toBe(false)
    expect(searchable('ab')).toBe(true)
    expect(searchable('7 -')).toBe(false)
  })

  it('searches every dimension, grouped by dimension, the first few values of each', () => {
    const found = valueSearch(view, [], [campaign, channel, store], valuesOf, {
      q: 'store',
      sort: 'asked',
    })
    expect(found.groups.map((g) => [g.dimension.name, g.values.length, g.matched])).toEqual([
      ['Store', 3, 55],
    ])
    expect(found.groups[0]!.nextCursor).toBe('3')
    // The Stores channel and 5 stores match but were not asked about.
    expect(found.notAsked).toBe(6)
    expect(found.nextCursor).toBeNull()
  })
})
