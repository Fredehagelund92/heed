// The demo warehouse's figures, a day at a time: what the mock's answers show and what the http
// journeys and the figures tests seed into a warehouse behind a stand-in Cube
// (tests/server/connectors/demo-warehouse.ts), so both modes read the same numbers. Invented, like
// the rest of Larchwood Outdoor. No imports, so the server's tests read it too.

/** One metric in one market, a day at a time from `from`, in euros. */
export type DailySeries = {
  metric: 'orders' | 'returns' | 'discount_cost'
  market: string
  /** The first day. */
  from: string
  days: number[]
}

/** A total spread over `n` days, the remainder on the last, so the days add up to it exactly. */
export function spread(total: number, n: number): number[] {
  const each = Math.round(total / n)
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - each * (n - 1) : each))
}

export const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0)

/** Orders in Norway in August: three days of sales, then online sales stop on the 4th. */
export const norwayAug = [
  13200,
  13800,
  12400,
  ...Array.from({ length: 28 }, (_, i) => (i % 2 === 0 ? 200 : 100)),
]
/** Orders in Norway in July. */
export const norwayJul = 412600
/** Orders in Spain so far in October, a slow slide, and the same days in September. */
export const spainOct = [
  7300, 7100, 7400, 7200, 6900, 7000, 6800, 6700, 6900, 6600, 6500, 6600, 6400, 6200, 6300, 6100,
  6000, 6200, 5900, 5800, 5700, 5600,
]
export const spainSep = 157400
/** Discount cost in Norway after promotions were paused: it should be close to nothing, and isn't. */
export const discountAfter = 18400
export const discountBefore = 17700
/** Returns in Norway in the three weeks from 20 April, and the three weeks before. */
export const returnsNorway = 61300
export const returnsBefore = 74800

/** Every series the demo warehouse holds. */
export const figureSeries: DailySeries[] = [
  { metric: 'orders', market: 'Norway', from: '2026-07-01', days: spread(norwayJul, 31) },
  { metric: 'orders', market: 'Norway', from: '2026-08-01', days: norwayAug },
  { metric: 'orders', market: 'Spain', from: '2026-09-01', days: spread(spainSep, 22) },
  { metric: 'orders', market: 'Spain', from: '2026-10-01', days: spainOct },
  { metric: 'returns', market: 'Norway', from: '2026-03-30', days: spread(returnsBefore, 21) },
  { metric: 'returns', market: 'Norway', from: '2026-04-20', days: spread(returnsNorway, 21) },
  {
    metric: 'discount_cost',
    market: 'Norway',
    from: '2026-04-16',
    days: spread(discountBefore, 23),
  },
  {
    metric: 'discount_cost',
    market: 'Norway',
    from: '2026-05-09',
    days: spread(discountAfter, 23),
  },
]
