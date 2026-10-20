import {
  SUMMARY_MAX_LENGTH,
  reviewQuestion,
  type ContextItem,
  type CreationChannel,
  type ItemKind,
  type RiskLevel,
} from '../../domain/item.ts'
import { serializeMentions, type MentionPart } from '../../domain/mentions.ts'
import { defaultNotToConclude } from '../../domain/proposal-rules.ts'
import { demoCaveats } from './caveats.ts'
import { definitionRefOf, demoDefinitions, goneRefOf } from './cube-model.ts'
import { addDays, createRandom, type Random } from './random.ts'
import { FIXTURE_TODAY, areas, people, vocabulary } from './reference-data.ts'
import { storyFacts } from './story-facts.ts'

/** What the contributor said the item does not mean: their own words, or the default (FR-104). */
const caveatOf = (title: string) => demoCaveats[title] ?? defaultNotToConclude

export const DEFAULT_ITEM_COUNT = 1500
export const DEFAULT_SEED = 20261007

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return `${Number(day)} ${months[Number(month) - 1] ?? ''} ${year}`
}

function formatMonth(isoDate: string): string {
  const [year, month] = isoDate.split('-')
  return `${months[Number(month) - 1] ?? ''} ${year}`
}

/** The markets a sentence names with "the": "orders in the Netherlands". */
const theMarkets = new Set(['united_kingdom', 'netherlands', 'united_states'])

const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)

/** What a template names, as people write it: the market, the metric and the day a fact starts. */
type Subject = {
  /** The market's name, as a label or before a noun: "Netherlands payments". */
  market: string
  /** The market in a sentence: "in the Netherlands". */
  place: string
  marketId: string
  /** The market's id as it reads in an address, such as `united-kingdom`. */
  marketSlug: string
  metric: string
  /** The metric's id as it reads in an address, such as `net-revenue`. */
  metricSlug: string
  /** The start, such as "4 August 2026". */
  date: string
  /** The start's month, such as "August 2026". */
  month: string
  /** The start as an ISO date, for a source's address. */
  day: string
}

type Line = (s: Subject) => string

/**
 * How one kind of fact is written. The title is the template's, word for word: tests, test
 * questions and the golden set know the titles. The summary opens with what happened, where and
 * when (`lead`), then adds a few of the writer's own lines; the source is a page and a sentence
 * copied from it. Each list is written as a person would put it, so no two facts read like a form.
 */
type Template = {
  title: Line
  lead: Line
  more: readonly Line[]
  quotes: readonly Line[]
  source: Line
  /** A guide's text. */
  body?: Line
}

const eventTemplates: readonly Template[] = [
  {
    title: (s) => `Online sales to ${s.place} stopped on ${s.date}`,
    lead: (s) => `A new customs rule stopped all online sales to ${s.place} on ${s.date}.`,
    more: [
      (s) => `${s.metric} in ${s.place} from that day doesn't compare with the weeks before.`,
      () => 'Parcels already on their way still arrived.',
      (s) => `Leave ${s.place} out when you add markets together for these weeks.`,
      (s) => `Compare ${s.place} with itself before or after the stop, never across it.`,
      () => 'The customs notice lists every product group it covers.',
    ],
    quotes: [
      (s) =>
        `Parcels from webshops outside ${s.place} are held at the border from ${s.date} until further notice.`,
      (s) =>
        `Carriers must stop accepting webshop parcels for ${s.place} from ${s.date}. Parcels already in transit may enter.`,
    ],
    source: (s) => `https://customs.example/${s.marketSlug}/notices/${s.day}`,
  },
  {
    title: (s) => `New VAT rate applied in ${s.place} from ${s.date}`,
    lead: (s) => `A new VAT rate started in ${s.place} on ${s.date}.`,
    more: [
      () =>
        'Figures after VAT use the new rate from that day, and figures before VAT stay the same.',
      (s) => `The rate covers every product group in ${s.place}.`,
      () => 'Discounts come off the price before VAT under the new rules.',
      () => 'Finance keeps the old and the new rate side by side in the tax sheet.',
      (s) => `Keep the new rate in mind when you compare ${s.metric} across ${s.date}.`,
    ],
    quotes: [
      (s) => `The standard VAT rate in ${s.place} changes from ${s.date}.`,
      (s) => `From ${s.date}, retailers in ${s.place} charge the new rate on all sales.`,
    ],
    source: (s) => `https://tax.example/${s.marketSlug}/vat/${s.day}`,
  },
  {
    title: (s) => `Payment provider switched in ${s.place} on ${s.date}`,
    lead: (s) => `We switched ${s.place} to a new payment provider on ${s.date}.`,
    more: [
      () => "Everything from that day comes from the new provider's files.",
      () => 'Cards moved first, and bank transfers followed within the week.',
      () => 'Everyone had to add their card again.',
      (s) => `Expect ${s.metric} in ${s.place} to be uneven for the first few days.`,
      () =>
        'A few transactions from the first day were booked twice and taken out again a week later.',
    ],
    quotes: [
      (s) => `All ${s.market} payments are processed by the new provider from ${s.date}.`,
      (s) => `Cutover for ${s.place} is planned for ${s.date} at 06:00 local time.`,
    ],
    source: (s) => `https://wiki.example/payments/${s.marketSlug}-provider-change-${s.day}`,
  },
  {
    title: (s) => `${s.market} launch campaign started on ${s.date}`,
    lead: (s) => `We started the ${s.market} launch campaign on ${s.date}.`,
    more: [
      () => 'It ran on TV, social and search at the same time.',
      () => 'Welcome discounts were doubled while it ran.',
      (s) => `Expect more sign-ups in ${s.place} in the first weeks.`,
      (s) => `Compare ${s.place} with a market without a campaign in the same weeks.`,
    ],
    quotes: [
      (s) => `The ${s.market} launch campaign starts on ${s.date} on TV, social and search.`,
      (s) => `Budget for the ${s.market} launch is approved from ${s.date}.`,
    ],
    source: (s) => `https://wiki.example/marketing/campaigns/${s.marketSlug}-launch-${s.day}`,
  },
  {
    title: (s) => `Regulator paused price promotions in ${s.place} on ${s.date}`,
    lead: (s) => `The regulator paused all price promotions in ${s.place} on ${s.date}.`,
    more: [
      (s) => `We ran no price promotions in ${s.place} while the pause lasted.`,
      (s) => `Orders with a discount code in ${s.place} are close to zero in those weeks.`,
      () => 'Customers who paid full price kept ordering.',
      (s) => `Compare ${s.place} with a market that kept its promotions.`,
    ],
    quotes: [
      (s) => `Price promotions in ${s.place} are suspended on all channels from ${s.date}.`,
      (s) => `No retailer may advertise price reductions in ${s.place} from ${s.date}.`,
    ],
    source: (s) => `https://regulator.example/${s.marketSlug}/promotions/${s.day}`,
  },
  {
    title: (s) => `Outage affected tracking in ${s.place} on ${s.date}`,
    lead: (s) =>
      `An outage affected our tracking in ${s.place} on ${s.date}, and some visits and sign-ups weren't recorded.`,
    more: [
      (s) => `Expect ${s.metric} for ${s.place} to read low for that day.`,
      () => 'Money figures come from another system and are complete.',
      () => "We couldn't fill in the missing events afterwards.",
      () => 'Leave that day out when you compare weeks.',
    ],
    quotes: [
      (s) =>
        `Event collection for ${s.place} was degraded on ${s.date}. Payments were not affected.`,
      (s) => `Tracking events for ${s.place} were dropped between 09:10 and 17:45 on ${s.date}.`,
    ],
    source: (s) => `https://status.example/incidents/${s.marketSlug}-${s.day}`,
  },
  {
    title: (s) =>
      `A change to the returns rules in ${s.place} took effect on ${s.date}, which also changed how returns are counted in the weekly reports`,
    lead: (s) =>
      `New returns rules started in ${s.place} on ${s.date}, and the weekly reports changed with them.`,
    more: [
      () => 'Weekly reports from that day count returns a little later than before.',
      () => 'Customers now have 30 days to send a product back.',
      (s) => `Compare ${s.metric} in ${s.place} only with weeks after the change.`,
      () => 'Most returns reach the warehouse within a week.',
    ],
    quotes: [
      (s) =>
        `From ${s.date}, retailers in ${s.place} must accept returns for 30 days after the order arrives.`,
      () => 'A refund is paid only after the returned product is checked.',
    ],
    source: (s) => `https://regulator.example/${s.marketSlug}/returns-rules/${s.day}`,
  },
]

const noteTemplates: readonly Template[] = [
  {
    title: (s) => `Data for ${s.metric} before ${s.date} is not reliable`,
    lead: (s) => `Our data for ${s.metric} before ${s.date} has gaps we can't fill in.`,
    more: [
      (s) => `Start trend lines on ${s.date}.`,
      () => 'The old tracking tool lost some days and doubled others.',
      () => 'Use the earlier months for rough sizes only, never for weekly changes.',
      () => 'Compare later months with each other instead of with the year before.',
    ],
    quotes: [
      (s) =>
        `Data for ${s.metric} before ${s.date} was collected by the old tool and has known gaps.`,
      (s) => `We won't backfill ${s.metric} before the migration on ${s.date}.`,
    ],
    source: (s) => `https://wiki.example/data/changelog/${s.day}`,
  },
  {
    title: (s) => `${s.metric} excludes test accounts`,
    lead: (s) => `We leave the accounts our own teams use for testing out of ${s.metric}.`,
    more: [
      () => 'There are a few hundred of them in each market.',
      () =>
        "Your number can be a little lower than in the finance team's report, which counts them.",
      () => "New test accounts are left out from the day they're made.",
      () => 'Ask the data team if you need them included.',
    ],
    quotes: [
      (s) => `Accounts flagged as internal or test are removed before ${s.metric} is calculated.`,
      () => 'Test accounts never count towards reported figures.',
    ],
    source: (s) => `https://wiki.example/data/definitions/${s.metricSlug}`,
  },
  {
    title: (s) => `${s.metric} changed definition on ${s.date}`,
    lead: (s) => `We changed how we count ${s.metric} on ${s.date}.`,
    more: [
      () => "Numbers before and after that day don't compare one to one.",
      () => 'Compare whole months on the same side of the change.',
      () => 'Dashboards moved to the new definition the same day.',
      () => 'Ask the data team for a long series on the old definition.',
    ],
    quotes: [
      (s) =>
        `The definition of ${s.metric} changes on ${s.date}. Earlier figures are not restated.`,
      (s) => `${s.metric} follows the new definition from ${s.date}.`,
    ],
    source: (s) => `https://wiki.example/data/changelog/${s.day}`,
  },
  {
    title: (s) => `${s.metric} is reported in local currency before conversion`,
    lead: (s) => `We report ${s.metric} in each market's own currency until it's converted.`,
    more: [
      () => 'Convert to euros at the rate of the day before you add markets together.',
      () => 'Euro figures can move with the exchange rate while the market itself stays flat.',
      () => 'The finance close uses the month-end rate, so its numbers differ slightly.',
    ],
    quotes: [
      (s) =>
        `${s.metric} is stored in the local currency of each market. Conversion happens in reporting.`,
      () => 'Amounts are in local currency. Apply the daily rate for euro totals.',
    ],
    source: (s) => `https://wiki.example/data/definitions/${s.metricSlug}`,
  },
  {
    title: (s) => `${s.metric} lags by one day in the source tool`,
    lead: (s) => `Cube gets ${s.metric} a day late.`,
    more: [
      () => "Today's figure is always missing, and yesterday's is often incomplete.",
      () => 'Leave out the last day when you compare weeks.',
      () => 'The number settles by about 10:00 the next morning.',
      () => 'Live dashboards show it a day behind the others.',
    ],
    quotes: [
      (s) => `${s.metric} is loaded in the nightly batch and is complete the following morning.`,
      (s) => `Expect a delay of one day for ${s.metric}.`,
    ],
    source: () => 'https://wiki.example/data/freshness',
  },
]

const guideTemplates: readonly Template[] = [
  {
    title: (s) => `How to investigate a drop in ${s.metric} in ${s.place}`,
    lead: (s) =>
      `Before you explain a drop in ${s.metric} in ${s.place}, check what's written down for those dates.`,
    more: [
      (s) => `Then compare ${s.place} with a market that stayed steady.`,
      () => 'Most drops match a closure, an outage or a change in how we count.',
      () => 'Look at the same weeks last year before you call it a drop.',
      () => 'Ask the owner of the domain before you name a cause.',
      () => "Write down what you find, so the next person doesn't start over.",
    ],
    quotes: [
      () => 'Rule out data problems before you look for a business reason.',
      () => 'Check closures and outages first. They explain most drops we see.',
    ],
    source: () => 'https://wiki.example/analytics/handbook/investigating-drops',
    body: (s) =>
      [
        `Start with the dates. Pick the exact weeks the drop shows in ${s.place}, and the same weeks a year earlier.`,
        'Then work through these:',
        `1. Look for closures, outages and new rules in ${s.place} in those weeks.\n2. Compare ${s.place} with a market that had none of them.\n3. Check whether the way we count ${s.metric} changed in that time.`,
        "If you still can't explain it, ask the owner of the domain. Say what you've checked, so they don't repeat it.",
      ].join('\n\n'),
  },
  {
    title: (s) => `Checklist before you report a change in ${s.metric}`,
    lead: (s) =>
      `Before you share a change in ${s.metric}, go through four checks. It takes about ten minutes.`,
    more: [
      () => "Most surprises we've seen were late data, not real changes.",
      () => 'Keep the checklist with your report, so readers know what you checked.',
      () => 'If a check fails, say so in the report.',
    ],
    quotes: [
      () => 'Every reported change must pass the four checks in this list.',
      () => "Don't report a change until the data for the last day is complete.",
    ],
    source: () => 'https://wiki.example/analytics/handbook/before-you-report',
    body: (s) =>
      [
        `Before you share a change in ${s.metric}:`,
        '1. Make sure the last day is complete. Some sources arrive a day late.\n2. Look for anything written down for the market and the dates.\n3. Compare with the same weeks last year.\n4. Check that every number uses the same currency.',
        'If a check fails, say so in the report. The owner of the domain can help with the rest.',
      ].join('\n\n'),
  },
  {
    title: (s) => `Comparing ${s.metric} between ${s.place} and other markets`,
    lead: (s) =>
      `Before you compare ${s.metric} in ${s.place} with other markets, line up the same dates for all of them.`,
    more: [
      () => 'Use a share of the total when markets differ a lot in size.',
      () => 'Leave out any market that was closed or paused in those weeks.',
      (s) => `${capital(s.place)} has its own tax rules, so compare before tax when you can.`,
    ],
    quotes: [
      () => 'Cross-market comparisons use euro values and identical date ranges.',
      () => 'Exclude markets with known disruptions from comparisons.',
    ],
    source: () => 'https://wiki.example/analytics/handbook/comparing-markets',
    body: (s) =>
      [
        'Markets differ in size, currency and rules, so a raw comparison misleads.',
        '1. Use the same dates for every market.\n2. Put money in euros, at the rate of the day.\n3. Leave out any market with a closure or an outage in that time.',
        `The owner of the domain keeps a list of markets that compare well with ${s.place}.`,
      ].join('\n\n'),
  },
  {
    title: (s) => `What to rule out before explaining a jump in ${s.metric}`,
    lead: (s) =>
      `Before you explain a jump in ${s.metric}, rule out late data and anything booked twice.`,
    more: [
      () => 'Then check whether a campaign or a holiday weekend started that week.',
      (s) => `Look for a change in how we count ${s.metric}.`,
      () => 'A jump in one market only is more often data than business.',
    ],
    quotes: [
      () => 'Rule out data issues before attributing a jump to business activity.',
      () => 'Most one-day jumps are late files arriving together.',
    ],
    source: () => 'https://wiki.example/analytics/handbook/explaining-jumps',
    body: (s) =>
      [
        `Before you explain a jump in ${s.metric}, rule out these:`,
        `1. Late data from the day before that arrives all at once.\n2. Anything booked twice after a change of payment provider.\n3. A change in how we count ${s.metric}.`,
        'If none of these fit, compare the market with the others. Then ask the owner of the domain.',
      ].join('\n\n'),
  },
]

const exampleTemplates: readonly Template[] = [
  {
    title: (s) => `How did ${s.metric} change in ${s.place} in ${s.month}?`,
    lead: (s) =>
      `How did ${s.metric} change in ${s.place} in ${s.month}? A good answer compares it with the month before and a year earlier.`,
    more: [
      () => 'It names each fact it used, with its dates.',
      () => 'It gives the size of the change in numbers before any explanation.',
      () => "It lists what's written down for that month.",
      () => 'If nothing is written down for that month, it says so.',
      () => "It names no cause that the facts don't state.",
    ],
    quotes: [
      () => 'Answer with the month-on-month and year-on-year change first.',
      () => 'A good answer cites the facts it used and their dates.',
    ],
    source: (s) => `https://wiki.example/analytics/good-answers/${s.metricSlug}-${s.marketSlug}`,
  },
  {
    title: (s) => `Which markets drove the change in ${s.metric}, with ${s.place} as the baseline?`,
    lead: (s) =>
      `Which markets moved most against ${s.place}? A good answer ranks them over the same weeks.`,
    more: [
      () => 'It uses euros for every market.',
      () => 'It leaves out markets that were closed in those weeks, and says which.',
      () => "It shows each market's share of the total change.",
      () => "It names no cause that the facts don't state.",
    ],
    quotes: [
      () => 'Rank markets by their share of the total change against the baseline.',
      () => 'Use one baseline market and the same weeks for every comparison.',
    ],
    source: (s) => `https://wiki.example/analytics/good-answers/${s.metricSlug}-by-market`,
  },
  {
    title: (s) => `What explains the movement of ${s.metric} in ${s.month}?`,
    lead: (s) =>
      `What happened to ${s.metric} in ${s.month}? A good answer starts with the closures, outages, new rules and campaigns written down.`,
    more: [
      () => 'It says which markets moved most.',
      () => 'It says when a movement has no fact to explain it.',
      () => "It names no cause that the facts don't state.",
      () => 'It gives the size of the change in numbers before any explanation.',
    ],
    quotes: [
      () => 'Start with the size of the change, then the facts that apply.',
      () => 'A good answer cites the facts it used and their dates.',
    ],
    source: (s) =>
      `https://wiki.example/analytics/good-answers/${s.metricSlug}-${s.day.slice(0, 7)}`,
  },
]

const templatesOf: Record<Exclude<ItemKind, 'issue'>, readonly Template[]> = {
  event: eventTemplates,
  note: noteTemplates,
  guide: guideTemplates,
  example: exampleTemplates,
}

/**
 * Where a writer usually stops: two or three short sentences. The few long summaries a library
 * has (12 lines asked for) run to the summary limit, so lists still meet one.
 */
const USUAL_SUMMARY_LENGTH = 200

/**
 * The summary: the lead, then up to `count` of the writer's further lines, drawn one by one. A
 * line already used or one that would make the summary too long is left out, so a summary never
 * repeats itself or stops mid-sentence. It draws `count` times whatever it keeps, so the random
 * stream, and every field after it, stays the same.
 */
function summaryOf(random: Random, template: Template, subject: Subject, count: number): string {
  const limit = count > 3 ? SUMMARY_MAX_LENGTH : USUAL_SUMMARY_LENGTH
  const lines = [template.lead(subject)]
  for (let i = 0; i < count; i += 1) {
    const line = random.pick(template.more)(subject)
    if (!lines.includes(line) && [...lines, line].join(' ').length <= limit) lines.push(line)
  }
  return lines.join(' ')
}

function itemId(random: Random): string {
  let id = ''
  for (let i = 0; i < 8; i += 1) id += random.int(0, 35).toString(36)
  return `itm_${id}`
}

function changeMark(random: Random): string {
  return `cm_${random.int(0x100000, 0xffffff).toString(16)}`
}

const currentMarks = new Map(
  demoDefinitions.map((definition) => [definition.ref, definition.changeMark]),
)

/**
 * The definition an item references for a metric, and the change mark it recorded, as the demo
 * Cube model has it (cube-model.ts). An item without a flag recorded the current mark. One that
 * needs a check recorded an older mark (the one drawn), and one whose source is missing references
 * a member Cube removed, so reading the demo model keeps every flag (CON-209, CON-210).
 */
function referenceTo(
  metricId: string,
  checkFlag: ContextItem['checkFlag'],
  drawnMark: string,
): [ref: string, mark: string] {
  if (checkFlag === 'source_missing') return [goneRefOf(metricId), drawnMark]
  const group = vocabulary.metrics.find((metric) => metric.id === metricId)?.group
  const ref = definitionRefOf({ key: `metric:${metricId}`, group })
  const current = currentMarks.get(ref)
  if (!current) throw new Error(`No demo definition ${ref}`)
  return [ref, checkFlag === 'needs_check' ? drawnMark : current]
}

function buildItem(random: Random, flags: Random, usedIds: Set<string>): ContextItem {
  const kind = random.weighted<Exclude<ItemKind, 'issue'>>([
    ['event', 35],
    ['note', 30],
    ['guide', 20],
    ['example', 15],
  ])
  const area = random.weighted(areas.map((a) => [a, a.id === 'area_sandbox' ? 3 : 10] as const))
  const metric = random.pick(vocabulary.metrics)
  const secondMetric = random.chance(0.3) ? random.pick(vocabulary.metrics) : null
  const marketDimension = vocabulary.dimensions[0]
  const market = random.pick(marketDimension?.values ?? [])
  const start = addDays('2024-01-01', random.int(0, 900))
  const subject: Subject = {
    market: market.name,
    place: theMarkets.has(market.id) ? `the ${market.name}` : market.name,
    marketId: market.id,
    marketSlug: market.id.replace(/_/g, '-'),
    metric: metric.name,
    metricSlug: metric.id.replace(/_/g, '-'),
    date: formatDate(start),
    month: formatMonth(start),
    day: start,
  }
  const template = random.pick(templatesOf[kind])
  const title = template.title(subject)
  const summary = summaryOf(random, template, subject, random.chance(0.08) ? 12 : random.int(1, 3))

  const hasEnd = kind === 'event' ? random.chance(0.55) : random.chance(0.12)
  const end = hasEnd ? addDays(start, random.int(14, 400)) : null
  const accepted = addDays(start, random.int(0, 20))
  const draftReview = end === null ? addDays(accepted, 90 * random.int(1, 6)) : null

  const dimensionValues = [{ dimension: 'market', value: market.id }]
  if (random.chance(0.25)) {
    const product = vocabulary.dimensions[1]
    if (product)
      dimensionValues.push({ dimension: 'product', value: random.pick(product.values).id })
  }

  // About one item in twelve is past its review date, as in a library that owners look after.
  // The review dates and check flags come from their own stream, so the other fields stay as
  // they were.
  const reviewDate =
    draftReview === null
      ? null
      : flags.chance(0.08)
        ? addDays(FIXTURE_TODAY, -flags.int(1, 60))
        : addDays(FIXTURE_TODAY, flags.int(7, 330))
  const checkFlag = flags.weighted<ContextItem['checkFlag']>([
    [null, 95],
    ['needs_check', 4],
    ['source_missing', 1],
  ])

  // A second pick can repeat the first metric. An item names a metric once (the tables refuse a
  // repeat), so the repeat is dropped. Its change mark is still drawn, as before, so the random
  // stream and every later field stay the same.
  const picked = [metric.id, ...(secondMetric ? [secondMetric.id] : [])]
  const changeMarks = Object.fromEntries(
    picked.map((id) => referenceTo(id, checkFlag, changeMark(random))),
  )
  const metrics = [...new Set(picked)]
  const references = Object.keys(changeMarks)

  const riskLevel: RiskLevel = random.chance(0.08) ? 'high' : kind === 'note' ? 'low' : 'normal'
  const createdVia: CreationChannel = random.weighted([
    ['form', 50],
    ['assistant', 20],
    ['chat', 12],
    ['import', 12],
    ['command_line', 4],
    ['mcp', 2],
  ])

  let id = itemId(random)
  while (usedIds.has(id)) id = itemId(random)
  usedIds.add(id)

  const proposer = random.pick(people)
  const updated = addDays(accepted, random.int(0, 120))
  return {
    id,
    kind,
    areaId: area.id,
    status: random.chance(0.06) ? 'retired' : 'accepted',
    version: random.weighted([
      [1, 70],
      [2, 20],
      [3, 8],
      [4, 2],
    ]),
    title,
    summary,
    ...(template.body ? { body: template.body(subject) } : {}),
    references,
    scope: { metrics, dimensions: [], dimensionValues },
    validity: { start, end },
    reviewDate,
    reviewQuestion: reviewQuestion({ kind, validity: { end } }),
    checkFlag,
    evidence: [
      {
        url: template.source(subject),
        quote: random.pick(template.quotes)(subject),
        date: accepted,
      },
    ],
    claimLevel: random.chance(0.7) ? 'fact_only' : 'effect_stated',
    riskLevel,
    notToConclude: caveatOf(title),
    audience: random.chance(0.85)
      ? { kind: 'everyone' }
      : { kind: 'groups', groups: [random.pick(['finance', 'regulation', 'data_platform'])] },
    // Every fixture domain has an owner (reference-data.ts).
    ownerId: area.ownerIds[0] ?? '',
    changeMarks,
    createdVia,
    proposerId: proposer.id,
    createdAt: `${accepted}T08:00:00Z`,
    updatedAt: `${updated > FIXTURE_TODAY ? FIXTURE_TODAY : updated}T09:00:00Z`,
  }
}

/** Days an issue with no end date waits for its first re-check (the `review.open_issue_days` default). */
const OPEN_ISSUE_REVIEW_DAYS = 14

/**
 * The demo issues, dated around the fixture "today" so every state shows: two still going on
 * with an end date, one open with no end date, one open past its review date (asked "Is this
 * still going on?"), and three that ended and are history now.
 */
const demoIssues = [
  {
    title: 'Marketplace partner reporting for Norway is down',
    summary:
      'The marketplace partner sends no customer data for Norway from 29 September. New customers for these days are missing until the feed is back.',
    market: 'norway',
    metric: 'new_customers',
    start: '2026-09-29',
    end: '2026-10-11',
    source: 'https://status.example/incidents/marketplace-norway-2026-09-29',
    quote: 'Customer data for Norway is not arriving. We expect to resend it by 10 October.',
  },
  {
    title: 'Payment provider delays order data in Poland',
    summary:
      'Orders in Poland arrive two days late while the payment provider moves its servers. Recent days look low until the data catches up.',
    market: 'poland',
    metric: 'orders',
    start: '2026-10-01',
    end: '2026-10-15',
    source: 'https://status.example/incidents/payments-poland-2026-10-01',
    quote: 'Poland settlement files are delayed by up to 48 hours during the data centre move.',
  },
  {
    title: 'Tracking outage in the Spain app',
    summary:
      "The Spain app hasn't tracked sessions since 2 October. Active customers from the app read low until tracking is fixed.",
    market: 'spain',
    metric: 'active_customers',
    start: '2026-10-02',
    end: null,
    source: 'https://status.example/incidents/app-tracking-spain-2026-10-02',
    quote: 'App events from Spain are not reaching the collector since release 8.14 on 2 October.',
  },
  {
    title: 'Stock feed gaps in Canada since mid September',
    summary:
      'The stock feed for Canada drops some products since 15 September. Online share for Canada reads low while the gaps last.',
    market: 'canada',
    metric: 'online_share',
    start: '2026-09-15',
    end: null,
    source: 'https://wiki.example/supply/stock-feed-log',
    quote: 'Canada products are intermittently missing from the feed since 15 September.',
  },
  {
    title: 'Partner reporting for France was down for twelve days',
    summary:
      "A partner sent no reports for France from 3 to 14 August. Units sold for these days aren't reliable. Data from 15 August is complete again.",
    market: 'france',
    metric: 'units_sold',
    start: '2026-08-03',
    end: '2026-08-15',
    source: 'https://status.example/incidents/partner-france-2026-08-03',
    quote: 'France partner reports for 3 to 14 August could not be recovered.',
  },
  {
    title: 'Clothing order lines were missing in Germany for three days',
    summary:
      'A tracking release dropped some clothing order lines in Germany from 10 to 12 June. Units per order for these days reads too low.',
    market: 'germany',
    metric: 'units_per_order',
    start: '2026-06-10',
    end: '2026-06-13',
    source: 'https://status.example/incidents/clothing-tracking-germany-2026-06-10',
    quote: 'Release 7.2 stopped recording clothing order lines in Germany from 10 to 12 June.',
  },
  {
    title: 'Returns were counted twice in the United Kingdom',
    summary:
      'A source change counted some returns in the United Kingdom twice from 1 to 7 March. Returns for that week are too high.',
    market: 'united_kingdom',
    metric: 'returns',
    start: '2026-03-01',
    end: '2026-03-08',
    source: 'https://wiki.example/data/changelog/2026-03-08',
    quote:
      'Returns in the United Kingdom from 1 to 7 March were loaded twice and are not corrected.',
  },
] as const

/**
 * Issues are temporary: an issue with no end date gets the short default review from its start,
 * and one with an end date needs no review, because it stops applying by itself (FR-135).
 */
function buildIssues(random: Random, usedIds: Set<string>): ContextItem[] {
  const sales = areas.find((area) => area.id === 'area_sales')!
  return demoIssues.map((issue) => {
    let id = itemId(random)
    while (usedIds.has(id)) id = itemId(random)
    usedIds.add(id)
    // Issues recorded a drawn mark before the demo model gave them the current one; the draw
    // stays, so the stream and every later field are the same.
    changeMark(random)
    const [reference, mark] = referenceTo(issue.metric, null, '')
    const updated = addDays(issue.start, 1)
    return {
      id,
      kind: 'issue',
      areaId: sales.id,
      status: 'accepted',
      version: 1,
      title: issue.title,
      summary: issue.summary,
      references: [reference],
      scope: {
        metrics: [issue.metric],
        dimensions: [],
        dimensionValues: [{ dimension: 'market', value: issue.market }],
      },
      validity: { start: issue.start, end: issue.end },
      reviewDate: issue.end === null ? addDays(issue.start, OPEN_ISSUE_REVIEW_DAYS) : null,
      reviewQuestion: reviewQuestion({ kind: 'issue', validity: { end: issue.end } }),
      checkFlag: null,
      evidence: [
        {
          url: issue.source,
          quote: issue.quote,
          date: issue.start,
        },
      ],
      claimLevel: 'fact_only',
      riskLevel: 'normal',
      notToConclude: caveatOf(issue.title),
      audience: { kind: 'everyone' },
      ownerId: sales.ownerIds[0] ?? '',
      changeMarks: { [reference]: mark },
      createdVia: 'form',
      proposerId: random.pick(people).id,
      createdAt: `${issue.start}T08:00:00Z`,
      updatedAt: `${updated > FIXTURE_TODAY ? FIXTURE_TODAY : updated}T09:00:00Z`,
    }
  })
}

/**
 * Items about a dimension with any value ("market: any value", FR-126): each applies to a
 * question that names the dimension or one of its values, never to one that names neither.
 */
const demoAnyValue = [
  {
    kind: 'note',
    areaId: 'area_sales',
    title: 'Orders are booked in the currency of each market',
    summary:
      'Orders in every market are booked in its own currency and turned into euros at the rate of the day. Compare markets in euros only.',
    metric: 'orders',
    dimension: 'market',
    start: '2025-01-01',
    source: 'https://wiki.example/data/definitions/orders',
    quote: 'Every order is converted to euros at the rate of the day.',
  },
  {
    kind: 'guide',
    areaId: 'area_marketing',
    title: 'How to read return on ad spend for one campaign',
    summary:
      'Return on ad spend for a campaign counts orders for 30 days after sign-up. A campaign younger than 30 days reads low, so compare campaigns of the same age.',
    metric: 'return_on_ad_spend',
    dimension: 'campaign',
    start: '2025-06-01',
    source: 'https://wiki.example/marketing/attribution',
    quote: 'Orders count towards a campaign for 30 days after sign-up.',
  },
  {
    // Once a line of the Sales description: a caveat belongs in a fact, where it is
    // reviewed, dated and given only to a question it applies to.
    kind: 'guide',
    areaId: 'area_sales',
    title: 'Comparing net revenue across markets with different tax rules',
    summary:
      'Net revenue is after VAT, and each market sets its own VAT rates. Ask the owner of Sales before you compare net revenue across markets with different tax rules.',
    metric: 'net_revenue',
    dimension: 'market',
    start: '2025-01-01',
    source: 'https://tax.example/vat-by-market',
    quote: 'VAT rates are set by each market and differ between them.',
  },
] as const

function buildAnyValue(random: Random, usedIds: Set<string>): ContextItem[] {
  return demoAnyValue.map((entry) => {
    let id = itemId(random)
    while (usedIds.has(id)) id = itemId(random)
    usedIds.add(id)
    const area = areas.find((candidate) => candidate.id === entry.areaId)!
    const [reference, mark] = referenceTo(entry.metric, null, '')
    const updated = addDays(entry.start, 30)
    return {
      id,
      kind: entry.kind,
      areaId: area.id,
      status: 'accepted',
      version: 1,
      title: entry.title,
      summary: entry.summary,
      references: [reference],
      scope: { metrics: [entry.metric], dimensions: [entry.dimension], dimensionValues: [] },
      validity: { start: entry.start, end: null },
      reviewDate: addDays(FIXTURE_TODAY, 60),
      reviewQuestion: 'still_correct',
      checkFlag: null,
      evidence: [
        {
          url: entry.source,
          quote: entry.quote,
          date: entry.start,
        },
      ],
      claimLevel: 'fact_only',
      riskLevel: 'low',
      notToConclude: caveatOf(entry.title),
      audience: { kind: 'everyone' },
      ownerId: area.ownerIds[0] ?? '',
      changeMarks: { [reference]: mark },
      createdVia: 'form',
      proposerId: random.pick(people).id,
      createdAt: `${entry.start}T08:00:00Z`,
      updatedAt: `${updated}T09:00:00Z`,
    }
  })
}

/** Splits `text` into literal text and mention tokens, each at the first match after the last. */
function mark(text: string, marks: { words: string; target: string }[]): MentionPart[] | null {
  const parts: MentionPart[] = []
  let from = 0
  for (const { words, target } of marks) {
    const at = text.indexOf(words, from)
    if (at < 0) continue
    if (at > from) parts.push({ kind: 'text', text: text.slice(from, at) })
    parts.push({ kind: 'mention', label: words, target })
    from = at + words.length
  }
  if (!parts.some((part) => part.kind === 'mention')) return null
  if (from < text.length) parts.push({ kind: 'text', text: text.slice(from) })
  return parts
}

const plain = (parts: MentionPart[]) =>
  parts.map((part) => (part.kind === 'text' ? part.text : part.label)).join('')

/**
 * Adds typed mentions (`@[words](target)`, src/domain/mentions.ts) to some items: a market or a
 * metric named in the summary, and in guide bodies the market, the area and an earlier item.
 * Mentions are navigation only; they never change an item's scope. They come from their own
 * random stream, so every other field is the same as without them.
 */
function addMentions(items: ContextItem[], random: Random): ContextItem[] {
  const metricNames = new Map(vocabulary.metrics.map((metric) => [metric.id, metric.name]))
  const marketNames = new Map(
    (vocabulary.dimensions[0]?.values ?? []).map((value) => [value.id, value.name]),
  )
  return items.map((item, index) => {
    const next: ContextItem = { ...item }
    if (random.chance(0.3)) {
      const market = item.scope.dimensionValues.find((value) => value.dimension === 'market')
      const candidates = [
        ...(market
          ? [{ words: marketNames.get(market.value) ?? '', target: `val:market/${market.value}` }]
          : []),
        ...item.scope.metrics.map((id) => ({
          words: metricNames.get(id) ?? '',
          target: `metric:${id}`,
        })),
      ].filter((candidate) => candidate.words && item.summary.includes(candidate.words))
      const parts = candidates.length ? mark(item.summary, [random.pick(candidates)]) : null
      if (parts) next.summaryMarkup = serializeMentions(parts)
    }
    if (item.body !== undefined && random.chance(0.6)) {
      const earlier = index > 0 ? items[random.int(0, index - 1)] : undefined
      const seeAlso =
        earlier && earlier.title.length <= 120 && random.chance(0.6) ? earlier : undefined
      const body = seeAlso ? `${item.body}\n\nSee also: ${seeAlso.title}` : item.body
      const parts = mark(body, [
        { words: 'market', target: 'dim:market' },
        { words: 'domain', target: `area:${item.areaId}` },
        ...(seeAlso ? [{ words: seeAlso.title, target: `item:${seeAlso.id}` }] : []),
      ])
      if (parts) {
        next.body = plain(parts)
        next.bodyMarkup = serializeMentions(parts)
      }
    }
    return next
  })
}

/**
 * The demo's one regression (Workbench plan, slice W2), told by the library: on 1 October an
 * owner accepted a second version of the Sales note "Net revenue excludes test accounts"
 * that ends it on 30 September (an end date is exclusive). From that edition an agent that asks
 * about net revenue in Spain in October is not given the note, so the test question
 * `net-revenue-month-to-date` (test-questions.ts) passes every weekly run until the one of
 * 5 October, which fails it, and production asks about it without an answer (the open gap in
 * gaps.ts). Version 1 had no end date, and so a review date (FR-127).
 */
export const regression = {
  item: 'itm_q2upr28v',
  question: 'net-revenue-month-to-date',
  accepted: '2026-10-01',
  end: '2026-10-01',
  reviewDateBefore: '2027-03-19',
} as const

/**
 * The demo library with the Norway show's facts in their writers' words (story-facts.ts): each
 * keeps its generated title, scope and dates, and takes the hand-written summary, text, source and
 * what not to conclude. A shorter library holds only some of them.
 */
function withStory(items: ContextItem[]): ContextItem[] {
  return items.map((item) => {
    const fact = storyFacts[item.id]
    if (!fact) return item
    return {
      ...item,
      summary: fact.summary,
      ...(fact.body === undefined ? {} : { body: fact.body }),
      notToConclude: fact.notToConclude,
      evidence: item.evidence.map((evidence) => ({ ...evidence, ...fact.source })),
    }
  })
}

/** The regression's note as its version 2 has it: ended, so with no review date of its own. */
function withRegression(items: ContextItem[]): ContextItem[] {
  return items.map((item) =>
    item.id === regression.item
      ? {
          ...item,
          version: 2,
          validity: { ...item.validity, end: regression.end },
          reviewDate: null,
          updatedAt: `${regression.accepted}T09:00:00Z`,
        }
      : item,
  )
}

/**
 * When a version entered service. A version whose content was not the item's current one says
 * what it had instead (`patch`): only the regression's first version does here, and the golden
 * set's superseded fixture (db/seed/golden-fixtures.ts) in its own seed.
 */
export type VersionDays = {
  version: number
  proposed: string
  accepted: string
  patch?: Partial<Pick<ContextItem, 'validity' | 'reviewDate' | 'title' | 'summary' | 'body'>>
}

/**
 * When each version of a fixture item was proposed and accepted, oldest first (UTC days). The
 * current version entered service on the item's update day, as the service defines `updatedAt`;
 * the first of several versions on the day the item was created, the ones between spread evenly.
 * Each was proposed two days before it was accepted. The mock's history and the database seed
 * both use this, so they tell the same story.
 */
export function versionDays(
  item: Pick<ContextItem, 'version' | 'createdAt' | 'updatedAt'> &
    Partial<Pick<ContextItem, 'id' | 'validity'>>,
) {
  const created = item.createdAt.slice(0, 10)
  const updated = item.updatedAt.slice(0, 10)
  const span = Math.max(
    0,
    (Date.parse(`${updated}T00:00:00Z`) - Date.parse(`${created}T00:00:00Z`)) / 86_400_000,
  )
  return Array.from({ length: item.version }, (_, index): VersionDays => {
    const accepted =
      item.version === 1
        ? updated
        : addDays(created, Math.round((span * index) / (item.version - 1)))
    const before =
      item.id === regression.item && item.validity && index === 0
        ? {
            patch: {
              validity: { start: item.validity.start, end: null },
              reviewDate: regression.reviewDateBefore,
            },
          }
        : {}
    return { version: index + 1, proposed: addDays(accepted, -2), accepted, ...before }
  })
}

/**
 * Generates context items that follow the item model in docs/requirements.md (section 4.1).
 * The output depends only on `count` and `seed`, so tests and screenshots are stable.
 * The mix of kinds, areas, validity windows and long titles is chosen to stress lists and
 * tables. The words read as people write them (docs/design/voice.md): each kind has its own
 * lines, and the facts on the Norway show's path are written by hand (story-facts.ts).
 */
export function generateItems(count = DEFAULT_ITEM_COUNT, seed = DEFAULT_SEED): ContextItem[] {
  const random = createRandom(seed)
  // Check flags come from their own stream, so adding them did not change any other field.
  const flags = createRandom(seed + 1)
  const usedIds = new Set<string>()
  // A library of 100 items or more ends with the demo issues and the items about any value of a
  // dimension, which take the last places. They come from their own streams, so every item before
  // them is the same as without them.
  const withIssues = count >= 100
  const items = Array.from(
    { length: withIssues ? count - demoIssues.length - demoAnyValue.length : count },
    () => buildItem(random, flags, usedIds),
  )
  if (withIssues) {
    items.push(...buildIssues(createRandom(seed + 3), usedIds))
    items.push(...buildAnyValue(createRandom(seed + 4), usedIds))
  }
  const library = addMentions(
    seed === DEFAULT_SEED ? withStory(items) : items,
    createRandom(seed + 2),
  )
  return seed === DEFAULT_SEED ? withRegression(library) : library
}
