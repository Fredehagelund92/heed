import { withWhen, type DomainId, type Fact, type Metric, type StoredFact } from '@/model/items'
import type { Person } from '@/model/people'

// Larchwood Outdoor, Heed's demo world (docs/design/demo-world.md in the Heed repository).
// Real countries; invented people, events and .example addresses. Fact text has no causal words
// and no percent sign, and follows the demo world's banned-word list.

/** The workspace's name, as an admin set it in General. Shown where a shared answer says where it is from. */
export const WORKSPACE_NAME = 'Larchwood Outdoor'

export const domains: Record<DomainId, { name: string; owners: string[]; covers: string }> = {
  sales: {
    name: 'Sales',
    owners: ['Jon Abara', 'Sofia Brandt'],
    covers: 'Orders, revenue and the basket: what customers buy and send back, and what we earn.',
  },
  marketing: {
    name: 'Marketing',
    owners: ['Tomas Eriksen'],
    covers:
      'Acquisition and discounts: spend, conversion, cost per acquisition and discount cost by campaign and channel.',
  },
  customer_value: {
    name: 'Customer value',
    owners: ['Noor Haddad', 'Alex Moreau'],
    covers:
      'Customers over their lifetime: new and active customers, first-time buyers, repeat purchases, churn and lifetime value.',
  },
  paid_media: {
    name: 'Paid media',
    owners: ['Priya Nair'],
    covers: 'Paid media buying: return on ad spend by campaign, channel and market.',
  },
  sandbox: {
    name: 'Sandbox',
    owners: ['Jon Abara'],
    covers: 'A place to try context before it goes anywhere.',
  },
}

export const domainIds = Object.keys(domains)

/* ---------- people ---------- */

export const people: Person[] = [
  { name: 'Jon Abara', role: 'Owner of Sales, admin', owns: ['sales', 'sandbox'], admin: true },
  { name: 'Tomas Eriksen', role: 'Owner of Marketing', owns: ['marketing'], admin: false },
  { name: 'Ines Duarte', role: 'Suggests context, owns no domain', owns: [], admin: false },
  { name: 'Ravi Kapoor', role: 'Admin', owns: [], admin: true },
  { name: 'Maria Lindqvist', role: 'Suggests context, owns no domain', owns: [], admin: false },
  { name: 'Sofia Brandt', role: 'Owner of Sales', owns: ['sales'], admin: false },
  { name: 'Noor Haddad', role: 'Owner of Customer value', owns: ['customer_value'], admin: false },
  { name: 'Alex Moreau', role: 'Owner of Customer value', owns: ['customer_value'], admin: false },
  { name: 'Priya Nair', role: 'Owner of Paid media', owns: ['paid_media'], admin: false },
  { name: 'Lars Dahl', role: 'Suggests context, owns no domain', owns: [], admin: false },
  { name: 'Kofi Mensah', role: 'Suggests context, owns no domain', owns: [], admin: false },
  { name: 'Ella Voss', role: 'Suggests context, owns no domain', owns: [], admin: false },
  {
    name: 'Aleksandra Konstantinopoulou-Whitfield',
    role: 'Invited',
    owns: [],
    admin: false,
    email: 'aleksandra.konstantinopoulou-whitfield@larchwood.example',
    invited: true,
  },
  {
    name: 'finance.lead@larchwood.example',
    role: 'Invited',
    owns: [],
    admin: false,
    email: 'finance.lead@larchwood.example',
    invited: true,
  },
]

/** The four people the sign-in picker offers first, each showing a different Inbox. */
export const signInPeople = ['Jon Abara', 'Tomas Eriksen', 'Ines Duarte', 'Ravi Kapoor']

export const person = (name: string) => people.find((p) => p.name === name) ?? people[0]

const stored: StoredFact[] = [
  {
    id: 'itm_norway_stop',
    title: 'Online sales to Norway stopped on 4 August 2026',
    summary:
      'A new customs rule stopped all online sales to Norway from 4 August 2026, so orders there fell to almost nothing.',
    body: 'There are no stores in Norway, so the [@ id="term:Webshop" label="Webshop"] was the only way to buy there.\n\n- Parcels already on their way still arrived.\n- Compare [@ id="metric:Orders" label="Orders"] in Norway with itself before or after the stop, never across it.\n\n> Paid campaigns there had stopped before this: [@ id="context:itm_za26xpzv" label="Regulator paused price promotions in Norway on 9 May 2026"].\n\nNot the same as the earlier change in Norway payments: [@ id="context:itm_kh4llvi9" label="Payment provider switched in Norway on 9 July 2025"].',
    domain: 'sales',
    kind: 'event',
    where: ['Orders', 'Norway'],
    valid: { from: '2026-08-04', ongoing: true },
    status: 'Live',
    checkedBy: 'Jon Abara',
    checkedOn: '3 Oct 2026',
    source: 'https://customs.example/norway/notices/2026-08-04',
    quote:
      'Parcels from webshops outside Norway are held at the border from 4 August 2026 until further notice.',
    dontConclude: 'Fewer orders in Norway after 4 August do not mean fewer customers.',
  },
  {
    id: 'itm_za26xpzv',
    title: 'Regulator paused price promotions in Norway on 9 May 2026',
    summary:
      "The Norway regulator paused all price promotions on 9 May 2026 while it writes new pricing rules. Our Norway campaigns were all price promotions, so we haven't run a paid campaign there since.",
    domain: 'marketing',
    kind: 'event',
    where: ['Return on ad spend', 'Norway'],
    valid: { from: '2026-05-09', ongoing: true },
    status: 'Live',
    checkedBy: 'Tomas Eriksen',
    checkedOn: '18 Sep 2026',
    source: 'https://regulator.example/norway/promotions/2026-05-09',
    quote:
      'With effect from 9 May 2026, no retailer may advertise price reductions in Norway until the new code takes effect.',
    dontConclude:
      "Missing return on ad spend in Norway since May 2026 doesn't mean our campaigns there failed.",
  },
  {
    id: 'itm_s90n5xps',
    title: 'Units sold excludes test accounts',
    summary:
      'Units sold in Norway leaves out the 312 accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too.',
    domain: 'sales',
    kind: 'note',
    where: ['Units sold', 'Norway'],
    valid: {},
    status: 'Live',
    checkedBy: 'Jon Abara',
    checkedOn: '2 Jul 2026',
    source: 'https://wiki.example/data/definitions/units-sold',
    quote: 'Accounts with the internal flag are removed from all units sold figures.',
    dontConclude: "Norway units sold didn't fall on 29 May 2026. Test orders stopped counting.",
  },
  {
    id: 'itm_0tmqp7o1',
    title: 'Orders lags by one day in the source tool',
    summary:
      "Germany's payment files reach Cube the morning after, so yesterday's orders are always short. Leave out the last day when you compare Germany weeks.",
    domain: 'sales',
    kind: 'issue',
    where: ['Orders', 'Germany'],
    valid: { ongoing: true },
    status: 'Live',
    checkedBy: 'Sofia Brandt',
    checkedOn: '12 Sep 2026',
    source: 'https://wiki.example/data/freshness',
    quote: 'Germany payment files are loaded the following morning at 07:00.',
    dontConclude: "A low last day for Germany orders isn't a drop.",
    replaces: 'itm_lag_two_days',
  },
  {
    id: 'itm_ra39ow6c',
    title: 'Returns changed definition on 28 April 2026',
    summary:
      "From 28 April 2026, Norway returns count only refunds that reached the customer's bank. Cancelled refunds counted before, so earlier weeks read about 4 percent higher.",
    domain: 'sales',
    kind: 'note',
    where: ['Returns', 'Norway'],
    valid: { from: '2026-04-28' },
    status: 'Needs checking',
    checkedBy: 'Jon Abara',
    checkedOn: '2 Jul 2026',
    source: 'https://wiki.example/data/changelog/2026-04-28',
    quote:
      'Returns are recognised when the bank confirms the refund. Cancelled refunds are excluded.',
    dontConclude:
      "The drop in Norway returns at the end of April 2026 isn't a change in what customers did.",
    outOfDate: 'Its check date passed on 2 Oct.',
  },
  {
    id: 'itm_2a1wp53q',
    title: 'What to rule out before explaining a jump in Orders',
    summary:
      'Before you explain a jump in France orders, check the file dates. The provider sends weekend files together on Monday, and most jumps are those late files, not customers.',
    domain: 'sales',
    kind: 'guide',
    where: ['Orders', 'France'],
    valid: {},
    status: 'Live',
    checkedBy: 'Sofia Brandt',
    checkedOn: '1 Oct 2026',
    source: 'https://wiki.example/payments/france-provider-files',
    quote: 'Files not sent over the weekend follow together on Monday morning.',
    dontConclude: "A Monday jump in France orders isn't real until you've checked the file dates.",
  },
  {
    id: 'itm_spe2w9kh',
    title: 'Payment provider switched in France on 12 May 2026',
    summary:
      "We moved France's card and bank payments to a new provider on 12 May 2026. For the first week some orders were booked twice, and finance took them out again on 19 May.",
    domain: 'sales',
    kind: 'event',
    where: ['Orders', 'France'],
    valid: { from: '2026-05-12', until: '2026-05-19' },
    status: 'Live',
    checkedBy: 'Jon Abara',
    checkedOn: '20 Aug 2026',
    source: 'https://wiki.example/payments/france-provider-change',
    quote:
      'Duplicate settlement records from 12 to 18 May will be reversed in the 19 May settlement file.',
    dontConclude:
      "Higher orders in France from 12 to 18 May 2026 don't mean customers ordered more.",
  },
  {
    id: 'itm_kcy22j54',
    title: 'What to rule out before explaining a jump in Gross margin',
    summary:
      'Before you explain a jump in gross margin in Spain, look at four weeks or more. Margin there swings with clearance sales, so one good weekend for us is no trend.',
    body: "1. Look at four weeks or more, never one weekend.\n2. Check for a few very large orders. One big order at full price can lift a week's margin.\n3. Compare with the average order value for the same weeks.",
    domain: 'sales',
    kind: 'guide',
    where: ['Gross margin', 'Spain'],
    valid: {},
    status: 'Needs checking',
    checkedBy: 'Sofia Brandt',
    checkedOn: '30 Sep 2026',
    source: 'https://wiki.example/merchandising/margin-by-market',
    quote:
      'Weekly gross margin in Spain has ranged from 38 to 55 percent over the last two seasons.',
    dontConclude: "A high margin in Spain for one week isn't better pricing.",
    outOfDate:
      'Cube changed the definition of Gross margin on 7 Oct, after this context item was checked.',
  },
  {
    id: 'itm_r6lyl1pc',
    title: 'Data for Orders before 19 January 2026 is not reliable',
    summary:
      'Sweden orders before 19 January 2026 come from the old payment report, which left out bank transfers. Use Sweden orders from 19 January 2026, and compare them only with later months.',
    domain: 'sales',
    kind: 'note',
    where: ['Orders', 'Sweden'],
    valid: { until: '2026-01-19' },
    status: 'Live',
    checkedBy: 'Sofia Brandt',
    checkedOn: '14 Sep 2026',
    source: 'https://wiki.example/data/changelog/2026-01-19',
    quote: 'Bank transfer payments are not included in this report.',
    dontConclude:
      "Sweden orders didn't jump in January 2026. The report started counting bank transfers.",
  },
  {
    id: 'itm_gift_store_credit',
    title: 'Norway orders count store credit',
    summary:
      'Orders in Norway include orders paid with store credit and gift cards, in euros at the daily rate.',
    domain: 'sales',
    kind: 'note',
    where: ['Orders', 'Norway'],
    valid: {},
    status: 'Live',
    checkedBy: 'Jon Abara',
    checkedOn: '5 Sep 2026',
    source: 'https://wiki.example/data/definitions/orders',
    quote: 'Store credit and gift card payments are included in order value.',
    dontConclude: "A rise in Norway orders paid with store credit isn't new money.",
    disagreesWith: 'itm_gift_card_only',
  },
  {
    id: 'itm_gift_card_only',
    title: 'Norway orders are card and cash payments only',
    summary:
      'Orders in Norway count only card and cash payments. Store credit and gift cards are left out.',
    domain: 'sales',
    kind: 'note',
    where: ['Orders', 'Norway'],
    valid: {},
    status: 'Live',
    checkedBy: 'Sofia Brandt',
    checkedOn: '2 Oct 2026',
    source: 'https://wiki.example/finance/norway-payment-types',
    quote: 'Norway order value is taken from card and cash settlements.',
    dontConclude: "Lower Norway orders than the shop report isn't missing data.",
    disagreesWith: 'itm_gift_store_credit',
  },
  {
    id: 'itm_eprlkrz2',
    origin: {
      tool: 'Google Drive',
      folder: 'Marketing / Campaigns',
      doc: 'Norway launch campaign notes',
      read: '20 Oct',
    },
    title: 'Norway launch campaign started on 24 March 2026',
    summary:
      'Marketing started the Norway spring campaign on 24 March 2026. Its ads stopped on 9 May 2026, when the regulator paused price promotions.',
    domain: 'marketing',
    kind: 'event',
    where: ['Return on ad spend', 'Norway'],
    valid: { from: '2026-03-24', until: '2026-05-09' },
    status: 'Live',
    checkedBy: 'Tomas Eriksen',
    checkedOn: '11 Sep 2026',
    source: 'https://wiki.example/marketing/campaigns/norway-spring-2026',
    quote: 'Norway spring campaign: live 24 March 2026. Budget committed until 19 November 2026.',
    dontConclude:
      "Return on ad spend in Norway after 9 May 2026 isn't the campaign's result. Its ads weren't running.",
    // A link to a definition another domain owns: Orders is Sales's metric.
    body: 'Orders from the campaign count under [@ id="metric:Orders" label="Orders"], the metric the Sales team owns.',
  },
  {
    id: 'itm_pfet8zj3',
    title: 'Regulator paused price promotions in Italy on 18 April 2026',
    summary:
      'The Italy regulator paused all price promotions and discount codes from 18 April to 30 May 2026 while it reviewed them. We gave no welcome discounts in Italy in those weeks.',
    domain: 'marketing',
    kind: 'event',
    where: ['Discount cost', 'Italy'],
    valid: { from: '2026-04-18', until: '2026-05-30' },
    status: 'Needs checking',
    checkedBy: 'Tomas Eriksen',
    checkedOn: '20 Jun 2026',
    source: 'https://regulator.example/italy/promotions/2026-04-18',
    quote:
      'Price promotions and discount codes in Italy are suspended from 18 April 2026 pending review.',
    dontConclude: "Lower discount cost in Italy in May 2026 isn't a saving we planned.",
    outOfDate: 'Its check date passed on 18 Sep.',
  },
  {
    id: 'itm_7ini5esz',
    title: 'New VAT rate applied in Norway from 3 August 2025',
    summary:
      'A new VAT rule applied in Norway from 3 August 2025 to 5 June 2026 and taxed discounts as part of the price. We cut welcome discounts in Norway in that time, and discount cost there is lower for those months.',
    domain: 'marketing',
    kind: 'event',
    where: ['Discount cost', 'Norway'],
    valid: { from: '2025-08-03', until: '2026-06-05' },
    status: 'Live',
    checkedBy: 'Tomas Eriksen',
    checkedOn: '1 Sep 2026',
    source: 'https://tax.example/norway/vat/2025-08-03',
    quote: 'From 3 August 2025, discounts given to customers are part of the taxable price.',
    dontConclude:
      "Lower conversion in Norway in those months isn't proven to come from the smaller discounts.",
  },
  {
    id: 'itm_m84x8rur',
    title: 'Payment provider switched in Spain on 21 October 2025',
    summary:
      "Spain payments moved to a new provider on 21 October 2025. It records a first order on the day it's approved, not the day it's made, so first-time buyers land a day later than before.",
    domain: 'customer_value',
    kind: 'event',
    where: ['First-time buyers', 'Spain'],
    valid: { from: '2025-10-21' },
    status: 'Live',
    checkedBy: 'Noor Haddad',
    checkedOn: '15 Sep 2026',
    source: 'https://wiki.example/payments/spain-provider-change',
    quote: 'Orders are reported on the day of approval.',
    dontConclude:
      "Fewer first-time buyers in Spain on 21 October 2025 isn't fewer new customers. They moved to the next day.",
  },
  {
    id: 'itm_p9lchmy0',
    title: 'New customers lags by one day in the source tool',
    summary:
      "New customers in Spain reach Cube the morning after they sign up. Yesterday's count is short until about 10:00, so leave out the last day when you compare weeks.",
    domain: 'customer_value',
    kind: 'issue',
    where: ['New customers', 'Spain'],
    valid: { ongoing: true },
    status: 'Live',
    checkedBy: 'Alex Moreau',
    checkedOn: '8 Oct 2026',
    source: 'https://wiki.example/data/freshness',
    quote: 'Spain sign-ups are loaded in the nightly batch and complete by 10:00 the next day.',
    dontConclude: "A low count for yesterday isn't a drop in sign-ups.",
  },
  {
    id: 'itm_roas_campaign',
    title: 'How to read return on ad spend for one campaign',
    summary:
      'Return on ad spend for one campaign counts orders for 30 days after sign-up. Read a campaign only once its 30 days have passed.',
    domain: 'paid_media',
    kind: 'guide',
    where: ['Return on ad spend'],
    valid: {},
    status: 'Live',
    checkedBy: 'Priya Nair',
    checkedOn: '29 Sep 2026',
    source: 'https://wiki.example/marketing/attribution',
    quote: 'Orders count towards a campaign for 30 days after sign-up.',
    dontConclude: "A low return in a campaign's first weeks isn't its final result.",
  },
  {
    id: 'itm_kh4llvi9',
    title: 'Payment provider switched in Norway on 9 July 2025',
    summary:
      'We moved Norway payments to a new provider on 9 July 2025, and customers had to add their cards again. Support contacts about payments stayed high until 15 December 2025.',
    domain: 'sales',
    kind: 'event',
    where: ['Support contacts', 'Norway'],
    valid: { from: '2025-07-09', until: '2025-12-15' },
    status: 'Archived',
    checkedBy: 'Jon Abara',
    checkedOn: '12 Jan 2026',
    source: 'https://wiki.example/payments/norway-provider-change',
    quote:
      'Customers in Norway will be asked to register their payment card again at their next order.',
    dontConclude:
      "More support contacts in Norway in autumn 2025 don't mean customers were unhappy with our gear.",
  },
  // Replaced by "Orders lags by one day in the source tool" when the loading moved to the morning.
  {
    id: 'itm_lag_two_days',
    title: 'Orders lag by two days in the source tool',
    summary:
      "Germany's payment files reach Cube two days late, so the last two days of orders are always short.",
    domain: 'sales',
    kind: 'issue',
    where: ['Orders', 'Germany'],
    valid: { ongoing: true },
    status: 'Archived',
    checkedBy: 'Sofia Brandt',
    checkedOn: '3 Mar 2026',
    source: 'https://wiki.example/data/freshness',
    quote: 'Germany payment files are loaded two days after the orders.',
    dontConclude: "Low last two days for Germany orders aren't a drop.",
  },
  // Drafts: started, never published. Agents don't get them; they can be finished or deleted.
  {
    id: 'itm_draft_spain_returns',
    title: 'Store returns in Spain count on the day they are booked',
    summary:
      'A return made in a store in Spain counts on the day the store books it, not the day the customer brings it back.',
    domain: 'sales',
    kind: 'note',
    where: ['Returns', 'Spain'],
    valid: { ongoing: true },
    status: 'Draft',
    by: 'Sofia Brandt',
    checkedBy: '',
    checkedOn: '',
    source: '',
    quote: '',
    dontConclude: '',
  },
  {
    id: 'itm_draft_black_friday',
    title: 'Black Friday 2026 orders land in two weeks',
    summary:
      'Black Friday is 27 November 2026. Its weekend orders land in week 48 and week 49 of the weekly reports.',
    domain: 'sales',
    kind: 'event',
    where: ['Orders'],
    valid: { from: '2026-11-27', until: '2026-11-30' },
    status: 'Draft',
    by: 'Jon Abara',
    checkedBy: '',
    checkedOn: '',
    source: '',
    quote: '',
    dontConclude: '',
  },
  {
    id: 'itm_draft_spring_spend',
    title: 'Spring campaign spend was booked in week 12',
    summary: 'Spend on the spring campaign was booked in week 12 instead of week 10.',
    domain: 'marketing',
    kind: 'event',
    where: ['Marketing spend'],
    valid: { from: '2026-03-16', until: '2026-03-22' },
    status: 'Draft',
    by: 'Tomas Eriksen',
    checkedBy: '',
    checkedOn: '',
    source: '',
    quote: '',
    dontConclude: '',
  },
]

export const facts: Fact[] = stored.map(withWhen)

export const factById = (id: string) => facts.find((f) => f.id === id)

/* ---------- metrics (read from Cube) ---------- */

export const metrics: Metric[] = [
  {
    name: 'Orders',
    group: 'Payments',
    domain: 'sales',
    facts: 14,
    definition:
      'The value of orders customers completed and paid for, in euros at the daily rate. Cancelled orders and failed payments are left out.',
  },
  {
    name: 'Returns',
    group: 'Payments',
    domain: 'sales',
    facts: 3,
    definition:
      'The value of products customers sent back, in euros at the daily rate, on the day the payment provider confirmed the refund.',
  },
  {
    name: 'Net revenue',
    otherNames: ['Net sales'],
    group: 'Revenue',
    domain: 'sales',
    facts: 9,
    definition:
      'Gross sales after returns, discounts, VAT and payment fees, in euros. The figure finance reports each month.',
  },
  {
    name: 'Gross sales',
    otherNames: ['Sales'],
    group: 'Revenue',
    domain: 'sales',
    facts: 4,
    definition:
      'The value of every order at full price, in euros, before returns, discounts and VAT.',
  },
  {
    name: 'Units sold',
    group: 'Revenue',
    domain: 'sales',
    facts: 5,
    definition: 'The number of units customers bought, including units paid with store credit.',
  },
  {
    name: 'Active customers',
    group: 'Customers',
    domain: 'customer_value',
    facts: 3,
    definition: 'Customers who placed at least one paid order in the period.',
  },
  {
    name: 'New customers',
    group: 'Customers',
    domain: 'customer_value',
    facts: 4,
    definition:
      'Customers who created an account in the period and confirmed it. Test and staff accounts are left out.',
  },
  {
    name: 'First-time buyers',
    group: 'Customers',
    domain: 'customer_value',
    facts: 2,
    definition: 'Customers whose first paid order fell in the period, whenever they signed up.',
  },
  {
    name: 'Repeat purchase rate',
    group: 'Customers',
    domain: 'customer_value',
    facts: 2,
    note: 'changed',
    definition:
      'The share of customers active in the previous month who are active again this month.',
  },
  {
    name: 'Churn rate',
    group: 'Customers',
    domain: 'customer_value',
    facts: 0,
    note: 'none',
    definition:
      'The share of customers active in the previous month who placed no order this month.',
  },
  {
    name: 'Discount cost',
    group: 'Marketing',
    domain: 'marketing',
    facts: 3,
    definition:
      'The value of the discounts and gift vouchers customers used, in euros, on the day they used them.',
  },
  {
    name: 'Marketing spend',
    group: 'Marketing',
    domain: 'marketing',
    facts: 2,
    definition:
      'Money paid to media, partners and agencies, in euros, on the day the cost was booked.',
  },
  {
    name: 'Cost per acquisition',
    otherNames: ['CPA'],
    group: 'Marketing',
    domain: 'marketing',
    facts: 1,
    definition: 'Marketing spend divided by first-time buyers in the same period, in euros.',
  },
  {
    name: 'Return on ad spend',
    otherNames: ['ROAS'],
    group: 'Marketing',
    domain: 'paid_media',
    facts: 4,
    definition:
      'Net revenue attributed to paid media divided by paid media spend. Attribution is the last click within 30 days.',
  },
  {
    name: 'Conversion rate',
    group: 'Marketing',
    domain: 'marketing',
    facts: 1,
    definition: 'The share of new accounts that place a first paid order within 30 days.',
  },
  {
    name: 'Average order value',
    group: 'Basket',
    domain: 'sales',
    facts: 2,
    definition:
      'The mean value of a paid order, in euros, after discounts. Gift-card purchases are left out.',
  },
  {
    name: 'Units per order',
    group: 'Basket',
    domain: 'sales',
    facts: 1,
    definition:
      'The mean number of units in a paid order. A product bought in two sizes counts twice.',
  },
  {
    name: 'Gross margin',
    otherNames: ['Margin rate'],
    group: 'Basket',
    domain: 'sales',
    facts: 2,
    note: 'changed',
    definition:
      'Net revenue minus what the goods cost us, as a share of net revenue, for orders shipped.',
  },
  {
    name: 'Online share',
    group: 'Basket',
    domain: 'sales',
    facts: 2,
    definition:
      'The share of net revenue from orders placed in the webshop or the apps, not in a store.',
  },
  {
    name: 'Customer lifetime value',
    group: 'Customers',
    domain: 'customer_value',
    facts: 0,
    note: 'none',
    definition: 'The net revenue a customer is expected to bring over two years, in euros.',
  },
  {
    name: 'Support contacts',
    group: 'Operations',
    domain: 'sales',
    facts: 1,
    definition: 'Chats, emails and calls to customer service that someone on our team answered.',
  },
  {
    name: 'On-time shipping rate',
    group: 'Operations',
    facts: 0,
    note: 'none',
    definition: 'No description in Cube.',
  },
]

/** The dimensions in Cube, the other half of the data glossary. */
export const dimensions: { name: string; values: string; definition: string }[] = [
  {
    name: 'Market',
    values: '12 markets, each a real country',
    definition: 'The country or region the order ships to.',
  },
  {
    name: 'Product',
    values: 'Footwear, Clothing, Camping, Climbing',
    definition: 'The product group the sale belongs to.',
  },
  {
    name: 'Channel',
    values: 'Marketplace, Paid search, Email, Organic',
    definition: 'How the customer first came to us, from the attribution at sign-up.',
  },
  {
    name: 'Platform',
    values: 'Web, iOS, Android',
    definition: 'Where the order was placed: the website, the iOS app or the Android app.',
  },
  {
    name: 'Campaign',
    values: '2,400 campaigns',
    definition: 'The marketing campaign the customer was acquired through.',
  },
]

export const markets = [
  'Norway',
  'Spain',
  'Poland',
  'France',
  'Germany',
  'United Kingdom',
  'Netherlands',
  'Italy',
  'Canada',
  'United States',
  'Sweden',
  'Mexico',
]

export const ABOUT_BUSINESS = `We are an outdoor-gear retailer. We sell footwear, clothing, camping and climbing gear in our own stores, in our webshop and apps, and through marketplaces, in twelve markets.

Words that are easy to misread here:
- Order: a purchase a customer completed and paid for, in a store, the webshop or an app. A cancelled order is not an order.
- Return: a product a customer sends back for a refund. Gross sales are before returns, discounts and VAT. Net revenue is after them.
- First-time buyer: a customer whose first paid order falls in the period, whenever they signed up.
- Marketplace: another company's online shop that sells our gear. It reports those sales to us a day or more late.
- Marketplace commission: the share of each marketplace sale the marketplace keeps.
- Gross margin: net revenue minus what the goods cost us, as a share of net revenue.
- Market: the country or region an order ships to. Selling country: the country of the store or webshop that took the order. They can differ.
- Season: spring and summer, or autumn and winter. Compare a season with the same season a year before.`
