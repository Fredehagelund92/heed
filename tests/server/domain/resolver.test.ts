import { describe, expect, it } from 'vitest'
import {
  resolve,
  type EditionBundle,
  type ResolveRequest,
  type Resolution,
} from '../../../src/domain/resolver.ts'
import { extractScope } from '../../../src/domain/scope.ts'
import { bundle, event, request, terms } from './fixtures.ts'
import { oracle } from './oracle.ts'

type Row = {
  id: string
  bundle: EditionBundle
  request: ResolveRequest
  expected: Partial<Resolution>
}
const windowRequest = (start: string, end: string) =>
  request({
    scope: {
      status: 'resolved',
      scope: {
        metrics: ['metric:orders'],
        filters: { 'dim:market': ['val:market/norway'] },
        window: { start, end },
      },
    },
  })
const id = event().id
const hit = { id }
/** Orders for any market (FR-126). */
const anyMarket = { metrics: ['metric:orders'], dimensions: ['dim:market'], dimensionValues: [] }
const rows: Row[] = [
  {
    id: 'C01 inside validity',
    bundle: bundle(),
    request: request(),
    expected: { status: 'matched', items: [hit] as Resolution['items'] },
  },
  {
    id: 'C02 before validity',
    bundle: bundle(),
    request: windowRequest('2026-07-01', '2026-08-04'),
    expected: { status: 'no_match', items: [] },
  },
  {
    id: 'C03 straddles start',
    bundle: bundle(),
    request: windowRequest('2026-08-01', '2026-09-01'),
    expected: { items: [{ id, startsAfterQuestion: true }] as Resolution['items'] },
  },
  {
    id: 'C04 different market',
    bundle: bundle(),
    request: request({
      scope: extractScope('Orders Spain August 2026', terms, '2026-08-05'),
    }),
    expected: { status: 'no_match', items: [] },
  },
  {
    id: 'C05 unfiltered market ranks below exact',
    bundle: bundle([
      event(),
      event({
        id: 'itm_00000002',
        scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
      }),
    ]),
    request: request({ scope: extractScope('Orders August 2026', terms, '2026-08-05') }),
    expected: {
      items: [
        { id: 'itm_00000002', match: 'exact' },
        {
          id,
          match: 'partial',
          restrictions: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
        },
      ] as Resolution['items'],
    },
  },
  {
    id: 'C06 open-ended validity',
    bundle: bundle(),
    request: windowRequest('2026-12-01', '2027-01-01'),
    expected: { status: 'matched' },
  },
  {
    id: 'C07 after end',
    bundle: bundle([event({ validity: { start: '2026-08-04', end: '2026-08-10' } })]),
    request: windowRequest('2026-09-01', '2026-10-01'),
    expected: { status: 'no_match' },
  },
  {
    id: 'C08 exclusive end boundary',
    bundle: bundle([event({ validity: { start: '2026-08-04', end: '2026-08-10' } })]),
    request: windowRequest('2026-08-10', '2026-08-11'),
    expected: { status: 'no_match' },
  },
  {
    id: 'C09 overdue review',
    bundle: bundle(),
    request: request({ today: '2026-11-03' }),
    expected: { items: [{ id, unverified: true }] as Resolution['items'] },
  },
  {
    id: 'C10 conflicts have no winner',
    bundle: bundle([event({ conflicts: ['itm_00000002'] }), event({ id: 'itm_00000002' })]),
    request: request(),
    expected: { status: 'conflict', items: [hit, { id: 'itm_00000002' }] as Resolution['items'] },
  },
  {
    id: 'C11 metric group member',
    bundle: bundle([
      event({ scope: { metrics: ['group:payments'], dimensions: [], dimensionValues: [] } }),
    ]),
    request: request(),
    expected: { status: 'matched' },
  },
  {
    id: 'C12 outside metric group',
    bundle: bundle([
      event({ scope: { metrics: ['group:payments'], dimensions: [], dimensionValues: [] } }),
    ]),
    request: request({ scope: extractScope('Revenue August 2026', terms, '2026-08-05') }),
    expected: { status: 'no_match' },
  },
  {
    id: 'C13 vocabulary alias',
    bundle: bundle(),
    request: request({
      scope: extractScope('Orders market Norge August 2026', terms, '2026-08-05'),
    }),
    expected: { status: 'matched' },
  },
  {
    id: 'C14 unknown market',
    bundle: bundle(),
    request: request({
      scope: extractScope('Orders market Xland August 2026', terms, '2026-08-05'),
    }),
    expected: {
      status: 'need_more_detail',
      items: [],
      issues: [
        {
          field: 'dim:market',
          input: 'xland',
          options: ['val:market/norway', 'val:market/spain'],
        },
      ],
    },
  },
  {
    id: 'C15 unpublished proposal',
    bundle: bundle([event({ status: 'proposal' })]),
    request: request(),
    expected: { status: 'no_match', items: [] },
  },
  {
    id: 'C16 replacement',
    bundle: bundle([
      event({ status: 'retired', replacedBy: 'itm_00000002' }),
      event({ id: 'itm_00000002' }),
    ]),
    request: request(),
    expected: {
      items: [{ id: 'itm_00000002' }] as Resolution['items'],
      replacements: [{ id, replacedBy: 'itm_00000002' }],
    },
  },
  {
    id: 'C17 restricted audience (parked write path)',
    bundle: bundle([event({ audience: { kind: 'groups', groups: ['finance'] } })]),
    request: request(),
    expected: { items: [], withheld: [{ id, reason: 'audience' }] },
  },
  {
    id: 'C18 changed source',
    bundle: bundle([event({ checkFlag: 'needs_check' })]),
    request: request(),
    expected: {
      items: [{ id, unverified: true, checkFlag: 'needs_check' }] as Resolution['items'],
    },
  },
  {
    // Every domain that exists is served (FR-320): a domain no edition named before still is.
    id: 'C19 a domain just created',
    bundle: bundle([event({ areaId: 'payments' })], {
      metricArea: { 'metric:orders': 'payments' },
    }),
    request: request(),
    expected: { status: 'matched', items: [hit] as Resolution['items'] },
  },
  {
    id: 'C30 an item of another domain about the metric',
    bundle: bundle([event({ areaId: 'marketing' })]),
    request: request(),
    expected: { status: 'matched', items: [hit] as Resolution['items'] },
  },
  {
    id: 'C20 unavailable dependency',
    bundle: bundle(),
    request: request({ dependenciesAvailable: false }),
    expected: { status: 'check_failed', items: [] },
  },
  {
    id: 'C21 fixed cut order',
    bundle: bundle([event({ id: 'itm_00000002', riskLevel: 'low' }), event({ riskLevel: 'high' })]),
    request: request({ sizeLimit: 32 }),
    expected: { items: [hit] as Resolution['items'], cut: ['itm_00000002'] },
  },
  {
    id: 'C22 metric-only scope',
    bundle: bundle([
      event({ scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] } }),
    ]),
    request: request({
      scope: extractScope('Orders Spain August 2026', terms, '2026-08-05'),
    }),
    expected: { status: 'matched' },
  },
  {
    id: 'C23 authorized proposal preview',
    bundle: bundle([event({ status: 'proposal' })]),
    request: request({
      preview: { personId: 'alice', ownerAreas: [], administrator: false, testRun: false },
    }),
    expected: { status: 'matched' },
  },
  {
    id: 'C24 repeatable ordering',
    bundle: bundle([event({ id: 'itm_00000002' }), event()]),
    request: request(),
    expected: { items: [hit, { id: 'itm_00000002' }] as Resolution['items'] },
  },
  {
    id: 'C25 edition pin',
    bundle: bundle(undefined, { edition: '2026-08-05.2' }),
    request: request(),
    expected: { edition: '2026-08-05.2' },
  },
  {
    id: 'C26 source visibility (parked connector path)',
    bundle: bundle([
      event({ scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] } }),
    ]),
    request: request({ hiddenMetrics: ['metric:orders'] }),
    expected: { items: [], withheld: [{ id, reason: 'source_visibility' }] },
  },
  {
    id: 'C27 any market, question about Norway',
    bundle: bundle([event({ scope: anyMarket })]),
    request: request(),
    expected: {
      status: 'matched',
      items: [{ id, match: 'exact', restrictions: [] }] as unknown as Resolution['items'],
    },
  },
  {
    id: 'C28 any market, question by market with no value',
    bundle: bundle([event({ scope: anyMarket })]),
    request: request({
      scope: extractScope('Orders by market August 2026', terms, '2026-08-05'),
    }),
    expected: {
      status: 'matched',
      items: [{ id, match: 'exact', restrictions: [] }] as unknown as Resolution['items'],
    },
  },
  {
    id: 'C29 any market, question names no market',
    bundle: bundle([event({ scope: anyMarket })]),
    request: request({ scope: extractScope('Total orders August 2026', terms, '2026-08-05') }),
    expected: { status: 'no_match', items: [] },
  },
]

describe('a metric group asked for', () => {
  const asked = (stopped: string[]) =>
    resolve(
      bundle([event()], { stopped: { all: false, areas: stopped, items: [] } }),
      request({
        scope: {
          status: 'resolved',
          scope: {
            metrics: ['group:payments'],
            filters: { 'dim:market': ['val:market/norway'] },
            window: { start: '2026-08-05', end: '2026-09-01' },
          },
        },
      }),
    )
  it('stands for its metrics: their items, and their domains for the stop switch', () => {
    expect(asked([])).toMatchObject({ status: 'matched', items: [{ id }] })
    expect(asked(['finance'])).toMatchObject({
      status: 'no_match',
      items: [],
      withheld: [{ id, reason: 'stopped' }],
    })
  })
})

describe('requirements Appendix A, all 30 rows', () => {
  it.each(rows)('$id', (row) => {
    const before = structuredClone({ bundle: row.bundle, request: row.request })
    const output = resolve(row.bundle, row.request)
    expect(output).toMatchObject(row.expected)
    expect(resolve({ ...row.bundle, items: [...row.bundle.items].reverse() }, row.request)).toEqual(
      output,
    )
    for (const other of [...rows].reverse()) resolve(other.bundle, other.request)
    expect(resolve(row.bundle, row.request)).toEqual(output)
    expect({ bundle: row.bundle, request: row.request }).toEqual(before)
  })
  it.each([
    {
      personId: 'stranger',
      ownerAreas: [],
      administrator: false,
      testRun: false,
      allowed: false,
    },
    {
      personId: 'owner',
      ownerAreas: ['finance'],
      administrator: false,
      testRun: false,
      allowed: true,
    },
    { personId: 'admin', ownerAreas: [], administrator: true, testRun: false, allowed: true },
    { personId: 'test', ownerAreas: [], administrator: false, testRun: true, allowed: true },
  ])('enforces preview authority for $personId', ({ allowed, ...preview }) =>
    expect(
      resolve(bundle([event({ status: 'proposal' })]), request({ preview })).items,
    ).toHaveLength(allowed ? 1 : 0),
  )
  it('withholds high-risk unverified items and honors every stop switch', () => {
    expect(
      resolve(bundle([event({ riskLevel: 'high', checkFlag: 'source_missing' })]), request())
        .withheld,
    ).toEqual([{ id, reason: 'high_risk_unverified' }])
    for (const stopped of [
      { all: true, areas: [], items: [] },
      { all: false, areas: ['finance'], items: [] },
      { all: false, areas: [], items: [id] },
    ])
      expect(resolve(bundle(undefined, { stopped }), request()).withheld).toEqual([
        { id, reason: 'stopped' },
      ])
  })
  it('removes the lowest-ranked tail even when a lower-ranked short item could fit', () => {
    const output = resolve(
      bundle([
        event({ summary: 'longer', riskLevel: 'high' }),
        event({ id: 'itm_00000002', summary: 'x', riskLevel: 'low' }),
      ]),
      request({ sizeLimit: 1 }),
    )
    expect(output.items).toEqual([])
    expect(output.cut).toEqual(['itm_00000002', id])
  })
  it('does not derive scope from mentions or missing domain mappings', () => {
    expect(
      resolve(
        bundle([
          event({
            summary: '@[Revenue](metric:revenue)',
            scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
          }),
        ]),
        request({ scope: extractScope('Revenue August 2026', terms, '2026-08-05') }),
      ).items,
    ).toEqual([])
    expect(
      resolve(
        bundle(
          [event({ scope: { metrics: ['metric:revenue'], dimensions: [], dimensionValues: [] } })],
          {
            metricArea: {},
          },
        ),
        request({ scope: extractScope('Revenue August 2026', terms, '2026-08-05') }),
      ).status,
    ).toBe('matched')
  })
})

/*
  An issue is temporary: a partner's reporting is down for twelve days, then comes back. It has
  the same validity as any item, so the same visibility rule applies: while it lasts it is a live
  warning; once it has ended it is history, delivered only for questions about its own period
  and silent for later ones. The questions are asked on 2026-10-08, after the issue ended.
*/
const ended = event({
  id: 'itm_issue001',
  summary: 'Partner reporting for Norway was down; data for these days is not reliable.',
  validity: { start: '2026-08-04', end: '2026-08-16' },
  reviewDate: null,
})
const open = event({
  id: 'itm_issue002',
  summary: 'Partner reporting for Norway is down.',
  validity: { start: '2026-10-02', end: null },
  reviewDate: '2026-10-16',
})
const asked = (start: string, end: string, today = '2026-10-08') => ({
  ...windowRequest(start, end),
  today,
})
const issueRows: Row[] = [
  {
    id: 'I01 ended issue, question inside its period',
    bundle: bundle([ended]),
    request: asked('2026-08-05', '2026-08-12'),
    expected: {
      status: 'matched',
      items: [{ id: ended.id, unverified: false }] as Resolution['items'],
    },
  },
  {
    id: 'I02 ended issue, question after its end',
    bundle: bundle([ended]),
    request: asked('2026-09-01', '2026-10-01'),
    expected: { status: 'no_match', items: [] },
  },
  {
    id: 'I03 ended issue, question from the end day on (end not included)',
    bundle: bundle([ended]),
    request: asked('2026-08-16', '2026-09-01'),
    expected: { status: 'no_match', items: [] },
  },
  {
    id: 'I04 ended issue, question that covers its period and later days',
    bundle: bundle([ended]),
    request: asked('2026-08-01', '2026-10-01'),
    expected: { status: 'matched', items: [{ id: ended.id }] as Resolution['items'] },
  },
  {
    id: 'I05 open issue, question after its start: a live warning',
    bundle: bundle([open]),
    request: asked('2026-10-01', '2026-10-08'),
    expected: {
      status: 'matched',
      items: [{ id: open.id, startsAfterQuestion: true, unverified: false }] as Resolution['items'],
    },
  },
  {
    id: 'I06 open issue, question before its start',
    bundle: bundle([open]),
    request: asked('2026-09-01', '2026-10-01'),
    expected: { status: 'no_match', items: [] },
  },
  {
    id: 'I07 open issue past its review date',
    bundle: bundle([open]),
    request: asked('2026-10-05', '2026-10-20', '2026-10-20'),
    expected: {
      status: 'matched',
      items: [{ id: open.id, unverified: true }] as Resolution['items'],
    },
  },
]

describe('requirements Appendix A, issue rows', () => {
  it.each(issueRows)('$id', (row) => {
    const output = resolve(row.bundle, row.request)
    expect(output).toMatchObject(row.expected)
    const { status, items, withheld, cut } = output
    expect(oracle(row.bundle, row.request)).toEqual({ status, items, withheld, cut })
    // An issue never changes what is delivered for the other items of the edition.
    const both = resolve(bundle([...row.bundle.items, event()]), row.request)
    expect(both.items.filter((m) => m.id !== id)).toEqual(output.items)
  })
})

it('fails a malformed bundle or request instead of returning no match', () => {
  expect(resolve(bundle([event(), event()]), request()).status).toBe('check_failed')
  expect(resolve(bundle(), request({ today: '2026-02-30' })).status).toBe('check_failed')
  expect(resolve(bundle(), request({ sizeLimit: -1 })).status).toBe('check_failed')
  expect(resolve(bundle(), windowRequest('2026-08-05', '2026-08-05')).status).toBe('check_failed')
})
