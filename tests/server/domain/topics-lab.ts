import type { AnswerAsk, AnswerSource, AnswerState } from '../../../src/domain/answer.ts'
import type { ResolvedScope } from '../../../src/domain/scope.ts'
import type { Term } from '../../../src/domain/vocabulary.ts'

/*
  The topics lab as fixtures: the 50 plausible phrasings and the 24 named cases with which the
  topics study ran Heed's scope reader on the Larchwood Outdoor names (docs/design/demo-world.md,
  sections 4 to 6). Each records the scope or topic the reader gave then, its known misses
  included: "turnover" is no name, so it loses the metric; a typo is suggested, never chosen; two
  scopes in one question share one topic. A change to the reader that changes what a question is
  read as shows here first, on purpose. Beside each is the state the answer engine gives on the
  small Larchwood library below. A question whose metric is lost reads as its market alone, and
  a market alone gets only the items about no metric, so those questions are Not found here
  although an item about their metric and market exists. DEMO DATA ONLY.
*/

const term = (
  key: string,
  kind: Term['kind'],
  name: string,
  aliases: string[] = [],
  parentKey: string | null = null,
): Term => ({ key, kind, name, aliases, parentKey, areaId: null, definitionRefs: [] })

const metrics: [string, string, string, string[]?][] = [
  ['orders', 'Orders', 'payments'],
  ['returns', 'Returns', 'payments'],
  ['net_revenue', 'Net revenue', 'revenue', ['Net sales']],
  ['gross_sales', 'Gross sales', 'revenue', ['GMV']],
  ['units_sold', 'Units sold', 'revenue'],
  ['active_customers', 'Active customers', 'customers'],
  ['new_customers', 'New customers', 'customers'],
  ['first_time_buyers', 'First-time buyers', 'customers'],
  ['repeat_purchase_rate', 'Repeat purchase rate', 'customers'],
  ['churn_rate', 'Churn rate', 'customers'],
  ['customer_lifetime_value', 'Customer lifetime value', 'customers'],
  ['discount_cost', 'Discount cost', 'marketing'],
  ['marketing_spend', 'Marketing spend', 'marketing'],
  ['cost_per_acquisition', 'Cost per acquisition', 'marketing', ['CPA']],
  ['return_on_ad_spend', 'Return on ad spend', 'marketing'],
  ['conversion_rate', 'Conversion rate', 'marketing'],
  ['average_order_value', 'Average order value', 'basket'],
  ['units_per_order', 'Units per order', 'basket'],
  ['gross_margin', 'Gross margin', 'basket', ['Margin rate']],
  ['online_share', 'Online share', 'basket'],
  ['support_contacts', 'Support contacts', 'operations'],
  ['on_time_shipping_rate', 'On-time shipping rate', 'operations'],
]
const groups = ['Payments', 'Revenue', 'Customers', 'Marketing', 'Basket', 'Operations']
const markets: [string, string, string[]][] = [
  ['norway', 'Norway', ['Norge']],
  ['spain', 'Spain', ['Espana']],
  ['poland', 'Poland', ['Polska']],
  ['france', 'France', []],
  ['germany', 'Germany', ['Deutschland']],
  ['united_kingdom', 'United Kingdom', ['Great Britain', 'UK']],
  ['netherlands', 'Netherlands', []],
  ['italy', 'Italy', []],
  ['canada', 'Canada', []],
  ['united_states', 'United States', ['USA', 'United States of America']],
  ['sweden', 'Sweden', []],
  ['mexico', 'Mexico', []],
]
const values = (dimension: string, rows: [string, string, string[]][]) =>
  rows.map(([key, name, aliases]) =>
    term(`val:${dimension}/${key}`, 'dimension_value', name, aliases, `dim:${dimension}`),
  )

/** The Larchwood vocabulary: 22 metrics in 6 groups, 4 dimensions and their values. */
export const larchwoodTerms: Term[] = [
  ...groups.map((group) => term(`group:${group.toLowerCase()}`, 'metric_group', group)),
  ...metrics.map(([key, name, group, aliases]) =>
    term(`metric:${key}`, 'metric', name, aliases ?? [], `group:${group}`),
  ),
  term('dim:market', 'dimension', 'Market'),
  term('dim:product', 'dimension', 'Product'),
  term('dim:channel', 'dimension', 'Channel'),
  term('dim:platform', 'dimension', 'Platform'),
  ...values('market', markets),
  ...values('product', [
    ['footwear', 'Footwear', ['Shoes']],
    ['clothing', 'Clothing', []],
    ['camping', 'Camping', []],
    ['climbing', 'Climbing', []],
  ]),
  ...values('channel', [
    ['marketplace', 'Marketplace', ['Marketplaces']],
    ['paid_search', 'Paid search', []],
    ['email', 'Email', []],
    ['organic', 'Organic', []],
  ]),
  ...values('platform', [
    ['web', 'Web', []],
    ['ios', 'iOS', []],
    ['android', 'Android', []],
  ]),
]

/** Each metric's domain; On-time shipping rate has none, Return on ad spend is Paid media's. */
export const larchwoodMetricArea: Record<string, string> = Object.fromEntries(
  metrics.flatMap(([key, , group]): [string, string][] =>
    key === 'on_time_shipping_rate'
      ? []
      : key === 'return_on_ad_spend'
        ? [[`metric:${key}`, 'area_paid_media']]
        : group === 'customers'
          ? [[`metric:${key}`, 'area_customer_value']]
          : group === 'marketing'
            ? [[`metric:${key}`, 'area_marketing']]
            : [[`metric:${key}`, 'area_sales']],
  ),
)
export const larchwoodGroupsOfMetric: Record<string, string[]> = Object.fromEntries(
  metrics.map(([key, , group]) => [`metric:${key}`, [`group:${group}`]]),
)

const item = (
  id: string,
  kind: AnswerSource['kind'],
  title: string,
  scope: { metrics: string[]; values?: string[]; dimensions?: string[] },
  validity: { start: string; end: string | null },
  more: Partial<AnswerSource> = {},
): AnswerSource => ({
  id,
  version: 1,
  areaId: larchwoodMetricArea[scope.metrics[0] ?? ''] ?? 'area_sales',
  kind,
  title,
  summary: `${title}.`,
  scope: {
    metrics: scope.metrics,
    dimensions: scope.dimensions ?? [],
    dimensionValues: (scope.values ?? []).map((value) => ({
      dimension: `dim:${value.slice(4).split('/')[0]}`,
      value,
    })),
  },
  validity,
  reviewDate: '2027-01-15',
  riskLevel: 'normal',
  checkFlag: null,
  status: 'accepted',
  audience: { kind: 'everyone' },
  conflicts: [],
  proposerId: '',
  ...more,
})

/** A small Larchwood library: events, a note past its check date, a guide and a disagreement. */
export const larchwoodLibrary: AnswerSource[] = [
  item(
    'itm_nostop001',
    'event',
    'Online sales to Norway stopped on 4 August 2026',
    { metrics: ['metric:orders', 'metric:net_revenue'], values: ['val:market/norway'] },
    { start: '2026-08-04', end: null },
  ),
  item(
    'itm_esvat0001',
    'event',
    'New VAT rate applied in Spain from 1 September 2026',
    { metrics: ['metric:net_revenue'], values: ['val:market/spain'] },
    { start: '2026-09-01', end: null },
  ),
  item(
    'itm_plcurr001',
    'note',
    'Orders is reported in local currency before conversion',
    { metrics: ['metric:orders'], values: ['val:market/poland'] },
    { start: '2026-01-01', end: null },
    { reviewDate: '2026-09-30' },
  ),
  item(
    'itm_ukretrn01',
    'issue',
    'Returns were counted twice in the United Kingdom',
    { metrics: ['metric:returns'], values: ['val:market/united_kingdom'] },
    { start: '2026-09-01', end: '2026-10-01' },
  ),
  item(
    'itm_cpaguide1',
    'guide',
    'What to check before you explain a change in cost per acquisition',
    { metrics: ['metric:cost_per_acquisition'] },
    { start: '2026-01-01', end: null },
  ),
  item(
    'itm_seroas001',
    'note',
    'Return on ad spend in Sweden counts store pick-up orders',
    { metrics: ['metric:return_on_ad_spend'], values: ['val:market/sweden'] },
    { start: '2026-10-01', end: null },
    { conflicts: ['itm_seroas002'] },
  ),
  item(
    'itm_seroas002',
    'note',
    'Return on ad spend in Sweden leaves store pick-up orders out',
    { metrics: ['metric:return_on_ad_spend'], values: ['val:market/sweden'] },
    { start: '2026-10-01', end: null },
    { conflicts: ['itm_seroas001'] },
  ),
  item(
    'itm_footwear1',
    'note',
    'Units sold counts a pair of shoes as one unit',
    { metrics: ['metric:units_sold'], values: ['val:product/footwear'] },
    { start: '2026-01-01', end: null },
  ),
  item(
    'itm_nlstop001',
    'event',
    'Online sales to the Netherlands stopped on 13 February 2026',
    { metrics: ['metric:orders'], values: ['val:market/netherlands'] },
    { start: '2026-02-13', end: '2026-09-25' },
  ),
]

/** A phrasing with no fields from the agent: what it was read as (its topic key), and its state. */
export type Phrasing = {
  kind:
    | 'clean'
    | 'other name'
    | 'synonym'
    | 'typo'
    | 'no scope'
    | 'two scopes'
    | 'range'
    | 'dimension'
    | 'group'
  question: string
  /** The topic the scope reader gives; null when it reads no scope. */
  topic: string | null
  state: AnswerState
}

/** The 50 phrasings, read on 22 October 2026. */
export const PHRASINGS_TODAY = '2026-10-22'
export const phrasings: Phrasing[] = [
  {
    kind: 'clean',
    question: 'What were orders in Norway last month?',
    topic: 'area_sales|metric:orders|val:market/norway|2026-09',
    state: 'grounded',
  },
  {
    kind: 'clean',
    question: 'Net revenue in Spain this quarter',
    topic: 'area_sales|metric:net_revenue|val:market/spain|2026-10',
    state: 'grounded',
  },
  {
    kind: 'clean',
    question: 'How many units did we sell in Poland in September?',
    topic: '||val:market/poland|2026-09',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'What is the churn rate in Sweden?',
    topic: 'area_customer_value|metric:churn_rate|val:market/sweden|2026-10',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'Show me average order value for Germany',
    topic: 'area_sales|metric:average_order_value|val:market/germany|2026-10',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'Marketing spend in the Netherlands last week',
    topic: 'area_marketing|metric:marketing_spend|val:market/netherlands|2026-10',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'What is our conversion rate in France?',
    topic: 'area_marketing|metric:conversion_rate|val:market/france|2026-10',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'Gross margin in Italy in Q3 2026',
    topic: 'area_sales|metric:gross_margin|val:market/italy|2026-07',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'Active customers in Canada this month',
    topic: 'area_customer_value|metric:active_customers|val:market/canada|2026-10',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'Return on ad spend in Sweden for Black Friday',
    topic: 'area_paid_media|metric:return_on_ad_spend|val:market/sweden|2026-10',
    state: 'conflict',
  },
  {
    kind: 'clean',
    question: 'Discount cost in the United States in October',
    topic: 'area_marketing|metric:discount_cost|val:market/united_states|2026-10',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'Customer lifetime value in Mexico',
    topic: 'area_customer_value|metric:customer_lifetime_value|val:market/mexico|2026-10',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'Why did orders drop in Norway on 4 August?',
    topic: 'area_sales|metric:orders|val:market/norway|2026-08',
    state: 'grounded',
  },
  {
    kind: 'clean',
    question: 'Do returns in Norway include store credit?',
    topic: 'area_sales|metric:returns|val:market/norway|2026-10',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'Is online share in Spain affected by the new rule?',
    topic: 'area_sales|metric:online_share|val:market/spain|2026-10',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'How is first-time buyers trending in the UK?',
    topic: 'area_customer_value|metric:first_time_buyers|val:market/united_kingdom|2026-10',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'What counts as net revenue in Norway?',
    topic: 'area_sales|metric:net_revenue|val:market/norway|2026-10',
    state: 'partial',
  },
  {
    kind: 'clean',
    question: 'Units per order, Poland, last 30 days',
    topic: 'area_sales|metric:units_per_order|val:market/poland|2026-09',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'Repeat purchase rate in Germany',
    topic: 'area_customer_value|metric:repeat_purchase_rate|val:market/germany|2026-10',
    state: 'missing',
  },
  {
    kind: 'clean',
    question: 'New customers in Norway this week',
    topic: 'area_customer_value|metric:new_customers|val:market/norway|2026-10',
    state: 'missing',
  },
  {
    kind: 'other name',
    question: 'Net sales in Norge last month',
    topic: 'area_sales|metric:net_revenue|val:market/norway|2026-09',
    state: 'grounded',
  },
  {
    kind: 'other name',
    question: 'GMV for the UK in September',
    topic: 'area_sales|metric:gross_sales|val:market/united_kingdom|2026-09',
    state: 'missing',
  },
  {
    kind: 'other name',
    question: 'CPA in Deutschland this month',
    topic: 'area_marketing|metric:cost_per_acquisition|val:market/germany|2026-10',
    state: 'grounded',
  },
  {
    kind: 'other name',
    question: 'Margin rate in Espana',
    topic: 'area_sales|metric:gross_margin|val:market/spain|2026-10',
    state: 'missing',
  },
  {
    kind: 'other name',
    question: 'Sales of Shoes in Sweden',
    topic: '||val:market/sweden,val:product/footwear|2026-10',
    state: 'missing',
  },
  {
    kind: 'synonym',
    question: 'What was turnover in Norway in August?',
    topic: '||val:market/norway|2026-08',
    state: 'missing',
  },
  {
    kind: 'synonym',
    question: 'Revenue in Norway last month',
    topic: '|group:revenue|val:market/norway|2026-09',
    state: 'partial',
  },
  {
    kind: 'synonym',
    question: 'How much money did we make in Spain in Q3?',
    topic: '||val:market/spain|2026-07',
    state: 'missing',
  },
  {
    kind: 'synonym',
    question: 'Number of purchases in Poland last week',
    topic: '||val:market/poland|2026-10',
    state: 'missing',
  },
  {
    kind: 'synonym',
    question: 'How many people bought from us in Canada?',
    topic: '||val:market/canada|2026-10',
    state: 'missing',
  },
  {
    kind: 'synonym',
    question: 'Basket size in Germany',
    topic: '|group:basket|val:market/germany|2026-10',
    state: 'missing',
  },
  {
    kind: 'typo',
    question: 'Net revenu in Norway in August',
    topic: '||val:market/norway|2026-08',
    state: 'missing',
  },
  {
    kind: 'typo',
    question: 'Orders in Norwy last month',
    topic: 'area_sales|metric:orders||2026-09',
    state: 'partial',
  },
  {
    kind: 'typo',
    question: 'Cost per aquisition in Germany',
    topic: '||val:market/germany|2026-10',
    state: 'missing',
  },
  {
    kind: 'typo',
    question: 'Chrun rate in Sweden',
    topic: '||val:market/sweden|2026-10',
    state: 'missing',
  },
  {
    kind: 'typo',
    question: 'Retruns in Spain',
    topic: '||val:market/spain|2026-10',
    state: 'missing',
  },
  { kind: 'no scope', question: 'How are we doing?', topic: null, state: 'missing' },
  { kind: 'no scope', question: 'What changed this week?', topic: null, state: 'missing' },
  { kind: 'no scope', question: 'Is the data fresh?', topic: null, state: 'missing' },
  {
    kind: 'no scope',
    question: 'Tell me about our best market',
    topic: '|||2026-10|dim:market',
    state: 'missing',
  },
  {
    kind: 'two scopes',
    question: 'Net revenue in Norway and Spain last month',
    topic: 'area_sales|metric:net_revenue|val:market/norway,val:market/spain|2026-09',
    state: 'grounded',
  },
  {
    kind: 'two scopes',
    question: 'Orders in Norway and net revenue in Spain',
    topic: 'area_sales|metric:net_revenue,metric:orders|val:market/norway,val:market/spain|2026-10',
    state: 'partial',
  },
  {
    kind: 'two scopes',
    question: 'Compare orders in Poland with orders in Spain',
    topic: 'area_sales|metric:orders|val:market/poland,val:market/spain|2026-10',
    state: 'partial',
  },
  {
    kind: 'two scopes',
    question: 'Orders and returns in Norway',
    topic: 'area_sales|metric:orders,metric:returns|val:market/norway|2026-10',
    state: 'partial',
  },
  {
    kind: 'range',
    question: 'Net revenue in Norway from 15 August to 15 September',
    topic: 'area_sales|metric:net_revenue|val:market/norway|2026-08',
    state: 'grounded',
  },
  {
    kind: 'range',
    question: 'Orders in Norway in Q3',
    topic: 'area_sales|metric:orders|val:market/norway|2026-07',
    state: 'grounded',
  },
  {
    kind: 'range',
    question: 'Net revenue in Norway this year so far',
    topic: 'area_sales|metric:net_revenue|val:market/norway|2026-01',
    state: 'grounded',
  },
  {
    kind: 'dimension',
    question: 'Orders by market last month',
    topic: 'area_sales|metric:orders||2026-09|dim:market',
    state: 'partial',
  },
  {
    kind: 'dimension',
    question: 'Net revenue by product in Norway',
    topic: 'area_sales|metric:net_revenue|val:market/norway|2026-10|dim:product',
    state: 'partial',
  },
  {
    kind: 'group',
    question: 'Revenue in Norway this month',
    topic: '|group:revenue|val:market/norway|2026-10',
    state: 'partial',
  },
]

/** A named case: what the agent sent beside the words, the scope read, its topic, its state. */
export type LabCase = {
  label: string
  ask: Extract<AnswerAsk, { question: string }>
  scope: ResolvedScope | null
  topic: string | null
  state: AnswerState
}

const norway = { 'dim:market': ['val:market/norway'] }
const august = { start: '2026-08-01', end: '2026-09-01' }

/** The 24 named cases, read on 25 October 2026. */
export const CASES_TODAY = '2026-10-25'
export const labCases: LabCase[] = [
  {
    label: 'A1 text only, August',
    ask: { question: 'What were orders in Norway in August 2026?' },
    scope: { metrics: ['metric:orders'], filters: norway, window: august },
    topic: 'area_sales|metric:orders|val:market/norway|2026-08',
    state: 'grounded',
  },
  {
    label: 'A2 text only, September',
    ask: { question: 'What were orders in Norway in September 2026?' },
    scope: {
      metrics: ['metric:orders'],
      filters: norway,
      window: { start: '2026-09-01', end: '2026-10-01' },
    },
    topic: 'area_sales|metric:orders|val:market/norway|2026-09',
    state: 'grounded',
  },
  {
    label: 'A3 text, no month',
    ask: { question: 'How are orders in Norway doing?' },
    scope: {
      metrics: ['metric:orders'],
      filters: norway,
      window: { start: '2026-10-25', end: '2026-10-26' },
    },
    topic: 'area_sales|metric:orders|val:market/norway|2026-10',
    state: 'partial',
  },
  {
    label: 'A4 structured: synonym + alias',
    ask: {
      question: 'How much did we make in Norge?',
      metrics: ['Net sales'],
      dimension_filters: [{ dimension: 'Market', values: ['Norge'] }],
      window: { from: '2026-08-01', to: '2026-08-31' },
    },
    scope: { metrics: ['metric:net_revenue'], filters: norway, window: august },
    topic: 'area_sales|metric:net_revenue|val:market/norway|2026-08',
    state: 'grounded',
  },
  {
    label: 'B1 synonym turnover (text)',
    ask: { question: 'What was turnover in Norway in August 2026?' },
    scope: { metrics: [], filters: norway, window: august },
    topic: '||val:market/norway|2026-08',
    state: 'missing',
  },
  {
    label: 'B2 turnover structured by agent',
    ask: { question: 'What was turnover in Norway in August 2026?', metrics: ['turnover'] },
    scope: null,
    topic: null,
    state: 'missing',
  },
  {
    label: 'C1 no scope',
    ask: { question: 'How are we doing?' },
    scope: null,
    topic: null,
    state: 'missing',
  },
  {
    label: 'C2 no scope, dates only',
    ask: { question: 'What happened in August 2026?' },
    scope: null,
    topic: null,
    state: 'missing',
  },
  {
    label: 'D1 two markets',
    ask: { question: 'Net revenue in Norway and Spain in August 2026' },
    scope: {
      metrics: ['metric:net_revenue'],
      filters: { 'dim:market': ['val:market/norway', 'val:market/spain'] },
      window: august,
    },
    topic: 'area_sales|metric:net_revenue|val:market/norway,val:market/spain|2026-08',
    state: 'partial',
  },
  {
    label: 'D2 two scopes in one',
    ask: { question: 'Orders in Norway and net revenue in Spain in August 2026' },
    scope: {
      metrics: ['metric:net_revenue', 'metric:orders'],
      filters: { 'dim:market': ['val:market/norway', 'val:market/spain'] },
      window: august,
    },
    topic: 'area_sales|metric:net_revenue,metric:orders|val:market/norway,val:market/spain|2026-08',
    state: 'partial',
  },
  {
    label: 'E1 range across months',
    ask: { question: 'Net revenue in Norway from 15 August to 15 September 2026' },
    scope: {
      metrics: ['metric:net_revenue'],
      filters: norway,
      window: { start: '2026-08-15', end: '2026-09-16' },
    },
    topic: 'area_sales|metric:net_revenue|val:market/norway|2026-08',
    state: 'grounded',
  },
  {
    label: 'E2 whole quarter',
    ask: { question: 'Net revenue in Norway in Q3 2026' },
    scope: {
      metrics: ['metric:net_revenue'],
      filters: norway,
      window: { start: '2026-07-01', end: '2026-10-01' },
    },
    topic: 'area_sales|metric:net_revenue|val:market/norway|2026-07',
    state: 'grounded',
  },
  {
    label: 'E3 last 30 days',
    ask: { question: 'Net revenue in Norway in the last 30 days' },
    scope: {
      metrics: ['metric:net_revenue'],
      filters: norway,
      window: { start: '2026-09-26', end: '2026-10-26' },
    },
    topic: 'area_sales|metric:net_revenue|val:market/norway|2026-09',
    state: 'grounded',
  },
  {
    label: 'F1 typo',
    ask: { question: 'Net revenu in Norwy in August 2026' },
    scope: null,
    topic: null,
    state: 'missing',
  },
  {
    label: 'F2 typo metric only',
    ask: { question: 'Net revenu in Norway in August 2026' },
    scope: { metrics: [], filters: norway, window: august },
    topic: '||val:market/norway|2026-08',
    state: 'missing',
  },
  {
    label: 'G1 group',
    ask: { question: 'Revenue in Norway in August 2026' },
    scope: { metrics: ['group:revenue'], filters: norway, window: august },
    topic: '|group:revenue|val:market/norway|2026-08',
    state: 'partial',
  },
  {
    label: 'G2 metric',
    ask: { question: 'Net revenue in Norway in August 2026' },
    scope: { metrics: ['metric:net_revenue'], filters: norway, window: august },
    topic: 'area_sales|metric:net_revenue|val:market/norway|2026-08',
    state: 'grounded',
  },
  {
    label: 'H1 dimension without a value',
    ask: { question: 'Orders by market in August 2026' },
    scope: { metrics: ['metric:orders'], filters: { 'dim:market': [] }, window: august },
    topic: 'area_sales|metric:orders||2026-08|dim:market',
    state: 'partial',
  },
  {
    label: 'I1 agent supplies wrong metric',
    ask: { question: 'What was net revenue in Norway in August 2026?', metrics: ['Orders'] },
    scope: { metrics: ['metric:orders'], filters: norway, window: august },
    topic: 'area_sales|metric:orders|val:market/norway|2026-08',
    state: 'grounded',
  },
  {
    label: 'I2 agent supplies nothing, text is right',
    ask: { question: 'What was net revenue in Norway in August 2026?' },
    scope: { metrics: ['metric:net_revenue'], filters: norway, window: august },
    topic: 'area_sales|metric:net_revenue|val:market/norway|2026-08',
    state: 'grounded',
  },
  {
    label: 'J1 alias CPA',
    ask: { question: 'CPA Germany this month' },
    scope: {
      metrics: ['metric:cost_per_acquisition'],
      filters: { 'dim:market': ['val:market/germany'] },
      window: { start: '2026-10-01', end: '2026-10-26' },
    },
    topic: 'area_marketing|metric:cost_per_acquisition|val:market/germany|2026-10',
    state: 'grounded',
  },
  {
    label: 'J2 GMV',
    ask: { question: 'GMV in the UK in September 2026' },
    scope: {
      metrics: ['metric:gross_sales'],
      filters: { 'dim:market': ['val:market/united_kingdom'] },
      window: { start: '2026-09-01', end: '2026-10-01' },
    },
    topic: 'area_sales|metric:gross_sales|val:market/united_kingdom|2026-09',
    state: 'missing',
  },
  {
    label: 'K1 ambiguous word',
    ask: { question: 'Revenue and returns for Black Friday in Sweden' },
    scope: {
      metrics: ['group:revenue', 'metric:returns'],
      filters: { 'dim:market': ['val:market/sweden'] },
      window: { start: '2026-10-25', end: '2026-10-26' },
    },
    topic: 'area_sales|group:revenue,metric:returns|val:market/sweden|2026-10',
    state: 'partial',
  },
  {
    label: 'L1 long free question',
    ask: {
      question:
        'Why did units sold fall in Poland last week and is it because of the customs rule?',
    },
    scope: {
      metrics: ['metric:units_sold'],
      filters: { 'dim:market': ['val:market/poland'] },
      window: { start: '2026-10-12', end: '2026-10-19' },
    },
    topic: 'area_sales|metric:units_sold|val:market/poland|2026-10',
    state: 'partial',
  },
]
