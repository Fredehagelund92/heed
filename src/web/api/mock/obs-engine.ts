import { stateLabel, type AnswerState } from '@/model/ask'
import type { DomainId } from '@/model/items'

// The mock binding's Observability engine: the demo world's fixtures (data/observability.ts) counted
// for a view, every range, domain and kind of agent scaled from the one week the board draws, the
// way the mockup counts them. It holds every count, small ones too; obs-page.ts runs what it counts
// through the same disclosure as the service before any page sees it.
//
// What Observability counts: what agents asked and how it was answered, as scopes and counts only.
// The words of a question and who asked are never kept, so there are no threads to open: a topic
// (a metric, a market, dates) and how often it was asked takes their place.
//
// The last 7 days are the numbers the Inbox already says: 142 asked, 117 found something written
// down (94 checked, 12 covering part, 4 where it disagrees, 7 that may be out of date) and 25 found
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
/** Found something written down: every answer that rests on it, Checked or not. */
export const found = (c: Counts) => c.grounded + c.partial + c.conflict + c.stale

/** Under this, a count is shown as "Fewer than 5". */
export const HIDE_UNDER = 5
export const shownCount = (n: number) =>
  n > 0 && n < HIDE_UNDER ? 'Fewer than 5' : n.toLocaleString('en-GB')

/* ---------- the days ---------- */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export type Day = { at: number; label: string; counts: Counts }

/** "Thu 22": a day as a chart's axis says it. */
export function dayLabel(at: number) {
  const d = new Date(at)
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()}`
}
export const dateLabel = (at: number) => {
  const d = new Date(at)
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`
}

/** A publish: a dashed line on the charts, so you can see whether the hatch of "nothing" shrank after it. */
export type Publish = { at: number; title: string; by: string; domain: DomainId; checked: string }
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
  `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]!.slice(0, 3)} ${m.slice(0, 4)}`

/** Months in time order, the year once when they share it: "Sep, Oct 2026"; "Dec 2026, Jan 2027". */
export function monthsLabel(months: string[]) {
  const asc = [...months].sort()
  const years = new Set(asc.map((m) => m.slice(0, 4)))
  if (years.size === 1)
    return `${asc.map((m) => monthShort(m).split(' ')[0]).join(', ')} ${asc[0]!.slice(0, 4)}`
  return asc.map(monthShort).join(', ')
}

/** "Orders in Norway"; across markets "Units sold, all markets"; about an event "Discount cost, Black Friday"; with no metric "Norway, no metric named". */
/** The agents of a week: kinds of agent, never a person. */
export type AgentWeek = { name: string; week: number }

/* ---------- a view: a range, a domain and an agent ---------- */

export type View = {
  range: Range
  domain?: DomainId
  agent?: string
  /** The review flag ?state=busy: a much busier workspace, every count times this. */
  scale?: number
}

/** The month of the dates asked about, as of the demo world's today: what a question with no dates is read as. */
export const THIS_MONTH = '2026-10'
/** What people and agents said about answers, and how the tools were used: Feedback and Usage. */
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

export const REPORT_WORDS: Record<ReportState, string> = {
  inbox: 'In your Inbox',
  looked: 'Looked at',
  fine: 'Not a problem',
}

/**
 * What Observability reads: every day counted, the topics, agents and publishes, the feedback and
 * the usage, for the address's review flag (`state`: empty, quiet, busy, or normal).
 */
export type ObsData = {
  state: ObsState
  /** The last day counted, as a UTC timestamp. */
  last: number
  /** What the last 7 days add up to: every range is scaled from it. */
  weekTotal: number
  days: Day[]
  publishes: Publish[]
  topics: Topic[]
  agents: AgentWeek[]
  /** Calls this week that could not be read: no topic, so in no domain. */
  couldNotRead: number
  /** The values of the Market dimension: a topic's place is a market or something else. */
  markets: string[]
  reports: Report[]
  goodByWeek: { labels: string[]; values: number[] }
  feedbackWeek: { good: number; goodChange: number; wrong: number }
  toolCalls: {
    name: string
    calls: number
    answered: number
    detail: number
    nothing: number
    failed: number
  }[]
  agentCalls: { name: string; calls: number; last: string }[]
  speedDays: { median: number[]; p95: number[] }
  speedWeeks: { median: number[]; p95: number[] }
  spend: {
    total: number
    cap: number
    parts: { name: string; amount: number }[]
    limits: { name: string; used: number; cap: number }[]
  }
}

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

/** What a grouped count shows: "31"; "13+" when a month under 5 would be given away; "Fewer than 5". */
export function groupCount(g: Pick<TopicGroup, 'visible' | 'shown'>) {
  if (g.visible !== null) return g.visible.toLocaleString('en-GB')
  return g.shown > 0 ? `${g.shown.toLocaleString('en-GB')}+` : 'Fewer than 5'
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

export const money = (n: number) => `$${n.toFixed(2)}`

/** Observability's counts over its data: each page's numbers, topics and charts for a view. */
export function observability(data: ObsData) {
  const {
    last: LAST,
    weekTotal: WEEK_TOTAL,
    days: DAYS,
    publishes: PUBLISHES,
    topics: TOPICS,
    agents: AGENTS,
    couldNotRead: COULD_NOT_READ,
    markets,
    speedDays: SPEED_DAYS,
    speedWeeks: SPEED_WEEKS,
  } = data

  const topicName = (t: Pick<Topic, 'metric' | 'where'> & Partial<Pick<Topic, 'named'>>) =>
    t.named === 'none' || !t.metric
      ? `${t.where}, no metric named`
      : markets.includes(t.where)
        ? `${t.metric} in ${t.where}`
        : `${t.metric}, ${t.where === 'All markets' ? 'all markets' : t.where}`

  /** The exact scope, as a person reads it: "Orders in Norway, October 2026". */
  const topicTitle = (t: Topic) => `${topicName(t)}, ${monthName(t.month)}`

  const slug = (w: string) => w.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  /** The stored key, in the real app's format: "area_sales|metric:orders|val:market/norway|2026-10". */
  function topicKey(t: Topic) {
    const metric =
      t.named === 'none' ? '' : `${t.named === 'group' ? 'group' : 'metric'}:${slug(t.metric)}`
    const value = markets.includes(t.where)
      ? `val:market/${slug(t.where)}`
      : t.where === 'All markets'
        ? ''
        : `val:event/${slug(t.where)}`
    return [t.domain ? `area_${t.domain}` : '', metric, value, t.month].join('|')
  }

  const topicShare = (domain?: DomainId) =>
    domain
      ? TOPICS.filter((t) => t.domain === domain).reduce((n, t) => n + total(t.week), 0) /
        WEEK_TOTAL
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
      floors.forEach((f, i) => (out[i]!.counts[k] = f))
      for (const { i } of order) {
        if (left <= 0) break
        out[i]!.counts[k] += 1
        left -= 1
      }
    }
    return out
  }

  /** The days a range shows, oldest first, with the filters' share of each. */
  function daysOf(v: View, back = 0): Day[] {
    const end = DAYS.length - back * v.range
    const days = DAYS.slice(Math.max(0, end - v.range), end)
    const scale = agentShare(v.agent) * (v.scale ?? 1)
    if (!v.domain && scale === 1) return days
    const share = stateShare(v.domain)
    for (const k of SHOWN) share[k] *= scale
    return scaleDays(days, share)
  }

  /** The same days, a bar each for 7 and 30 days, a week each for 90. */
  function barsOf(v: View): { label: string; at: number; counts: Counts }[] {
    const days = daysOf(v)
    if (v.range !== 90) return days
    // Weeks back from the last day; the oldest may be a few days short.
    const out: { label: string; at: number; counts: Counts }[] = []
    for (let end = days.length; end > 0; end -= 7) {
      const week = days.slice(Math.max(0, end - 7), end)
      const counts = zero()
      week.forEach((d) => SHOWN.forEach((k) => (counts[k] += d.counts[k])))
      out.unshift({ label: dateLabel(week[0]!.at), at: week[0]!.at, counts })
    }
    return out
  }

  const sum = (days: { counts: Counts }[]) => {
    const c = zero()
    days.forEach((d) => SHOWN.forEach((k) => (c[k] += d.counts[k])))
    return c
  }

  /** The headline numbers of a view, and the same for the period before it. */
  function numbersOf(v: View) {
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
  function topicCounts(t: Topic, v: View): Counts {
    const range = total(sum(daysOf({ range: v.range }))) / WEEK_TOTAL
    const share = range * agentShare(v.agent) * (v.scale ?? 1)
    const c = zero()
    SHOWN.forEach((k) => (c[k] = Math.round(t.week[k] * share)))
    return c
  }

  /** The topics a view shows, asked most first. */
  function topicsOf(v: View) {
    return TOPICS.filter((t) => !v.domain || t.domain === v.domain)
      .map((t) => ({ ...t, counts: topicCounts(t, v) }))
      .sort((a, b) => total(b.counts) - total(a.counts))
  }

  /** A topic's questions per day over the range, for its sparkline. */
  function sparkOf(t: Topic, v: View) {
    const share = total(t.week) / WEEK_TOTAL
    return daysOf({ range: v.range, agent: v.agent, scale: v.scale }).map(
      (d) => Math.round(total(d.counts) * share * 10) / 10,
    )
  }

  /** Agents for a view. */
  function agentsOf(v: View) {
    const range = total(sum(daysOf({ range: v.range }))) / WEEK_TOTAL
    const share = topicShare(v.domain) * (v.scale ?? 1)
    return AGENTS.map((a) => ({ name: a.name, count: Math.round(a.week * range * share) }))
  }

  /** The publishes a range shows a line for. */
  function publishesIn(v: View) {
    const days = daysOf(v)
    const from = days[0]?.at ?? LAST
    return PUBLISHES.filter(
      (p) => p.at >= from && p.at <= LAST && (!v.domain || p.domain === v.domain),
    )
  }

  /** What a topic's status says, in the order that matters: a gap's way forward, then a disagreement, then age. */
  /** Topics that share a domain, a metric and a market, joined; the month stays inside as a breakdown and a filter. */
  function rollUp(rows: TopicRow[]): TopicGroup[] {
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
          name: topicName(list[0]!),
          domain: list[0]!.domain,
          named: list[0]!.named,
          rows: ordered,
          counts,
          total: sumOf,
          shown,
          visible:
            list.length > 1 ? visibleTotal(sumOf, shown) : visibleCount(sumOf) ? sumOf : null,
          months: ordered.map((t) => t.month),
        }
      })
      .sort((a, b) => (b.visible ?? b.shown) - (a.visible ?? a.shown))
  }

  /** Every month the topics are about, newest first. */
  const topicMonths = () => [...new Set(TOPICS.map((t) => t.month))].sort().reverse()

  /**
   * Found nothing 5 or more times in 7 days about the same thing, counted across a month edge (this
   * changes FR-606 case 1): Orders in Germany, 3 calls about 30 October and 3 about 1 November, is one.
   */
  function notFoundGroups(v: View) {
    return rollUp(topicsOf({ ...v, range: 7 })).filter((g) => g.counts.missing >= HIDE_UNDER)
  }

  /** Calls that could not be read in a range: no topic, so in no domain; an owner's narrowed view has none. */
  function couldNotRead(v: View) {
    if (v.domain) return 0
    return Math.round((COULD_NOT_READ * total(numbersOf(v).counts)) / WEEK_TOTAL)
  }

  /** The days or weeks the speed chart draws for a range, with their labels. */
  function speedOf(range: number) {
    if (range === 7)
      return { ...SPEED_DAYS, labels: DAYS.slice(-7).map((d) => d.label), per: 'day' }
    const n = range === 30 ? 5 : 13
    const starts = DAYS.filter((_, i) => (DAYS.length - 1 - i) % 7 === 6).slice(-n)
    return {
      median: SPEED_WEEKS.median.slice(-n),
      p95: SPEED_WEEKS.p95.slice(-n),
      labels: starts.map((d) => dateLabel(d.at)),
      per: 'week',
    }
  }

  return {
    data,
    topicName,
    topicTitle,
    topicKey,
    daysOf,
    barsOf,
    numbersOf,
    topicCounts,
    topicsOf,
    sparkOf,
    agentsOf,
    publishesIn,
    rollUp,
    topicMonths,
    notFoundGroups,
    couldNotRead,
    speedOf,
  }
}

export type Observability = ReturnType<typeof observability>
