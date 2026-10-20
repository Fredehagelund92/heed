import type { GoldenQuestionInput } from '../../src/domain/golden-question.ts'

/*
  Test questions for the demo database (db/seed/demo.ts), a handful per area, about items the
  bulk seed's library holds (generateItems(1500), src/web/mocks/items.ts). Every wording names its
  metric, market and dates, so get_context resolves it on its own, as the scripted answer model
  asks it (src/server/modules/models/mock.ts). Each expects the items an analyst needs and forbids
  one about the same metric elsewhere that must stay out.

  `net-revenue-month-to-date` is the demo's regression, as in the mock (`regression` in
  mocks/items.ts): it expects the Sales note on net revenue and test accounts, which a second
  version ended on 30 September, and its caveat. It passes every weekly run until the one of
  5 October.

  Sales, Marketing and Sandbox wrote theirs in July, before the first weekly run of the demo;
  Customer value wrote its first ones in September, and Paid media in October.

  The mock keeps its own set (src/web/mocks/test-questions.ts): it scripts what an edition
  delivers instead of resolving wordings, and its other areas have no questions on purpose.
*/

type Seeded = Omit<GoldenQuestionInput, 'wordings'> & {
  natural: string
  precise: string
  /** Why it is set aside (FR-514); a set-aside question is counted, never run. */
  setAside?: string
}

const market = (value: string) => [{ dimension: 'dim:market', values: [`val:market/${value}`] }]

const seeded: Seeded[] = [
  // Sales: weekly runs.
  {
    id: 'net-revenue-month-to-date',
    area: 'area_sales',
    natural: 'How is net revenue in Spain doing in October 2026?',
    precise: 'What should an analyst know about net revenue for market Spain in October 2026?',
    scope: { metrics: ['metric:net_revenue'], dimension_filters: market('spain') },
    expected: {
      must_deliver: ['itm_q2upr28v'],
      must_not_deliver: ['itm_q9j454i2'],
      caveat: 'Net revenue excludes test accounts.',
    },
    source: 'Sales analysts, September 2026',
  },
  {
    id: 'orders-united-kingdom-test-accounts',
    area: 'area_sales',
    natural: 'Do the orders in the United Kingdom over the last 7 days include test accounts?',
    precise: 'Which accounts do orders for market United Kingdom leave out in the last 7 days?',
    scope: { metrics: ['metric:orders'], dimension_filters: market('united_kingdom') },
    expected: {
      must_deliver: ['itm_yakb4kwg'],
      must_not_deliver: ['itm_9omvkhl1'],
      caveat: 'Orders excludes test accounts.',
    },
    split: 'held_out',
    source: 'Sales analysts, July 2026',
  },
  {
    id: 'gross-sales-netherlands-before-reporting',
    area: 'area_sales',
    natural:
      'Gross sales in the Netherlands moved over the last 7 days. What should I check before I report it?',
    precise:
      'What should an analyst check before reporting a change in gross sales for market Netherlands in the last 7 days?',
    scope: { metrics: ['metric:gross_sales'], dimension_filters: market('netherlands') },
    expected: { must_deliver: ['itm_joe9y144'], must_not_deliver: ['itm_663ag1km'] },
    risk: 'high',
    source: 'Sales analysts, July 2026',
  },
  {
    id: 'units-sold-spain-may',
    area: 'area_sales',
    natural: 'Why were units sold in Spain low in May 2026?',
    precise: 'What explains units sold for market Spain in May 2026?',
    scope: { metrics: ['metric:units_sold'], dimension_filters: market('spain') },
    expected: { must_deliver: ['itm_rfyaxd6x'], must_not_deliver: ['itm_n6clrfuw'] },
    source: 'Sales analysts, July 2026',
  },
  {
    id: 'cpa-spain-markets',
    area: 'area_sales',
    natural:
      'Is cost per acquisition in Spain over the last 30 days comparable with other markets?',
    precise:
      'How should cost per acquisition for market Spain in the last 30 days be compared with other markets?',
    scope: { metrics: ['metric:cost_per_acquisition'], dimension_filters: market('spain') },
    expected: { must_deliver: ['itm_rcvnm24i'], must_not_deliver: ['itm_n4yuekeq'] },
    source: 'Sales analysts, July 2026',
  },
  {
    id: 'discount-cost-united-kingdom-march',
    area: 'area_sales',
    natural: 'Why did discount cost in the United Kingdom move in March 2026?',
    precise: 'What explains discount cost for market United Kingdom in March 2026?',
    scope: { metrics: ['metric:discount_cost'], dimension_filters: market('united_kingdom') },
    expected: { must_deliver: ['itm_8qygrrm4'] },
    source: 'Sales analysts, July 2026',
    setAside: 'Waiting for the restated March 2026 discount figures.',
  },

  // Marketing: weekly runs.
  {
    id: 'marketing-spend-united-kingdom-test-accounts',
    area: 'area_marketing',
    natural: 'Does marketing spend in the United Kingdom over the last 7 days count test accounts?',
    precise:
      'Which accounts does marketing spend for market United Kingdom leave out in the last 7 days?',
    scope: { metrics: ['metric:marketing_spend'], dimension_filters: market('united_kingdom') },
    expected: {
      must_deliver: ['itm_owky5vyg'],
      must_not_deliver: ['itm_gd8uvf65'],
      caveat: 'Marketing spend excludes test accounts.',
    },
    split: 'held_out',
    source: 'Marketing analysts, July 2026',
  },
  {
    id: 'discount-cost-netherlands-latest-days',
    area: 'area_marketing',
    natural: 'Is discount cost in the Netherlands for the last 2 days complete?',
    precise: 'Is discount cost for market Netherlands in the last 2 days final in the source tool?',
    scope: { metrics: ['metric:discount_cost'], dimension_filters: market('netherlands') },
    expected: {
      must_deliver: ['itm_1y8znds2'],
      must_not_deliver: ['itm_3romadve'],
      caveat: 'Discount cost lags by one day in the source tool.',
    },
    source: 'Marketing analysts, July 2026',
  },
  {
    id: 'net-revenue-canada-definition',
    area: 'area_marketing',
    natural: 'Can I compare net revenue in Canada in March 2025 with the months before?',
    precise: 'What changed in how net revenue for market Canada is defined in March 2025?',
    scope: { metrics: ['metric:net_revenue'], dimension_filters: market('canada') },
    expected: {
      must_deliver: ['itm_q7gmj7cu'],
      caveat: 'Net revenue changed definition on 11 March 2025.',
    },
    source: 'Marketing analysts, July 2026',
  },
  {
    // A question without dates is read at today (FR-304); one that names no metric or market
    // still needs more detail, and a good answer asks which.
    id: 'marketing-no-scope',
    area: 'area_marketing',
    natural: 'How did our numbers do?',
    precise: 'How did our figures change?',
    scope: {},
    expected: { status: 'need_more_detail', clarifying_question: true },
    source: 'Marketing analysts, July 2026',
  },

  // Sandbox (the demo area): weekly runs, like every domain's.
  {
    id: 'sandbox-returns-netherlands-provider',
    area: 'area_sandbox',
    natural: 'Why did returns in the Netherlands change in October 2024?',
    precise: 'What explains returns for market Netherlands in October 2024?',
    scope: { metrics: ['metric:returns'], dimension_filters: market('netherlands') },
    expected: { must_deliver: ['itm_ypdubbwy'], must_not_deliver: ['itm_7ff82z76'] },
    source: 'Sandbox examples, July 2026',
  },
  {
    id: 'sandbox-gross-sales-canada-latest-days',
    area: 'area_sandbox',
    natural: 'Is footwear gross sales in Canada for the last 2 days final?',
    precise:
      'Is gross sales for market Canada and product Footwear in the last 2 days complete in the source tool?',
    scope: {
      metrics: ['metric:gross_sales'],
      dimension_filters: [
        ...market('canada'),
        { dimension: 'dim:product', values: ['val:product/footwear'] },
      ],
    },
    expected: {
      must_deliver: ['itm_vk2tlflh'],
      caveat: 'Gross sales lags by one day in the source tool.',
    },
    split: 'held_out',
    source: 'Sandbox examples, July 2026',
  },
  {
    id: 'sandbox-margin-united-states-drop',
    area: 'area_sandbox',
    natural:
      'Gross margin in the United States dropped over the last 7 days. What should I rule out?',
    precise:
      'How should an analyst investigate a drop in gross margin for market United States in the last 7 days?',
    scope: { metrics: ['metric:gross_margin'], dimension_filters: market('united_states') },
    expected: { must_deliver: ['itm_sq1l7j9x'] },
    risk: 'high',
    source: 'Sandbox examples, July 2026',
  },

  // Customer value.
  {
    id: 'cv-net-revenue-netherlands-test-accounts',
    area: 'area_customer_value',
    natural: 'Does net revenue in the Netherlands over the last 7 days count test accounts?',
    precise: 'Which accounts does net revenue for market Netherlands leave out in the last 7 days?',
    scope: { metrics: ['metric:net_revenue'], dimension_filters: market('netherlands') },
    expected: {
      must_deliver: ['itm_vhsmzho2'],
      caveat: 'Net revenue excludes test accounts.',
    },
    source: 'Customer value analysts, September 2026',
  },
  {
    id: 'cv-repeat-purchase-spain-currency',
    area: 'area_customer_value',
    natural: 'Is repeat purchase rate in Spain over the last 30 days in euros?',
    precise:
      'In which currency is repeat purchase rate for market Spain reported in the last 30 days?',
    scope: { metrics: ['metric:repeat_purchase_rate'], dimension_filters: market('spain') },
    expected: { must_deliver: ['itm_4gnkxqc0'] },
    source: 'Customer value analysts, September 2026',
  },
  {
    id: 'cv-units-per-order-spain-test-accounts',
    area: 'area_customer_value',
    natural: 'Do test accounts show up in units per order for Spain over the last 7 days?',
    precise: 'Which accounts does units per order for market Spain leave out in the last 7 days?',
    scope: { metrics: ['metric:units_per_order'], dimension_filters: market('spain') },
    expected: {
      must_deliver: ['itm_pp72ks7n'],
      must_not_deliver: ['itm_7t72bblx'],
      caveat: 'Units per order excludes test accounts.',
    },
    source: 'Customer value analysts, September 2026',
  },

  // Paid media: a first few.
  {
    id: 'pm-roas-spain-currency',
    area: 'area_paid_media',
    natural: 'Is return on ad spend in Spain over the last 30 days converted to euros?',
    precise:
      'In which currency is return on ad spend for market Spain reported in the last 30 days?',
    scope: { metrics: ['metric:return_on_ad_spend'], dimension_filters: market('spain') },
    expected: { must_deliver: ['itm_a830f497'] },
    source: 'Paid media analysts, October 2026',
  },
  {
    id: 'pm-net-revenue-sweden-latest-days',
    area: 'area_paid_media',
    natural: 'Is net revenue in Sweden for the last 2 days complete?',
    precise: 'Is net revenue for market Sweden in the last 2 days final in the source tool?',
    scope: { metrics: ['metric:net_revenue'], dimension_filters: market('sweden') },
    expected: {
      must_deliver: ['itm_09d3odlm'],
      caveat: 'Net revenue lags by one day in the source tool.',
    },
    source: 'Paid media analysts, October 2026',
  },
]

/** When each area wrote its questions: an hour before that day's editions. */
const savedOn: Record<string, string> = {
  area_sales: '2026-07-16',
  area_marketing: '2026-07-16',
  area_sandbox: '2026-07-16',
  area_customer_value: '2026-09-15',
  area_paid_media: '2026-10-02',
}

/** The questions as the file format has them, when they were saved, and why one is set aside. */
export const demoTestQuestions = seeded.map(({ natural, precise, setAside, ...question }) => ({
  question: {
    ...question,
    wordings: [
      { text: natural, kind: 'natural' as const },
      { text: precise, kind: 'precise' as const },
    ],
  } satisfies GoldenQuestionInput,
  savedAt: `${savedOn[question.area]!}T08:00:00Z`,
  setAside: setAside ?? null,
}))
