import { describe, expect, it } from 'vitest'
import {
  answer,
  answerState,
  askedTopics,
  lookUp,
  NEAR_MISSES_SHOWN,
  reach,
  startersOf,
  topicScope,
  topicWords,
  type AnswerBundle,
  type AnswerSource,
  type TopicCount,
} from '../../../src/domain/answer.ts'
import type { ResolverItem } from '../../../src/domain/resolver.ts'
import { bundle as editionBundle, event, terms } from './fixtures.ts'

const source = (overrides: Partial<ResolverItem> & { title?: string } = {}): AnswerSource => {
  const { title = 'Online sales stopped', ...item } = overrides
  return { ...event(item), kind: 'event', title }
}
const bundleOf = (items: AnswerSource[], overrides: Partial<AnswerBundle> = {}): AnswerBundle => ({
  ...editionBundle(items),
  terms,
  ...overrides,
  items,
})
const today = '2026-08-05'
const orders = (id: string, overrides: Partial<ResolverItem> & { title?: string } = {}) =>
  source({
    id,
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    ...overrides,
  })
const ask = { question: 'What were orders in Norway in August 2026?' }

describe('the steps', () => {
  it('come one by one, in order, each timed with the clock it is given', () => {
    let t = 0
    const steps = lookUp(bundleOf([orders('itm_00000001')]), ask, {
      today,
      now: () => (t += 2.5),
    })
    const names: string[] = []
    let next = steps.next()
    while (!next.done) {
      names.push(next.value.step)
      expect(next.value.ms).toBe(2.5)
      next = steps.next()
    }
    expect(names).toEqual(['read_scope', 'looked_up', 'left_out', 'checked', 'said'])
    expect(next.value).toMatchObject({ state: 'grounded', ms: 12.5 })
    expect(next.value.steps.map((s) => s.step)).toEqual(names)
  })

  it('say what was read, what applies, the state, and the sentence', () => {
    const result = answer(bundleOf([orders('itm_00000001')]), ask, { today })
    expect(result.steps).toEqual([
      {
        step: 'read_scope',
        ms: 0,
        scope: result.scope,
        dates: {
          words: 'August 2026',
          reads_as: '1-31 Aug 2026 (the whole month, including the days after today; UTC)',
        },
        assumed: null,
        issues: [],
      },
      { step: 'looked_up', ms: 0, status: 'matched', items: result.items },
      { step: 'left_out', ms: 0, leftOut: [], more: 0, forAnotherGroup: 0 },
      { step: 'checked', ms: 0, state: 'grounded', uncovered: { metrics: [], values: [] } },
      { step: 'said', ms: 0, say: result.say, next: null },
    ])
    expect(result.items).toEqual([
      {
        id: 'itm_00000001',
        version: 1,
        areaId: 'finance',
        kind: 'event',
        title: 'Online sales stopped',
        summary: 'Norway online sales stopped.',
        validity: { start: '2026-08-04', end: null },
        match: 'exact',
        unverified: false,
        unverifiedReason: null,
        restrictions: [],
        conflictsWith: [],
        quote: null,
        notToConclude: null,
      },
    ])
  })

  it("carry each item's first copied source line and what its writer said not to conclude", () => {
    const result = answer(
      bundleOf([
        orders('itm_00000001', {
          evidence: [
            { url: 'https://a.example', quote: ' ' },
            { url: 'https://b.example', quote: 'Held at the border from 4 August.' },
          ],
          notToConclude: 'Fewer orders do not mean fewer customers.',
        } as Partial<ResolverItem>),
        orders('itm_00000002', { notToConclude: 'cause not proven' } as Partial<ResolverItem>),
      ]),
      ask,
      { today },
    )
    expect(result.items.map((i) => [i.id, i.quote, i.notToConclude])).toEqual([
      [
        'itm_00000001',
        'Held at the border from 4 August.',
        'Fewer orders do not mean fewer customers.',
      ],
      ['itm_00000002', null, null],
    ])
  })
})

describe('what is left out, and why', () => {
  it('names the resolver reasons, the item limit and the near misses', () => {
    const items = [
      orders('itm_00000001'),
      orders('itm_00000002', { title: 'Paused item' }),
      orders('itm_00000003', { audience: { kind: 'groups', groups: ['finance'] }, title: 'Hush' }),
      orders('itm_00000004', { validity: { start: '2026-01-01', end: '2026-02-01' } }),
      orders('itm_00000005', {
        scope: {
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
        },
      }),
      orders('itm_00000006', {
        scope: { metrics: ['metric:orders'], dimensions: ['dim:product'], dimensionValues: [] },
      }),
      orders('itm_00000007'),
      orders('itm_00000008', { status: 'retired', replacedBy: 'itm_00000007' }),
      // About another metric: no near miss.
      source({
        id: 'itm_00000009',
        scope: { metrics: ['metric:revenue'], dimensions: [], dimensionValues: [] },
      }),
    ]
    const result = answer(
      bundleOf(items, { stopped: { all: false, areas: [], items: ['itm_00000002'] } }),
      ask,
      { today, maxItems: 1 },
    )
    expect(result.items.map((i) => i.id)).toEqual(['itm_00000001'])
    expect(result.leftOut.map((l) => [l.id, l.reason, l.title, l.replacedBy])).toEqual([
      ['itm_00000002', 'stopped', 'Paused item', null],
      ['itm_00000007', 'cut', 'Online sales stopped', null],
      ['itm_00000008', 'replaced', 'Online sales stopped', 'itm_00000007'],
      ['itm_00000005', 'values', 'Online sales stopped', null],
      ['itm_00000006', 'dimension', 'Online sales stopped', null],
      ['itm_00000004', 'dates', 'Online sales stopped', null],
    ])
    // An item for another group is never named, not even by its id: it is counted.
    expect(result.forAnotherGroup).toBe(1)
    expect(JSON.stringify(result)).not.toContain('itm_00000003')
    expect(result.say).toContain("1 more fact applies but didn't fit in this reply.")
  })

  it('lists at most ten near misses, and counts the rest', () => {
    const misses = Array.from({ length: NEAR_MISSES_SHOWN + 3 }, (_, i) =>
      orders(`itm_1000000${String(i).padStart(2, '0')}`, {
        validity: { start: '2026-01-01', end: '2026-02-01' },
      }),
    )
    const result = answer(bundleOf(misses), ask, { today })
    expect(result.leftOut).toHaveLength(NEAR_MISSES_SHOWN)
    expect(result.leftOutMore).toBe(3)
    expect(result.state).toBe('missing')
  })
})

describe('the answer state', () => {
  const none = { metrics: [], values: [] }
  it.each([
    ['check_failed', [], none, false, 'failed'],
    ['need_more_detail', [], none, false, 'missing'],
    ['no_match', [], none, false, 'missing'],
    [
      'conflict',
      [{ unverified: true }],
      { metrics: ['metric:orders'], values: [] },
      true,
      'conflict',
    ],
    [
      'matched',
      [{ unverified: true }],
      { metrics: [], values: ['val:market/spain'] },
      false,
      'partial',
    ],
    ['matched', [{ unverified: false }], none, true, 'partial'],
    ['matched', [{ unverified: false }, { unverified: true }], none, false, 'stale'],
    ['matched', [{ unverified: false }], none, false, 'grounded'],
  ] as const)('%s with %j, %j, assumed %s, is %s', (status, given, uncovered, assumed, state) => {
    expect(answerState({ status, given, uncovered, assumed })).toBe(state)
  })

  it('is Partial when an asked market has nothing, and says which', () => {
    const result = answer(
      bundleOf([orders('itm_00000001')]),
      { question: 'Orders in Norway and Spain in August 2026' },
      { today },
    )
    expect(result).toMatchObject({
      state: 'partial',
      uncovered: { metrics: [], values: ['val:market/spain'] },
    })
  })

  it('is Outdated when an item is past its check date, and Checked once it is checked', () => {
    const late = orders('itm_00000001', { reviewDate: '2026-08-01' })
    expect(answer(bundleOf([late]), ask, { today })).toMatchObject({
      state: 'stale',
      items: [{ unverified: true, unverifiedReason: 'past_review_date' }],
    })
    const flagged = orders('itm_00000001', { checkFlag: 'source_missing' })
    expect(answer(bundleOf([flagged]), ask, { today }).items[0]!.unverifiedReason).toBe(
      'source_missing',
    )
  })

  it('is Conflict when two given items disagree, and names the other in each', () => {
    const result = answer(
      bundleOf([
        orders('itm_00000001', { conflicts: ['itm_00000002'] }),
        orders('itm_00000002', { conflicts: ['itm_00000001'] }),
      ]),
      ask,
      { today },
    )
    expect(result.state).toBe('conflict')
    expect(result.items.map((i) => i.conflictsWith)).toEqual([['itm_00000002'], ['itm_00000001']])
  })
})

describe('a topic', () => {
  it('stands for its scope over its whole month', () => {
    expect(
      topicScope({
        metrics: ['metric:orders'],
        values: ['val:market/spain', 'val:market/norway', 'val:product/footwear'],
        dimensions: ['dim:channel'],
        month: '2026-12-01',
      }),
    ).toEqual({
      metrics: ['metric:orders'],
      filters: {
        'dim:channel': [],
        'dim:market': ['val:market/norway', 'val:market/spain'],
        'dim:product': ['val:product/footwear'],
      },
      window: { start: '2026-12-01', end: '2027-01-01' },
    })
    expect(
      topicWords(
        { terms },
        topicScope({
          metrics: ['metric:orders'],
          values: ['val:market/norway'],
          dimensions: [],
          month: '2026-08-01',
        }),
      ),
    ).toBe('Orders in Norway')
  })
})

const topic = (id: string, overrides: Partial<TopicCount> = {}): TopicCount => ({
  id,
  area: 'finance',
  metrics: ['metric:orders'],
  values: ['val:market/norway'],
  dimensions: [],
  month: '2026-08-01',
  calls: 10,
  ...overrides,
})

describe('Asked this week', () => {
  it('joins a topic’s months, most asked first, and never gives a small month away', () => {
    const { topics, hidden } = askedTopics(
      [
        topic('a', { calls: 31, month: '2026-10-01' }),
        topic('b', { calls: 7, month: '2026-09-01' }),
        // Net revenue in Norway: 13 shown, and 3 in another month that a total would give away.
        topic('c', { metrics: ['metric:revenue'], calls: 13, month: '2026-10-01' }),
        topic('d', { metrics: ['metric:revenue'], calls: 3, month: '2026-09-01' }),
        // Orders in Spain: two months under 5 that add up to 6.
        topic('e', { values: ['val:market/spain'], calls: 3, month: '2026-10-01' }),
        topic('f', { values: ['val:market/spain'], calls: 3, month: '2026-09-01' }),
        // Orders by market: asked 4 times, never listed.
        topic('g', { values: [], dimensions: ['dim:market'], calls: 4 }),
      ],
      5,
      '2026-10-26',
    )
    expect(topics.map((t) => [t.metrics, t.values, t.months, t.month, t.count, t.atLeast])).toEqual(
      [
        [
          ['metric:orders'],
          ['val:market/norway'],
          ['2026-10-01', '2026-09-01'],
          '2026-10-01',
          38,
          38,
        ],
        [['metric:revenue'], ['val:market/norway'], ['2026-10-01'], '2026-10-01', null, 13],
        [['metric:orders'], ['val:market/spain'], [], '2026-10-01', 6, 0],
      ],
    )
    expect(hidden).toBeNull()
    expect(
      askedTopics(
        [topic('a', { calls: 2 }), topic('b', { values: [], calls: 3 })],
        5,
        '2026-10-26',
      ),
    ).toEqual({ topics: [], hidden: 5 })
  })

  it('answers a row listed only by its total on the month of today, never on a hidden month', () => {
    const { topics } = askedTopics(
      [
        topic('a', { calls: 3, month: '2026-09-01' }),
        topic('b', { calls: 3, month: '2026-08-01' }),
      ],
      5,
      '2026-10-26',
    )
    expect(topics).toHaveLength(1)
    expect(topics[0]!.months).toEqual([])
    expect(topics[0]!.count).toBe(6)
    expect(topicScope(topics[0]!).window.start).toBe('2026-10-01')
  })
})

describe("a workspace's first questions", () => {
  it('are the scopes of its live items, a metric and the first value each, then its metrics, four at most', () => {
    const scopes = startersOf(
      bundleOf([
        orders('itm_00000001'),
        orders('itm_00000002'),
        source({
          id: 'itm_00000003',
          scope: { metrics: [], dimensions: [], dimensionValues: [] },
        }),
      ]),
      '2026-10-23',
    )
    const month = { start: '2026-10-01', end: '2026-11-01' }
    expect(scopes[0]).toEqual({
      metrics: ['metric:orders'],
      filters: { 'dim:market': ['val:market/norway'] },
      window: month,
    })
    // The same scope twice is offered once; an item about nothing is not a question.
    expect(scopes.filter((s) => s.filters['dim:market'])).toHaveLength(1)
    expect(scopes.length).toBeLessThanOrEqual(4)
    for (const s of scopes.slice(1)) {
      expect(s.metrics).toHaveLength(1)
      expect(s.window).toEqual(month)
    }
  })

  it('never come from an item an agent would not be given: for a group, or stopped', () => {
    const norway = orders('itm_00000001', {
      audience: { kind: 'groups', groups: ['finance'] },
    })
    const spain = orders('itm_00000002', {
      scope: {
        metrics: ['metric:orders'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
      },
    })
    const markets = (b: AnswerBundle) =>
      startersOf(b, '2026-10-23').flatMap((s) => s.filters['dim:market'] ?? [])
    expect(markets(bundleOf([norway, spain]))).toEqual(['val:market/spain'])
    expect(
      markets(
        bundleOf([norway, spain], { stopped: { all: false, areas: [], items: ['itm_00000002'] } }),
      ),
    ).toEqual([])
  })

  it('are none while nothing is live', () => {
    expect(startersOf(bundleOf([]), '2026-10-23')).toEqual([])
  })
})

describe('the reach of a draft', () => {
  const draft = orders('itm_draft001')
  const library = bundleOf([orders('itm_00000001'), draft])
  it('counts the questions of the topics that would get it, with no topic under the minimum', () => {
    const topics = [
      topic('a', { calls: 12 }),
      topic('b', { calls: 4 }),
      topic('c', { values: ['val:market/spain'], calls: 30 }),
      topic('d', { calls: 8, month: '2026-01-01' }),
    ]
    expect(reach(library, 'itm_draft001', topics, today, 5)).toBe(12)
    expect(reach(library, 'itm_draft001', [topic('b', { calls: 4 })], today, 5)).toBe(0)
  })

  it('counts no topic hidden at a higher minimum, and only what the item limit gives', () => {
    expect(reach(library, 'itm_draft001', [topic('a', { calls: 12 })], today, 20)).toBe(0)
    // The live item comes first (same rank, lower id), so a limit of one leaves the draft out.
    expect(reach(library, 'itm_draft001', [topic('a', { calls: 12 })], today, 5, 1)).toBe(0)
    expect(reach(library, 'itm_00000001', [topic('a', { calls: 12 })], today, 5, 1)).toBe(12)
  })
})
