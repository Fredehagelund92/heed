import { describe, expect, it } from 'vitest'
import { figureAskOf } from '@/model/figures'

// What an answer asks of the data. "Footwear orders in August 2026" is read for Footwear, a value
// of the product dimension, and named no market: its figure once read every product's orders and
// showed them as "Orders, 1 to 31 Aug 2026".

const august = { start: '2026-08-01', end: '2026-09-01' }
const answer = {
  metric: 'Orders',
  markets: [],
  dates: '1 to 31 Aug 2026',
  state: 'missing' as const,
  sources: [],
}

describe('the figure an answer asks for', () => {
  it('asks for every value the answer was read for, of any dimension', () => {
    const footwear = {
      ...answer,
      keys: {
        metrics: ['metric:orders'],
        filters: { 'dim:product': ['val:product/footwear'] },
        window: august,
      },
    }
    expect(figureAskOf(footwear)).toEqual({
      metric: 'Orders',
      markets: [],
      values: ['val:product/footwear'],
      dates: '1 to 31 Aug 2026',
      state: 'missing',
      sources: [],
    })
  })

  it('asks for a market by its key too, and for the values of each dimension named', () => {
    const asked = figureAskOf({
      ...answer,
      markets: ['Norway'],
      keys: {
        metrics: ['metric:orders'],
        filters: {
          'dim:channel': ['val:channel/webshop'],
          'dim:market': ['val:market/norway'],
        },
        window: august,
      },
    })
    expect(asked.values).toEqual(['val:channel/webshop', 'val:market/norway'])
  })

  it('asks for the whole metric when the answer split it by a dimension with no value', () => {
    const byChannel = {
      ...answer,
      keys: { metrics: ['metric:orders'], filters: { 'dim:channel': [] }, window: august },
    }
    expect(figureAskOf(byChannel).values).toEqual([])
  })

  it('asks for the markets by name when the answer was not read as keys', () => {
    const asked = figureAskOf({ ...answer, markets: ['Norway'] })
    expect(asked).not.toHaveProperty('values')
    expect(asked.markets).toEqual(['Norway'])
  })
})
