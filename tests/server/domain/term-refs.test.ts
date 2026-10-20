import { describe, expect, it } from 'vitest'
import { contentDigest } from '../../../src/domain/canonical.ts'
import {
  namesOf,
  refView,
  relevantRefs,
  resolveTerm,
  termDigestContent,
  type Term,
} from '../../../src/domain/vocabulary.ts'

/*
  One dimension, many Cube names (CON-201, CON-208): a term holds every view's member of its
  name, matters to an item only through the members in the views of the item's metrics
  (CON-209, CON-210), and answers to any of its members' names (CON-517).
*/

const market: Term = {
  key: 'dim:market',
  kind: 'dimension',
  name: 'Market',
  aliases: [],
  parentKey: null,
  areaId: null,
  definitionRefs: [
    'cube:marketing_cost.market',
    'cube:store_traffic.market',
    'cube:traffic.market',
  ],
}

describe('the members of a term', () => {
  it('reads the view of a definition ref', () => {
    expect(refView('cube:marketing_cost.market')).toBe('marketing_cost')
    expect(refView('cube:market')).toBeNull()
    expect(refView('git:docs/a.b.market')).toBe('docs/a.b')
  })

  it('matter to an item through the views of its metrics, or all of them', () => {
    const refs = market.definitionRefs
    expect(relevantRefs(refs, ['cube:marketing_cost.cost_eur'])).toEqual([
      'cube:marketing_cost.market',
    ])
    expect(relevantRefs(refs, ['cube:marketing_cost.cost_eur', 'cube:traffic.sessions'])).toEqual([
      'cube:marketing_cost.market',
      'cube:traffic.market',
    ])
    // No metric, or none in a view the term has: every member matters.
    expect(relevantRefs(refs, [])).toEqual(refs)
    expect(relevantRefs(refs, ['cube:stock_levels.units_in_stock'])).toEqual(refs)
    // A term with one member always has it.
    expect(relevantRefs(['cube:marketing_cost.market'], ['cube:traffic.sessions'])).toEqual([
      'cube:marketing_cost.market',
    ])
  })

  it("answers to any of its members' names", () => {
    expect(namesOf(market)).toEqual(
      expect.arrayContaining([
        'cube:marketing_cost.market',
        'marketing_cost.market',
        'store_traffic.market',
        'traffic.market',
      ]),
    )
    for (const name of ['store_traffic.market', 'cube:traffic.market', 'Marketing_Cost.Market'])
      expect(resolveTerm(name, [market], ['dimension'])).toEqual({
        status: 'resolved',
        key: 'dim:market',
      })
  })
})

describe('termDigestContent', () => {
  it('keeps the shape a term with one definition was always digested in', async () => {
    const orders = {
      key: 'metric:orders',
      kind: 'metric' as const,
      parentKey: null,
      name: 'Orders',
      aliases: [],
      areaId: 'finance',
    }
    expect(termDigestContent({ ...orders, definitionRefs: ['cube:payments.orders'] })).toEqual({
      ...orders,
      definitionRef: 'cube:payments.orders',
    })
    expect(termDigestContent({ ...orders, definitionRefs: [] })).toEqual({
      ...orders,
      definitionRef: null,
    })
    // Several definitions digest as a sorted list, whatever order they came in.
    const forward = termDigestContent(market)
    const backward = termDigestContent({
      ...market,
      definitionRefs: [...market.definitionRefs].reverse(),
    })
    expect(forward).toMatchObject({ definitionRefs: market.definitionRefs })
    expect(await contentDigest(backward)).toBe(await contentDigest(forward))
  })
})
