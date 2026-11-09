import { describe, expect, it } from 'vitest'
import type { ServingBundle } from '../../src/server/modules/editions/index.ts'
import {
  createAskTools,
  overviewTurn,
  turnOf,
  type MadeRead,
  type ToolReads,
} from '../../src/server/modules/answer/index.ts'
import { bundle } from './mcp/fixtures.ts'

/*
  Ask's tools and what code writes of an answer, on a workspace whose dimensions are not the
  demo's (FR-718 to FR-720): a help desk that counts Tickets closed by Team and by Sprint, in one
  domain, Support. Heed is open source, so nothing in the tools, the answer or the page may assume
  a market or any other dimension: every noun comes with the id a typed mention writes, every
  value with its own dimension, and the closest written are counted by whichever dimension the
  question narrowed.
*/

const term = (key: string, kind: 'metric' | 'dimension' | 'dimension_value', name: string, parentKey: string | null = null) => ({
  key,
  kind,
  name,
  aliases: [],
  parentKey,
  areaId: kind === 'metric' ? 'area_support' : null,
  definitionRefs: [],
  definitions: [],
})

/** The help desk's edition: one metric, two dimensions, three items. */
function helpDesk(): ServingBundle {
  const base = bundle()
  const item = (id: string, title: string, values: [string, string][]) => ({
    ...base.items[0]!,
    id,
    areaId: 'area_support',
    title,
    summary: `${title}.`,
    owner: { team: 'Support' },
    review: { ...base.items[0]!.review!, areaId: 'area_support' },
    scope: {
      metrics: ['metric:tickets_closed'],
      dimensions: [],
      dimensionValues: values.map(([dimension, value]) => ({ dimension, value })),
    },
  })
  return {
    ...base,
    terms: [
      term('metric:tickets_closed', 'metric', 'Tickets closed'),
      term('dim:team', 'dimension', 'Team'),
      term('val:team/platform', 'dimension_value', 'Platform', 'dim:team'),
      term('val:team/billing', 'dimension_value', 'Billing', 'dim:team'),
      term('dim:sprint', 'dimension', 'Sprint'),
      term('val:sprint/s41', 'dimension_value', 'Sprint 41', 'dim:sprint'),
    ],
    metricArea: { 'metric:tickets_closed': 'area_support' },
    areas: [
      { id: 'area_support', name: 'Support', team: 'Support', summary: 'The help desk.', description: '' },
    ],
    refMarks: {},
    links: [],
    items: [
      item('itm_platform01', 'Platform closes merged tickets once', [['dim:team', 'val:team/platform']]),
      item('itm_platform02', 'Platform tickets before Sprint 41 are not tagged', [
        ['dim:team', 'val:team/platform'],
        ['dim:sprint', 'val:sprint/s41'],
      ]),
      item('itm_sprint0041', 'Sprint 41 ran a day short for Platform', [
        ['dim:team', 'val:team/platform'],
        ['dim:sprint', 'val:sprint/s41'],
      ]),
    ],
  }
}

const unread = (): never => {
  throw new Error('not read here')
}
const reads: ToolReads = {
  bundle: () => Promise.resolve(helpDesk()),
  index: () =>
    Promise.resolve({
      items: helpDesk().items.map((i) => ({ id: i.id, status: 'accepted', kind: i.kind })),
      loadedAt: '2026-10-23T12:00:00.000Z',
      today: '2026-10-23',
    } as never),
  records: unread,
  areas: () => Promise.resolve([{ id: 'area_support', name: 'Support', ownerIds: ['p_ada'] }]),
  people: () => Promise.resolve([{ id: 'p_ada', name: 'Ada Okafor' }]),
  catalogue: () =>
    Promise.resolve({
      terms: [
        { key: 'metric:tickets_closed', kind: 'metric', definition: null },
        { key: 'dim:team', kind: 'dimension', definition: { valueType: 'string' } },
        { key: 'dim:sprint', kind: 'dimension', definition: { valueType: 'time' } },
      ],
    } as never),
  glossary: unread,
  conflicts: unread,
  inbox: unread,
  asked: unread,
  today: '2026-10-23',
  now: '2026-10-23T12:00:00.000Z',
}

describe('a workspace of teams and sprints', () => {
  it('names every noun by its own id and every value by its own dimension, and no market', async () => {
    const tools = createAskTools(reads)
    const result = await tools.run('get_context', {
      about: 'tickets closed by billing',
      widen: { without: 'values' },
    })
    if (!('state' in result)) throw new Error(result.error)
    expect(result.state).toBe('missing')
    expect(result.read?.about).toEqual(['metric:tickets_closed', 'value:team/billing'])
    expect(result.names).toContainEqual({ id: 'value:team/billing', name: 'Billing', of: 'Team', type: 'string' })
    expect(result.names).toContainEqual({ id: 'value:sprint/s41', name: 'Sprint 41', of: 'Sprint', type: 'time' })
    expect(result.owners).toEqual([
      { domain: 'Support', owners: ['Ada Okafor'], id: 'domain:area_support', people: ['person:p_ada'] },
    ])
    // A nearby item applies to other values of the dimension the subject names: as data.
    expect(result.nearby.map((n) => [n.id, n.reason])).toEqual(
      expect.arrayContaining([['itm_platform01', 'values']]),
    )
    expect(JSON.stringify(result)).not.toMatch(/market/i)

    const turn = turnOf(
      'Nothing written covers [@metric:tickets_closed] for [@value:team/billing].',
      [{ tool: 'get_context', ref: 'r1', input: {}, result } satisfies MadeRead],
      [],
      'tickets closed by billing',
    )
    expect(turn.closest?.by).toBe('dimension:team')
    expect(turn.closest?.counts).toEqual([{ id: 'value:team/platform', count: 3 }])
    expect(turn.nouns.find((n) => n.id === 'dimension:team')?.name).toBe('Team')
    expect(JSON.stringify(turn)).not.toMatch(/market/i)
  })

  it('searches and lists the items with what each applies to, by id', async () => {
    const tools = createAskTools(reads)
    const found = await tools.run('find_context', { words: 'sprint 41' })
    if (!('items' in found)) throw new Error(found.error ?? 'no items')
    const about = new Map(found.items.map((i) => [i.id, i.about]))
    expect(about.get('itm_sprint0041')).toEqual([
      'metric:tickets_closed',
      'value:team/platform',
      'value:sprint/s41',
    ])
    expect(found.items.every((i) => i.domainId === 'domain:area_support')).toBe(true)
    const turn = turnOf('[list:r1]', [{ tool: 'find_context', ref: 'r1', input: {}, result: found }], [])
    expect(turn.body[0]?.t).toBe('list')
    expect(turn.items.length).toBeGreaterThan(0)
    // An overview needs a read with groups; a search has none.
    expect(overviewTurn('x', { from: 'r1' }, [{ tool: 'find_context', ref: 'r1', input: {}, result: found }], [])).toBeNull()
  })
})
