import { expect, it } from 'vitest'
import fc from 'fast-check'
import {
  resolve,
  itemTextSize,
  type EditionBundle,
  type ResolverItem,
} from '../../../src/domain/resolver.ts'
import { shiftDate } from '../../../src/domain/validity.ts'
import { bundle, event, request } from './fixtures.ts'
import { oracle } from './oracle.ts'

const day = (offset: number) => shiftDate('2026-08-01', offset)
const metric = fc.constantFrom('metric:orders', 'metric:revenue', 'group:payments')
const values = fc.uniqueArray(fc.constantFrom('val:market/norway', 'val:market/spain'), {
  maxLength: 2,
})
const itemArb = fc.record({
  start: fc.integer({ min: 0, max: 10 }),
  length: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  metrics: fc.uniqueArray(metric, { maxLength: 2 }),
  values,
  // Dimensions with any value; the market only when the item lists no market value (FR-126).
  anyValue: fc.uniqueArray(fc.constantFrom('dim:market', 'dim:product'), { maxLength: 2 }),
  riskLevel: fc.constantFrom('low' as const, 'normal' as const, 'high' as const),
  checkFlag: fc.constantFrom(null, 'needs_check' as const, 'source_missing' as const),
  status: fc.constantFrom('accepted' as const, 'retired' as const, 'proposal' as const),
  areaId: fc.constantFrom('finance', 'operations'),
  review: fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
  restricted: fc.boolean(),
  summary: fc.string({ minLength: 1, maxLength: 20 }),
  conflicts: fc.uniqueArray(fc.integer({ min: 0, max: 7 }), { maxLength: 3 }),
})
const bundleArb = fc
  .record({
    items: fc.array(itemArb, { maxLength: 8 }),
    all: fc.boolean(),
    areas: fc.uniqueArray(fc.constantFrom('finance', 'operations')),
    stopped: fc.uniqueArray(fc.integer({ min: 0, max: 7 })),
  })
  .map((value): EditionBundle =>
    bundle(
      value.items.map((row, i): ResolverItem =>
        event({
          id: `itm_0000000${i}`,
          areaId: row.areaId,
          scope: {
            metrics: row.metrics,
            dimensions: row.anyValue.filter(
              (dimension) => dimension !== 'dim:market' || row.values.length === 0,
            ),
            dimensionValues: row.values.map((value) => ({ dimension: 'dim:market', value })),
          },
          validity: {
            start: day(row.start),
            end: row.length === null ? null : day(row.start + row.length),
          },
          riskLevel: row.riskLevel,
          checkFlag: row.checkFlag,
          status: row.status,
          summary: row.summary,
          reviewDate: row.review === null ? null : day(row.review),
          audience: row.restricted ? { kind: 'groups', groups: ['finance'] } : { kind: 'everyone' },
          conflicts: row.conflicts.map((i) => `itm_0000000${i}`),
        }),
      ),
      {
        stopped: {
          all: value.all,
          areas: value.areas,
          items: value.stopped.map((i) => `itm_0000000${i}`),
        },
      },
    ),
  )
const requestArb = fc
  .record({
    metrics: fc.uniqueArray(metric),
    values,
    // Whether the question names the market (with or without values) and the product.
    market: fc.boolean(),
    product: fc.boolean(),
    start: fc.integer({ min: 0, max: 10 }),
    length: fc.integer({ min: 1, max: 10 }),
    today: fc.integer({ min: 0, max: 20 }),
    sizeLimit: fc.integer({ min: 0, max: 100 }),
    member: fc.boolean(),
    hidden: fc.boolean(),
    preview: fc.boolean(),
  })
  .map((row) =>
    request({
      scope: {
        status: 'resolved',
        scope: {
          metrics: row.metrics,
          filters: {
            ...(row.market || row.values.length ? { 'dim:market': row.values } : {}),
            ...(row.product ? { 'dim:product': [] } : {}),
          },
          window: { start: day(row.start), end: day(row.start + row.length) },
        },
      },
      today: day(row.today),
      sizeLimit: row.sizeLimit,
      groups: row.member ? ['finance'] : [],
      hiddenMetrics: row.hidden ? ['metric:orders'] : [],
      ...(row.preview
        ? { preview: { personId: 'alice', ownerAreas: [], administrator: false, testRun: false } }
        : {}),
    }),
  )

// CPU-bound and deterministic: the default five seconds is too short beside the full suite.
it(
  'agrees with an independent full-scan oracle on 20,000 boundary-heavy cases',
  { timeout: 60_000 },
  () => {
    fc.assert(
      fc.property(bundleArb, requestArb, (bundle, request) => {
        const output = resolve(bundle, request)
        expect({
          status: output.status,
          items: output.items,
          withheld: output.withheld,
          cut: output.cut,
        }).toEqual(oracle(bundle, request))
        expect(resolve({ ...bundle, items: [...bundle.items].reverse() }, request)).toEqual(output)
        expect(
          output.items.reduce(
            (size, match) =>
              size + itemTextSize(bundle.items.find((item) => item.id === match.id)!),
            0,
          ),
        ).toBeLessThanOrEqual(request.sizeLimit)
      }),
      { seed: 20260804, numRuns: 20_000 },
    )
  },
)
