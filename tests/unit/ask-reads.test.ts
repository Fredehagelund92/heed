import { describe, expect, it } from 'vitest'
import type { TryItReading } from '@/api'
import { datesTarget } from '@/lib/ask-draft'
import { draftTagged, readsOf, readsSomething } from '@/lib/ask-reads'
import { addToScope } from '@/lib/mention-targets'
import { emptyScope, type TryItScope } from '@/lib/try-it'

/*
  What the composer's "Heed reads" line shows and the question is sent with (Heed composer, stages
  1 and 2): the chips in the question, its other words, what was picked for this question and what
  the last question carries, kind by kind, with one period.
*/

const today = '2026-10-14'
const term = (key: string, name: string): TryItReading['about'][number] => ({
  key,
  name,
  kind: key.startsWith('metric:')
    ? 'metric'
    : key.startsWith('dim:')
      ? 'dimension'
      : 'dimension_value',
  dimension: key.startsWith('val:market') ? 'Market' : null,
})
const reading = (overrides: Partial<TryItReading> = {}): TryItReading => ({
  about: [],
  from: null,
  to: null,
  dates: null,
  ambiguous: [],
  dates_problem: null,
  today,
  spans: [],
  ...overrides,
})
const scopeOf = (keys: string[], from: string | null = null, to: string | null = from) =>
  ({ scope: keys.reduce(addToScope, emptyScope), from, to }) satisfies TryItScope

const revenueIn2026 = reading({
  about: [term('metric:net_revenue', 'Net revenue'), term('val:market/norway', 'Norway')],
  from: '2026-01-01',
  to: '2026-12-31',
  dates: {
    words: '2026',
    reads_as: '1 Jan to 31 Dec 2026 (the whole year; UTC)',
    note: 'the whole year',
  },
})
const none = new Set<string>()

describe('what Heed reads for a question', () => {
  it('reads the words: their terms and their period, sent as get_context fields', () => {
    const reads = readsOf({
      reading: revenueIn2026,
      picked: null,
      carried: null,
      dropped: none,
      today,
    })
    expect(reads.terms).toEqual([
      { key: 'metric:net_revenue', source: 'typed' },
      { key: 'val:market/norway', source: 'typed' },
    ])
    expect(reads).toMatchObject({
      window: { from: '2026-01-01', to: '2026-12-31' },
      windowSource: 'typed',
      datesNote: 'the whole year',
    })
    expect(reads.wire).toEqual({
      metrics: ['metric:net_revenue'],
      dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
      window: { from: '2026-01-01', to: '2026-12-31' },
      window_source: 'typed',
      carried: [],
      unresolved: [],
    })
  })

  it('carries the last question kind by kind: a market typed replaces the market carried', () => {
    const carried = scopeOf(['metric:net_revenue', 'val:market/norway'], '2026-01-01', '2026-12-31')
    const reads = readsOf({
      reading: reading({ about: [term('val:market/spain', 'Spain')] }),
      picked: null,
      carried,
      dropped: none,
      today,
    })
    expect(reads.terms).toEqual([
      { key: 'val:market/spain', source: 'typed' },
      { key: 'metric:net_revenue', source: 'carried' },
    ])
    expect(reads.windowSource).toBe('carried')
    expect(reads.wire.carried).toEqual(['metric:net_revenue', 'window'])
    expect(reads.wire.dimension_filters).toEqual([
      { dimension: 'dim:market', values: ['val:market/spain'] },
    ])
    // Taking a carried part off leaves it out of this question, and today is assumed.
    const dropped = readsOf({
      reading: reading({ about: [term('val:market/spain', 'Spain')] }),
      picked: null,
      carried,
      dropped: new Set(['metric:net_revenue', 'window']),
      today,
    })
    expect(dropped.terms).toEqual([{ key: 'val:market/spain', source: 'typed' }])
    expect(dropped).toMatchObject({ window: null, windowSource: 'assumed', today })
    expect(dropped.wire).not.toHaveProperty('window')
  })

  it('adds what was picked, whose dates win over the carried ones but not over the words', () => {
    const picked = scopeOf(['metric:orders'], '2026-09-01', '2026-09-30')
    const carried = scopeOf(['metric:net_revenue'], '2026-01-01', '2026-12-31')
    const reads = readsOf({ reading: reading(), picked, carried, dropped: none, today })
    expect(reads.terms).toEqual([{ key: 'metric:orders', source: 'picked' }])
    expect(reads).toMatchObject({ windowSource: 'picked', window: { from: '2026-09-01' } })
    const typed = readsOf({ reading: revenueIn2026, picked, carried, dropped: none, today })
    expect(typed.windowSource).toBe('typed')
    expect(typed.terms.map((t) => t.source)).toEqual(['typed', 'typed', 'picked'])
  })

  it('shows undecided words until one of their terms is picked', () => {
    const undecided = reading({
      ambiguous: [
        {
          words: 'revenue',
          options: [
            term('metric:net_revenue', 'Net revenue'),
            term('metric:gross_sales', 'Gross sales'),
          ],
        },
      ],
    })
    const open = readsOf({ reading: undecided, picked: null, carried: null, dropped: none, today })
    expect(open.undecided).toHaveLength(1)
    expect(open.wire.unresolved).toEqual([
      { words: 'revenue', options: ['metric:net_revenue', 'metric:gross_sales'] },
    ])
    expect(readsSomething(open)).toBe(true)
    const chosen = readsOf({
      reading: undecided,
      picked: scopeOf(['metric:gross_sales']),
      carried: null,
      dropped: none,
      today,
    })
    expect(chosen.undecided).toEqual([])
    expect(chosen.wire.metrics).toEqual(['metric:gross_sales'])
  })

  it('names dates it cannot read instead of carrying the last question’s, and assumes today otherwise', () => {
    const carried = scopeOf(['metric:net_revenue'], '2026-01-01', '2026-12-31')
    const launch = reading({
      dates_problem: { words: 'since the launch', message: 'Heed cannot…' },
    })
    const reads = readsOf({ reading: launch, picked: null, carried, dropped: none, today })
    expect(reads).toMatchObject({ window: null, windowSource: 'unreadable' })
    expect(reads.wire.carried).toEqual(['metric:net_revenue'])
    const plain = readsOf({ reading: reading(), picked: null, carried: null, dropped: none, today })
    expect(plain).toMatchObject({ windowSource: 'assumed', today })
    expect(readsSomething(plain)).toBe(false)
  })

  it('reads the chips in the question first: their terms, and their dates over the words’', () => {
    // "what was [net revenue] in Norway [last quarter] or 2026": the chips are the question's
    // own scope; Heed still reads the words they leave.
    const tagged = draftTagged([
      { kind: 'mention', target: 'metric:net_revenue', label: 'net revenue' },
      { kind: 'text', text: ' in Norway ' },
      { kind: 'mention', target: datesTarget('2026-07-01', '2026-09-30'), label: 'last quarter' },
    ])
    const carried = scopeOf(['metric:orders', 'val:market/spain'], '2026-01-01', '2026-01-31')
    const reads = readsOf({
      reading: reading({
        about: [term('val:market/norway', 'Norway')],
        from: '2026-01-01',
        to: '2026-12-31',
      }),
      tagged,
      picked: null,
      carried,
      dropped: none,
      today,
    })
    expect(reads.terms).toEqual([
      { key: 'metric:net_revenue', source: 'tagged' },
      { key: 'val:market/norway', source: 'typed' },
    ])
    expect(reads).toMatchObject({
      window: { from: '2026-07-01', to: '2026-09-30' },
      windowSource: 'tagged',
      datesNote: null,
    })
    // The service hears the chips as the question's words: what is sent is what stage 1 sends.
    expect(reads.wire).toEqual({
      metrics: ['metric:net_revenue'],
      dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
      window: { from: '2026-07-01', to: '2026-09-30' },
      window_source: 'typed',
      carried: [],
      unresolved: [],
    })
    // A dates chip stands over words Heed cannot read as dates.
    const unreadable = readsOf({
      reading: reading({ dates_problem: { words: 'since the launch', message: 'Heed cannot…' } }),
      tagged,
      picked: null,
      carried: null,
      dropped: none,
      today,
    })
    expect(unreadable).toMatchObject({ windowSource: 'tagged', datesProblem: null })
  })

  it('reads chips alone, before or without a reading of the words', () => {
    const tagged = draftTagged([
      { kind: 'mention', target: 'group:revenue', label: 'revenue' },
      { kind: 'mention', target: 'dim:market', label: 'by market' },
    ])
    const reads = readsOf({
      reading: null,
      tagged,
      picked: null,
      carried: null,
      dropped: none,
      today,
    })
    expect(reads.terms).toEqual([
      { key: 'group:revenue', source: 'tagged' },
      { key: 'dim:market', source: 'tagged' },
    ])
    expect(reads.wire).toMatchObject({
      metrics: ['group:revenue'],
      dimension_filters: [{ dimension: 'dim:market', values: [] }],
      window_source: 'assumed',
    })
  })
})

describe('items and domains in the question', () => {
  const tagged = draftTagged([
    { kind: 'text', text: 'What does ' },
    { kind: 'mention', target: 'item:itm_a1b2c3d4', label: 'Orders excludes test accounts' },
    { kind: 'text', text: ' say for ' },
    { kind: 'mention', target: 'area:commercial', label: 'Commercial' },
    { kind: 'text', text: ' and ' },
    { kind: 'mention', target: 'metric:orders', label: 'orders' },
    { kind: 'mention', target: 'area:commercial', label: 'Commercial' },
  ])

  it('sends them with the question, apart from the terms get_context reads', () => {
    expect(tagged?.about).toEqual(['item:itm_a1b2c3d4', 'area:commercial'])
    const reads = readsOf({
      reading: null,
      tagged,
      picked: null,
      carried: null,
      dropped: none,
      today,
    })
    expect(reads.terms).toEqual([{ key: 'metric:orders', source: 'tagged' }])
    expect(reads.about).toEqual(['item:itm_a1b2c3d4', 'area:commercial'])
    expect(reads.wire.about).toEqual(['item:itm_a1b2c3d4', 'area:commercial'])
    expect(reads.wire.metrics).toEqual(['metric:orders'])
  })

  it('has a scope to send with only a domain, and none without one', () => {
    const domain = draftTagged([
      { kind: 'mention', target: 'area:commercial', label: 'Commercial' },
    ])
    const reads = readsOf({
      reading: null,
      tagged: domain,
      picked: null,
      carried: null,
      dropped: none,
      today,
    })
    expect(readsSomething(reads)).toBe(true)
    expect(reads.wire).toMatchObject({
      metrics: [],
      dimension_filters: [],
      about: ['area:commercial'],
    })
    const plain = readsOf({ reading: null, picked: null, carried: null, dropped: none, today })
    expect(readsSomething(plain)).toBe(false)
    expect(plain.wire).not.toHaveProperty('about')
  })

  it('never carries them to the next question', () => {
    const reads = readsOf({
      reading: null,
      tagged,
      picked: null,
      carried: null,
      dropped: none,
      today,
    })
    expect(reads.scope.scope).toEqual(addToScope(emptyScope, 'metric:orders'))
    expect(reads.wire.carried).toEqual([])
  })
})
