import type { ItemVersion } from '../../../src/domain/item-version.ts'
import type { EditionBundle, ResolveRequest, ResolverItem } from '../../../src/domain/resolver.ts'
import type { Term } from '../../../src/domain/vocabulary.ts'

export const terms: Term[] = [
  {
    key: 'group:payments',
    kind: 'metric_group',
    name: 'Payments',
    aliases: [],
    parentKey: null,
    areaId: 'finance',
    definitionRefs: [],
  },
  {
    key: 'metric:orders',
    kind: 'metric',
    name: 'Orders',
    aliases: ['Order amount'],
    parentKey: 'group:payments',
    areaId: 'finance',
    definitionRefs: ['cube:payments.orders'],
  },
  {
    key: 'metric:revenue',
    kind: 'metric',
    name: 'Revenue',
    aliases: [],
    parentKey: null,
    areaId: null,
    definitionRefs: ['cube:payments.revenue'],
  },
  {
    key: 'dim:market',
    kind: 'dimension',
    name: 'Market',
    aliases: [],
    parentKey: null,
    areaId: null,
    definitionRefs: [],
  },
  {
    key: 'val:market/norway',
    kind: 'dimension_value',
    name: 'Norway',
    aliases: ['Norge'],
    parentKey: 'dim:market',
    areaId: null,
    definitionRefs: [],
  },
  {
    key: 'val:market/spain',
    kind: 'dimension_value',
    name: 'Spain',
    aliases: [],
    parentKey: 'dim:market',
    areaId: null,
    definitionRefs: [],
  },
]
export function event(overrides: Partial<ResolverItem> = {}): ResolverItem {
  return {
    id: 'itm_00000001',
    version: 1,
    areaId: 'finance',
    scope: {
      metrics: [],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    validity: { start: '2026-08-04', end: null },
    reviewDate: '2026-11-02',
    riskLevel: 'normal',
    checkFlag: null,
    status: 'accepted',
    audience: { kind: 'everyone' },
    summary: 'Norway online sales stopped.',
    conflicts: [],
    proposerId: 'alice',
    ...overrides,
  }
}
export function bundle(items = [event()], overrides: Partial<EditionBundle> = {}): EditionBundle {
  return {
    edition: '2026-08-04.1',
    overlay: '1',
    items,
    groupsOfMetric: { 'metric:orders': ['group:payments'] },
    metricArea: { 'metric:orders': 'finance' },
    stopped: { all: false, areas: [], items: [] },
    ...overrides,
  }
}
export function request(overrides: Partial<ResolveRequest> = {}): ResolveRequest {
  return {
    scope: {
      status: 'resolved',
      scope: {
        metrics: ['metric:orders'],
        filters: { 'dim:market': ['val:market/norway'] },
        window: { start: '2026-08-05', end: '2026-09-01' },
      },
    },
    today: '2026-08-05',
    sizeLimit: 10000,
    dependenciesAvailable: true,
    groups: [],
    hiddenMetrics: [],
    ...overrides,
  }
}
export function version(overrides: Partial<ItemVersion> = {}): ItemVersion {
  return {
    kind: 'event',
    areaId: 'finance',
    title: 'Online sales stopped',
    summary: 'Online sales stopped in Norway.',
    summaryMarkup: 'Online sales stopped in @[Norway](val:market/norway).',
    mentions: [{ field: 'summary', position: 0, target: 'val:market/norway', label: 'Norway' }],
    scope: event().scope,
    validity: event().validity,
    reviewDate: '2026-11-02',
    evidence: [
      { url: 'https://example.com/notice', quote: 'Online sales stopped', date: '2026-08-04' },
    ],
    references: [],
    changeMarks: {},
    claimLevel: 'fact_only',
    riskLevel: 'normal',
    audience: { kind: 'everyone' },
    ownerId: 'owner',
    proposerId: 'alice',
    createdVia: 'form',
    notToConclude: 'cause not proven',
    replaces: [],
    conflicts: [],
    ...overrides,
  }
}
