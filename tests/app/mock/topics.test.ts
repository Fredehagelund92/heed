import { describe, expect, it } from 'vitest'
import { obsData } from '@/api/mock/data/observability'
import { groupCount, observability, total, visibleTotal } from '@/api/mock/obs-engine'

const { data, couldNotRead, notFoundGroups, rollUp, topicKey, topicName, topicsOf, topicTitle } =
  observability(obsData('normal'))
const TOPICS = data.topics

// Topics as the real key has them (the topics design and its six picks): an exact scope with
// its month, roll-ups only for reading, a hidden month never given away, a gap across a month edge.

const byId = (id: string) => TOPICS.find((t) => t.id === id)!

describe('the topic key', () => {
  it("keeps the month in the key, in the real app's format", () => {
    expect(topicKey(byId('orders-norway'))).toBe(
      'area_sales|metric:orders|val:market/norway|2026-10',
    )
    expect(topicKey(byId('orders-norway-sep'))).toBe(
      'area_sales|metric:orders|val:market/norway|2026-09',
    )
    expect(topicTitle(byId('orders-norway-sep'))).toBe('Orders in Norway, September 2026')
  })
  it('gives a metric group the domain of its metrics, and a topic with no metric none', () => {
    expect(topicKey(byId('revenue-norway'))).toBe(
      'area_sales|group:revenue|val:market/norway|2026-10',
    )
    expect(topicKey(byId('norway-no-metric'))).toBe('||val:market/norway|2026-10')
    expect(topicName(byId('norway-no-metric'))).toBe('Norway, no metric named')
  })
  it("still adds up to the week's 142 calls, and by answer to the Inbox's own numbers", () => {
    const sum = (k: 'grounded' | 'partial' | 'conflict' | 'stale' | 'missing') =>
      TOPICS.reduce((n, t) => n + t.week[k], 0)
    expect(TOPICS.reduce((n, t) => n + total(t.week), 0)).toBe(142)
    expect([
      sum('grounded'),
      sum('partial'),
      sum('conflict'),
      sum('stale'),
      sum('missing'),
    ]).toEqual([94, 12, 4, 7, 25])
  })
})

describe('roll-ups', () => {
  const groups = rollUp(topicsOf({ range: 7 }))
  it('joins the months of a metric and market into one row, the months kept inside', () => {
    const orders = groups.find((g) => g.name === 'Orders in Norway')!
    expect(orders.total).toBe(31)
    expect(orders.months).toEqual(['2026-10', '2026-09'])
    expect(groupCount(orders)).toBe('31')
  })
  it('never gives a month under 5 away by subtraction', () => {
    // Net revenue in Norway: October 13, September 4. Showing 17 would give September's 4 away.
    const revenue = groups.find((g) => g.name === 'Net revenue in Norway')!
    expect(revenue.total).toBe(17)
    expect(revenue.visible).toBeNull()
    expect(groupCount(revenue)).toBe('13+')
    expect(visibleTotal(31, 31)).toBe(31)
    expect(visibleTotal(17, 13)).toBeNull()
    expect(visibleTotal(3, 0)).toBeNull()
  })
})

describe('gaps across a month edge, and calls that could not be read', () => {
  it('counts 3 calls about 30 October and 3 about 1 November as one gap', () => {
    const parts = TOPICS.filter((t) => t.metric === 'Orders' && t.where === 'Germany')
    expect(parts.map((t) => t.week.missing)).toEqual([3, 3])
    const germany = notFoundGroups({ range: 7 }).find((g) => g.name === 'Orders in Germany')!
    expect(germany.counts.missing).toBe(6)
    expect(germany.months).toEqual(['2026-11', '2026-10'])
  })
  it('counts the calls that could not be read, in no domain', () => {
    expect(couldNotRead({ range: 7 })).toBe(9)
    expect(couldNotRead({ range: 7, domain: 'sales' })).toBe(0)
  })
})
