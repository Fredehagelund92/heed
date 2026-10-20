import { describe, expect, it } from 'vitest'
import { systemClock } from '../../../src/server/clock.ts'
import { asDelivered, type ServingBundle } from '../../../src/server/modules/editions/index.ts'
import { deliver } from '../../../src/server/modules/evals/index.ts'
import { bundle } from '../mcp/fixtures.ts'

/**
 * Finance and Payments each hold a note on Norway orders; every domain is served. A check
 * "as delivered" (the retrieval pass, answer tests and the review gate) lifts the stops of the one
 * area it is about: an item of another domain that is stopped stays withheld, as it is from
 * agents.
 */
function twoAreas(changes: Partial<ServingBundle> = {}): ServingBundle {
  const base = bundle()
  const own = base.items[0]!
  return {
    ...base,
    areas: [
      { id: 'finance', name: 'Finance', team: 'Regulation', summary: '', description: '' },
      { id: 'payments', name: 'Payments', team: null, summary: '', description: '' },
    ],
    items: [own, { ...own, id: 'itm_payments01', areaId: 'payments', title: 'Payments note' }],
    ...changes,
  }
}

const ask = {
  question: 'Anything I should know about Norway orders this week?',
  metrics: ['metric:orders'],
  dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
  window: { from: '2026-10-01', to: '2026-10-07' },
}
type Reply = {
  status?: string
  items?: { id: string }[]
  check_report?: { withheld?: number }
  delivery_id?: string
}
const reply = async (serving: ServingBundle) => {
  // Each reply has its own delivery id; everything else is what the agent is given.
  const { delivery_id: _, ...given } = (await deliver(
    serving,
    systemClock('2026-10-07'),
    ask,
  )) as Reply
  return given as Reply
}
const ids = (r: Reply) => (r.items ?? []).map((i) => i.id)

describe('a check as delivered', () => {
  it('serves every domain, exactly as served when nothing is stopped', async () => {
    const served = twoAreas()
    expect(ids(await reply(served)).sort()).toEqual(['itm_norway01', 'itm_payments01'])
    expect(await reply(asDelivered(served, 'finance'))).toEqual(await reply(served))
  })

  it("lifts the area's own stops and keeps every other stop", async () => {
    const stopped = (stops: ServingBundle['stopped']) =>
      reply(asDelivered(twoAreas({ stopped: stops }), 'finance'))
    expect(ids(await stopped({ all: true, areas: [], items: [] }))).toEqual(['itm_norway01'])
    expect(ids(await stopped({ all: false, areas: ['finance', 'payments'], items: [] }))).toEqual([
      'itm_norway01',
    ])
    expect(
      ids(await stopped({ all: false, areas: [], items: ['itm_norway01', 'itm_payments01'] })),
    ).toEqual(['itm_norway01'])
  })
})
