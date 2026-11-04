import type { PlannedBundle } from '../../../domain/planned-answer.ts'
import type { AnswerSource } from '../../../domain/answer.ts'
import type { ItemKind } from '../../../domain/item.ts'
import type { Term } from '../../../domain/vocabulary.ts'

/*
  The world the planner cases run in (FR-710, FR-719): an invented edition shaped like the demo's
  live one, Larchwood Outdoor on 23 October 2026, with its metrics, its twelve markets and the
  twenty-one context items a person meets around the Norway story (9 events, 7 rules, 2 warnings
  and 3 guides), and one more for the Finance group only, which no reader here may be given. Every
  name, number and date is made up.
*/

/** The day the cases are asked on. */
export const PLAN_TODAY = '2026-10-23'
/** The moment it is then, for the records' periods. */
export const PLAN_NOW = '2026-10-23T12:00:00.000Z'

const term = (
  key: string,
  kind: Term['kind'],
  name: string,
  parentKey: string | null = null,
  aliases: string[] = [],
): Term => ({ key, kind, name, aliases, parentKey, areaId: null, definitionRefs: [] })

const groups = ['Payments', 'Revenue', 'Customers', 'Marketing', 'Basket', 'Operations']
const metrics: [string, string, string, string[]?][] = [
  ['orders', 'Orders', 'Payments', ['Order count']],
  ['returns', 'Returns', 'Payments'],
  ['net_revenue', 'Net revenue', 'Revenue', ['Sales', 'Turnover']],
  ['gross_sales', 'Gross sales', 'Revenue'],
  ['units_sold', 'Units sold', 'Revenue'],
  ['active_customers', 'Active customers', 'Customers'],
  ['new_customers', 'New customers', 'Customers'],
  ['first_time_buyers', 'First-time buyers', 'Customers'],
  ['churn_rate', 'Churn rate', 'Customers'],
  ['discount_cost', 'Discount cost', 'Marketing'],
  ['marketing_spend', 'Marketing spend', 'Marketing'],
  ['return_on_ad_spend', 'Return on ad spend', 'Marketing', ['ROAS']],
  ['conversion_rate', 'Conversion rate', 'Marketing'],
  ['average_order_value', 'Average order value', 'Basket', ['AOV']],
  ['gross_margin', 'Gross margin', 'Basket'],
  ['support_contacts', 'Support contacts', 'Operations'],
]
const markets: [string, string, string[]?][] = [
  ['norway', 'Norway', ['Norge']],
  ['spain', 'Spain', ['Espana']],
  ['poland', 'Poland'],
  ['france', 'France'],
  ['germany', 'Germany'],
  ['united_kingdom', 'United Kingdom', ['UK']],
  ['netherlands', 'Netherlands'],
  ['italy', 'Italy'],
  ['canada', 'Canada'],
  ['united_states', 'United States', ['USA']],
  ['sweden', 'Sweden'],
  ['mexico', 'Mexico'],
]

export const planTerms: Term[] = [
  ...groups.map((g) => term(`group:${g.toLowerCase()}`, 'metric_group', g)),
  ...metrics.map(([id, name, group, aliases]) =>
    term(`metric:${id}`, 'metric', name, `group:${group.toLowerCase()}`, aliases),
  ),
  term('dim:market', 'dimension', 'Market', null, ['Country']),
  ...markets.map(([id, name, aliases]) =>
    term(`val:market/${id}`, 'dimension_value', name, 'dim:market', aliases),
  ),
  term('dim:channel', 'dimension', 'Channel'),
  term('val:channel/email', 'dimension_value', 'Email', 'dim:channel'),
  term('val:channel/paid_search', 'dimension_value', 'Paid search', 'dim:channel'),
]

export const planAreas = [
  { id: 'area_sales', name: 'Sales' },
  { id: 'area_marketing', name: 'Marketing' },
  { id: 'area_customer_value', name: 'Customer value' },
  { id: 'area_paid_media', name: 'Paid media' },
]

type Seed = {
  id: string
  kind: ItemKind
  area: string
  title: string
  summary: string
  metrics: string[]
  markets?: string[]
  from: string
  until?: string
  conflicts?: string[]
  reviewDate?: string
  checkFlag?: 'needs_check'
  groups?: string[]
}

const seeds: Seed[] = [
  // Events.
  {
    id: 'evt_norway_stop',
    kind: 'event',
    area: 'area_sales',
    title: 'Online sales to Norway stopped on 4 August 2026',
    summary:
      'A new customs rule stopped all online sales to Norway from 4 August 2026, so orders there fell to almost nothing.',
    metrics: ['orders'],
    markets: ['norway'],
    from: '2026-08-04',
  },
  {
    id: 'evt_norway_promos',
    kind: 'event',
    area: 'area_marketing',
    title: 'Regulator paused price promotions in Norway on 9 May 2026',
    summary:
      'The Norway regulator paused all price promotions on 9 May 2026 while it writes new pricing rules, so no paid campaign has run there since.',
    metrics: ['return_on_ad_spend'],
    markets: ['norway'],
    from: '2026-05-09',
  },
  {
    id: 'evt_norway_launch',
    kind: 'event',
    area: 'area_marketing',
    title: 'Norway launch campaign started on 24 March 2026',
    summary:
      'The Norway launch campaign ran from 24 March 2026 until the regulator paused price promotions on 9 May 2026.',
    metrics: ['marketing_spend'],
    markets: ['norway'],
    from: '2026-03-24',
    until: '2026-05-09',
  },
  {
    id: 'evt_france_12',
    kind: 'event',
    area: 'area_sales',
    title: 'Payment provider switched in France on 12 May 2026',
    summary:
      "We moved France's card and bank payments to a new provider on 12 May 2026. For the first week some orders were booked twice, and finance took them out again on 19 May.",
    metrics: ['orders'],
    markets: ['france'],
    from: '2026-05-12',
  },
  {
    id: 'evt_france_21',
    kind: 'event',
    area: 'area_sales',
    title: 'Payment provider switched in France on 21 May 2026',
    summary: 'France bank transfers moved to the new payment provider on 21 May 2026.',
    metrics: ['orders'],
    markets: ['france'],
    from: '2026-05-21',
  },
  {
    id: 'evt_spain_cards',
    kind: 'event',
    area: 'area_sales',
    title: 'Card payments in Spain failed from 14 to 16 October 2026',
    summary:
      'Card payments in Spain failed from 14 to 16 October 2026 while the provider moved data centres, so orders there were low on those days.',
    metrics: ['orders'],
    markets: ['spain'],
    from: '2026-10-14',
    until: '2026-10-17',
  },
  {
    id: 'evt_italy_promos',
    kind: 'event',
    area: 'area_marketing',
    title: 'Regulator paused price promotions in Italy on 18 April 2026',
    summary:
      'The Italy regulator paused all price promotions and discount codes from 18 April to 30 May 2026, so we gave no welcome discounts in Italy in those weeks.',
    metrics: ['discount_cost'],
    markets: ['italy'],
    from: '2026-04-18',
    until: '2026-05-31',
  },
  {
    id: 'evt_norway_vat',
    kind: 'event',
    area: 'area_marketing',
    title: 'New VAT rate applied in Norway from 3 August 2025',
    summary:
      'A new VAT rule applied in Norway from 3 August 2025 to 5 June 2026 and taxed discounts as part of the price, so discount cost there is lower for those months.',
    metrics: ['discount_cost'],
    markets: ['norway'],
    from: '2025-08-03',
    until: '2026-06-06',
  },
  {
    id: 'evt_spain_provider',
    kind: 'event',
    area: 'area_customer_value',
    title: 'Payment provider switched in Spain on 21 October 2025',
    summary:
      "Spain payments moved to a new provider on 21 October 2025. It records a first order on the day it's approved, so first-time buyers land a day later than before.",
    metrics: ['first_time_buyers'],
    markets: ['spain'],
    from: '2025-10-21',
  },
  // Rules.
  {
    id: 'rul_units_test',
    kind: 'note',
    area: 'area_sales',
    title: 'Units sold excludes test accounts',
    summary: 'Units sold leaves out the 312 accounts our teams use to test the webshop.',
    metrics: ['units_sold'],
    from: '2025-01-01',
  },
  {
    id: 'rul_returns_definition',
    kind: 'note',
    area: 'area_sales',
    title: 'Returns changed definition on 28 April 2026',
    summary:
      "From 28 April 2026, returns count only refunds that reached the customer's bank, so earlier weeks read higher.",
    metrics: ['returns'],
    from: '2026-04-28',
    checkFlag: 'needs_check',
  },
  {
    id: 'rul_sweden_old',
    kind: 'note',
    area: 'area_sales',
    title: 'Data for Orders before 19 January 2026 is not reliable',
    summary:
      'Sweden orders before 19 January 2026 come from the old payment report, which left out bank transfers. Compare Sweden orders only from 19 January 2026.',
    metrics: ['orders'],
    markets: ['sweden'],
    from: '2025-01-01',
    until: '2026-01-19',
  },
  {
    id: 'rul_norway_credit',
    kind: 'note',
    area: 'area_sales',
    title: 'Norway orders count store credit',
    summary: 'Orders in Norway include orders paid with store credit and gift cards.',
    metrics: ['orders'],
    markets: ['norway'],
    from: '2025-01-01',
    conflicts: ['rul_norway_cash'],
  },
  {
    id: 'rul_norway_cash',
    kind: 'note',
    area: 'area_sales',
    title: 'Norway orders are card and cash payments only',
    summary:
      'Orders in Norway count only card and cash payments. Store credit and gift cards are left out.',
    metrics: ['orders'],
    markets: ['norway'],
    from: '2025-01-01',
    conflicts: ['rul_norway_credit'],
  },
  {
    id: 'rul_spain_vat_in',
    kind: 'note',
    area: 'area_sales',
    title: 'Net revenue in Spain includes VAT',
    summary: 'Net revenue in Spain includes VAT, as the shop shows it.',
    metrics: ['net_revenue'],
    markets: ['spain'],
    from: '2026-01-01',
  },
  {
    id: 'rul_spain_vat_out',
    kind: 'note',
    area: 'area_paid_media',
    title: 'Net revenue in Spain excludes VAT',
    summary: 'Net revenue in Spain excludes VAT.',
    metrics: ['net_revenue'],
    markets: ['spain'],
    from: '2026-01-01',
  },
  // Warnings.
  {
    id: 'wrn_orders_lag',
    kind: 'issue',
    area: 'area_sales',
    title: 'Orders lags by one day in the source tool',
    summary:
      "Germany's payment files arrive the morning after, so yesterday's orders are always short. Leave out the last day when you compare weeks.",
    metrics: ['orders'],
    markets: ['germany'],
    from: '2025-06-01',
  },
  {
    id: 'wrn_new_customers_lag',
    kind: 'issue',
    area: 'area_customer_value',
    title: 'New customers lags by one day in the source tool',
    summary:
      "New customers in Spain arrive the morning after they sign up, so yesterday's count is short until about 10:00.",
    metrics: ['new_customers'],
    markets: ['spain'],
    from: '2025-06-01',
  },
  // Guides.
  {
    id: 'gde_orders_jump',
    kind: 'guide',
    area: 'area_sales',
    title: 'What to rule out before explaining a jump in Orders',
    summary:
      'Before you explain a jump in France orders, check the file dates. The provider sends weekend files together on Monday, and most jumps are those late files, not customers.',
    metrics: ['orders'],
    markets: ['france'],
    from: '2025-01-01',
  },
  {
    id: 'gde_margin_jump',
    kind: 'guide',
    area: 'area_sales',
    title: 'What to rule out before explaining a jump in Gross margin',
    summary:
      'Before you explain a jump in gross margin, look at four weeks or more. Margin swings with clearance sales, so one good weekend is no trend.',
    metrics: ['gross_margin'],
    from: '2025-01-01',
    reviewDate: '2026-10-01',
  },
  {
    id: 'gde_roas',
    kind: 'guide',
    area: 'area_paid_media',
    title: 'How to read return on ad spend for one campaign',
    summary:
      'Return on ad spend for one campaign counts orders for 30 days after sign-up. Read a campaign only once its 30 days have passed.',
    metrics: ['return_on_ad_spend'],
    from: '2025-01-01',
  },
  // For the Finance group only: no reader here is in it, so nothing here may give it or count it.
  {
    id: 'rul_finance_only',
    kind: 'note',
    area: 'area_sales',
    title: 'Finance counts Norway orders after refunds',
    summary: 'Finance reads Norway orders after refunds for its own month-end report.',
    metrics: ['orders'],
    markets: ['norway'],
    from: '2025-01-01',
    groups: ['finance'],
  },
]

const itemOf = (s: Seed): AnswerSource => ({
  id: s.id,
  version: 1,
  areaId: s.area,
  kind: s.kind,
  title: s.title,
  summary: s.summary,
  scope: {
    metrics: s.metrics.map((m) => `metric:${m}`),
    dimensions: [],
    dimensionValues: (s.markets ?? []).map((m) => ({
      dimension: 'dim:market',
      value: `val:market/${m}`,
    })),
  },
  validity: { start: s.from, end: s.until ?? null },
  reviewDate: s.reviewDate ?? '2027-03-01',
  riskLevel: 'normal',
  checkFlag: s.checkFlag ?? null,
  status: 'accepted',
  audience: s.groups ? { kind: 'groups', groups: s.groups } : { kind: 'everyone' },
  conflicts: s.conflicts ?? [],
  proposerId: null,
  notToConclude: 'cause not proven',
})

/** The edition the cases read: the invented world as the engine and the planner read it. */
export const planBundle: PlannedBundle = {
  edition: '2026-10-23.1',
  overlay: '0',
  items: seeds.map(itemOf),
  terms: planTerms,
  areas: planAreas,
  groupsOfMetric: Object.fromEntries(
    metrics.map(([id, , group]) => [`metric:${id}`, [`group:${group.toLowerCase()}`]]),
  ),
  metricArea: Object.fromEntries(metrics.map(([id]) => [`metric:${id}`, 'area_sales'])),
  stopped: { all: false, areas: [], items: [] },
}

/** An item's id by its title, for the cases to name what must and must not be read. */
export const planItem = (title: string) => {
  const found = seeds.find((s) => s.title === title)
  if (!found) throw new Error(`No item is titled "${title}"`)
  return found.id
}
