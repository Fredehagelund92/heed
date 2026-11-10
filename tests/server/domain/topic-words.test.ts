import { describe, expect, it } from 'vitest'
import { topicWords } from '../../../src/domain/say.ts'

// A topic of what agents asked, as Observability names it, in any workspace's dimensions: the
// demo's markets, and a workspace with product lines and channels and no market at all. A topic
// with no value used to read "all markets", and one split by a dimension lost the split.

const names: Record<string, string> = {
  'metric:orders': 'Orders',
  'metric:units_sold': 'Units sold',
  'metric:returns': 'Returns',
  'dim:market': 'Market',
  'dim:channel': 'Channel',
  'val:market/norway': 'Norway',
  'val:market/spain': 'Spain',
  'val:channel/webshop': 'Webshop',
  'val:product_line/footwear': 'Footwear',
  'val:product_line/tents': 'Tents',
}
const name = (key: string) => names[key] ?? key
const topic = (metrics: string[], values: string[] = [], dimensions: string[] = []) =>
  topicWords({ metrics, values, dimensions }, name)

describe('the words of a topic', () => {
  it('names the demo market as before', () => {
    expect(topic(['metric:orders'], ['val:market/norway'])).toBe('Orders in Norway')
    expect(topic(['metric:orders'], ['val:market/norway', 'val:market/spain'])).toBe(
      'Orders in Norway and Spain',
    )
  })

  it('says only the metric when no value was named, never "all markets"', () => {
    expect(topic(['metric:units_sold'])).toBe('Units sold')
  })

  it('names the values of any dimension, each dimension once', () => {
    expect(topic(['metric:returns'], ['val:product_line/tents'])).toBe('Returns in Tents')
    expect(topic(['metric:orders'], ['val:product_line/footwear', 'val:channel/webshop'])).toBe(
      'Orders in Webshop for Footwear',
    )
  })

  it('keeps a split by a dimension named without a value', () => {
    expect(topic(['metric:orders'], [], ['dim:channel'])).toBe('Orders by channel')
    expect(topic(['metric:orders'], [], ['dim:market'])).toBe('Orders by market')
  })

  it('says when no metric was named', () => {
    expect(topic([], ['val:market/norway'])).toBe('Norway, no metric named')
    expect(topic([], ['val:channel/webshop'])).toBe('Webshop, no metric named')
    expect(topic([])).toBe('Everything, no metric named')
    expect(topic([], ['val:channel/webshop', 'val:product_line/footwear'])).toBe(
      'Webshop, Footwear, no metric named',
    )
  })
})
