import { stateLabel, type AnswerState } from '@/data/ask'
import { markets, type DomainId } from '@/data/world'

// What Observability counts: what agents asked and how it was answered, as scopes and counts only.
// The words of a question and who asked are never kept, so there are no threads to open: a topic
// (a metric, a market, dates) and how often it was asked takes their place.
//
// The last 7 days are the numbers the Inbox already says: 142 asked, 117 found checked context
// (94 based on it, 12 covering part, 4 where it disagrees, 7 that may be out of date) and 25 found
// nothing written down. Longer ranges run back from those, a week at a time, so every page, filter
// and range adds up the same way. A count under 5 is never shown as a number: it could point to
// one person.

export type Range = 7 | 30 | 90
export const RANGES: Range[] = [7, 30, 90]

/** The answer states a chart tells apart. Not checked is a failure, counted on Usage instead. */
export type Shown = Exclude<AnswerState, 'failed'>
export const SHOWN: Shown[] = ['grounded', 'partial', 'conflict', 'stale', 'missing']
/** The same words as everywhere, from the one list. */
export const STATE_WORDS: Record<Shown, string> = stateLabel

export type Counts = Record<Shown, number>
const zero = (): Counts => ({ grounded: 0, partial: 0, conflict: 0, stale: 0, missing: 0 })
export const total = (c: Counts) => SHOWN.reduce((n, k) => n + c[k], 0)
/** Found checked context: every answer that rests on something written down. */
export const found = (c: Counts) => c.grounded + c.partial + c.conflict + c.stale

/** Under this, a count is shown as "Fewer than 5". */
export const HIDE_UNDER = 5
export const shownCount = (n: number) =>
  n > 0 && n < HIDE_UNDER ? 'Fewer than 5' : n.toLocaleString('en-GB')

/* ---------- the days ---------- */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
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

export type Day = { at: number; label: string; counts: Counts }

/** Every day counted, oldest first: 26 weeks, the last 7 days exactly as the board has them. */
export const DAYS: Day[] = (() => {
  const out: Day[] = []
  for (let w = WEEKS_BACK.length; w >= 0; w--) {
    const m = w === 0 ? 1 : WEEKS_BACK[w - 1]
    // An older week found nothing a little more often: there was less written down.
    const lessWritten = w <= 1 ? 0 : Math.min(0.12, w * 0.006)
    ;(w === 0 ? WEEK : PREV_WEEK).forEach((c, i) => {
      const at = LAST - (w * 7 + (6 - i)) * DAY
      const counts = zero()
      SHOWN.forEach((k, j) => (counts[k] = Math.round(c[j] * m)))
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

function dayLabel(at: number) {
  const d = new Date(at)
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()}`
}
export const dateLabel = (at: number) => {
  const d = new Date(at)
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`
}

/** A publish: a dashed line on the charts, so you can see whether the hatch of "nothing" shrank after it. */
export type Publish = { at: number; title: string; by: string; domain: DomainId; checked: string }
export const PUBLISHES: Publish[] = [
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

/* ---------- topics, agents and domains ---------- */

export type Topic = {
  id: string
  /** The metric, or the metric group, as people name it; empty when no metric was named. */
  metric: string
  where: string
  /** The domain of its metrics. A topic with no metric named has none (the key starts with "||"). */
  domain?: DomainId
  /** The calendar month the question's dates start in, as stored in the key: "2026-10". */
  month: string
  /** The last 7 days. */
  week: Counts
  /** Where its "found nothing" went: a draft or a suggestion in the Inbox. */
  gap?: { label: string; href: string }
  /** Somebody reported an answer about it this week. */
  reported?: boolean
  /** How the metric was named: a metric group (its domain taken from the group's metrics), or none at all. */
  named?: 'group' | 'none'
  /** Calls this week whose agent's own fields named one thing and the words another: a bit per call, never the words. */
  disagree?: number
}

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
export const TOPICS: Topic[] = [
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
export const COULD_NOT_READ = 9

const MONTH_NAMES = [
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
/** "2026-10" as "October 2026". */
export const monthName = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
/** "2026-10" as "Oct 2026". */
export const monthShort = (m: string) =>
  `${MONTH_NAMES[Number(m.slice(5, 7)) - 1].slice(0, 3)} ${m.slice(0, 4)}`

/** Months in time order, the year once when they share it: "Sep, Oct 2026"; "Dec 2026, Jan 2027". */
export function monthsLabel(months: string[]) {
  const asc = [...months].sort()
  const years = new Set(asc.map((m) => m.slice(0, 4)))
  if (years.size === 1)
    return `${asc.map((m) => monthShort(m).split(' ')[0]).join(', ')} ${asc[0].slice(0, 4)}`
  return asc.map(monthShort).join(', ')
}

/** "Orders in Norway"; across markets "Units sold, all markets"; about an event "Discount cost, Black Friday"; with no metric "Norway, no metric named". */
export const topicName = (t: Pick<Topic, 'metric' | 'where'> & Partial<Pick<Topic, 'named'>>) =>
  t.named === 'none' || !t.metric
    ? `${t.where}, no metric named`
    : markets.includes(t.where)
      ? `${t.metric} in ${t.where}`
      : `${t.metric}, ${t.where === 'All markets' ? 'all markets' : t.where}`

/** The exact scope, as a person reads it: "Orders in Norway, October 2026". */
export const topicTitle = (t: Topic) => `${topicName(t)}, ${monthName(t.month)}`

const slug = (w: string) => w.toLowerCase().replace(/[^a-z0-9]+/g, '_')
/** The stored key, in the real app's format: "area_sales|metric:orders|val:market/norway|2026-10". */
export function topicKey(t: Topic) {
  const metric =
    t.named === 'none' ? '' : `${t.named === 'group' ? 'group' : 'metric'}:${slug(t.metric)}`
  const value = markets.includes(t.where)
    ? `val:market/${slug(t.where)}`
    : t.where === 'All markets'
      ? ''
      : `val:event/${slug(t.where)}`
  return [t.domain ? `area_${t.domain}` : '', metric, value, t.month].join('|')
}

/** Kinds of agent, never a person: the name an agent gives itself is mapped to a fixed list. */
export const AGENTS: { name: string; week: number }[] = [
  { name: 'Claude Code', week: 58 },
  { name: 'Claude app', week: 41 },
  { name: 'Cursor', week: 22 },
  { name: 'ChatGPT', week: 14 },
  { name: 'Other agents', week: 7 },
]

/* ---------- a view: a range, a domain and an agent ---------- */

export type View = {
  range: Range
  domain?: DomainId
  agent?: string
  /** The review flag ?state=busy: a much busier workspace, every count times this. */
  scale?: number
}

const WEEK_TOTAL = 142
/** The month of the dates asked about, as of the demo world's today: what a question with no dates is read as. */
export const THIS_MONTH = '2026-10'
const topicShare = (domain?: DomainId) =>
  domain
    ? TOPICS.filter((t) => t.domain === domain).reduce((n, t) => n + total(t.week), 0) / WEEK_TOTAL
    : 1
const agentShare = (agent?: string) =>
  agent ? (AGENTS.find((a) => a.name === agent)?.week ?? 0) / WEEK_TOTAL : 1

/** A domain's share of each answer state, from its topics: its days add up to its topics exactly. */
function stateShare(domain?: DomainId): Counts {
  const all = zero()
  const mine = zero()
  for (const t of TOPICS)
    for (const k of SHOWN) {
      all[k] += t.week[k]
      if (!domain || t.domain === domain) mine[k] += t.week[k]
    }
  const out = zero()
  for (const k of SHOWN) out[k] = all[k] ? mine[k] / all[k] : 0
  return out
}

/**
 * Days scaled by a share per state, rounded so each state's total over the period is the rounded
 * total of the exact values: a filtered page adds up the same as its topics do.
 */
function scaleDays(days: Day[], share: Counts): Day[] {
  const out = days.map((d) => ({ ...d, counts: zero() }))
  for (const k of SHOWN) {
    const exact = days.map((d) => d.counts[k] * share[k])
    const target = Math.round(exact.reduce((a, b) => a + b, 0))
    const floors = exact.map(Math.floor)
    let left = target - floors.reduce((a, b) => a + b, 0)
    const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r)
    floors.forEach((f, i) => (out[i].counts[k] = f))
    for (const { i } of order) {
      if (left <= 0) break
      out[i].counts[k] += 1
      left -= 1
    }
  }
  return out
}

/** The days a range shows, oldest first, with the filters' share of each. */
export function daysOf(v: View, back = 0): Day[] {
  const end = DAYS.length - back * v.range
  const days = DAYS.slice(Math.max(0, end - v.range), end)
  const scale = agentShare(v.agent) * (v.scale ?? 1)
  if (!v.domain && scale === 1) return days
  const share = stateShare(v.domain)
  for (const k of SHOWN) share[k] *= scale
  return scaleDays(days, share)
}

/** The same days, a bar each for 7 and 30 days, a week each for 90. */
export function barsOf(v: View): { label: string; at: number; counts: Counts }[] {
  const days = daysOf(v)
  if (v.range !== 90) return days
  // Weeks back from the last day; the oldest may be a few days short.
  const out: { label: string; at: number; counts: Counts }[] = []
  for (let end = days.length; end > 0; end -= 7) {
    const week = days.slice(Math.max(0, end - 7), end)
    const counts = zero()
    week.forEach((d) => SHOWN.forEach((k) => (counts[k] += d.counts[k])))
    out.unshift({ label: dateLabel(week[0].at), at: week[0].at, counts })
  }
  return out
}

const sum = (days: { counts: Counts }[]) => {
  const c = zero()
  days.forEach((d) => SHOWN.forEach((k) => (c[k] += d.counts[k])))
  return c
}

/** The headline numbers of a view, and the same for the period before it. */
export function numbersOf(v: View) {
  const now = sum(daysOf(v))
  const before = sum(daysOf(v, 1))
  const asked = total(now)
  const was = total(before)
  const share = asked ? found(now) / asked : 0
  const shareWas = was ? found(before) / was : 0
  return {
    asked,
    askedBefore: was,
    askedChange: was ? Math.round(((asked - was) / was) * 100) : 0,
    found: found(now),
    foundShare: Math.round(share * 100),
    foundChange: Math.round((share - shareWas) * 100),
    nothing: now.missing,
    nothingChange: now.missing - before.missing,
    nothingShare: asked ? Math.round((now.missing / asked) * 100) : 0,
    counts: now,
  }
}

/** A topic's counts for a view: the week's, scaled to the range and the agent's share. */
export function topicCounts(t: Topic, v: View): Counts {
  const range = total(sum(daysOf({ range: v.range }))) / WEEK_TOTAL
  const share = range * agentShare(v.agent) * (v.scale ?? 1)
  const c = zero()
  SHOWN.forEach((k) => (c[k] = Math.round(t.week[k] * share)))
  return c
}

/** The topics a view shows, asked most first. */
export function topicsOf(v: View) {
  return TOPICS.filter((t) => !v.domain || t.domain === v.domain)
    .map((t) => ({ ...t, counts: topicCounts(t, v) }))
    .sort((a, b) => total(b.counts) - total(a.counts))
}

/** A topic's questions per day over the range, for its sparkline. */
export function sparkOf(t: Topic, v: View) {
  const share = total(t.week) / WEEK_TOTAL
  return daysOf({ range: v.range, agent: v.agent, scale: v.scale }).map(
    (d) => Math.round(total(d.counts) * share * 10) / 10,
  )
}

/** Agents for a view. */
export function agentsOf(v: View) {
  const range = total(sum(daysOf({ range: v.range }))) / WEEK_TOTAL
  const share = topicShare(v.domain) * (v.scale ?? 1)
  return AGENTS.map((a) => ({ name: a.name, count: Math.round(a.week * range * share) }))
}

/** The publishes a range shows a line for. */
export function publishesIn(v: View) {
  const days = daysOf(v)
  const from = days[0]?.at ?? LAST
  return PUBLISHES.filter(
    (p) => p.at >= from && p.at <= LAST && (!v.domain || p.domain === v.domain),
  )
}

/** What a topic's status says, in the order that matters: a gap's way forward, then a disagreement, then age. */
/* ---------- roll-ups: the same key, grouped for reading ---------- */

export type TopicRow = Topic & { counts: Counts }
/** How Questions and Overview group topics: each exact scope, metric and market (the default), or domain only. */
export type Grouping = 'none' | 'metric' | 'domain'
export const GROUPINGS: Record<Grouping, string> = {
  none: 'None',
  metric: 'Metric and market',
  domain: 'Domain only',
}

const visibleCount = (n: number) => n === 0 || n >= HIDE_UNDER
/**
 * FR-614 for a total over parts shown one by one (the real app's visibleTotal): the total shows only
 * when it, and what it adds over the shown parts, is zero or at least 5. Otherwise a hidden month
 * could be found by subtraction.
 */
export function visibleTotal(sumOf: number, shown: number): number | null {
  return visibleCount(sumOf) && visibleCount(sumOf - shown) ? sumOf : null
}

export type TopicGroup = {
  key: string
  name: string
  domain?: DomainId
  named?: Topic['named']
  /** Its exact scopes, most asked first. */
  rows: TopicRow[]
  counts: Counts
  total: number
  /** What its shown months add up to. */
  shown: number
  /** The total, or null when it would give a hidden month away. */
  visible: number | null
  months: string[]
}

/** Topics that share a domain, a metric and a market, joined; the month stays inside as a breakdown and a filter. */
export function rollUp(rows: TopicRow[]): TopicGroup[] {
  const by = new Map<string, TopicRow[]>()
  for (const t of rows) {
    const k = [t.domain ?? '', t.named ?? 'metric', t.metric, t.where].join('|')
    by.set(k, [...(by.get(k) ?? []), t])
  }
  return [...by.entries()]
    .map(([key, list]) => {
      const counts = zero()
      for (const t of list) SHOWN.forEach((s) => (counts[s] += t.counts[s]))
      const sumOf = total(counts)
      const shown = list.reduce(
        (n, t) => n + (visibleCount(total(t.counts)) ? total(t.counts) : 0),
        0,
      )
      const ordered = [...list].sort((a, b) => b.month.localeCompare(a.month))
      return {
        key,
        name: topicName(list[0]),
        domain: list[0].domain,
        named: list[0].named,
        rows: ordered,
        counts,
        total: sumOf,
        shown,
        visible: list.length > 1 ? visibleTotal(sumOf, shown) : visibleCount(sumOf) ? sumOf : null,
        months: ordered.map((t) => t.month),
      }
    })
    .sort((a, b) => (b.visible ?? b.shown) - (a.visible ?? a.shown))
}

/** What a grouped count shows: "31"; "13+" when a month under 5 would be given away; "Fewer than 5". */
export function groupCount(g: Pick<TopicGroup, 'visible' | 'shown'>) {
  if (g.visible !== null) return g.visible.toLocaleString('en-GB')
  return g.shown > 0 ? `${g.shown.toLocaleString('en-GB')}+` : 'Fewer than 5'
}

export type Sort = 'asked' | 'nothing' | 'name'

export const sortGroups = (gs: TopicGroup[], sort: Sort) =>
  [...gs].sort((a, b) =>
    sort === 'name'
      ? a.name.localeCompare(b.name)
      : sort === 'nothing'
        ? b.counts.missing - a.counts.missing || (b.visible ?? b.shown) - (a.visible ?? a.shown)
        : (b.visible ?? b.shown) - (a.visible ?? a.shown),
  )

/** The exact rows in the order they show, for stepping through the answer panel. */
export function rowOrder(rows: TopicRow[], grouping: Grouping, sort: Sort) {
  if (grouping === 'none')
    return sortGroups(
      rollUp(rows).flatMap((g) => g.rows.map((r) => rollUp([r])[0])),
      sort,
    ).flatMap((g) => g.rows)
  return sortGroups(rollUp(rows), sort).flatMap((g) => g.rows)
}

/** Every month the topics are about, newest first. */
export const topicMonths = () => [...new Set(TOPICS.map((t) => t.month))].sort().reverse()

/**
 * Found nothing 5 or more times in 7 days about the same thing, counted across a month edge (this
 * changes FR-606 case 1): Orders in Germany, 3 calls about 30 October and 3 about 1 November, is one.
 */
export function notFoundGroups(v: View) {
  return rollUp(topicsOf({ ...v, range: 7 })).filter((g) => g.counts.missing >= HIDE_UNDER)
}

/** Calls that could not be read in a range: no topic, so in no domain; an owner's narrowed view has none. */
export function couldNotRead(v: View) {
  if (v.domain) return 0
  return Math.round((COULD_NOT_READ * total(numbersOf(v).counts)) / WEEK_TOTAL)
}

export function statusOf(
  t: Topic & { counts: Counts },
): { label: string; tone: 'gap' | 'warn'; href?: string } | undefined {
  if (t.counts.missing >= HIDE_UNDER)
    return t.gap
      ? { label: t.gap.label, tone: 'gap', href: t.gap.href }
      : { label: STATE_WORDS.missing, tone: 'gap' }
  if (t.counts.conflict >= 3) return { label: STATE_WORDS.conflict, tone: 'warn' }
  if (t.counts.stale >= 3) return { label: STATE_WORDS.stale, tone: 'warn' }
  return undefined
}

/** The demo's review flag for this area: ?state=empty (nothing connected), quiet (under 5), busy. */
export type ObsState = 'normal' | 'empty' | 'quiet' | 'busy'

/* ---------- Feedback ---------- */

export type ReportState = 'inbox' | 'looked' | 'fine'
export type Report = {
  id: string
  title: string
  line: string
  state: ReportState
  domain: DomainId
  /** A person's name when they sent it on purpose; an agent's kind otherwise, never a name. */
  from: string
  agent?: boolean
  when: string
  href: string
}

/** What people and agents said about answers this week. Open reports wait in the Inbox. */
export const REPORTS: Report[] = [
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

export const REPORT_WORDS: Record<ReportState, string> = {
  inbox: 'In your Inbox',
  looked: 'Looked at',
  fine: 'Not a problem',
}

/** Thumbs up under an answer in Ask, a week at a time, oldest first; only the verdict and the domain are kept. */
export const GOOD_BY_WEEK = {
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
export const FEEDBACK_WEEK = { good: 38, goodChange: 6, wrong: 3 }

/* ---------- Usage ---------- */

/** Each tool an agent called this week, and how the calls ended. Answering needs no model. */
export const TOOL_CALLS: {
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
export const AGENT_CALLS: { name: string; calls: number; last: string }[] = [
  { name: 'Claude Code', calls: 134, last: 'Today, 09:12' },
  { name: 'Claude app', calls: 96, last: 'Today, 08:55' },
  { name: 'Cursor', calls: 47, last: 'Today, 09:31' },
  { name: 'ChatGPT', calls: 24, last: 'Yesterday' },
  { name: 'Other agents', calls: 11, last: 'Tue 20 Oct' },
]

/** How long a reply took, in milliseconds: the median and 95 of 100, for each of the last 7 days. */
export const SPEED_DAYS = {
  median: [40, 38, 43, 36, 35, 39, 38],
  p95: [118, 102, 131, 96, 112, 108, 114],
}
/** The same, for each of the last 13 weeks: replies got a little faster as the index settled. */
export const SPEED_WEEKS = {
  median: [52, 50, 49, 47, 47, 45, 44, 43, 42, 41, 40, 39, 38],
  p95: [151, 146, 140, 139, 133, 128, 126, 121, 119, 117, 115, 113, 112],
}

/** The days or weeks the speed chart draws for a range, with their labels. */
export function speedOf(range: number) {
  if (range === 7) return { ...SPEED_DAYS, labels: DAYS.slice(-7).map((d) => d.label), per: 'day' }
  const n = range === 30 ? 5 : 13
  const starts = DAYS.filter((_, i) => (DAYS.length - 1 - i) % 7 === 6).slice(-n)
  return {
    median: SPEED_WEEKS.median.slice(-n),
    p95: SPEED_WEEKS.p95.slice(-n),
    labels: starts.map((d) => dateLabel(d.at)),
    per: 'week',
  }
}

/**
 * Model spend this month, from the ledger. Answering agents needs no model: the spend is Ask's
 * wording in the app, reading web pages, and the one run of answer tests from the command line.
 */
export const SPEND = {
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
export const money = (n: number) => `$${n.toFixed(2)}`
