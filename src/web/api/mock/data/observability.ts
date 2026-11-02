import {
  dayLabel,
  SHOWN,
  type AgentWeek,
  type Counts,
  type Day,
  type ObsData,
  type ObsState,
  type Publish,
  type Report,
  type Topic,
} from '../obs-engine'
import type { DomainId } from '@/model/items'
import { markets } from './world'

// What Observability counts: what agents asked and how it was answered, as scopes and counts only.
// The words of a question and who asked are never kept, so there are no threads to open: a topic
// (a metric, a market, dates) and how often it was asked takes their place.
//
// The last 7 days are the numbers the Inbox already says: 142 asked, 117 found something written
// down (94 checked, 12 covering part, 4 where it disagrees, 7 that may be out of date) and 25 found
// nothing written down. Longer ranges run back from those, a week at a time, so every page, filter
// and range adds up the same way. A count under 5 is never shown as a number: it could point to
// one person.

const zero = (): Counts => ({ grounded: 0, partial: 0, conflict: 0, stale: 0, missing: 0 })

/** The last day counted: yesterday, Thursday 22 October 2026. */
const LAST = Date.UTC(2026, 9, 22)
const DAY = 86_400_000

/** The 7 days the board draws, Friday 16 to Thursday 22 October. */
const WEEK: [number, number, number, number, number][] = [
  [15, 2, 0, 1, 6],
  [17, 2, 1, 1, 6],
  [8, 1, 0, 0, 2],
  [6, 1, 0, 1, 1],
  [20, 3, 1, 2, 2],
  [16, 2, 1, 1, 3],
  [12, 1, 1, 1, 5],
]

/** The 7 days before: 129 asked, 27 found nothing, so this week reads +10% and 2 fewer. */
const PREV_WEEK: [number, number, number, number, number][] = [
  [13, 2, 0, 1, 5],
  [15, 2, 1, 1, 6],
  [7, 1, 0, 0, 3],
  [5, 1, 0, 1, 2],
  [17, 2, 1, 1, 4],
  [14, 1, 0, 1, 3],
  [12, 1, 1, 1, 4],
]

/** Each week before those against the week before this one: fewer questions, and more of them found nothing. */
const WEEKS_BACK = [
  1, 1.03, 0.95, 0.99, 0.91, 0.88, 0.92, 0.86, 0.81, 0.85, 0.78, 0.76, 0.73, 0.75, 0.68, 0.66, 0.69,
  0.64, 0.6, 0.63, 0.57, 0.55, 0.58, 0.54, 0.52, 0.51,
]

/** Every day counted, oldest first: 26 weeks, the last 7 days exactly as the board has them. */
const DAYS: Day[] = (() => {
  const out: Day[] = []
  for (let w = WEEKS_BACK.length; w >= 0; w--) {
    const m = w === 0 ? 1 : WEEKS_BACK[w - 1]!
    // An older week found nothing a little more often: there was less written down.
    const lessWritten = w <= 1 ? 0 : Math.min(0.12, w * 0.006)
    ;(w === 0 ? WEEK : PREV_WEEK).forEach((c, i) => {
      const at = LAST - (w * 7 + (6 - i)) * DAY
      const counts = zero()
      SHOWN.forEach((k, j) => (counts[k] = Math.round(c[j]! * m)))
      if (lessWritten) {
        const moved = Math.round(counts.grounded * lessWritten)
        counts.grounded -= moved
        counts.missing += moved
      }
      out.push({ at, label: dayLabel(at), counts })
    })
  }
  return out
})()

const PUBLISHES: Publish[] = [
  {
    at: Date.UTC(2026, 9, 20),
    title: 'Units sold excludes test accounts',
    by: 'Jon Abara',
    domain: 'sales',
    checked: 'Then 12 saved questions were checked: 11 the same, 1 changed.',
  },
  {
    at: Date.UTC(2026, 9, 6),
    title: 'Orders lags by one day in the source tool',
    by: 'Jon Abara',
    domain: 'sales',
    checked: 'Then 11 saved questions were checked: all the same.',
  },
  {
    at: Date.UTC(2026, 8, 15),
    title: 'Payment provider switched in France on 12 May 2026',
    by: 'Sofia Brandt',
    domain: 'sales',
    checked: 'Then 10 saved questions were checked: all the same.',
  },
  {
    at: Date.UTC(2026, 7, 4),
    title: 'Online sales to Norway stopped on 4 August 2026',
    by: 'Jon Abara',
    domain: 'sales',
    checked: 'Then 9 saved questions were checked: 8 the same, 1 changed.',
  },
]

const topic = (
  id: string,
  metric: string,
  where: string,
  domain: DomainId | undefined,
  c: [number, number, number, number, number],
  extra: Partial<Topic> = {},
): Topic => ({
  id,
  metric,
  where,
  domain,
  month: '2026-10',
  week: { grounded: c[0], partial: c[1], conflict: c[2], stale: c[3], missing: c[4] },
  ...extra,
})

/**
 * The topics of the last 7 days, one per exact scope as the real key has it: domain, metric, market
 * and the month the dates start in. Their counts add up to the 142, and by answer to the Inbox's own
 * numbers. Two subjects are asked about two months (Orders and Net revenue in Norway, September
 * too); Orders in Germany was asked about 30 October and 1 November, so it sits in two months.
 */
const TOPICS: Topic[] = [
  topic('orders-norway', 'Orders', 'Norway', 'sales', [20, 1, 0, 2, 1], { disagree: 3 }),
  topic('orders-norway-sep', 'Orders', 'Norway', 'sales', [6, 1, 0, 0, 0], { month: '2026-09' }),
  topic('net-revenue-norway', 'Net revenue', 'Norway', 'sales', [9, 1, 2, 0, 1], {
    reported: true,
  }),
  topic('net-revenue-norway-sep', 'Net revenue', 'Norway', 'sales', [3, 0, 1, 0, 0], {
    month: '2026-09',
  }),
  topic('revenue-norway', 'Revenue', 'Norway', 'sales', [5, 0, 0, 0, 0], { named: 'group' }),
  topic('units-sold-all', 'Units sold', 'All markets', 'sales', [11, 0, 0, 0, 1]),
  topic('norway-no-metric', '', 'Norway', undefined, [4, 1, 0, 0, 0], { named: 'none' }),
  topic('discount-black-friday', 'Discount cost', 'Black Friday', 'marketing', [10, 1, 0, 3, 0]),
  topic('orders-poland', 'Orders', 'Poland', 'sales', [4, 2, 0, 1, 6], {
    gap: { label: 'A suggestion waits', href: '/inbox/sug-agent/review' },
  }),
  topic('orders-spain', 'Orders', 'Spain', 'sales', [1, 2, 0, 0, 9], {
    gap: { label: 'Draft ready', href: '/inbox?card=gap-spain' },
  }),
  topic('orders-germany', 'Orders', 'Germany', 'sales', [0, 0, 0, 0, 3], {
    gap: { label: 'No draft yet', href: '/inbox?card=gap-germany' },
  }),
  topic('orders-germany-nov', 'Orders', 'Germany', 'sales', [0, 0, 0, 0, 3], {
    month: '2026-11',
    gap: { label: 'No draft yet', href: '/inbox?card=gap-germany' },
  }),
  topic('cpa-germany', 'Cost per acquisition', 'Germany', 'marketing', [8, 1, 1, 0, 0]),
  topic('new-customers-norway', 'New customers', 'Norway', 'customer_value', [5, 1, 0, 0, 0]),
  topic('roas-sweden', 'Return on ad spend', 'Sweden', 'paid_media', [5, 0, 0, 1, 0]),
  topic(
    'repeat-purchases-all',
    'Repeat purchases',
    'All markets',
    'customer_value',
    [3, 1, 0, 0, 1],
  ),
]

/**
 * Calls this week that could not be read: no metric and no market from the definitions, so no topic.
 * Counted, never the words (FR-602). Before, they were in no count at all.
 */
const COULD_NOT_READ = 9

/** Kinds of agent, never a person: the name an agent gives itself is mapped to a fixed list. */
const AGENTS: AgentWeek[] = [
  { name: 'Claude Code', week: 58 },
  { name: 'Claude app', week: 41 },
  { name: 'Cursor', week: 22 },
  { name: 'ChatGPT', week: 14 },
  { name: 'Other agents', week: 7 },
]

/** What people and agents said about answers this week. Open reports wait in the Inbox. */
const REPORTS: Report[] = [
  {
    id: 'r-germany',
    title: 'Orders lags by one day in the source tool',
    line: 'Reported as unclear: “Is this Germany only, or every market?”',
    state: 'inbox',
    domain: 'sales',
    from: 'Maria Lindqvist, from Ask',
    when: 'Yesterday',
    href: '/inbox?card=flag-germany',
  },
  {
    id: 'r-revenue',
    title: 'Net revenue in Norway still counts test accounts',
    line: 'Reported as wrong',
    state: 'looked',
    domain: 'sales',
    from: 'Ines Duarte, from Ask',
    when: 'Tue 20 Oct',
    href: '/context/itm_s90n5xps',
  },
  {
    id: 'r-poland',
    title: 'Orders in Poland: nothing written for October',
    line: 'From an agent: reported a gap. No name is kept.',
    state: 'looked',
    domain: 'sales',
    from: 'Claude Code',
    agent: true,
    when: 'Fri 16 Oct',
    href: '/inbox/sug-agent/review',
  },
  {
    id: 'r-gift',
    title: 'Gift card orders counted twice',
    line: 'Reported as wrong',
    state: 'fine',
    domain: 'sales',
    from: 'Sofia Brandt, from Ask',
    when: 'Thu 15 Oct',
    href: '/context/itm_gift_card_only',
  },
  {
    id: 'r-spain',
    title: 'Orders in Spain: nothing written for October',
    line: 'From an agent: reported a gap. No name is kept.',
    state: 'looked',
    domain: 'sales',
    from: 'Claude app',
    agent: true,
    when: 'Wed 21 Oct',
    href: '/inbox?card=gap-spain',
  },
  {
    id: 'r-discount',
    title: 'Discount cost, Black Friday: an old check date',
    line: 'From an agent: the answer may be out of date.',
    state: 'looked',
    domain: 'marketing',
    from: 'Cursor',
    agent: true,
    when: 'Tue 20 Oct',
    href: '/context/itm_pfet8zj3',
  },
  {
    id: 'r-roas',
    title: 'Return on ad spend in Sweden: nothing for one campaign',
    line: 'From an agent: reported a gap. No name is kept.',
    state: 'looked',
    domain: 'paid_media',
    from: 'ChatGPT',
    agent: true,
    when: 'Mon 19 Oct',
    href: '/observability/questions?dock=topic.roas-sweden',
  },
  {
    id: 'r-customers',
    title: 'New customers in Norway: which day counts',
    line: 'Reported as unclear: “The first order, or the account?”',
    state: 'looked',
    domain: 'customer_value',
    from: 'Lars Dahl, from Ask',
    when: 'Sun 18 Oct',
    href: '/context/itm_p9lchmy0',
  },
  {
    id: 'r-repeat',
    title: 'Repeat purchases: an agent asked twice',
    line: 'From an agent: gave feedback that the answer helped.',
    state: 'fine',
    domain: 'customer_value',
    from: 'Other agents',
    agent: true,
    when: 'Sat 17 Oct',
    href: '/observability/questions?dock=topic.repeat-purchases-all',
  },
]

/** Thumbs up under an answer in Ask, a week at a time, oldest first; only the verdict and the domain are kept. */
const GOOD_BY_WEEK = {
  labels: [
    '21 Jul',
    '28 Jul',
    '4 Aug',
    '11 Aug',
    '18 Aug',
    '25 Aug',
    '1 Sep',
    '8 Sep',
    '15 Sep',
    '22 Sep',
    '29 Sep',
    '6 Oct',
    '13 Oct',
    '20 Oct',
  ],
  values: [18, 21, 24, 22, 26, 25, 29, 31, 27, 35, 33, 30, 32, 38],
}
/** This week: 38 good answers (6 more than last), and something wrong fewer than 5 times. */
const FEEDBACK_WEEK = { good: 38, goodChange: 6, wrong: 3 }

/** Each tool an agent called this week, and how the calls ended. Answering needs no model. */
const TOOL_CALLS: {
  name: string
  calls: number
  answered: number
  detail: number
  nothing: number
  failed: number
}[] = [
  { name: 'get_context', calls: 142, answered: 105, detail: 12, nothing: 25, failed: 0 },
  { name: 'read_context', calls: 83, answered: 83, detail: 0, nothing: 0, failed: 0 },
  { name: 'find_context', calls: 61, answered: 54, detail: 0, nothing: 7, failed: 0 },
  { name: 'get_related', calls: 17, answered: 17, detail: 0, nothing: 0, failed: 0 },
  { name: 'report', calls: 5, answered: 5, detail: 0, nothing: 0, failed: 0 },
  { name: 'suggest_context', calls: 4, answered: 2, detail: 0, nothing: 0, failed: 2 },
]

/** Calls by kind of agent this week, and its last call. */
const AGENT_CALLS: { name: string; calls: number; last: string }[] = [
  { name: 'Claude Code', calls: 134, last: 'Today, 09:12' },
  { name: 'Claude app', calls: 96, last: 'Today, 08:55' },
  { name: 'Cursor', calls: 47, last: 'Today, 09:31' },
  { name: 'ChatGPT', calls: 24, last: 'Yesterday' },
  { name: 'Other agents', calls: 11, last: 'Tue 20 Oct' },
]

/** How long a reply took, in milliseconds: the median and 95 of 100, for each of the last 7 days. */
const SPEED_DAYS = {
  median: [40, 38, 43, 36, 35, 39, 38],
  p95: [118, 102, 131, 96, 112, 108, 114],
}
/** The same, for each of the last 13 weeks: replies got a little faster as the index settled. */
const SPEED_WEEKS = {
  median: [52, 50, 49, 47, 47, 45, 44, 43, 42, 41, 40, 39, 38],
  p95: [151, 146, 140, 139, 133, 128, 126, 121, 119, 117, 115, 113, 112],
}

/**
 * Model spend this month, from the ledger. Answering agents needs no model: the spend is Ask's
 * wording in the app, reading web pages, and the one run of answer tests from the command line.
 */
const SPEND = {
  total: 18.4,
  cap: 50,
  parts: [
    { name: 'Ask', amount: 11.2 },
    { name: 'Answer tests', amount: 6.1 },
    { name: 'Web reads', amount: 1.1 },
  ],
  limits: [
    { name: 'Each month, all model use', used: 18.4, cap: 50 },
    { name: 'Each person, each day', used: 1.2, cap: 2 },
    { name: 'Answer tests, each month', used: 6.1, cap: 20 },
  ],
}

/** Observability's data for an address's review flag; `busy` is the same data, scaled in the view. */
export function obsData(state: ObsState): ObsData {
  return {
    state,
    last: LAST,
    weekTotal: 142,
    days: DAYS,
    publishes: PUBLISHES,
    topics: TOPICS,
    agents: AGENTS,
    couldNotRead: COULD_NOT_READ,
    markets,
    reports: REPORTS,
    goodByWeek: GOOD_BY_WEEK,
    feedbackWeek: FEEDBACK_WEEK,
    toolCalls: TOOL_CALLS,
    agentCalls: AGENT_CALLS,
    speedDays: SPEED_DAYS,
    speedWeeks: SPEED_WEEKS,
    spend: SPEND,
  }
}

export { TOPICS as topicSeed, DAYS as daySeed }
export type { DomainId, Publish, Report, Topic, Day }
