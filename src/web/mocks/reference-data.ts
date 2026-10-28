import type { Area, Person, Vocabulary } from '../../domain/item.ts'
import { productName } from '../lib/brand.ts'

/** The date every fixture treats as "today". Fixed so screenshots and tests never drift. */
export const FIXTURE_TODAY = '2026-10-07'

/** Invented people. Maria and Jon are the people in the requirements' worked example. */
export const people: Person[] = [
  { id: 'per_maria', name: 'Maria Lindqvist', initials: 'ML' },
  { id: 'per_jon', name: 'Jon Abara', initials: 'JA' },
  { id: 'per_sofia', name: 'Sofia Brandt', initials: 'SB' },
  { id: 'per_tomas', name: 'Tomas Eriksen', initials: 'TE' },
  { id: 'per_noor', name: 'Noor Haddad', initials: 'NH' },
  { id: 'per_alex', name: 'Alex Moreau', initials: 'AM' },
  { id: 'per_priya', name: 'Priya Nair', initials: 'PN' },
  { id: 'per_lars', name: 'Lars Dahl', initials: 'LD' },
  { id: 'per_ines', name: 'Ines Duarte', initials: 'ID' },
  { id: 'per_kofi', name: 'Kofi Mensah', initials: 'KM' },
  { id: 'per_ella', name: 'Ella Voss', initials: 'EV' },
  { id: 'per_ravi', name: 'Ravi Kapoor', initials: 'RK' },
]

export const currentUserId = 'per_maria'

/**
 * Roles beyond the owners named on each domain (several for some): a high-risk approver for Sales
 * and an admin. The bulk seed grants the same, so the mock and the service agree on who
 * may do what.
 */
export const roleGrants = {
  approvers: [{ areaId: 'area_sales', personId: 'per_lars' }],
  administrators: ['per_ravi'],
  /** Reads the history log (FR-808), and nothing else an admin does. */
  auditors: ['per_ella'],
} as const

/** Business areas (requirements section 2.1 "Area"). Each label is a hue on the domain ring. */
export const areas: Area[] = [
  {
    id: 'area_sales',
    name: 'Sales',
    summary: 'Orders, revenue and the basket: what customers buy and send back, and what we earn.',
    description: `Sales covers the money side of the business: **gross sales**, **net revenue** and **units sold**, the basket figures behind them (units per order, average order value, gross margin, online share) and orders (orders and returns).

Facts here are mostly events and notes that move these numbers, such as a market's online sales stopping, a payment provider outage or a change in how discounts are netted off. Marketing spend and discount cost live in Marketing.`,
    ownerIds: ['per_jon', 'per_sofia'],
    label: 'teal',
    revision: 1,
    demo: false,
  },
  {
    id: 'area_marketing',
    name: 'Marketing',
    summary:
      'Acquisition and discounts: spend, conversion, cost per acquisition and discount cost by campaign and channel.',
    description: `Marketing covers how we win and keep customers: **marketing spend**, **conversion rate**, **cost per acquisition** and **discount cost**, broken down by campaign, channel and market.

Expect notes on campaign launches and pauses, tracking changes that break a series, and how discount cost is counted. Paid media buying itself (return on ad spend) lives in Paid media.`,
    ownerIds: ['per_tomas'],
    label: 'pink',
    revision: 1,
    demo: false,
  },
  {
    id: 'area_customer_value',
    name: 'Customer value',
    summary:
      'Customers over their lifetime: new and active customers, first-time buyers, repeat purchases, churn and lifetime value.',
    description: `Customer value covers the customer base and how it develops: **new customers**, **first-time buyers**, **active customers**, **repeat purchase rate**, **churn rate** and **customer lifetime value**.

Most facts here explain definitions (what counts as active, when a customer churns) and breaks in the series, such as a change in the activity window or a market where accounts were merged.`,
    ownerIds: ['per_noor', 'per_alex'],
    label: 'indigo',
    revision: 1,
    demo: false,
  },
  {
    id: 'area_paid_media',
    name: 'Paid media',
    summary: 'Buying ads: return on ad spend by campaign, channel and format.',
    description: `Paid media covers what we buy from ad networks and what it brings back: **return on ad spend**, by campaign, channel and campaign format (search, social, video, display, email).

Facts here are about attribution windows, tracking outages and campaigns whose spend was booked late.`,
    ownerIds: ['per_priya'],
    label: 'violet',
    revision: 1,
    demo: false,
  },
  {
    id: 'area_sandbox',
    name: 'Sandbox',
    summary: `The demo domain: invented examples to try ${productName} with, never real numbers.`,
    description: `Sandbox is the built-in demo domain. Everything in it is invented, so anyone can try proposing, reviewing and asking without touching a real domain.

Use it to practise, and never quote it about the real business.`,
    ownerIds: ['per_jon'],
    label: 'gray',
    revision: 1,
    demo: true,
  },
]

/**
 * The markets: real countries, never anything below one, with real other names. "Norway" is the
 * market in the requirements' worked example.
 */
const markets = [
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
] as const

/**
 * Invented marketing campaigns: one per market, event, year and format, 2,400 in all. A dimension
 * with thousands of values is common (campaigns, products, stores), so the demo has one: the
 * "where it applies" picker searches it on the server instead of listing it (FR-107).
 */
const campaignEvents = [
  'Spring Sale',
  'Summer Trail',
  'Autumn Gear Up',
  'Winter Warmth',
  'Black Friday',
  'Festival Season',
  'Late Night Sale',
  'New Season',
  'Clearance',
  'Welcome Back',
] as const
const campaignFormats = ['Search', 'Social', 'Video', 'Display', 'Email'] as const
const campaignYears = [2023, 2024, 2025, 2026] as const
export const campaigns = markets.flatMap(([, market]) =>
  campaignEvents.flatMap((event) =>
    campaignYears.flatMap((year) =>
      campaignFormats.map((format) => {
        const name = `${market} ${event} ${year} ${format}`
        return { id: name.toLowerCase().replace(/ /g, '_'), name, aliases: [] as string[] }
      }),
    ),
  ),
)

export const vocabulary: Vocabulary = {
  metrics: [
    { id: 'orders', name: 'Orders', group: 'Payments' },
    { id: 'returns', name: 'Returns', group: 'Payments' },
    { id: 'net_revenue', name: 'Net revenue', group: 'Revenue' },
    { id: 'gross_sales', name: 'Gross sales', group: 'Revenue' },
    { id: 'units_sold', name: 'Units sold', group: 'Revenue' },
    { id: 'active_customers', name: 'Active customers', group: 'Customers' },
    { id: 'new_customers', name: 'New customers', group: 'Customers' },
    { id: 'first_time_buyers', name: 'First-time buyers', group: 'Customers' },
    { id: 'repeat_purchase_rate', name: 'Repeat purchase rate', group: 'Customers' },
    { id: 'churn_rate', name: 'Churn rate', group: 'Customers' },
    { id: 'discount_cost', name: 'Discount cost', group: 'Marketing' },
    { id: 'marketing_spend', name: 'Marketing spend', group: 'Marketing' },
    { id: 'cost_per_acquisition', name: 'Cost per acquisition', group: 'Marketing' },
    { id: 'return_on_ad_spend', name: 'Return on ad spend', group: 'Marketing' },
    { id: 'conversion_rate', name: 'Conversion rate', group: 'Marketing' },
    { id: 'average_order_value', name: 'Average order value', group: 'Basket' },
    { id: 'units_per_order', name: 'Units per order', group: 'Basket' },
    { id: 'gross_margin', name: 'Gross margin', group: 'Basket' },
    { id: 'online_share', name: 'Online share', group: 'Basket' },
    { id: 'customer_lifetime_value', name: 'Customer lifetime value', group: 'Customers' },
    { id: 'support_contacts', name: 'Support contacts', group: 'Operations' },
    { id: 'on_time_shipping_rate', name: 'On-time shipping rate', group: 'Operations' },
  ],
  dimensions: [
    {
      id: 'market',
      name: 'Market',
      values: markets.map(([id, name, aliases]) => ({ id, name, aliases: [...aliases] })),
    },
    {
      id: 'product',
      name: 'Product',
      values: [
        { id: 'footwear', name: 'Footwear', aliases: ['Shoes'] },
        { id: 'clothing', name: 'Clothing', aliases: [] },
        { id: 'camping', name: 'Camping', aliases: [] },
        { id: 'climbing', name: 'Climbing', aliases: [] },
      ],
    },
    {
      id: 'channel',
      name: 'Channel',
      values: [
        { id: 'marketplace', name: 'Marketplace', aliases: ['Marketplaces'] },
        { id: 'paid_search', name: 'Paid search', aliases: [] },
        { id: 'email', name: 'Email', aliases: [] },
        { id: 'organic', name: 'Organic', aliases: [] },
      ],
    },
    {
      id: 'platform',
      name: 'Platform',
      values: [
        { id: 'web', name: 'Web', aliases: [] },
        { id: 'ios', name: 'iOS', aliases: [] },
        { id: 'android', name: 'Android', aliases: [] },
      ],
    },
    { id: 'campaign', name: 'Campaign', values: campaigns },
  ],
}
