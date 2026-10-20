import { describe, expect, it } from 'vitest'
import { explainApplicability } from '../../../src/domain/applicability.ts'
import { bundle, event, request } from './fixtures.ts'

const scoped = (metrics: string[], filters: Record<string, string[]>, start: string, end: string) =>
  request({ scope: { status: 'resolved', scope: { metrics, filters, window: { start, end } } } })
const norway = { 'dim:market': ['val:market/norway'] }
const orders = event({
  scope: {
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: event().scope.dimensionValues,
  },
})

describe('why an item about any value of a dimension does or does not apply', () => {
  const anyMarket = event({
    scope: { metrics: ['metric:orders'], dimensions: ['dim:market'], dimensionValues: [] },
  })
  it('applies in full to a question that names the dimension or a value of it', () => {
    for (const filters of [norway, { 'dim:market': [] }])
      expect(
        explainApplicability(
          bundle([anyMarket]),
          scoped(['metric:orders'], filters, '2026-08-05', '2026-08-06'),
          anyMarket.id,
        ),
      ).toMatchObject({ applies: true, match: 'exact', restrictions: [] })
  })
  it('names the dimension as what keeps it out of a question that names no market', () => {
    expect(
      explainApplicability(
        bundle([anyMarket]),
        scoped(['metric:orders'], {}, '2026-08-05', '2026-08-06'),
        anyMarket.id,
      ),
    ).toEqual({ applies: false, reason: 'scope', parts: ['dimension'] })
    expect(
      explainApplicability(
        bundle([anyMarket]),
        scoped(['metric:revenue'], {}, '2026-07-01', '2026-07-02'),
        anyMarket.id,
      ),
    ).toEqual({ applies: false, reason: 'scope', parts: ['metric', 'dates', 'dimension'] })
  })
})

describe('why an item does or does not apply (FR-703), from the resolver alone', () => {
  it('applies, fully or only in part', () => {
    expect(explainApplicability(bundle([orders]), request(), orders.id)).toEqual({
      applies: true,
      match: 'exact',
      restrictions: [],
      unverified: false,
    })
    expect(
      explainApplicability(
        bundle([orders]),
        scoped(['metric:orders'], {}, '2026-08-05', '2026-08-06'),
        orders.id,
      ),
    ).toMatchObject({
      applies: true,
      match: 'partial',
      restrictions: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
    })
  })

  it('names the part of the scope that keeps it out', () => {
    const explain = (r: ReturnType<typeof request>) =>
      explainApplicability(bundle([orders]), r, orders.id)
    expect(explain(scoped(['metric:orders'], norway, '2026-07-01', '2026-08-01'))).toEqual({
      applies: false,
      reason: 'scope',
      parts: ['dates'],
    })
    expect(
      explain(
        scoped(
          ['metric:orders'],
          { 'dim:market': ['val:market/spain'] },
          '2026-08-05',
          '2026-08-06',
        ),
      ),
    ).toEqual({ applies: false, reason: 'scope', parts: ['dimension'] })
    expect(explain(scoped(['metric:revenue'], norway, '2026-08-05', '2026-08-06'))).toEqual({
      applies: false,
      reason: 'scope',
      parts: ['metric'],
    })
    expect(
      explain(
        scoped(
          ['metric:revenue'],
          { 'dim:market': ['val:market/spain'] },
          '2026-07-01',
          '2026-07-02',
        ),
      ),
    ).toEqual({ applies: false, reason: 'scope', parts: ['metric', 'dates', 'dimension'] })
  })

  it('reports what the resolver withholds, retires or replaces', () => {
    expect(
      explainApplicability(
        bundle([orders], { stopped: { all: false, areas: [], items: [orders.id] } }),
        request(),
        orders.id,
      ),
    ).toEqual({ applies: false, reason: 'stopped' })
    const replacement = event({ id: 'itm_00000002', scope: orders.scope })
    const old = event({ ...orders, status: 'retired', replacedBy: replacement.id })
    expect(explainApplicability(bundle([old, replacement]), request(), old.id)).toEqual({
      applies: false,
      reason: 'replaced',
      replacedBy: replacement.id,
    })
    expect(
      explainApplicability(bundle([event({ ...orders, status: 'retired' })]), request(), orders.id),
    ).toEqual({ applies: false, reason: 'retired' })
    expect(
      explainApplicability(
        bundle([event({ ...orders, status: 'proposal' })]),
        request(),
        orders.id,
      ),
    ).toEqual({ applies: false, reason: 'not_accepted' })
    expect(explainApplicability(bundle([orders]), request(), 'itm_99999999')).toEqual({
      applies: false,
      reason: 'not_in_edition',
    })
    expect(
      explainApplicability(
        bundle([orders]),
        request({ scope: { status: 'need_more_detail', issues: [] } }),
        orders.id,
      ),
    ).toEqual({ applies: false, reason: 'need_more_detail' })
  })

  it('agrees with the resolver on every window around the item', () => {
    for (const start of ['2026-07-30', '2026-08-03', '2026-08-04', '2026-08-10']) {
      const r = scoped(
        ['metric:orders'],
        norway,
        start,
        '2026-08-05' > start ? '2026-08-05' : '2026-08-11',
      )
      const result = explainApplicability(bundle([orders]), r, orders.id)
      expect(result.applies).toBe(
        r.scope.status === 'resolved' && r.scope.scope.window.end! > '2026-08-04',
      )
    }
  })
})
