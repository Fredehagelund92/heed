import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { answersOf, shownStates, topicView, type TopicCounts } from '@domain/observability'
import {
  chipsFrom,
  chipsTo,
  chipSentence,
  facet,
  FILTER_KEYS,
  moved,
  narrowed,
  opWords,
  passes,
  readDomain,
  toggled,
  withValues,
  type Chip,
  type FilterKey,
  type Filters,
} from '@/lib/obs-views'
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

describe('the chips in the address', () => {
  it('keep each field in its own param, "!" for is not, and the order when it is not the fields\'', () => {
    const chips: Filters = [
      { key: 'market', not: true, values: ['Norway'] },
      { key: 'answer', values: ['missing', 'partial'] },
    ]
    expect(chipsTo(chips)).toMatchObject({
      market: '!Norway',
      answer: 'missing,partial',
      chips: 'market,answer',
      domain: undefined,
      q: undefined,
    })
    expect(roundTrip(chips)).toEqual(chips)
    // In the fields' own order there is no `chips` param.
    expect(chipsTo([...chips].reverse()).chips).toBeUndefined()
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
    const chips = fc
      .shuffledSubarray([...FILTER_KEYS])
      .chain((keys) => (keys.length ? fc.tuple(...keys.map(chip)) : fc.constant([] as Chip[])))
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
    { key: 'market', not: true, values: ['Norway'] },
    { key: 'month', values: ['2026-10'] },
  ]
  it('add a value to a chip, keeping how it matches, and take a chip off with its last value', () => {
    expect(toggled(chips, 'market', 'Spain')[1]).toEqual({
      key: 'market',
      not: true,
      values: ['Norway', 'Spain'],
    })
    expect(toggled(chips, 'answer', 'missing').map((c) => c.key)).toEqual(['market', 'month'])
    // A new field goes last.
    expect(withValues(chips, 'domain', ['sales']).at(-1)).toEqual({
      key: 'domain',
      values: ['sales'],
    })
  })
  it('move a chip, never past either end', () => {
    expect(moved(chips, 'month', 0).map((c) => c.key)).toEqual(['month', 'answer', 'market'])
    expect(moved(chips, 'answer', -1)).toBe(chips)
    expect(moved(chips, 'answer', 9).map((c) => c.key)).toEqual(['market', 'month', 'answer'])
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
  const keys: FilterKey[] = ['answer', 'domain', 'market', 'metric', 'month', 'reported']
  const valuesOf = (topics: Topic[], key: FilterKey) =>
    key === 'answer'
      ? [...SHOWN]
      : key === 'domain'
        ? ['sales', 'marketing']
        : key === 'reported'
          ? ['yes', 'no']
          : key === 'market'
            ? MARKETS
            : key === 'metric'
              ? METRICS
              : [...new Set(topics.map((t) => t.month))]
  const chip = (key: FilterKey) =>
    fc.record({
      key: fc.constant(key),
      not: fc.boolean(),
      values: fc.subarray(valuesOf([], key).length ? valuesOf([], key) : ['2026-09'], {
        minLength: 1,
      }),
    })
  const chips = fc
    .shuffledSubarray(keys, { maxLength: 3 })
    .chain((ks) => (ks.length ? fc.tuple(...ks.map(chip)) : fc.constant([] as Chip[])))

  it("count every value without the field's own chip, so the other values stay", () => {
    const { data } = disclosed({
      subjects: [
        { domain: 'sales', metric: 'Orders', market: 'Norway', months: [[9, 0, 0, 0, 6]] },
        { domain: 'sales', metric: 'Orders', market: 'Spain', months: [[8, 0, 0, 0, 0]] },
      ],
      reported: Array.from({ length: 12 }, () => false),
    })
    const obs = observability(data)
    const market = facet('market', {
      obs,
      chips: [{ key: 'market', values: ['Norway'] }],
      inView: () => true,
      all: true,
      values: () => MARKETS,
    })
    expect(market.map((f) => [f.value, f.topics, f.count?.visible])).toEqual([
      ['Norway', 1, 15],
      ['Spain', 1, 8],
      [ALL_VALUES, 0, 0],
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
      facet('agent', { ...input, chips: [{ key: 'market', values: ['Norway'] }] })[0]!.count,
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
