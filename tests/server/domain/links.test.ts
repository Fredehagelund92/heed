import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  outgoing,
  related,
  relations,
  type LinkBundle,
  type LinkItem,
  type LinkTerm,
  type RawLink,
} from '../../../src/domain/links.ts'
import { shiftDate } from '../../../src/domain/validity.ts'
import { relatedOracle } from './link-oracle.ts'

const day = (offset: number) => shiftDate('2026-08-01', offset)
const today = '2026-10-07'

function item(id: string, extra: Partial<LinkItem> = {}): LinkItem {
  return {
    id,
    version: 1,
    kind: 'event',
    title: `Title of ${id}`,
    summary: `Summary of ${id}`,
    areaId: 'finance',
    scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
    validity: { start: '2026-08-04', end: null },
    reviewDate: null,
    riskLevel: 'normal',
    checkFlag: null,
    status: 'accepted',
    audience: { kind: 'everyone' },
    conflicts: [],
    proposerId: '',
    ...extra,
  }
}
const orders: LinkTerm = {
  key: 'metric:orders',
  kind: 'metric',
  name: 'Orders',
  aliases: [],
  parentKey: null,
  areaId: 'finance',
  definitionRefs: ['cube:finance.orders'],
  definitions: [{ ref: 'cube:finance.orders', missing: false, renamedTo: null, changeMark: '1' }],
}
const norway: LinkTerm = {
  key: 'val:market/norway',
  kind: 'dimension_value',
  name: 'Norway',
  aliases: [],
  parentKey: 'dim:market',
  areaId: null,
  definitionRefs: [],
  definitions: [],
}
function bundle(items: LinkItem[], links: RawLink[], extra: Partial<LinkBundle> = {}): LinkBundle {
  return {
    edition: '2026-10-07.1',
    overlay: '0',
    items,
    links,
    terms: [orders, norway],
    areas: [
      { id: 'finance', name: 'Finance', team: null },
      { id: 'operations', name: 'Operations', team: null },
    ],
    refMarks: {},
    retired: [],
    metricArea: { 'metric:orders': 'finance' },
    groupsOfMetric: {},
    // Delivery is stopped for Operations, so its items, terms and links are hidden.
    stopped: { all: false, areas: ['operations'], items: [] },
    ...extra,
  }
}
const link = (from: string, rel: string, to: string, label: string | null = null): RawLink => ({
  from_item: from,
  rel,
  to_kind: to.startsWith('itm_')
    ? 'item'
    : to.startsWith('metric:')
      ? 'metric'
      : to.startsWith('val:')
        ? 'dimension_value'
        : 'area',
  to_id: to,
  label,
})

describe('get_related, by example', () => {
  it('lists the items that mention or apply to a metric, with both links and counts', () => {
    const a = item('itm_aaaaaaaa'),
      b = item('itm_bbbbbbbb', { riskLevel: 'high' })
    const data = bundle(
      [a, b],
      [
        link(a.id, 'mentions', 'metric:orders', 'orders'),
        link(a.id, 'applies_to', 'metric:orders'),
        link(b.id, 'applies_to', 'metric:orders'),
      ],
    )
    const result = related(data, { id: 'metric:orders', depth: 1, today })
    expect(result).toMatchObject({
      found: true,
      root: { type: 'metric', id: 'metric:orders', status: 'current' },
      // applies_to before mentioned_by; the higher risk first within one relation.
      nodes: [
        { id: b.id, distance: 1, risk: 'high' },
        { id: a.id, distance: 1 },
      ],
      counts: { applies_to: 2, mentioned_by: 1 },
      withheld: 0,
    })
    expect(result.found && result.edges.map((e) => [e.from, e.rel, e.to])).toEqual([
      [b.id, 'applies_to', 'metric:orders'],
      [a.id, 'applies_to', 'metric:orders'],
      [a.id, 'mentions', 'metric:orders'],
    ])
    // A node carries no body: only what search shows.
    expect(JSON.stringify(result)).not.toContain('"body"')
  })

  it('answers a hidden start exactly like one that does not exist', () => {
    const hidden = item('itm_hidden01', { audience: { kind: 'groups', groups: ['secret'] } })
    const stopped = item('itm_stopped1', { areaId: 'operations' })
    const data = bundle([hidden, stopped], [])
    for (const id of [hidden.id, stopped.id, 'itm_unknown1', 'operations', 'area:operations'])
      expect(related(data, { id, depth: 1, today })).toEqual({ found: false })
    expect(related(data, { id: 'area:finance', depth: 1, today })).toMatchObject({ found: true })
  })

  it('counts hidden neighbours apart and never lists or counts them as neighbours', () => {
    const a = item('itm_aaaaaaaa'),
      secret = item('itm_secret01', {
        title: 'CANARY title',
        audience: { kind: 'groups', groups: ['x'] },
      })
    const data = bundle(
      [a, secret],
      [link(a.id, 'mentions', secret.id, 'the secret'), link(secret.id, 'mentions', a.id)],
    )
    const result = related(data, { id: a.id, depth: 2, today })
    expect(result).toMatchObject({ found: true, nodes: [], counts: {}, withheld: 1 })
    expect(JSON.stringify(result)).not.toContain('CANARY')
    expect(JSON.stringify(result)).not.toContain(secret.id)
  })

  it('shows a retired target as a short marker with the author’s own words', () => {
    const a = item('itm_aaaaaaaa'),
      next = item('itm_nextnext')
    const data = bundle(
      [a, next],
      [link(a.id, 'mentions', 'itm_oldoldol', 'the old licence rule')],
      {
        retired: [
          {
            id: 'itm_oldoldol',
            areaId: 'finance',
            audience: null,
            validity: { start: '2026-01-01', end: '2026-06-01' },
            replacedBy: next.id,
          },
        ],
      },
    )
    const result = related(data, { id: a.id, depth: 2, today })
    expect(result.found && result.nodes).toEqual([
      {
        type: 'item',
        id: 'itm_oldoldol',
        label: 'the old licence rule',
        status: 'replaced',
        replaced_by: next.id,
        distance: 1,
      },
    ])
  })

  it('lists each node once at its shortest distance and keeps edges among listed nodes', () => {
    const a = item('itm_aaaaaaaa'),
      b = item('itm_bbbbbbbb'),
      c = item('itm_cccccccc')
    const data = bundle(
      [a, b, c],
      [
        link(a.id, 'mentions', b.id),
        link(b.id, 'mentions', a.id),
        link(b.id, 'mentions', c.id),
        link(c.id, 'conflicts_with', a.id),
      ],
    )
    const one = related(data, { id: a.id, depth: 1, today, relations: ['mentions'] })
    expect(one.found && one.nodes.map((n) => [n.id, n.distance])).toEqual([[b.id, 1]])
    const two = related(data, { id: a.id, depth: 2, today, relations: ['mentions'] })
    expect(two.found && two.nodes.map((n) => [n.id, n.distance])).toEqual([
      [b.id, 1],
      [c.id, 2],
    ])
    expect(two.found && two.edges.map((e) => [e.from, e.to, e.after])).toEqual([
      [a.id, b.id, 0],
      [b.id, a.id, 0],
      [b.id, c.id, 1],
    ])
  })

  it('follows a domain only through mentions unless in_area is asked for', () => {
    const a = item('itm_aaaaaaaa'),
      b = item('itm_bbbbbbbb')
    const data = bundle([a, b], [link(a.id, 'mentions', 'finance', 'Finance')])
    const mentioned = related(data, { id: 'area:finance', depth: 1, today })
    expect(mentioned.found && mentioned.nodes.map((n) => n.id)).toEqual([a.id])
    const all = related(data, { id: 'finance', depth: 1, today, relations: ['in_area'] })
    expect(all.found && all.nodes.map((n) => n.id)).toEqual([a.id, b.id])
  })

  it('refuses a depth beyond two', () => {
    expect(() => related(bundle([], []), { id: 'finance', depth: 3, today })).toThrow(/Depth/)
  })

  it('keeps the links of a delivered item in the order and shape get_context has always used', () => {
    const a = item('itm_aaaaaaaa')
    const data = bundle([a], [link(a.id, 'mentions', 'val:market/norway', 'Norway')])
    expect(outgoing(data, a, today)).toEqual({
      links: [
        {
          rel: 'mentions',
          target: {
            type: 'dimension_value',
            id: 'val:market/norway',
            label: 'Norway',
            status: 'current',
          },
        },
        {
          rel: 'in_area',
          target: { type: 'area', id: 'finance', label: 'Finance', status: 'current' },
        },
      ],
      withheld: 0,
    })
  })
})

/*
  Property: on random small editions, `related` agrees with the independent oracle for every
  start, relation set, depth and window, and its output does not depend on the order of rows.
*/
const itemIds = ['itm_00000000', 'itm_00000001', 'itm_00000002', 'itm_00000003', 'itm_00000004']
const retiredIds = ['itm_90000000', 'itm_90000001']
const termKeys = ['metric:orders', 'metric:revenue', 'dim:market', 'val:market/norway']
/** Market is a member of two views: an item about Orders is checked through the finance one. */
const marketRefs = ['cube:finance.market', 'cube:operations.market']
const areaIds = ['finance', 'operations']
const targets = [...itemIds, ...retiredIds, ...termKeys, ...areaIds, 'metric:gone', 'nowhere']
const label = fc.constantFrom(null, 'Alpha words', 'Beta words')
/** True about one time in eight: hiding things is the rarer case, so graphs have neighbours. */
const rarely = fc.integer({ min: 0, max: 7 }).map((n) => n === 0)
const itemArb = fc.record({
  areaId: fc.constantFrom(...areaIds),
  restricted: rarely,
  riskLevel: fc.constantFrom('low' as const, 'normal' as const, 'high' as const),
  checkFlag: fc.constantFrom(null, null, null, 'needs_check' as const),
  review: fc.option(fc.integer({ min: 0, max: 120 }), { nil: null }),
  start: fc.integer({ min: 0, max: 40 }),
  length: fc.option(fc.integer({ min: 1, max: 40 }), { nil: null }),
  aboutDeposits: fc.boolean(),
})
const rowArb = fc
  .record({
    from: fc.constantFrom(...itemIds, 'itm_77777777'),
    rel: fc.constantFrom('mentions', 'applies_to', 'replaces', 'conflicts_with'),
    to: fc.constantFrom(...targets),
    label,
    marked: fc.constantFrom(null, '1', '2'),
    repointed: fc.boolean(),
    marketRef: fc.constantFrom(...marketRefs),
  })
  .map((r): RawLink => ({
    from_item: r.from,
    rel: r.rel,
    to_kind: r.to.startsWith('itm_')
      ? 'item'
      : r.to.startsWith('metric:')
        ? 'metric'
        : r.to.startsWith('val:')
          ? 'dimension_value'
          : r.to.startsWith('dim:')
            ? 'dimension'
            : 'area',
    to_id: r.to,
    label: r.label,
    ...(r.rel === 'mentions' && r.to === 'metric:orders'
      ? {
          definition_ref: r.repointed ? 'cube:finance.old' : 'cube:finance.orders',
          change_mark: r.marked,
        }
      : r.rel === 'mentions' && r.to === 'dim:market'
        ? { definition_ref: r.marketRef, change_mark: r.marked }
        : {}),
  }))
/** One member of Market as the source last read it, or none read. */
const marketArb = (ref: string) =>
  fc.constantFrom(
    null,
    { ref, missing: false, renamedTo: null, changeMark: '1' },
    { ref, missing: false, renamedTo: null, changeMark: '2' },
    { ref, missing: true, renamedTo: null, changeMark: '1' },
  )
const definitionArb = fc.constantFrom(
  null,
  { ref: 'cube:finance.orders', missing: false, renamedTo: null, changeMark: '1' },
  { ref: 'cube:finance.orders', missing: false, renamedTo: null, changeMark: '2' },
  { ref: 'cube:finance.orders', missing: true, renamedTo: 'cube:finance.net', changeMark: '1' },
)
const bundleArb = fc
  .record({
    items: fc.tuple(...itemIds.map(() => fc.option(itemArb, { nil: null }))),
    retired: fc.tuple(
      ...retiredIds.map(() =>
        fc.option(
          fc.record({
            areaId: fc.constantFrom(...areaIds),
            restricted: rarely,
            start: fc.integer({ min: 0, max: 40 }),
            replacedBy: fc.constantFrom(null, ...itemIds),
          }),
          { nil: null },
        ),
      ),
    ),
    links: fc.array(rowArb, { minLength: 2, maxLength: 16 }),
    definition: definitionArb,
    market: fc.tuple(...marketRefs.map(marketArb)),
    revenueArea: fc.constantFrom(null, 'operations'),
    refMark: fc.constantFrom(null, '1', '2'),
    all: rarely,
    stoppedAreas: fc.uniqueArray(fc.constantFrom(...areaIds), { maxLength: 1 }),
    stoppedItems: fc.uniqueArray(fc.constantFrom(...itemIds, ...retiredIds), { maxLength: 1 }),
  })
  .map((v): LinkBundle => ({
    edition: '2026-10-07.1',
    overlay: '0',
    items: v.items.flatMap((row, i) =>
      row
        ? [
            item(itemIds[i]!, {
              areaId: row.areaId,
              audience: row.restricted ? { kind: 'groups', groups: ['x'] } : { kind: 'everyone' },
              riskLevel: row.riskLevel,
              checkFlag: row.checkFlag,
              reviewDate: row.review === null ? null : day(row.review),
              scope: {
                metrics: row.aboutDeposits ? ['metric:orders'] : [],
                dimensions: [],
                dimensionValues: [],
              },
              validity: {
                start: day(row.start),
                end: row.length === null ? null : day(row.start + row.length),
              },
            }),
          ]
        : [],
    ),
    retired: v.retired.flatMap((row, i) =>
      row
        ? [
            {
              id: retiredIds[i]!,
              areaId: row.areaId,
              audience: row.restricted ? ['x'] : null,
              validity: { start: day(row.start), end: day(row.start + 10) },
              replacedBy: row.replacedBy,
            },
          ]
        : [],
    ),
    links: v.links,
    terms: [
      { ...orders, definitions: v.definition ? [v.definition] : [] },
      {
        ...orders,
        key: 'metric:revenue',
        name: 'Revenue',
        areaId: v.revenueArea,
        definitionRefs: [],
        definitions: [],
      },
      {
        key: 'dim:market',
        kind: 'dimension',
        name: 'Market',
        aliases: [],
        parentKey: null,
        areaId: null,
        definitionRefs: marketRefs,
        definitions: v.market.flatMap((state) => state ?? []),
      },
      norway,
    ],
    areas: [
      { id: 'finance', name: 'Finance', team: null },
      { id: 'operations', name: 'Operations', team: null },
    ],
    refMarks: v.refMark
      ? Object.fromEntries(
          itemIds.map((id) => [
            id,
            Object.fromEntries(
              ['cube:finance.orders', ...marketRefs].map((ref) => [ref, v.refMark!]),
            ),
          ]),
        )
      : {},
    metricArea: { 'metric:orders': 'finance' },
    groupsOfMetric: {},
    stopped: { all: v.all, areas: v.stoppedAreas, items: v.stoppedItems },
  }))
const requestArb = fc.record({
  id: fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom(...itemIds, ...termKeys) },
    {
      weight: 1,
      arbitrary: fc.constantFrom(...targets, 'area:finance', 'area:nowhere', 'itm_unknown1'),
    },
  ),
  relations: fc.option(fc.uniqueArray(fc.constantFrom(...relations), { minLength: 1 }), {
    nil: undefined,
  }),
  depth: fc.constantFrom(1, 2),
  today: fc.integer({ min: 0, max: 120 }).map(day),
  window: fc.option(
    fc
      .record({ start: fc.integer({ min: 0, max: 60 }), length: fc.integer({ min: 1, max: 30 }) })
      .map((w) => ({ start: day(w.start), end: day(w.start + w.length) })),
    { nil: undefined },
  ),
})

// CPU-bound and deterministic: the default five seconds is too short beside the full suite.
it(
  'agrees with an independent full-scan oracle and ignores the order of rows',
  { timeout: 60_000 },
  () => {
    fc.assert(
      fc.property(bundleArb, requestArb, (data, request) => {
        const output = related(data, request)
        expect(output).toEqual(relatedOracle(data, request))
        expect(
          related(
            { ...data, links: [...data.links].reverse(), items: [...data.items].reverse() },
            request,
          ),
        ).toEqual(output)
      }),
      { seed: 20261008, numRuns: 20_000 },
    )
  },
)
