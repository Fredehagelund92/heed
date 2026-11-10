import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { answersOf, shownStates, topicView, type TopicCounts } from '@domain/observability'
import {
  ANY,
  chipsFrom,
  chipsTo,
  chipSentence,
  facet,
  FIELD_KEYS,
  fromLegacy,
  MAX_CHIPS,
  moved,
  narrowed,
  opWords,
  passes,
  readDomain,
  toggled,
  wireFilters,
  withValues,
  type Chip,
  type DimKey,
  type FilterKey,
  type Filters,
} from '@/lib/obs-views'
import { rememberNames } from '@/lib/obs-names'
import {
  ALL_VALUES,
  observability,
  SHOWN,
  type ObsData,
  type Shown,
  type Topic,
} from '@/model/observability'

// Overview's filter bar: the chips as the address keeps them, how they change, and the facets'
// counts, which must never let a reader work out a hidden count (FR-614): every number a facet
// shows exactly is a sum of counts the binding disclosed, so it tells a reader nothing the
// disclosed counts did not.

const domains = {
  sales: { name: 'Sales' },
  marketing: { name: 'Marketing' },
} as unknown as Parameters<typeof chipSentence>[1]

/** The chips through the address and back, as a link or Back would carry them. */
const roundTrip = (chips: Filters) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(chipsTo(chips))) if (v) q.set(k, v)
  return chipsFrom(new URLSearchParams(q.toString()))
}

rememberNames([
  { key: 'dim:market', name: 'Market' },
  { key: 'val:market/norway', name: 'Norway' },
  { key: 'val:market/spain', name: 'Spain' },
  { key: 'dim:store', name: 'Store' },
])

describe('the chips in the address', () => {
  it('keep each field and each dimension in its own param, "!" for is not, and the order when it is not their own', () => {
    const chips: Filters = [
      { key: 'dim:market', not: true, values: ['val:market/norway'] },
      { key: 'answer', values: ['missing', 'partial'] },
    ]
    expect(chipsTo(chips)).toMatchObject({
      'd.market': '!norway',
      answer: 'missing,partial',
      chips: 'd.market,answer',
      domain: undefined,
      q: undefined,
    })
    expect(roundTrip(chips)).toEqual(chips)
    // In the fields' own order, then the dimensions A to Z, there is no `chips` param.
    expect(chipsTo([...chips].reverse()).chips).toBeUndefined()
    expect(chipsFrom(new URLSearchParams('d.store=*&d.market=spain,norway'))).toEqual([
      { key: 'dim:market', values: ['val:market/spain', 'val:market/norway'] },
      { key: 'dim:store', values: [ANY] },
    ])
  })

  it('clear a dimension taken off, and keep any value alone', () => {
    const now = new URLSearchParams('d.store=alder_row&d.market=norway&range=30')
    expect(chipsTo([{ key: 'dim:market', values: ['val:market/norway'] }], now)).toMatchObject({
      'd.store': undefined,
      'd.market': 'norway',
    })
    expect(chipsFrom(new URLSearchParams('d.store=alder_row,*'))).toEqual([
      { key: 'dim:store', values: [ANY] },
    ])
    // Only a dimension's own words: anything else in the param is dropped.
    expect(chipsFrom(new URLSearchParams('d.store=Alder Row,../x&d.Bad=x'))).toEqual([])
  })

  it(`keep at most ${MAX_CHIPS} chips`, () => {
    const q = new URLSearchParams(
      Array.from({ length: MAX_CHIPS + 5 }, (_, i) => `d.dim_${i}=v`).join('&'),
    )
    expect(chipsFrom(q)).toHaveLength(MAX_CHIPS)
    const full = chipsFrom(q)
    expect(withValues(full, 'answer', ['missing'])).toBe(full)
  })

  it("read an old link's market by name, as a dimension's chip when the name is one value", () => {
    const old = chipsFrom(new URLSearchParams('market=!Norway&answer=missing&chips=market,answer'))
    expect(old).toEqual([
      { key: 'market', not: true, values: ['Norway'] },
      { key: 'answer', values: ['missing'] },
    ])
    const topic = (values: Topic['values']) => ({ values }) as Topic
    const norway = { dimension: 'dim:market', value: 'val:market/norway', name: 'Norway' }
    expect(fromLegacy(old, [topic([norway])])).toEqual({
      chips: [
        { key: 'dim:market', not: true, values: ['val:market/norway'] },
        { key: 'answer', values: ['missing'] },
      ],
    })
    // A name two values share stays as it was, and says why: never merged into one of them.
    const shared = fromLegacy(old, [
      topic([norway]),
      topic([{ dimension: 'dim:store', value: 'val:store/norway', name: 'Norway' }]),
    ])
    expect(shared.chips).toBe(old)
    expect(shared.why).toBe(
      'Norway is a value of 2 dimensions: Market, Store. Choose one in the filter.',
    )
    expect(fromLegacy(old, []).why).toBe('No topic in this range asked about Norway.')
  })

  it('read an old link: one domain, a month and "found" for every answer that found something', () => {
    expect(chipsFrom(new URLSearchParams('domain=sales&month=2026-10&answer=found'))).toEqual([
      { key: 'answer', values: ['grounded', 'partial', 'conflict', 'stale'] },
      { key: 'domain', values: ['sales'] },
      { key: 'month', values: ['2026-10'] },
    ])
  })

  it('drop what a field cannot hold: an unknown state, a bad month, a kind of agent left out', () => {
    expect(
      chipsFrom(new URLSearchParams('answer=missing,nope&month=2026-1,2026-09&agent=!Cursor')),
    ).toEqual([
      { key: 'answer', values: ['missing'] },
      { key: 'month', values: ['2026-09'] },
    ])
    // A kind of agent is one; a topic's words are never left out.
    expect(chipsFrom(new URLSearchParams('agent=Cursor,Codex&q=!nor'))).toEqual([
      { key: 'agent', values: ['Cursor'] },
      { key: 'topic', values: ['nor'] },
    ])
  })

  it('keep a value with a comma, a "!" or a "%" in it', () => {
    const chips: Filters = [
      { key: 'market', values: ['Norway, Sweden', '!Iceland', '100% online'] },
      { key: 'metric', not: true, values: ['Orders, net'] },
    ]
    expect(roundTrip(chips)).toEqual(chips)
  })

  it('take to the service every filter it can, and say the rest', () => {
    const topics = [{ metric: 'Orders', metrics: ['metric:orders'] }] as Topic[]
    const view = { id: 'look', name: 'Needs a look' }
    expect(
      wireFilters(
        [
          { key: 'domain', values: ['sales'] },
          { key: 'metric', values: ['Orders'] },
          { key: 'dim:market', not: true, values: [ANY] },
          { key: 'topic', values: ['nor'] },
        ],
        view,
        topics,
        domains,
      ),
    ).toEqual({
      filters: [
        { key: 'metric', values: ['metric:orders'] },
        { key: 'dim:market', not: true, values: [ANY] },
      ],
      left: ['Topic has “nor”', 'the view Needs a look'],
    })
    // A view of one field is that field's filter.
    expect(wireFilters([], { id: 'stale', name: 'Outdated' }, topics, domains)).toEqual({
      filters: [{ key: 'answer', values: ['stale'] }],
      left: [],
    })
  })

  it('round-trip any chips, in any order', () => {
    const value = fc.string({ minLength: 1, maxLength: 12 })
    const chip = (key: FilterKey): fc.Arbitrary<Chip> => {
      const values =
        key === 'answer'
          ? fc.uniqueArray(fc.constantFrom(...SHOWN), { minLength: 1 })
          : key === 'gap'
            ? fc.uniqueArray(fc.constantFrom('draft', 'suggestion', 'none'), { minLength: 1 })
            : key === 'reported'
              ? fc.uniqueArray(fc.constantFrom('yes', 'no'), { minLength: 1 })
              : key === 'month'
                ? fc.uniqueArray(fc.constantFrom('2026-08', '2026-09', '2026-10'), {
                    minLength: 1,
                  })
                : key === 'agent'
                  ? value.map((v) => [v])
                  : fc.uniqueArray(value, { minLength: 1, maxLength: 4 })
      const not = key === 'agent' || key === 'topic' ? fc.constant(false) : fc.boolean()
      return fc
        .tuple(values, not)
        .map(([vs, n]) => ({ key, ...(n ? { not: true } : {}), values: [...vs] }))
    }
    const id = fc.stringMatching(/^[a-z0-9_]{1,8}$/)
    const dimension = (key: DimKey): fc.Arbitrary<Chip> =>
      fc
        .tuple(
          fc.oneof(
            fc.constant([ANY] as string[]),
            fc
              .uniqueArray(id, { minLength: 1, maxLength: 4 })
              .map((ids) => ids.map((v) => `val:${key.slice(4)}/${v}`)),
          ),
          fc.boolean(),
        )
        .map(([values, n]) => ({ key, ...(n ? { not: true } : {}), values }))
    const dims = fc
      .uniqueArray(id, { maxLength: 4 })
      .map((ids) => ids.map((i): DimKey => `dim:${i}`))
    const chips = fc
      .tuple(fc.shuffledSubarray([...FIELD_KEYS]), dims)
      .chain(([keys, ds]) =>
        keys.length + ds.length
          ? fc.tuple(...keys.map(chip), ...ds.map(dimension))
          : fc.constant([] as Chip[]),
      )
      .chain((list) => fc.shuffledSubarray(list, { minLength: list.length }))
    fc.assert(
      fc.property(chips, (c) => {
        expect(roundTrip(c)).toEqual(c)
      }),
    )
  })
})

describe('changing the chips', () => {
  const chips: Filters = [
    { key: 'answer', values: ['missing'] },
    { key: 'dim:market', not: true, values: ['val:market/norway'] },
    { key: 'month', values: ['2026-10'] },
  ]
  it('add a value to a chip, keeping how it matches, and take a chip off with its last value', () => {
    expect(toggled(chips, 'dim:market', 'val:market/spain')[1]).toEqual({
      key: 'dim:market',
      not: true,
      values: ['val:market/norway', 'val:market/spain'],
    })
    expect(toggled(chips, 'answer', 'missing').map((c) => c.key)).toEqual(['dim:market', 'month'])
    // Any value takes the place of a dimension's values, and a value the place of any value.
    expect(toggled(chips, 'dim:market', ANY)[1]).toEqual({
      key: 'dim:market',
      not: true,
      values: [ANY],
    })
    expect(
      toggled([{ key: 'dim:market', values: [ANY] }], 'dim:market', 'val:market/spain'),
    ).toEqual([{ key: 'dim:market', values: ['val:market/spain'] }])
    // A new field goes last.
    expect(withValues(chips, 'domain', ['sales']).at(-1)).toEqual({
      key: 'domain',
      values: ['sales'],
    })
  })
  it('move a chip, never past either end', () => {
    expect(moved(chips, 'month', 0).map((c) => c.key)).toEqual(['month', 'answer', 'dim:market'])
    expect(moved(chips, 'answer', -1)).toBe(chips)
    expect(moved(chips, 'answer', 9).map((c) => c.key)).toEqual(['dim:market', 'month', 'answer'])
  })
  it('read as sentences: is, is any of, is not, is none of, has', () => {
    expect(chipSentence({ key: 'answer', values: ['missing'] }, domains)).toBe(
      'Answer is Not found',
    )
    expect(chipSentence({ key: 'domain', values: ['sales', 'marketing'] }, domains)).toBe(
      'Domain is any of Sales, Marketing',
    )
    expect(chipSentence({ key: 'month', not: true, values: ['2026-10'] }, domains)).toBe(
      'Month asked about is not October 2026',
    )
    expect(opWords({ key: 'gap', not: true, values: ['draft', 'none'] })).toBe('is none of')
    expect(chipSentence({ key: 'topic', values: ['nor', 'orders'] }, domains)).toBe(
      'Topic has “nor” and “orders”',
    )
    expect(
      chipSentence(
        { key: 'dim:market', values: ['val:market/norway', 'val:market/spain'] },
        domains,
      ),
    ).toBe('Market is any of Norway, Spain')
    expect(chipSentence({ key: 'dim:store', values: [ANY] }, domains)).toBe('Store has any value')
    expect(chipSentence({ key: 'dim:store', not: true, values: [ANY] }, domains)).toBe(
      'Store has no value',
    )
    // A value nothing has named yet reads from its own words.
    expect(chipSentence({ key: 'dim:store', values: ['val:store/alder_row'] }, domains)).toBe(
      'Store is Alder row',
    )
  })
  it('send one domain to the service, and narrow the topics with any other', () => {
    expect(readDomain([{ key: 'domain', values: ['sales'] }])).toBe('sales')
    expect(readDomain([{ key: 'domain', values: ['sales', 'marketing'] }])).toBeUndefined()
    expect(readDomain([{ key: 'domain', not: true, values: ['sales'] }])).toBeUndefined()
    expect(narrowed([{ key: 'domain', values: ['sales'] }], 'all')).toBe(false)
  })
})

/* ---------- the facets and the disclosure rules ---------- */

const MIN = 5
const DOMAINS = ['sales', 'marketing', null] as const
const MARKETS = ['Norway', 'Spain', ALL_VALUES]
const METRICS = ['Orders', 'Revenue']

type World = {
  /** Each subject: its domain, metric, market, and its months' counts. */
  subjects: { domain: string | null; metric: string; market: string; months: number[][] }[]
  reported: boolean[]
}

/** A small world of topics, with counts around the minimum so some are hidden. */
const world: fc.Arbitrary<World> = fc
  .array(
    fc.record({
      domain: fc.constantFrom(...DOMAINS),
      metric: fc.constantFrom(...METRICS),
      market: fc.constantFrom(...MARKETS),
      months: fc.array(fc.array(fc.nat({ max: 9 }), { minLength: 5, maxLength: 5 }), {
        minLength: 1,
        maxLength: 2,
      }),
    }),
    { minLength: 1, maxLength: 6 },
  )
  .chain((subjects) =>
    fc.record({
      subjects: fc.constant(subjects),
      reported: fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
    }),
  )

/**
 * The world as the binding sends it for a view of every domain or one: every count through the one
 * disclosure pass.
 */
function disclosed(w: World, domain?: string) {
  const rows: (TopicCounts & { metric: string; market: string; month: string })[] = []
  w.subjects.forEach((s, i) =>
    s.months.forEach((c, m) => {
      const counts = Object.fromEntries(shownStates.map((k, j) => [k, c[j]!])) as never
      rows.push({
        id: `t${i}-${m}`,
        domain: s.domain,
        subject: `s${i}`,
        counts,
        metric: s.metric,
        market: s.market,
        month: `2026-${String(9 + m).padStart(2, '0')}`,
      })
    }),
  )
  const asked = rows.filter((r) => shownStates.some((k) => r.counts[k] > 0))
  const view = topicView(asked, MIN, { bars: [], ...(domain ? { domain } : {}) })
  const shownOf = new Map(view.topics.map((t) => [t.id, t]))
  const subjects = new Map(view.subjects.map((g) => [g.key, g]))
  const topics: Topic[] = asked.map((r, i) => {
    const t = shownOf.get(r.id)!
    return {
      id: r.id,
      metric: r.metric,
      metrics: [`metric:${r.metric.toLowerCase()}`],
      values:
        r.market === ALL_VALUES
          ? []
          : [
              {
                dimension: 'dim:market',
                value: `val:market/${r.market.toLowerCase()}`,
                name: r.market,
              },
            ],
      dimensions: [],
      where: r.market,
      ...(r.domain ? { domain: r.domain } : {}),
      month: r.month,
      subject: r.subject,
      total: t.total,
      atLeast: t.atLeast,
      counts: t.counts,
      in: {
        notFound: false,
        reported: w.reported[i % 12]!,
        answers: answersOf(subjects.get(r.subject)!),
      },
    }
  })
  const data: ObsData = {
    state: 'normal',
    range: 7,
    last: 0,
    numbers: {
      asked: view.asked,
      counts: view.counts,
      before: { asked: null, missing: null, grounded: null },
    },
    bars: [],
    topics,
    subjects: view.subjects.map(({ domain, ...g }) => ({
      ...g,
      ...(domain ? { domain } : {}),
    })),
    domains: view.domains.map((d) => ({
      ...(d.domain ? { domain: d.domain } : {}),
      total: d.total,
      atLeast: d.atLeast,
    })),
    notFound: { subjects: [], topics: [] },
    couldNotRead: null,
    markets: MARKETS,
    publishes: [],
    agents: [],
    feedback: null,
    usage: null,
  }
  return { rows: asked, view, data }
}

/**
 * Whether `target` is a sum of the disclosed counts, added and taken away: in their span. If it is,
 * showing it tells a reader nothing the disclosed counts did not. Exact elimination over integers
 * by fractions would do; the vectors are 0 and 1 and few, so a tolerance is enough.
 */
function inSpan(vectors: number[][], target: number[]) {
  const rows = vectors.map((v) => [...v])
  const n = target.length
  const basis: { row: number[]; pivot: number }[] = []
  const reduce = (v: number[]) => {
    const r = [...v]
    for (const b of basis) {
      const f = r[b.pivot]!
      if (Math.abs(f) > 1e-9) for (let j = 0; j < n; j++) r[j]! -= f * b.row[j]!
    }
    return r
  }
  for (const v of rows) {
    const r = reduce(v)
    const pivot = r.findIndex((x) => Math.abs(x) > 1e-9)
    if (pivot < 0) continue
    const p = r[pivot]!
    const row = r.map((x) => x / p)
    for (const b of basis) {
      const f = b.row[pivot]!
      if (Math.abs(f) > 1e-9) for (let j = 0; j < n; j++) b.row[j]! -= f * row[j]!
    }
    basis.push({ row, pivot })
  }
  return reduce(target).every((x) => Math.abs(x) < 1e-6)
}

describe('the facets', () => {
  const keys: FilterKey[] = ['answer', 'domain', 'metric', 'month', 'reported']
  const valuesOf = (topics: Topic[], key: FilterKey) =>
    key === 'answer'
      ? [...SHOWN]
      : key === 'domain'
        ? ['sales', 'marketing']
        : key === 'reported'
          ? ['yes', 'no']
          : key === 'metric'
            ? METRICS
            : [...new Set(topics.map((t) => t.month))]
  const chip = (key: FilterKey): fc.Arbitrary<Chip> =>
    fc.record({
      key: fc.constant(key),
      not: fc.boolean(),
      values: fc.subarray(valuesOf([], key).length ? valuesOf([], key) : ['2026-09'], {
        minLength: 1,
      }),
    })
  // A dimension's chip narrows the topics too: Market by its values' keys, or any value of it.
  const market: fc.Arbitrary<Chip> = fc.record({
    key: fc.constant('dim:market' as const),
    not: fc.boolean(),
    values: fc.oneof(
      fc.constant([ANY] as string[]),
      fc.subarray(['val:market/norway', 'val:market/spain'], { minLength: 1 }),
    ),
  })
  const chips: fc.Arbitrary<Chip[]> = fc
    .tuple(fc.shuffledSubarray(keys, { maxLength: 3 }), fc.boolean())
    .chain(([ks, dim]) =>
      ks.length || dim
        ? fc.tuple(...ks.map(chip), ...(dim ? [market] : []))
        : fc.constant([] as Chip[]),
    )

  it("count every value without the field's own chip, so the other values stay", () => {
    const { data } = disclosed({
      subjects: [
        { domain: 'sales', metric: 'Orders', market: 'Norway', months: [[9, 0, 0, 0, 6]] },
        { domain: 'sales', metric: 'Revenue', market: 'Spain', months: [[8, 0, 0, 0, 0]] },
      ],
      reported: Array.from({ length: 12 }, () => false),
    })
    const obs = observability(data)
    const metric = facet('metric', {
      obs,
      chips: [{ key: 'metric', values: ['Orders'] }],
      inView: () => true,
      all: true,
      values: () => METRICS,
    })
    expect(metric.map((f) => [f.value, f.topics, f.count?.visible])).toEqual([
      ['Orders', 1, 15],
      ['Revenue', 1, 8],
    ])
    // A dimension's chip narrows the topics the facets count.
    const narrowedBy = facet('metric', {
      obs,
      chips: [{ key: 'dim:market', values: ['val:market/spain'] }],
      inView: () => true,
      all: true,
      values: () => METRICS,
    })
    expect(narrowedBy.map((f) => [f.value, f.topics])).toEqual([
      ['Orders', 0],
      ['Revenue', 1],
    ])
  })

  it('say a kind of agent is not shown when the topics are narrowed: the service has no such count', () => {
    const { data } = disclosed({
      subjects: [
        { domain: 'sales', metric: 'Orders', market: 'Norway', months: [[9, 0, 0, 0, 6]] },
      ],
      reported: Array.from({ length: 12 }, () => false),
    })
    const obs = observability({ ...data, agents: [{ name: 'Cursor', count: 15 }] })
    const input = { obs, inView: () => true, all: true, values: () => ['Cursor'] }
    expect(facet('agent', { ...input, chips: [] })[0]!.count).toEqual({ visible: 15, shown: 15 })
    expect(
      facet('agent', {
        ...input,
        chips: [{ key: 'dim:market', values: ['val:market/norway'] }],
      })[0]!.count,
    ).toBeNull()
    // The domain the service reads is its own count's domain: those still show.
    expect(
      facet('agent', { ...input, chips: [{ key: 'domain', values: ['sales'] }] })[0]!.count,
    ).not.toBeNull()
  })

  it('never let a reader work out a hidden count, whatever the facets and chips', () => {
    fc.assert(
      fc.property(world, chips, (w, on) => {
        // The service reads the one domain a chip names, as the page asks it to.
        const { rows, view, data } = disclosed(w, readDomain(on))
        const obs = observability(data)
        // Each count as the atoms it adds up: a topic's calls by answer state.
        const atoms = rows.flatMap((r) => shownStates.map((s) => `${r.id}:${s}`))
        const at = new Map(atoms.map((a, i) => [a, i]))
        const raw = new Map(
          rows.flatMap((r) => shownStates.map((s) => [`${r.id}:${s}`, r.counts[s]])),
        )
        const vector = (ids: string[]) => {
          const v = atoms.map(() => 0)
          for (const id of ids) v[at.get(id)!] = 1
          return v
        }
        const of = (topics: { id: string }[], states: readonly string[] = shownStates) =>
          topics.flatMap((t) => states.map((s) => `${t.id}:${s}`))
        // Everything the binding disclosed, each as the atoms it adds up.
        const disclosedCounts: string[][] = []
        const subjectRows = (key: string) => rows.filter((r) => r.subject === key)
        for (const t of view.topics) {
          if (t.total !== null) disclosedCounts.push(of([t]))
          for (const s of shownStates) if (t.counts[s] !== null) disclosedCounts.push(of([t], [s]))
        }
        for (const g of view.subjects) {
          if (g.total !== null) disclosedCounts.push(of(subjectRows(g.key)))
          for (const s of shownStates)
            if (g.counts[s] !== null) disclosedCounts.push(of(subjectRows(g.key), [s]))
        }
        for (const d of view.domains)
          if (d.total !== null) disclosedCounts.push(of(rows.filter((r) => r.domain === d.domain)))
        const scope = rows.filter((r) => !readDomain(on) || r.domain === readDomain(on))
        if (view.asked !== null) disclosedCounts.push(of(scope))
        for (const s of shownStates)
          if (view.counts[s] !== null) disclosedCounts.push(of(scope, [s]))
        const span = disclosedCounts.map(vector)

        // The control: a topic hidden for being small is not in that span, or the test proves nothing.
        for (const t of view.topics) {
          const ids = of([t])
          const n = ids.reduce((x, id) => x + raw.get(id)!, 0)
          if (t.total === null && n > 0 && n < MIN) expect(inSpan(span, vector(ids))).toBe(false)
        }

        const name = obs.topicName
        for (const key of keys) {
          const others = data.topics.filter((t) => passes(t, on, name, key))
          const values = valuesOf(data.topics, key)
          const out = facet(key, {
            obs,
            chips: on,
            inView: () => true,
            all: true,
            values: () => values,
          })
          for (const f of out) {
            if (!f.count) continue
            // What the value counts, and its true size.
            const ids =
              key === 'answer'
                ? of(others, [f.value])
                : of(others.filter((t) => passes(t, [{ key, values: [f.value] }], name)))
            const truth = ids.reduce((n, id) => n + raw.get(id)!, 0)
            if (f.count.visible !== null) {
              // Exact only when it is the truth and the disclosed counts already add up to it.
              expect(f.count.visible).toBe(truth)
              expect(inSpan(span, vector(ids))).toBe(true)
            } else expect(f.count.shown).toBeLessThanOrEqual(truth)
          }
        }
      }),
      { numRuns: 200 },
    )
  })
})

describe('a facet value read out', () => {
  it('uses the words of the counts', async () => {
    const { facetSaid, facetWords } = await import('@/lib/obs-views')
    const f = { value: 'x', topics: 3, count: { visible: null, shown: 88 } }
    expect(facetWords(f.count)).toBe('88+')
    expect(facetSaid(f)).toBe('3 topics, asked at least 88 times')
    expect(facetSaid({ ...f, count: { visible: null, shown: 0 } }, true)).toBe(
      '3 topics, how many answered so is hidden',
    )
    expect(facetWords({ visible: null, shown: 0 }, true)).toBe('-')
    expect(facetWords(null)).toBe('Not shown')
    expect((['grounded'] as Shown[]).length).toBe(1)
  })
})
