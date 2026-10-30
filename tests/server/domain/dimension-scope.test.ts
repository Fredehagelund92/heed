import { describe, expect, it } from 'vitest'
import { scopeNames } from '../../../src/domain/catalogue.ts'
import { canRead } from '../../../src/domain/links.ts'
import { areaOfMetrics, topicFor } from '../../../src/domain/gap-reports.ts'
import { bundle, event } from './fixtures.ts'

/*
  A scope that names a dimension with any value ("market: any value", FR-126), where it reaches
  beyond the resolver: who may read the item, the catalogue's shelves, and topics.
*/
const anyMarket = { metrics: ['metric:orders'], dimensions: ['dim:market'], dimensionValues: [] }

describe('an item about any value of a dimension', () => {
  it('can be read like any other delivered item (FR-314)', () => {
    const item = event({ scope: anyMarket })
    expect(canRead(bundle([item]), item, '2026-08-05')).toBe(true)
  })

  it('sits on the shelf of its dimension, not of each value (FR-136)', () => {
    const item = {
      scope: { metrics: ['orders'], dimensions: ['market'], dimensionValues: [] },
    }
    expect(scopeNames('dim:market')(item)).toBe(true)
    expect(scopeNames('val:market/norway')(item)).toBe(false)
    expect(scopeNames('dim:product')(item)).toBe(false)
  })
})

describe('a topic (FR-604)', () => {
  const window = { start: '2026-08-05', end: '2026-08-06' }
  it('keeps a dimension named without a value, and the keys of earlier topics', () => {
    expect(
      topicFor(
        {
          metrics: ['metric:orders'],
          filters: { 'dim:market': ['val:market/norway'] },
          window,
        },
        { 'metric:orders': 'finance' },
      ),
    ).toEqual({
      key: 'finance|metric:orders|val:market/norway|2026-08',
      area: 'finance',
      metrics: ['metric:orders'],
      values: ['val:market/norway'],
      dimensions: [],
      month: '2026-08-01',
    })
    expect(
      topicFor(
        { metrics: ['metric:orders'], filters: { 'dim:product': [], 'dim:market': [] }, window },
        { 'metric:orders': 'finance' },
      ),
    ).toMatchObject({
      key: 'finance|metric:orders||2026-08|dim:market,dim:product',
      dimensions: ['dim:market', 'dim:product'],
    })
  })

  it('takes the one area its metrics belong to, as an assistant rating does (FR-712)', () => {
    const metricArea = {
      'metric:orders': 'finance',
      'metric:returns': 'finance',
      'metric:ctr': 'ads',
    }
    expect(areaOfMetrics(['metric:orders', 'metric:returns'], metricArea)).toBe('finance')
    expect(areaOfMetrics(['metric:orders', 'metric:unknown'], metricArea)).toBe('finance')
    // Two areas, or none known, is about no one area.
    expect(areaOfMetrics(['metric:orders', 'metric:ctr'], metricArea)).toBeNull()
    expect(areaOfMetrics(['metric:unknown'], metricArea)).toBeNull()
    expect(areaOfMetrics([], metricArea)).toBeNull()
  })
})
