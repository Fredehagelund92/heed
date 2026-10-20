import { describe, expect, it } from 'vitest'
import { gapTypes } from '@domain/gaps'
import type { Gap, TopicCounts } from '@/api'
import { fitGapColumns, fitTopicColumns } from '@/components/gaps/gap-columns'
import {
  countLabel,
  countText,
  countValue,
  describeGapFilters,
  gapFilterCount,
  gapTypeGroups,
  gapWeeks,
  groupGapRows,
  groupTopicRows,
  shareText,
  shownCount,
  toGapRow,
  topicDomainsText,
  topicTitle,
  toTopicRows,
  visibleGapRows,
  visibleTopicRows,
} from '@/lib/gaps'
import { validateGapsSearch } from '@/lib/search-params'
import { areas, vocabulary } from '@/mocks/reference-data'

const gap = (patch: Partial<Gap> = {}): Gap => ({
  id: 'ca9a0000-0000-4000-8000-000000000001',
  ref: 'gap_7c41d0e2a9',
  topic: {
    areaId: 'area_sales',
    areaIds: ['area_sales'],
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    month: '2026-10-01',
  },
  type: 'missing',
  status: 'open',
  severity: 3,
  openedBy: 'no_item_calls',
  firstSeen: '2026-09-14',
  lastSeen: '2026-10-06',
  statusSince: '2026-09-14T09:00:00Z',
  reports: 6,
  personReports: 0,
  noItemCalls: 40,
  weeks: [],
  proposals: [],
  canManage: true,
  ...patch,
})

describe('the privacy rule for counts (FR-614)', () => {
  it('never shows a value from one to just under the minimum, whoever sent it', () => {
    expect(shownCount(3, 5)).toEqual({ kind: 'fewer', minimum: 5 })
    expect(shownCount(4, 5)).toEqual({ kind: 'fewer', minimum: 5 })
    expect(shownCount(5, 5)).toEqual({ kind: 'value', value: 5 })
    expect(shownCount(0, 5)).toEqual({ kind: 'value', value: 0 })
  })

  it('says "Fewer than" for a hidden cell and "Hidden" for a hidden total', () => {
    expect(countText(shownCount(null, 5, { nullMeansFewer: true }))).toBe('Fewer than 5')
    // A total adds up only the weeks that show, so "fewer than" would not be true.
    expect(countText(shownCount(null, 5))).toBe('Hidden')
    expect(countText(shownCount(1234, 5))).toBe('1,234')
  })

  it('hides every count but zero while the minimum is not known', () => {
    expect(shownCount(12, null)).toEqual({ kind: 'hidden' })
    expect(shownCount(null, null, { nullMeansFewer: true })).toEqual({ kind: 'hidden' })
    expect(shownCount(0, null)).toEqual({ kind: 'value', value: 0 })
  })

  it('gives the chart a number only for a count it may draw', () => {
    expect(countValue(shownCount(2, 5))).toBeNull()
    expect(countLabel(shownCount(2, 5))).toBe('<5')
    expect(countValue(shownCount(9, 5))).toBe(9)
    expect(countLabel(shownCount(null, null))).toBe('-')
  })

  it('applies the rule to every week of a gap, also an owner sees', () => {
    const weeks = gapWeeks(
      gap({
        weeks: [
          { week: '2026-10-05', reports: 2, personReports: 1, noItemCalls: 11 },
          { week: '2026-09-28', reports: null, personReports: null, noItemCalls: 0 },
        ],
      }),
      5,
    )
    expect(
      weeks.map((week) => [week.label, countText(week.reports), countText(week.noItemCalls)]),
    ).toEqual([
      ['5 Oct', 'Fewer than 5', '11'],
      ['28 Sept', 'Fewer than 5', '0'],
    ])
  })

  it('shows a share only when the count behind it shows', () => {
    const counts: TopicCounts = {
      minimumCount: 5,
      hiddenTopicWeeks: 1,
      rows: [
        {
          topic: {
            areaId: null,
            areaIds: [],
            metrics: ['metric:units_sold'],
            dimensions: [],
            dimensionValues: [],
            month: '2026-10-01',
          },
          week: '2026-10-05',
          calls: 26,
          noItemCalls: null,
          noItemShare: null,
        },
        {
          topic: {
            areaId: 'area_sandbox',
            areaIds: ['area_sandbox'],
            metrics: [],
            dimensions: [],
            dimensionValues: [],
            month: '2026-10-01',
          },
          week: '2026-10-05',
          calls: 20,
          noItemCalls: 5,
          noItemShare: 0.25,
        },
      ],
    }
    const rows = toTopicRows(counts, { areas, vocabulary })
    expect(rows.map((row) => [countText(row.noItemCalls), shareText(row.share)])).toEqual([
      ['Fewer than 5', 'Hidden'],
      ['5', '25%'],
    ])
    expect(rows.map((row) => row.areaName)).toEqual([null, 'Sandbox'])
  })
})

describe('the gap rows', () => {
  it('names a topic from its scope in everyday words', () => {
    expect(topicTitle(gap().topic, vocabulary)).toBe('Orders in Norway')
    expect(
      topicTitle(
        {
          areaId: null,
          areaIds: ['area_marketing', 'area_customer_value'],
          metrics: ['metric:active_customers', 'metric:marketing_spend'],
          dimensions: [],
          dimensionValues: [],
          month: '2026-10-01',
        },
        vocabulary,
      ),
    ).toBe('Active customers and Marketing spend')
    expect(
      topicTitle(
        {
          areaId: null,
          areaIds: [],
          metrics: [],
          dimensions: [],
          dimensionValues: [
            { dimension: 'dim:market', value: 'val:market/poland' },
            { dimension: 'dim:product', value: 'val:product/clothing' },
          ],
          month: '2026-10-01',
        },
        vocabulary,
      ),
    ).toBe('Poland and Clothing')
    expect(
      topicTitle(
        {
          areaId: null,
          areaIds: [],
          metrics: [],
          dimensions: [],
          dimensionValues: [],
          month: '2026-10-01',
        },
        vocabulary,
      ),
    ).toBe('Any topic')
    // Without the vocabulary the keys' own words stand in.
    expect(topicTitle(gap().topic, undefined)).toBe('orders in norway')
  })

  it('names the domains of a topic that spans them, and shows the one domain of a topic that has one', () => {
    const spanning = gap({
      topic: {
        ...gap().topic,
        areaId: null,
        areaIds: ['area_marketing', 'area_customer_value'],
        metrics: ['metric:active_customers', 'metric:marketing_spend'],
      },
    })
    expect(topicDomainsText(spanning.topic, areas)).toBe('2 domains: Marketing, Customer value')
    expect(toGapRow(spanning, { areas, vocabulary, minimum: 5 })).toMatchObject({
      areaId: null,
      areaName: null,
      domainsText: '2 domains: Marketing, Customer value',
    })
    // A topic seen before its metric had a domain, which has one now: the domain shows.
    const one = gap({ topic: { ...gap().topic, areaId: null, areaIds: ['area_sales'] } })
    expect(toGapRow(one, { areas, vocabulary, minimum: 5 })).toMatchObject({
      areaId: null,
      areaName: 'Sales',
    })
    expect(topicDomainsText({ areaIds: [] }, areas)).toBe('No domain')
  })

  it('filters by origin: how a gap opened, or for people, any report of theirs', () => {
    const rows = [
      gap(),
      gap({ id: 'agent', openedBy: 'report_gap' }),
      gap({ id: 'person', openedBy: 'person', personReports: 1 }),
      // People reported a gap agents opened; a hidden count does not say they did.
      gap({ id: 'later', openedBy: 'report_gap', personReports: 7 }),
      gap({ id: 'hidden', openedBy: 'report_gap', personReports: null }),
    ].map((row) => toGapRow(row, { areas, vocabulary, minimum: 5 }))
    expect(visibleGapRows(rows, { origin: 'person' }).map((row) => row.id)).toEqual([
      'person',
      'later',
    ])
    expect(visibleGapRows(rows, { origin: 'report_gap' }).map((row) => row.id)).toEqual([
      'agent',
      'later',
      'hidden',
    ])
    expect(rows.map((row) => row.fromPeople)).toEqual([false, false, true, true, false])
    expect(rows[2]?.personReports).toEqual({ kind: 'fewer', minimum: 5 })
    expect(gapFilterCount({ origin: 'person', status: 'open' })).toBe(2)
    expect(describeGapFilters({ origin: 'person' }, () => '')).toBe(
      'Nothing matches Origin: Reported by people.',
    )
  })

  it('filters by status, type, domain and search, and groups open, drafting and closed', () => {
    const rows = [
      gap(),
      gap({ id: 'b', status: 'proposal_made', type: 'outdated' }),
      gap({
        id: 'c',
        status: 'resolved',
        topic: { ...gap().topic, areaId: null, areaIds: ['area_sales', 'area_marketing'] },
      }),
      gap({ id: 'd', status: 'wont_fix' }),
    ].map((row) => toGapRow(row, { areas, vocabulary, minimum: 5 }))
    expect(visibleGapRows(rows, { type: 'outdated' }).map((row) => row.id)).toEqual(['b'])
    // A gap whose topic spans domains shows under each of them.
    expect(visibleGapRows(rows, { area: 'area_sales' })).toHaveLength(4)
    expect(visibleGapRows(rows, { area: 'area_marketing' }).map((row) => row.id)).toEqual(['c'])
    expect(visibleGapRows(rows, { q: 'norway october' })).toHaveLength(4)
    expect(visibleGapRows(rows, { q: 'spain' })).toHaveLength(0)
    expect(
      groupGapRows(rows).map((entry) =>
        entry.type === 'group' ? `${entry.stage}:${entry.count}` : entry.row.id,
      ),
    ).toEqual([
      'open:1',
      'ca9a0000-0000-4000-8000-000000000001',
      'drafting:1',
      'b',
      'closed:2',
      'c',
      'd',
    ])
    expect(rows[2]?.areaName).toBeNull()
    expect(
      describeGapFilters({ status: 'open', type: 'missing', area: 'area_sales' }, () => 'Sales'),
    ).toBe('Nothing matches Status: Open, Type: Missing and Domain: Sales.')
  })

  it('groups topic counts by week, newest first, and filters them by domain', () => {
    const counts: TopicCounts = {
      minimumCount: 5,
      hiddenTopicWeeks: 0,
      rows: ['2026-10-05', '2026-10-05', '2026-09-28'].map((week, index) => ({
        topic: {
          areaId: index === 1 ? 'area_marketing' : 'area_sales',
          areaIds: [index === 1 ? 'area_marketing' : 'area_sales'],
          metrics: ['metric:orders'],
          dimensions: [],
          dimensionValues: [],
          month: '2026-10-01',
        },
        week,
        calls: 10,
        noItemCalls: 0,
        noItemShare: 0,
      })),
    }
    const rows = toTopicRows(counts, { areas, vocabulary })
    expect(groupTopicRows(rows).filter((entry) => entry.type === 'group')).toEqual([
      { type: 'group', week: '2026-10-05', count: 2 },
      { type: 'group', week: '2026-09-28', count: 1 },
    ])
    expect(visibleTopicRows(rows, { area: 'area_marketing' })).toHaveLength(1)
  })
})

describe('the gap columns (direction A)', () => {
  it('shows every column from a 1,216 container, and all but Last seen at 1440 (1,184)', () => {
    expect(fitGapColumns(1216, 24)).toEqual({
      columns: ['type', 'status', 'domain', 'reports', 'noItemCalls', 'lastSeen'],
      narrow: false,
    })
    expect(fitGapColumns(1184, 24).columns).toEqual([
      'type',
      'status',
      'domain',
      'reports',
      'noItemCalls',
    ])
  })

  it('drops Last seen, then Type, then Reports on a rail page at 1024', () => {
    expect(fitGapColumns(976, 24).columns).toEqual(['status', 'domain', 'reports', 'noItemCalls'])
    expect(fitGapColumns(800, 24)).toEqual({ columns: ['status', 'noItemCalls'], narrow: false })
  })

  it('leaves Domain out for one domain, and turns into the narrow row below 768', () => {
    expect(fitGapColumns(1184, 24, { oneDomain: true }).columns).not.toContain('domain')
    expect(fitGapColumns(767, 16).narrow).toBe(true)
    expect(fitTopicColumns(976, 24)).toEqual({
      columns: ['domain', 'calls', 'noItemCalls', 'share'],
      narrow: false,
    })
  })
})

describe('the Gaps address', () => {
  it("keeps the API's statuses and types, and the open gap", () => {
    expect(
      validateGapsSearch({
        view: 'topics',
        status: 'proposal_made',
        type: 'wrong_item_chosen',
        gap: 'ca9a0000-0000-4000-8000-000000000001',
      }),
    ).toEqual({
      view: 'topics',
      status: 'proposal_made',
      type: 'wrong_item_chosen',
      gap: 'ca9a0000-0000-4000-8000-000000000001',
    })
  })

  it('drops the statuses that are not the API’s, and a gap that is not an id', () => {
    expect(validateGapsSearch({ status: 'planned', gap: 'gap_7c41d0e2a9' })).toEqual({
      status: undefined,
      gap: undefined,
    })
  })
})

describe('Report a gap in plain words', () => {
  it('groups every gap type exactly once under three plain questions', () => {
    expect(gapTypeGroups.map((group) => group.label)).toEqual([
      'Something is missing',
      'Something is wrong or out of date',
      'The wrong thing came back',
    ])
    expect(gapTypeGroups.flatMap((group) => group.types).toSorted()).toEqual(
      [...gapTypes].toSorted(),
    )
  })
})
