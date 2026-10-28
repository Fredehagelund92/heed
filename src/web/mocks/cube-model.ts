/**
 * The demo Cube model (db/seed/cube) as the Cube connector reads it: the definition facts Heed
 * stores (CON-207, never a calculation), and how the demo vocabulary points at them. The bulk
 * seed stores exactly these, so the demo has real definition reads, and the mock binding answers
 * the catalogue from them. tests/server/connectors/demo-model.test.ts compiles the model and
 * fails when this file no longer matches it: after changing the model, copy the new read here.
 */
import { REPOSITORY_URL } from '../../domain/brand.ts'
import { termDomain } from '../../domain/catalogue.ts'

/** The model version the connector reports for db/seed/cube (a digest of its files). */
export const DEMO_SOURCE_VERSION =
  '7d73c2db78838fb4b32f22780383c5ef13c65a3986e7ead4ead00e4fb234ed36'
/** When the seed says the connector first read the model, and read it last (ISO 8601). */
export const DEMO_FIRST_READ_AT = '2026-09-01T05:00:00.000Z'
export const DEMO_READ_AT = '2026-10-07T05:00:00.000Z'
/**
 * The `sources.cube_model_url` setting the bulk seed turns on: the demo model's folder in this
 * repository, so a metric's Source tab links to its model file.
 */
export const DEMO_MODEL_URL = `${REPOSITORY_URL}/blob/main/db/seed/cube`
/** The definition the `definition-gone` scenario's newest read no longer lists. */
export const GONE_DEFINITION_REF = 'cube:basket.gross_margin'
/** The read before the newest, for a definition the newest read no longer lists (a mock scenario). */
export const DEMO_PREVIOUS_READ_AT = '2026-10-06T05:00:00.000Z'

export type DemoDefinition = {
  ref: string
  kind: 'metric' | 'dimension'
  name: string
  title: string | null
  descriptionCopy: string | null
  valueType: string | null
  areaHint: string | null
  domainSource: 'cube' | 'override' | 'none'
  /** The model file that defines the member's view, in db/seed/cube. */
  modelFile: string
  changeMark: string
}

/** Every member the connector lists, by id. */
export const demoDefinitions: DemoDefinition[] = [
  {
    ref: 'cube:basket.average_order_value',
    kind: 'metric',
    name: 'basket.average_order_value',
    title: 'Basket Average order value',
    descriptionCopy:
      'The mean value of a paid order, in euros, after discounts. Gift-card purchases are left out.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'cube',
    modelFile: 'basket.yml',
    changeMark: 'e0137dff78632de12d4b24464b84b7af879777a79eb1f31a1991ccceb49f7179',
  },
  {
    ref: 'cube:basket.gross_margin',
    kind: 'metric',
    name: 'basket.gross_margin',
    title: 'Basket Gross margin',
    descriptionCopy:
      'Net revenue minus what the goods cost us, as a share of net revenue, for orders shipped.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'cube',
    modelFile: 'basket.yml',
    changeMark: '98b800ae25ab9155b91db94e2ca789ff3adc2f386e6250f8d05e429e5de9f5d1',
  },
  {
    ref: 'cube:basket.online_share',
    kind: 'metric',
    name: 'basket.online_share',
    title: 'Basket Online share',
    descriptionCopy:
      'The share of net revenue from orders placed in the webshop or the apps, not in a store.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'cube',
    modelFile: 'basket.yml',
    changeMark: '969441b6fd2e08d1e919e8c94325f4835b2c835275bd5f025d157fce25d9edd7',
  },
  {
    ref: 'cube:basket.units_per_order',
    kind: 'metric',
    name: 'basket.units_per_order',
    title: 'Basket Units per order',
    descriptionCopy:
      'The mean number of units in a paid order. A product bought in two sizes counts twice.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'cube',
    modelFile: 'basket.yml',
    changeMark: 'de851b6f0215efee654cc72922359425bc1032aed25912226dd00e6026170fed',
  },
  {
    ref: 'cube:customers.active_customers',
    kind: 'metric',
    name: 'customers.active_customers',
    title: 'Customers Active customers',
    descriptionCopy:
      'Customers who placed at least one paid order in the period. A customer counts once, whatever the number of product groups they bought from.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'cube',
    modelFile: 'customers.yml',
    changeMark: '355fd23b14b0d988c2b1c4f761bdc893aaa5f4d108eaf014cf08b2cfc8ed2c95',
  },
  {
    ref: 'cube:customers.churn_rate',
    kind: 'metric',
    name: 'customers.churn_rate',
    title: 'Customers Churn rate',
    descriptionCopy:
      'The share of customers active in the previous month who placed no order this month.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'cube',
    modelFile: 'customers.yml',
    changeMark: '4c6b2f60ad64ef8ac439e07585b2b664ee66b89d8522fd6184e4a9b096227c38',
  },
  {
    ref: 'cube:customers.customer_lifetime_value',
    kind: 'metric',
    name: 'customers.customer_lifetime_value',
    title: 'Customers Customer lifetime value',
    descriptionCopy:
      'The net revenue a customer is expected to bring over two years, in euros, from the customer value forecast run each Monday.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'cube',
    modelFile: 'customers.yml',
    changeMark: '23dea68cf015324a80d463f5936ccdf8f66c48e0de1c1be355e49fd7abc09867',
  },
  {
    ref: 'cube:customers.first_time_buyers',
    kind: 'metric',
    name: 'customers.first_time_buyers',
    title: 'Customers First-time buyers',
    descriptionCopy:
      'Customers whose first paid order fell in the period, whenever they signed up.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'cube',
    modelFile: 'customers.yml',
    changeMark: '643cec8865e29789c427d88ae05dea8fccd2050c88e53061f38542f59f56dd57',
  },
  {
    ref: 'cube:customers.new_customers',
    kind: 'metric',
    name: 'customers.new_customers',
    title: 'Customers New customers',
    descriptionCopy:
      'Customers who created an account in the period and confirmed it. Test and staff accounts are left out.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'cube',
    modelFile: 'customers.yml',
    changeMark: 'bfde89584eaf081ca8d086605f59ab751b67e2543dda6bb3bf27f3f37de7f136',
  },
  {
    ref: 'cube:customers.repeat_purchase_rate',
    kind: 'metric',
    name: 'customers.repeat_purchase_rate',
    title: 'Customers Repeat purchase rate',
    descriptionCopy:
      'The share of customers active in the previous month who are active again this month.',
    valueType: 'number',
    areaHint: 'area_customer_value',
    domainSource: 'cube',
    modelFile: 'customers.yml',
    changeMark: 'ddbe8c5148f2bd85610fb1b716d8d955961fb3a26b2f829edf65a4f6bd6b3f55',
  },
  {
    ref: 'cube:marketing.conversion_rate',
    kind: 'metric',
    name: 'marketing.conversion_rate',
    title: 'Marketing Conversion rate',
    descriptionCopy: 'The share of new accounts that place a first paid order within 30 days.',
    valueType: 'number',
    areaHint: 'area_marketing',
    domainSource: 'cube',
    modelFile: 'marketing.yml',
    changeMark: '7d89c9247eded8e8f48a83614835d011f31ebe628969ddddf4b54f21e6ab174f',
  },
  {
    ref: 'cube:marketing.cost_per_acquisition',
    kind: 'metric',
    name: 'marketing.cost_per_acquisition',
    title: 'Marketing Cost per acquisition',
    descriptionCopy: 'Marketing spend divided by first-time buyers in the same period, in euros.',
    valueType: 'number',
    areaHint: 'area_marketing',
    domainSource: 'cube',
    modelFile: 'marketing.yml',
    changeMark: '8c070901fac9ab7e7347d492d38591c3a9218839e601c7e8938399f19b552269',
  },
  {
    ref: 'cube:marketing.discount_cost',
    kind: 'metric',
    name: 'marketing.discount_cost',
    title: 'Marketing Discount cost',
    descriptionCopy:
      'The value of the discounts and gift vouchers customers used, in euros, on the day they used them.',
    valueType: 'number',
    areaHint: 'area_marketing',
    domainSource: 'cube',
    modelFile: 'marketing.yml',
    changeMark: 'c11f524dda89a303ce6656f7048f03a1725cea2edc33fbca59008d34315e9a3b',
  },
  {
    ref: 'cube:marketing.market',
    kind: 'dimension',
    name: 'marketing.market',
    title: 'Marketing Market',
    descriptionCopy: 'The country or region the cost was booked for.',
    valueType: 'string',
    areaHint: 'area_marketing',
    domainSource: 'cube',
    modelFile: 'marketing.yml',
    changeMark: '02eb58387b87fbfe197619f880699737a3be6ca22101d294cf1dd8c92538be9d',
  },
  {
    ref: 'cube:marketing.marketing_day',
    kind: 'dimension',
    name: 'marketing.marketing_day',
    title: 'Marketing Marketing day',
    descriptionCopy: 'The day the cost was booked.',
    valueType: 'time',
    areaHint: 'area_marketing',
    domainSource: 'cube',
    modelFile: 'marketing.yml',
    changeMark: '8dc5590dcb384715d795987e1b8ba62fea7ec3d0f881058d5d2b8714c809e1a2',
  },
  {
    ref: 'cube:marketing.marketing_spend',
    kind: 'metric',
    name: 'marketing.marketing_spend',
    title: 'Marketing Marketing spend',
    descriptionCopy:
      'Money paid to media, partners and agencies, in euros, on the day the cost was booked. Discounts are not marketing spend.',
    valueType: 'number',
    areaHint: 'area_marketing',
    domainSource: 'cube',
    modelFile: 'marketing.yml',
    changeMark: '6b210ca9edeb188ccd9d21ce1fb968bc90e5d81679f68a4fc494ead77c320276',
  },
  {
    ref: 'cube:marketing.return_on_ad_spend',
    kind: 'metric',
    name: 'marketing.return_on_ad_spend',
    title: 'Marketing Return on ad spend',
    descriptionCopy:
      'Net revenue attributed to paid media divided by paid media spend. Attribution is the last click within 30 days.',
    valueType: 'number',
    areaHint: 'area_paid_media',
    domainSource: 'cube',
    modelFile: 'marketing.yml',
    changeMark: 'fd2d2d46703ced1e9557b9fdcbce0ff6598e68ce11a9826449db0a660bc15e8d',
  },
  {
    ref: 'cube:operations.on_time_shipping_rate',
    kind: 'metric',
    name: 'operations.on_time_shipping_rate',
    title: 'Operations On-time shipping rate',
    descriptionCopy: null,
    valueType: 'number',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'operations.yml',
    changeMark: '88f7ed2eeb5c0e1d481ef81bc8014c506d362becd94ac03c3634ee8bff458778',
  },
  {
    ref: 'cube:operations.support_contacts',
    kind: 'metric',
    name: 'operations.support_contacts',
    title: 'Operations Support contacts',
    descriptionCopy:
      'Chats, emails and calls to customer service that someone on our team answered.',
    valueType: 'number',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'operations.yml',
    changeMark: 'd10810f85a9cf3925f9ec0d616516c3ba61fb4dff54c4a94df410752e70c7f58',
  },
  {
    ref: 'cube:orders.market',
    kind: 'dimension',
    name: 'orders.market',
    title: 'Orders Market',
    descriptionCopy: 'The country or region the order ships to.',
    valueType: 'string',
    areaHint: 'area_sales',
    domainSource: 'cube',
    modelFile: 'orders.yml',
    changeMark: '8a4c0260fd1b96e02ee292889861d8743607154c25f83cc08ac702636388bdaa',
  },
  {
    ref: 'cube:orders.order_day',
    kind: 'dimension',
    name: 'orders.order_day',
    title: 'Orders Order day',
    descriptionCopy: 'The day the order was paid for.',
    valueType: 'time',
    areaHint: 'area_sales',
    domainSource: 'cube',
    modelFile: 'orders.yml',
    changeMark: '16dde0fbd3d44abb518133d4195120fd95912bce15f51040aa95b7dd8486d7ca',
  },
  {
    ref: 'cube:orders.orders',
    kind: 'metric',
    name: 'orders.orders',
    title: 'Orders Orders',
    descriptionCopy:
      'The value of orders customers completed and paid for, in euros at the daily rate. Cancelled orders and failed payments are left out.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'cube',
    modelFile: 'orders.yml',
    changeMark: 'b1be26888156a4775ecf26b8297257d7143719c80406442f23d73f3d66fcaa2a',
  },
  {
    ref: 'cube:orders.returns',
    kind: 'metric',
    name: 'orders.returns',
    title: 'Orders Returns',
    descriptionCopy:
      'The value of products customers sent back, in euros at the daily rate, on the day the payment provider confirmed the refund.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'cube',
    modelFile: 'orders.yml',
    changeMark: 'ae095db1952a1bcc4524560ef0961d72f475cd6e9275c7f7199be58b3f072ca5',
  },
  {
    ref: 'cube:revenue.gross_sales',
    kind: 'metric',
    name: 'revenue.gross_sales',
    title: 'Revenue Gross sales',
    descriptionCopy:
      'The value of every order at full price, in euros, before returns, discounts and VAT.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'cube',
    modelFile: 'revenue.yml',
    changeMark: 'f0cad536918d53f99aa6cac38c76022de0ae17b6ff2b217c9b04407b5e1f4a40',
  },
  {
    ref: 'cube:revenue.net_revenue',
    kind: 'metric',
    name: 'revenue.net_revenue',
    title: 'Revenue Net revenue',
    descriptionCopy:
      'Gross sales after returns, discounts, VAT and payment fees, in euros. The figure finance reports each month.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'cube',
    modelFile: 'revenue.yml',
    changeMark: '45892d93b8400840600cf25e8f5200176de1a84caeb07df1c71a9e48cbde9824',
  },
  {
    ref: 'cube:revenue.units_sold',
    kind: 'metric',
    name: 'revenue.units_sold',
    title: 'Revenue Units sold',
    descriptionCopy:
      'The number of units customers bought, including units paid with store credit.',
    valueType: 'number',
    areaHint: 'area_sales',
    domainSource: 'cube',
    modelFile: 'revenue.yml',
    changeMark: 'af29d3ea0abca7629b180687a716f382e2aa16063faf97e1261b4480499ebd2d',
  },
  {
    ref: 'cube:segments.campaign',
    kind: 'dimension',
    name: 'segments.campaign',
    title: 'Segments Campaign',
    descriptionCopy:
      'The marketing campaign the customer was acquired through. There are thousands.',
    valueType: 'string',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'segments.yml',
    changeMark: '2affacedb9eb939af32d56ca314466a0c1750bfdf13efdd92b8d24f1a7d20c80',
  },
  {
    ref: 'cube:segments.channel',
    kind: 'dimension',
    name: 'segments.channel',
    title: 'Segments Channel',
    descriptionCopy: 'How the customer first came to us, from the attribution at sign-up.',
    valueType: 'string',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'segments.yml',
    changeMark: '9674b6b4f95be3b23971dcd00329d1578499296f74fc592a43e99e33951af204',
  },
  {
    ref: 'cube:segments.market',
    kind: 'dimension',
    name: 'segments.market',
    title: 'Segments Market',
    descriptionCopy: 'The country or region the order ships to.',
    valueType: 'string',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'segments.yml',
    changeMark: 'a8d7beb0dabcdb719556ec3bd69607a14feed3bd76f6f4a35b15febdd37a3acb',
  },
  {
    ref: 'cube:segments.platform',
    kind: 'dimension',
    name: 'segments.platform',
    title: 'Segments Platform',
    descriptionCopy: 'Where the order was placed: the website, the iOS app or the Android app.',
    valueType: 'string',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'segments.yml',
    changeMark: 'eae95c652d2807c90536243ad8f247849276a1b8198589be41f280c1536673a3',
  },
  {
    ref: 'cube:segments.product',
    kind: 'dimension',
    name: 'segments.product',
    title: 'Segments Product',
    descriptionCopy:
      'The product group the sale belongs to: footwear, clothing, camping or climbing.',
    valueType: 'string',
    areaHint: null,
    domainSource: 'none',
    modelFile: 'segments.yml',
    changeMark: '6ea64cf3e7f18e5e6cc6cc2daa2f78095b4207f3a4976941478e7b2c131d9172',
  },
]

/** The read of db/seed/cube warns about the two views without a domain (CON-516). */
export const demoWarnings = [
  { code: 'missing_domain', target: 'operations' },
  { code: 'missing_domain', target: 'segments' },
] as const

/**
 * Definitions Cube changed after the first read: the mark Heed read then. Items accepted before
 * the change and not checked since carry the old mark, so they need a check (CON-209).
 */
export const changedDefinitions: Record<string, { previousMark: string; changedAt: string }> = {
  'cube:customers.repeat_purchase_rate': {
    previousMark: '1259ea3cc637221b435043fb9b6c262ca9d12d19bd3c91b3ec72f436a207cabf',
    changedAt: DEMO_READ_AT,
  },
}

const viewOfGroup: Record<string, string> = {
  Payments: 'orders',
  Revenue: 'revenue',
  Customers: 'customers',
  Marketing: 'marketing',
  Basket: 'basket',
  Operations: 'operations',
}

/**
 * The definition a vocabulary metric names: the member in the view of its group. A dimension's
 * first definition, in the shared `segments` view (`definitionRefsOf` has them all).
 */
export function definitionRefOf(term: { key: string; group?: string }): string {
  const [prefix, id] = term.key.split(':')
  if (prefix === 'dim') return `cube:segments.${id}`
  const view = viewOfGroup[term.group ?? '']
  if (!view) throw new Error(`No demo view for ${term.key}`)
  return `cube:${view}.${id}`
}

/**
 * The definitions each term named before a term could name several: its first view's member
 * only (the `term-in-one-view` mock scenario, and a database from before 0070).
 */
export const firstViewRefs = (term: { key: string; group?: string }): string[] => [
  definitionRefOf(term),
]

/**
 * The definitions each vocabulary term names (CON-208): a metric's one, or every view's member
 * of a dimension's name, merged strictly by name (Market is in `segments` and `orders`).
 */
export function definitionRefsOf(term: { key: string; group?: string }): string[] {
  const [prefix, id] = term.key.split(':')
  if (prefix !== 'dim') return [definitionRefOf(term)]
  return demoDefinitions
    .filter((definition) => definition.kind === 'dimension' && definition.name.endsWith(`.${id}`))
    .map((definition) => definition.ref)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * The vocabulary's area map (CON-206), which wins over Cube's domain. Support contacts belongs
 * to Sales although its view has none; On-time shipping rate keeps no domain at all.
 */
export const termAreas: Record<string, string> = {
  'metric:support_contacts': 'area_sales',
}

/**
 * The domain of each metric by the one rule serving, gap topics and the catalogue share
 * (`termDomain`, CON-206): the vocabulary's area, else the domain its Cube view gives. A metric of
 * a group with no demo view (a test's own vocabulary) has the vocabulary's area only.
 */
export function demoMetricArea(
  metrics: readonly { id: string; group: string }[],
): Record<string, string> {
  const hints = new Map(demoDefinitions.map((definition) => [definition.ref, definition.areaHint]))
  return Object.fromEntries(
    metrics.flatMap(({ id, group }) => {
      const key = `metric:${id}`
      const view = viewOfGroup[group]
      const hint = view ? (hints.get(`cube:${view}.${id}`) ?? null) : null
      const { areaId } = termDomain(termAreas[key] ?? null, hint)
      return areaId === null ? [] : [[key, areaId]]
    }),
  )
}

/**
 * A member of a view Cube removed after the first read. Items flagged `source_missing` in the
 * fixtures reference one, so a read of the demo model keeps their flag (CON-210).
 */
export const goneRefOf = (metricId: string) => `cube:legacy.${metricId}`
