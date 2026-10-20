import { ORPCError } from '@orpc/server'
import type { ServingBundle } from '../../../src/server/modules/editions/index.ts'
import type { AnonymousRecord, AnonymousStore } from '../../../src/server/mcp/records.ts'
import type { Changes, ServingReads, WaitingTerms } from '../../../src/server/mcp/reads.ts'

export function bundle(): ServingBundle {
  return {
    seq: '1',
    edition: '2026-10-07.1',
    overlay: '0',
    terms: [
      {
        key: 'metric:orders',
        kind: 'metric',
        name: 'Orders',
        aliases: [],
        parentKey: null,
        areaId: 'finance',
        definitionRefs: ['cube:finance.orders'],
        definitions: [
          {
            ref: 'cube:finance.orders',
            missing: false,
            renamedTo: null,
            changeMark: '1',
          },
        ],
        described: {
          ref: 'cube:finance.orders',
          title: 'Finance Orders',
          description: 'The value of paid orders, in euros.',
          tool: 'Cube',
          source: 'Cube local model',
        },
      },
      {
        key: 'dim:market',
        kind: 'dimension',
        name: 'Market',
        aliases: [],
        parentKey: null,
        areaId: null,
        definitionRefs: [],
        definitions: [],
      },
      {
        key: 'val:market/norway',
        kind: 'dimension_value',
        name: 'Norway',
        aliases: [],
        parentKey: 'dim:market',
        areaId: null,
        definitionRefs: [],
        definitions: [],
      },
    ],
    metricArea: { 'metric:orders': 'finance' },
    groupsOfMetric: {},
    stopped: { all: false, areas: [], items: [] },
    areas: [
      {
        id: 'finance',
        name: 'Finance',
        team: 'Regulation',
        summary: 'Orders and returns, by market.',
        description: 'Finance covers **orders** and returns, by market and payment provider.',
      },
    ],
    retired: [],
    refMarks: { itm_norway01: { 'cube:finance.orders': '1' } },
    links: [
      {
        from_item: 'itm_norway01',
        rel: 'mentions',
        to_kind: 'metric',
        to_id: 'metric:orders',
        label: 'Orders',
        definition_ref: 'cube:finance.orders',
        change_mark: '1',
      },
    ],
    items: [
      {
        id: 'itm_norway01',
        version: 1,
        areaId: 'finance',
        kind: 'event',
        title: 'Norway closure',
        summary: 'Online sales stopped on 4 August.',
        body: 'Compare with an unaffected market.',
        riskLevel: 'normal',
        claim: 'fact_only',
        audience: { kind: 'everyone' },
        validity: { start: '2026-08-04', end: null },
        reviewDate: '2027-01-01',
        checkFlag: null,
        status: 'accepted',
        proposerId: '',
        conflicts: [],
        scope: {
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
        },
        owner: { team: 'Regulation' },
        review: {
          acceptedOn: '2026-08-04',
          acceptedAs: 'owner',
          areaId: 'finance',
          edition: '2026-08-04.1',
        },
        notToConclude: 'cause not proven',
        evidence: [
          {
            url: 'https://example.test/law',
            quote: 'Online sales are stopped from 4 August.',
            read_on: '2026-08-05',
          },
        ],
      },
    ],
  }
}
/**
 * The fixture edition with the metric group Revenue and its three metrics, as the definition
 * source groups them: an item about Gross sales and one about Net revenue in Norway,
 * and one about the whole group.
 */
export function withRevenue(data: ServingBundle) {
  const term = (key: string, name: string, kind: 'metric' | 'metric_group' = 'metric') => ({
    key,
    kind,
    name,
    aliases: [],
    parentKey: kind === 'metric' ? 'group:revenue' : null,
    areaId: 'finance',
    definitionRefs: [],
    definitions: [],
  })
  data.terms.push(
    term('group:revenue', 'Revenue', 'metric_group'),
    term('metric:units_sold', 'Units sold'),
    term('metric:net_revenue', 'Net revenue'),
    term('metric:gross_sales', 'Gross sales'),
  )
  const members = ['metric:units_sold', 'metric:net_revenue', 'metric:gross_sales']
  data.metricArea = {
    ...data.metricArea,
    ...Object.fromEntries(members.map((k) => [k, 'finance'])),
  }
  data.groupsOfMetric = Object.fromEntries(members.map((k) => [k, ['group:revenue']]))
  const norway = [{ dimension: 'dim:market', value: 'val:market/norway' }]
  const item = (id: string, metrics: string[], dimensionValues = norway) => ({
    ...data.items[0]!,
    id,
    title: `About ${id}`,
    scope: { metrics, dimensions: [], dimensionValues },
  })
  data.items.push(
    item('itm_gmv0001', ['metric:gross_sales']),
    item('itm_net0001', ['metric:net_revenue']),
    item('itm_revenue01', ['group:revenue'], []),
  )
  return data
}
export function memoryStore() {
  const records: AnonymousRecord[] = []
  const feedback: unknown[] = []
  const gaps: unknown[] = []
  const store: AnonymousStore = {
    write(batch) {
      records.push(...batch)
      return Promise.resolve()
    },
    feedback(...args) {
      feedback.push(args)
      return Promise.resolve()
    },
    reportGap(...args) {
      gaps.push(args)
      return Promise.resolve('00000000-0000-4000-8000-000000000001')
    },
  }
  return { store, records, feedback, gaps }
}

/**
 * Owners, gaps and editions beside the fixture edition: an edition comparison that changed the
 * Norway item, retired one in Finance and added one in a domain agents do not get.
 */
export function fakeReads(
  /** The source members that are no term yet, and who may propose them: none by default. */
  waiting: WaitingTerms = { members: [], canPropose: false },
): ServingReads & { asked: unknown[] } {
  const asked: unknown[] = []
  const changes: Changes = {
    from: '2026-10-06.1',
    to: '2026-10-07.1',
    editions: 1,
    items: [
      {
        itemId: 'itm_norway01',
        change: 'changed',
        title: 'Norway closure',
        areaId: 'finance',
        kind: 'event',
        fields: ['validity', 'notToConclude', 'changeMarks'],
      },
      {
        itemId: 'itm_retired001',
        change: 'retired',
        title: 'A retired note',
        areaId: 'finance',
        kind: 'note',
        fields: [],
      },
      {
        itemId: 'itm_hidden0001',
        change: 'added',
        title: 'Not for agents yet',
        areaId: 'payments',
        kind: 'note',
        fields: [],
      },
    ],
    total: 3,
    vocabulary: 0,
  }
  return {
    asked,
    owners: () => Promise.resolve([{ areaId: 'finance', count: 2 }]),
    openGaps: (areaId) => {
      asked.push({ openGaps: areaId ?? null })
      return Promise.resolve([
        {
          ref: 'gap_k2m4p6q8',
          status: 'open',
          areaId: 'finance',
          metrics: ['metric:orders'],
          dimensionValues: ['val:market/norway'],
          month: '2026-10-01',
          reports: 6,
          noItemCalls: 12,
          lastSeen: '2026-10-06',
        },
      ])
    },
    editions: () =>
      Promise.resolve([
        { label: '2026-10-07.1', live: true, reason: 'proposal_accepted', sealedAt: null },
        { label: '2026-10-06.1', live: false, reason: 'item_retired', sealedAt: null },
      ]),
    changes: (input) => {
      asked.push({ changes: input })
      if (input.from === '2026-01-01.9' || input.to === '2026-01-01.9')
        return Promise.reject(
          new ORPCError('NOT_FOUND', { message: 'Nothing is shared with AI apps yet.' }),
        )
      return Promise.resolve(structuredClone(changes))
    },
    waiting: () => Promise.resolve(structuredClone(waiting)),
  }
}
