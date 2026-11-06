import type { PlannedBundle } from '../../../domain/planned-answer.ts'
import type { AnswerSource } from '../../../domain/answer.ts'
import type { ItemKind } from '../../../domain/item.ts'
import type { Term } from '../../../domain/vocabulary.ts'
import type { RecordsItem, RecordsWorld } from '../../../domain/records.ts'

/*
  The world the planner cases run in (FR-710, FR-719): an invented edition shaped like the demo's
  live one, Larchwood Outdoor on 23 October 2026, with its metrics, its twelve markets and the
  context items a person meets around the Norway story (10 events, 7 rules, 2 warnings and 3
  guides, one of the events written twice), and one more for the Finance group only, which no
  reader here may be given. Beside it, the records an analysis reads (FR-720): the 22 metrics and
  5 dimensions with their domains, owners and source words, what agents asked this week, the
  person's Inbox and what the source lists, fixed here so the cases' answers stay what they are.
  Every name, number and date is made up.
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
const SALES = 'area_sales'
const MARKETING = 'area_marketing'
const CUSTOMER_VALUE = 'area_customer_value'
const PAID_MEDIA = 'area_paid_media'
/** Each metric: its id, name, group, domain (none for one) and other names. */
const metrics: [string, string, string, string | null, string[]?][] = [
  ['orders', 'Orders', 'Payments', SALES, ['Order count']],
  ['returns', 'Returns', 'Payments', SALES],
  ['net_revenue', 'Net revenue', 'Revenue', SALES, ['Sales', 'Turnover']],
  ['gross_sales', 'Gross sales', 'Revenue', SALES],
  ['units_sold', 'Units sold', 'Revenue', SALES],
  ['active_customers', 'Active customers', 'Customers', CUSTOMER_VALUE],
  ['new_customers', 'New customers', 'Customers', CUSTOMER_VALUE],
  ['first_time_buyers', 'First-time buyers', 'Customers', CUSTOMER_VALUE],
  ['repeat_purchase_rate', 'Repeat purchase rate', 'Customers', CUSTOMER_VALUE],
  ['churn_rate', 'Churn rate', 'Customers', CUSTOMER_VALUE],
  ['customer_lifetime_value', 'Customer lifetime value', 'Customers', CUSTOMER_VALUE],
  ['discount_cost', 'Discount cost', 'Marketing', MARKETING],
  ['marketing_spend', 'Marketing spend', 'Marketing', MARKETING],
  ['cost_per_acquisition', 'Cost per acquisition', 'Marketing', MARKETING],
  ['conversion_rate', 'Conversion rate', 'Marketing', MARKETING],
  ['return_on_ad_spend', 'Return on ad spend', 'Marketing', PAID_MEDIA, ['ROAS']],
  ['average_order_value', 'Average order value', 'Basket', SALES, ['AOV']],
  ['units_per_order', 'Units per order', 'Basket', SALES],
  ['gross_margin', 'Gross margin', 'Basket', SALES],
  ['online_share', 'Online share', 'Basket', SALES],
  ['support_contacts', 'Support contacts', 'Operations', SALES],
  ['on_time_shipping_rate', 'On-time shipping rate', 'Operations', null],
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
  ...metrics.map(([id, name, group, , aliases]) =>
    term(`metric:${id}`, 'metric', name, `group:${group.toLowerCase()}`, aliases),
  ),
  term('dim:market', 'dimension', 'Market', null, ['Country']),
  ...markets.map(([id, name, aliases]) =>
    term(`val:market/${id}`, 'dimension_value', name, 'dim:market', aliases),
  ),
  term('dim:channel', 'dimension', 'Channel'),
  term('val:channel/email', 'dimension_value', 'Email', 'dim:channel'),
  term('val:channel/paid_search', 'dimension_value', 'Paid search', 'dim:channel'),
  term('dim:product', 'dimension', 'Product'),
  term('dim:platform', 'dimension', 'Platform'),
  term('dim:campaign', 'dimension', 'Campaign'),
]

export const planAreas = [
  { id: SALES, name: 'Sales' },
  { id: MARKETING, name: 'Marketing' },
  { id: CUSTOMER_VALUE, name: 'Customer value' },
  { id: PAID_MEDIA, name: 'Paid media' },
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
    metrics: ['return_on_ad_spend'],
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
  // The same event written twice: an owner has not noticed yet.
  {
    id: 'evt_france_12_again',
    kind: 'event',
    area: 'area_sales',
    title: 'Payment provider switched in France on 12 May 2026',
    summary: 'France payments moved to the new provider on 12 May 2026.',
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
    reviewDate: '2026-09-18',
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
    reviewDate: '2026-10-02',
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
  metricArea: Object.fromEntries(
    metrics.flatMap(([id, , , area]) => (area ? [[`metric:${id}`, area]] : [])),
  ),
  stopped: { all: false, areas: [], items: [] },
}

/** An item's id by its title, for the cases to name what must and must not be read. */
export const planItem = (title: string) => {
  const found = seeds.find((s) => s.title === title)
  if (!found) throw new Error(`No item is titled "${title}"`)
  return found.id
}

/** What the definition source says of a metric, for the cases that show its words. */
export const planDefinitions: Readonly<Record<string, string>> = {
  'metric:churn_rate':
    'The share of customers active in the previous month who placed no order this month.',
  'metric:net_revenue': 'Gross sales less returns, discounts and tax.',
  'metric:gross_sales': 'What customers paid before returns, discounts and tax.',
  'metric:active_customers': 'Customers who placed at least one order in the last 90 days.',
  'metric:repeat_purchase_rate':
    'The share of customers active in the previous month who are active again this month.',
}

type AuditKind = RecordsItem['kind']

const statusOf = (s: Seed): RecordsItem['status'] =>
  s.reviewDate && s.reviewDate < PLAN_TODAY ? 'due' : 'live'

const itemRecord = (s: Seed): RecordsItem => ({
  id: s.id,
  kind: s.kind as RecordsItem['kind'],
  areaId: s.area,
  title: s.title,
  status: statusOf(s),
  reviewDate: s.reviewDate ?? '2027-03-01',
  checkFlag: s.checkFlag ?? null,
  publishedAt: `${s.from}T09:00:00.000Z`,
  changedAt: '2026-10-20T09:00:00.000Z',
  checkedAt: '2026-10-20T09:00:00.000Z',
  archivedAt: null,
  owners: [],
})

/** The items a person here may see: never the one for the Finance group. */
const seen = seeds.filter((s) => !s.groups)

/** What agents asked this week: each topic, its domain, its calls, those that found nothing. */
const asked: [string, string, number, number, string[], boolean?][] = [
  ['Orders in Norway', SALES, 31, 0, ['metric:orders', 'val:market/norway']],
  ['Net revenue in Norway', SALES, 17, 0, ['metric:net_revenue', 'val:market/norway']],
  ['Orders in Poland', SALES, 13, 6, ['metric:orders', 'val:market/poland']],
  ['Orders in Spain', SALES, 12, 9, ['metric:orders', 'val:market/spain'], true],
  ['Cost per acquisition', MARKETING, 10, 0, ['metric:cost_per_acquisition']],
  ['Orders in Germany', SALES, 6, 6, ['metric:orders', 'val:market/germany']],
]

const owners: Record<string, string[]> = {
  [SALES]: ['per_jon', 'per_sofia'],
  [MARKETING]: ['per_tomas'],
  [CUSTOMER_VALUE]: ['per_noor', 'per_alex'],
  [PAID_MEDIA]: ['per_priya'],
}

/** Jon Abara's records: an administrator and an owner of Sales, in no group. */
export const planRecords: RecordsWorld = {
  items: seen.map(itemRecord),
  areas: planAreas.map((a) => ({ ...a, ownerIds: owners[a.id]! })),
  people: {
    per_jon: 'Jon Abara',
    per_sofia: 'Sofia Brandt',
    per_tomas: 'Tomas Eriksen',
    per_noor: 'Noor Haddad',
    per_alex: 'Alex Moreau',
    per_priya: 'Priya Nair',
    per_ines: 'Ines Duarte',
  },
  terms: planTerms.map((t) =>
    t.kind === 'metric' ? { ...t, areaId: planBundle.metricArea[t.key] ?? null } : t,
  ),
  asked: {
    minimum: 5,
    rows: asked.map(([title, area, count, nothing, keys, gap]) => ({
      title,
      area,
      count,
      atLeast: count,
      nothing,
      state: nothing ? 'missing' : 'grounded',
      gap: gap ? { card: 'gap:spain', draft: null } : null,
      metrics: keys.filter((k) => k.startsWith('metric:')),
      values: keys.filter((k) => k.startsWith('val:')),
    })),
  },
  conflicts: [
    {
      key: 'rul_norway_credit.rul_norway_cash',
      holder: { id: 'rul_norway_credit', title: 'Norway orders count store credit', areaId: SALES },
      other: {
        id: 'rul_norway_cash',
        title: 'Norway orders are card and cash payments only',
        areaId: SALES,
      },
      topic: 'Orders in Norway',
      since: '2026-09-24',
    },
  ],
  audit: {
    terms: planTerms
      .filter((t) => t.kind === 'metric' || t.kind === 'dimension')
      .map((t) => {
        const named = seen.filter((s) =>
          t.kind === 'metric'
            ? s.metrics.includes(t.key.slice('metric:'.length))
            : t.key === 'dim:market' && (s.markets?.length ?? 0) > 0,
        )
        const count = (kind: ItemKind) => named.filter((s) => s.kind === kind).length
        return {
          key: t.key,
          kind: t.kind as 'metric' | 'dimension',
          name: t.name,
          areaId: planBundle.metricArea[t.key] ?? null,
          state: 'current' as const,
          words:
            t.key === 'metric:on_time_shipping_rate'
              ? null
              : (planDefinitions[t.key] ?? `What ${t.name} counts.`),
          shelf: {
            event: count('event'),
            issue: count('issue'),
            note: count('note'),
            guide: count('guide'),
          },
        }
      }),
    items: seen.map((s) => ({
      id: s.id,
      kind: s.kind as AuditKind,
      title: s.title,
      areaId: s.area,
      metrics: s.metrics.map((m) => `metric:${m}`),
      values: (s.markets ?? []).map((m) => `val:market/${m}`),
      start: s.from,
      end: s.until ?? null,
      conflicts: s.conflicts ?? [],
    })),
    members: {
      total: 31,
      unlinked: [
        { name: 'Order day', valueType: 'Date', suggested: false },
        { name: 'Marketing day', valueType: 'Date', suggested: false },
      ],
    },
    readAt: '2026-10-22T06:00:00.000Z',
  },
  queue: [
    { group: 'gap', count: 1 },
    { group: 'flag', count: 2 },
    { group: 'check', count: 2 },
    { group: 'suggestion', count: 3 },
  ],
  glossary: [
    {
      name: 'Store credit',
      meaning:
        'Money a customer holds with us from a gift card or a refund, spent like cash at checkout.',
    },
  ],
}

/** The same records on the day the source changed a definition: no item relies on it yet. */
export const sourceChangedRecords: RecordsWorld = {
  ...planRecords,
  audit: {
    ...planRecords.audit!,
    terms: planRecords.audit!.terms.map((t) =>
      t.key === 'metric:repeat_purchase_rate' ? { ...t, changedAt: '2026-10-07T05:00:00.000Z' } : t,
    ),
  },
}
