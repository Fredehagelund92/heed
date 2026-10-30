import type { GapStatus, GapType } from '../../../src/domain/gaps.ts'

/*
  Gaps and topic counts for the fixture world (requirements FR-604 to FR-616): what agents asked
  about and found nothing for, by topic and week, in the eight weeks up to the fixture day
  (2026-10-07; weeks start on Monday). The demo seed writes them into PostgreSQL (db/seed/gaps.ts),
  and tests/integration/seed-demo.test.ts reads them back.

  The numbers are chosen to exercise the privacy rule (FR-614, minimum five): weeks a topic is
  asked about fewer than five times, no-item counts from one to four, a gap Maria cannot see at
  all, one she sees only in part, and one that spans domains. The last gap is the mock's
  regression seen from production (fixtures.ts, `regression`): from 1 October agents asking about
  net revenue in Spain get nothing, a few times in its first week and more in the next.
*/

/** `privacy.min_count`, the setting's default (OQ-6). */
export const GAP_MINIMUM_COUNT = 5

export type GapFixtureTopic = {
  /** The topic's canonical key (area, sorted metrics, sorted values, month). */
  key: string
  areaId: string | null
  metrics: string[]
  values: string[]
  /** Dimensions the questions named without a value. */
  dimensions: string[]
  /** The first day of the topic's calendar month. */
  month: string
  /** Agent calls per week (Monday) and how many of them delivered no item. */
  weeks: { week: string; calls: number; noItemCalls: number }[]
}

export type GapFixture = {
  id: string
  ref: string
  topic: string
  type: GapType
  status: GapStatus
  severity: 1 | 2 | 3 | 4
  /** FR-606: 1 no-item calls, 2 report_gap, 3 negative feedback, 4 a source change, 5 a person. */
  openedByCase: 1 | 2 | 3 | 4 | 5
  firstSeen: string
  lastSeen: string
  statusSince: string
  /** `personReports` is the part of `reports` people made from Try it or the assistant (case 5). */
  weeks: { week: string; reports: number; personReports?: number; noItemCalls: number }[]
  notes: {
    source: 'report_gap' | 'feedback' | 'owner' | 'person'
    note: string
    createdHour: string
  }[]
}

const topic = (
  areaId: string | null,
  metrics: string[],
  values: string[],
  month: string,
  weeks: [week: string, calls: number, noItemCalls: number][],
): GapFixtureTopic => ({
  key: [
    areaId ?? '',
    [...metrics].sort().join(','),
    [...values].sort().join(','),
    month.slice(0, 7),
  ].join('|'),
  areaId,
  metrics,
  values,
  dimensions: [],
  month,
  weeks: weeks.map(([week, calls, noItemCalls]) => ({ week, calls, noItemCalls })),
})

export const gapTopics: GapFixtureTopic[] = [
  topic('area_sales', ['metric:orders'], ['val:market/norway'], '2026-10-01', [
    ['2026-09-14', 18, 6],
    ['2026-09-21', 25, 9],
    ['2026-09-28', 31, 14],
    ['2026-10-05', 22, 11],
  ]),
  topic('area_sales', ['metric:units_sold'], ['val:market/spain'], '2026-09-01', [
    ['2026-09-07', 12, 3],
    ['2026-09-14', 9, 5],
    ['2026-09-21', 4, 4],
  ]),
  topic(
    'area_marketing',
    ['metric:cost_per_acquisition'],
    ['val:channel/marketplace'],
    '2026-10-01',
    [['2026-10-05', 3, 0]],
  ),
  topic('area_sales', [], ['val:market/poland'], '2026-09-01', [['2026-09-07', 14, 0]]),
  topic(null, ['metric:active_customers', 'metric:marketing_spend'], [], '2026-10-01', [
    ['2026-09-28', 16, 8],
    ['2026-10-05', 20, 12],
  ]),
  topic('area_sandbox', ['metric:net_revenue'], ['val:product/clothing'], '2026-08-01', [
    ['2026-08-17', 11, 7],
    ['2026-08-24', 6, 5],
  ]),
  topic(
    'area_customer_value',
    ['metric:repeat_purchase_rate'],
    ['val:platform/ios'],
    '2026-10-01',
    [
      ['2026-09-21', 9, 5],
      ['2026-09-28', 8, 6],
      ['2026-10-05', 10, 7],
    ],
  ),
  topic('area_sales', ['metric:returns'], ['val:market/united_kingdom'], '2026-10-01', [
    ['2026-10-05', 4, 1],
  ]),
  topic(
    'area_paid_media',
    ['metric:return_on_ad_spend'],
    ['val:channel/paid_search'],
    '2026-09-01',
    [
      ['2026-09-14', 7, 0],
      ['2026-09-21', 13, 2],
    ],
  ),
  // Asked about without a gap: what the topic counts show beside the gaps.
  topic('area_sales', ['metric:orders'], ['val:market/spain'], '2026-10-01', [
    ['2026-09-28', 42, 0],
    ['2026-10-05', 37, 0],
  ]),
  topic('area_sales', ['metric:gross_sales'], ['val:product/footwear'], '2026-10-01', [
    ['2026-10-05', 26, 4],
  ]),
  topic('area_marketing', ['metric:new_customers'], ['val:platform/web'], '2026-10-01', [
    ['2026-09-28', 8, 0],
    ['2026-10-05', 2, 0],
  ]),
  topic('area_sales', ['metric:net_revenue'], ['val:market/spain'], '2026-10-01', [
    ['2026-09-28', 4, 3],
    ['2026-10-05', 14, 12],
  ]),
]

const keyOf = (index: number) => gapTopics[index]!.key
const gapId = (n: number) => `ca9a0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

export const gapFixtures: GapFixture[] = [
  {
    id: gapId(1),
    ref: 'gap_7c41d0e2a9',
    topic: keyOf(0),
    type: 'missing',
    status: 'open',
    severity: 3,
    openedByCase: 1,
    firstSeen: '2026-09-14',
    lastSeen: '2026-10-06',
    statusSince: '2026-09-14T09:00:00Z',
    weeks: [
      { week: '2026-09-14', reports: 0, noItemCalls: 6 },
      { week: '2026-09-21', reports: 2, noItemCalls: 9 },
      { week: '2026-09-28', reports: 1, noItemCalls: 14 },
      { week: '2026-10-05', reports: 3, personReports: 1, noItemCalls: 11 },
    ],
    notes: [
      {
        source: 'report_gap',
        note: 'Nothing about the August stop in Norway, so orders there look like a collapse.',
        createdHour: '2026-09-22T10:00:00Z',
      },
      {
        source: 'owner',
        note: 'Likely the customs rule of 4 August. An event item would cover it.',
        createdHour: '2026-09-29T08:00:00Z',
      },
    ],
  },
  {
    id: gapId(2),
    ref: 'gap_b2e95f1c04',
    topic: keyOf(1),
    type: 'outdated',
    status: 'open',
    severity: 2,
    openedByCase: 3,
    firstSeen: '2026-09-08',
    lastSeen: '2026-09-16',
    statusSince: '2026-09-08T11:00:00Z',
    weeks: [
      { week: '2026-09-07', reports: 4, noItemCalls: 3 },
      { week: '2026-09-14', reports: 2, noItemCalls: 5 },
    ],
    notes: [
      {
        source: 'feedback',
        note: 'The answer still used the units sold definition from before the September change.',
        createdHour: '2026-09-09T15:00:00Z',
      },
    ],
  },
  {
    id: gapId(3),
    ref: 'gap_0d93aa7e61',
    topic: keyOf(2),
    type: 'missing',
    status: 'open',
    severity: 2,
    openedByCase: 2,
    firstSeen: '2026-10-05',
    lastSeen: '2026-10-06',
    statusSince: '2026-10-05T13:00:00Z',
    weeks: [{ week: '2026-10-05', reports: 3, noItemCalls: 0 }],
    notes: [
      {
        source: 'report_gap',
        note: 'No context on marketplace cost per acquisition after the October price change.',
        createdHour: '2026-10-05T13:00:00Z',
      },
    ],
  },
  {
    id: gapId(4),
    ref: 'gap_e5f0c3b871',
    topic: keyOf(3),
    type: 'scope_too_narrow',
    status: 'wont_fix',
    severity: 1,
    openedByCase: 3,
    firstSeen: '2026-09-08',
    lastSeen: '2026-09-10',
    statusSince: '2026-09-15T08:00:00Z',
    weeks: [{ week: '2026-09-07', reports: 5, noItemCalls: 0 }],
    notes: [],
  },
  {
    id: gapId(5),
    ref: 'gap_41a7d29be3',
    topic: keyOf(4),
    type: 'contradictory',
    status: 'open',
    severity: 3,
    openedByCase: 3,
    firstSeen: '2026-09-29',
    lastSeen: '2026-10-07',
    statusSince: '2026-09-29T10:00:00Z',
    weeks: [
      { week: '2026-09-28', reports: 4, noItemCalls: 8 },
      { week: '2026-10-05', reports: 6, noItemCalls: 12 },
    ],
    notes: [],
  },
  {
    id: gapId(6),
    ref: 'gap_9e2b6c50d8',
    topic: keyOf(5),
    type: 'incorrect',
    status: 'resolved',
    severity: 2,
    openedByCase: 4,
    firstSeen: '2026-08-18',
    lastSeen: '2026-08-27',
    statusSince: '2026-09-02T14:00:00Z',
    weeks: [
      { week: '2026-08-17', reports: 0, noItemCalls: 7 },
      { week: '2026-08-24', reports: 0, noItemCalls: 5 },
    ],
    notes: [],
  },
  {
    id: gapId(7),
    ref: 'gap_63fd18a0c2',
    topic: keyOf(6),
    type: 'missing',
    status: 'open',
    severity: 2,
    openedByCase: 1,
    firstSeen: '2026-09-21',
    lastSeen: '2026-10-07',
    statusSince: '2026-09-21T09:00:00Z',
    weeks: [
      { week: '2026-09-21', reports: 0, noItemCalls: 5 },
      { week: '2026-09-28', reports: 0, noItemCalls: 6 },
      { week: '2026-10-05', reports: 1, noItemCalls: 7 },
    ],
    notes: [],
  },
  {
    id: gapId(8),
    ref: 'gap_a80c4e9f15',
    topic: keyOf(7),
    type: 'unclear_question',
    status: 'open',
    severity: 1,
    openedByCase: 5,
    firstSeen: '2026-10-06',
    lastSeen: '2026-10-06',
    statusSince: '2026-10-06T16:00:00Z',
    weeks: [{ week: '2026-10-05', reports: 2, personReports: 2, noItemCalls: 1 }],
    notes: [
      {
        source: 'person',
        note: 'Not clear whether returns here means requested or refunded.',
        createdHour: '2026-10-06T16:00:00Z',
      },
    ],
  },
  {
    id: gapId(9),
    ref: 'gap_5b1e7d3a96',
    topic: keyOf(8),
    type: 'wrong_item_chosen',
    status: 'open',
    severity: 2,
    openedByCase: 3,
    firstSeen: '2026-09-15',
    lastSeen: '2026-09-24',
    statusSince: '2026-09-15T12:00:00Z',
    weeks: [
      { week: '2026-09-14', reports: 5, noItemCalls: 0 },
      { week: '2026-09-21', reports: 7, personReports: 5, noItemCalls: 2 },
    ],
    notes: [],
  },
  {
    id: gapId(10),
    ref: 'gap_d4c27e9b13',
    topic: keyOf(12),
    type: 'missing',
    status: 'open',
    severity: 2,
    openedByCase: 1,
    firstSeen: '2026-10-01',
    lastSeen: '2026-10-07',
    statusSince: '2026-10-01T10:00:00Z',
    weeks: [
      { week: '2026-09-28', reports: 0, noItemCalls: 3 },
      { week: '2026-10-05', reports: 0, noItemCalls: 12 },
    ],
    notes: [],
  },
]
