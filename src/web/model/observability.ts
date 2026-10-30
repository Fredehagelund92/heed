import { COMPARE_FROM, countChange, shareChange, type Change } from '@domain/observability'
import { stateLabel, type AnswerState } from './ask'
import type { DomainId } from './items'
import { flipped, type SortKey, type Sorting } from '@/lib/sort'

// What Observability shows: what agents asked and how it was answered, as scopes and counts only.
// The words of a question and who asked are never kept, so there are no threads to open: a topic
// (a metric, a market, dates) and how often it was asked takes their place.
//
// A page's data comes from the binding for one view (a range, and a domain or a kind of agent),
// with every count already through src/domain/observability.ts: a count under 5 is null, and no
// count shown gives a hidden one away by subtraction. The app never sees a hidden count, so all it
// can do with one is say "Fewer than 5", or "13+" for a total whose shown parts are known.

export type Range = 7 | 30 | 90
export const RANGES: Range[] = [7, 30, 90]

/** The answer states a chart tells apart. Not checked is a failure, counted on Usage instead. */
export type Shown = Exclude<AnswerState, 'failed'>
export const SHOWN: Shown[] = ['grounded', 'partial', 'conflict', 'stale', 'missing']
/** The same words as everywhere, from the one list. */
export const STATE_WORDS: Record<Shown, string> = stateLabel

/** A count a reader may see; null when it is hidden (FR-614). */
export type Count = number | null
export type Counts = Record<Shown, Count>
export const noCounts = (): Counts => ({
  grounded: null,
  partial: null,
  conflict: null,
  stale: null,
  missing: null,
})
/** What the shown counts add up to. */
export const shownSum = (c: Counts) => SHOWN.reduce((n, k) => n + (c[k] ?? 0), 0)

/** Under this, a count is shown as "Fewer than 5". */
export const HIDE_UNDER = 5
export const shownCount = (n: Count) =>
  n === null || (n > 0 && n < HIDE_UNDER) ? 'Fewer than 5' : n.toLocaleString('en-GB')

/* ---------- the days ---------- */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Thu 22": a day as a chart's axis says it. */
export function dayLabel(at: number) {
  const d = new Date(at)
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()}`
}
export const dateLabel = (at: number) => {
  const d = new Date(at)
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`
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

export const money = (n: number) => `$${n.toFixed(2)}`

/* ---------- what a page reads ---------- */

/** A publish: a dashed line on the charts, so you can see whether the hatch of "nothing" shrank after it. */
export type Publish = {
  at: number
  title: string
  by: string
  domain?: DomainId
  /** What the saved questions said after it, when they were checked. */
  checked?: string
}

export type Topic = {
  id: string
  /** The metric, or the metric group, as people name it; empty when no metric was named. */
  metric: string
  /** The market, the event or the other value asked about; "All markets" when none was. */
  where: string
  /** The domain of its metrics. A topic with no metric named has none. */
  domain?: DomainId
  /** The calendar month the question's dates start in, as stored in the key: "2026-10". */
  month: string
  /** Its scope without the month: the months of one subject read as one row. */
  subject: string
  /** How the metric was named: a metric group (its domain taken from the group's metrics), or none at all. */
  named?: 'group' | 'none'
  /** How often it was asked in the range, or null when that is hidden. */
  total: Count
  /** What its shown counts add up to, when the total is hidden: "9+". */
  atLeast: number
  counts: Counts
  /**
   * Which of Questions' views it is in: whether its subject found nothing 5 or more times, whether
   * someone reported an answer about it, and how it was answered as far as the counts shown say.
   */
  in: { notFound: boolean; reported: boolean; answers: Shown[] }
  /** Where its "found nothing" went: a draft or a suggestion in the Inbox. */
  gap?: { label: string; href: string }
  /** Calls whose agent's own fields named one thing and the words another: a bit per call, never the words. */
  disagree?: Count
  /** Its questions per day over the range, for its sparkline, when a binding has them. */
  spark?: number[]
  /** The kinds of agent that asked about it, when a binding has them. */
  agents?: { name: string; count: Count }[]
}

/** A subject: the topics of one scope over its months, with what may be shown of their total. */
export type Subject = {
  key: string
  domain?: DomainId
  topics: string[]
  total: Count
  atLeast: number
  counts: Counts
}

/** The view a page reads: a range, and a domain or a kind of agent. */
export type View = { range: Range; domain?: DomainId; agent?: string }

/** The demo's review flag for this area: ?state=empty (nothing connected), quiet (under 5), busy. */
export type ObsState = 'normal' | 'empty' | 'quiet' | 'busy'

/** What people and agents said about answers. */
export type ReportState = 'inbox' | 'looked' | 'fine'
export type Report = {
  id: string
  title: string
  line: string
  state: ReportState
  domain?: DomainId
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

export type Bar = { label: string; at: number; counts: Counts }

export type FeedbackData = {
  reports: Report[]
  goodByWeek: { labels: string[]; values: Count[] }
  week: { good: Count; goodBefore: Count; wrong: Count }
}

export type UsageData = {
  tools: {
    name: string
    calls: number
    answered: number
    detail: number
    nothing: number
    failed: number
  }[]
  /** Tool calls in the range before, to compare with. */
  before: number | null
  /** Calls whose question could not be read. */
  couldNotRead: Count
  agents: { name: string; calls: Count; last: string }[]
  speed: { median: Count[]; p95: Count[]; labels: string[]; per: 'day' | 'week' }
  spend: {
    total: number
    cap: number
    parts: { name: string; amount: number }[]
    limits: { name: string; used: number; cap: number }[]
  }
}

/** An Observability page's data for one view, every count already disclosed. */
export type ObsData = {
  state: ObsState
  range: Range
  /** The last day counted, as a UTC timestamp. */
  last: number
  /** What was asked in the range, by answer state, and in the range before it. */
  numbers: {
    asked: Count
    counts: Counts
    before: { asked: Count; missing: Count; grounded: Count }
  }
  /** The chart: a bar a day for 7 and 30 days, a week a bar for 90. */
  bars: Bar[]
  /** Every topic of the range in the domains the reader sees, whatever domain the numbers are for. */
  topics: Topic[]
  subjects: Subject[]
  domains: { domain?: DomainId; total: Count; atLeast: number }[]
  /** What found nothing five or more times in the last 7 days, its months counted together. */
  notFound: { subjects: Subject[]; topics: Topic[] }
  /** Calls that could not be read: no topic, so in no domain. */
  couldNotRead: Count
  /** The values of the Market dimension: a topic's place is a market or something else. */
  markets: string[]
  publishes: Publish[]
  /** The kinds of agent that asked, for admins. */
  agents: { name: string; count: Count }[]
  feedback: FeedbackData | null
  usage: UsageData | null
}

/* ---------- roll-ups: the same key, grouped for reading ---------- */

/** How Questions and Overview group topics: each exact scope, metric and market (the default), or domain only. */
export type Grouping = 'none' | 'metric' | 'domain'
export const GROUPINGS: Record<Grouping, string> = {
  none: 'None',
  metric: 'Metric and market',
  domain: 'Domain only',
}

export type TopicGroup = {
  key: string
  name: string
  domain?: DomainId
  named?: Topic['named']
  /** Its exact scopes, newest month first. */
  rows: Topic[]
  counts: Counts
  /** The total, or null when it would give a hidden count away. */
  visible: Count
  /** What its shown parts add up to: "13+". */
  shown: number
  months: string[]
}

/** What a grouped count shows: "31"; "13+" when a hidden count is part of it; "Fewer than 5". */
export function groupCount(g: Pick<TopicGroup, 'visible' | 'shown'>) {
  if (g.visible !== null) return g.visible.toLocaleString('en-GB')
  return g.shown > 0 ? `${g.shown.toLocaleString('en-GB')}+` : 'Fewer than 5'
}

/** The ways the topics sort, each with its direction in words. */
export const TOPIC_SORTS = {
  asked: { label: 'Asked', first: 'desc', ways: { desc: 'Most first', asc: 'Fewest first' } },
  nothing: { label: 'Not found', first: 'desc', ways: { desc: 'Most first', asc: 'Fewest first' } },
  name: { label: 'Topic', first: 'asc', ways: { asc: 'A to Z', desc: 'Z to A' } },
} satisfies Record<string, SortKey>
export type Sort = keyof typeof TOPIC_SORTS

/** How many, for ordering: the total, or what its shown parts add up to. */
const size = (g: Pick<TopicGroup, 'visible' | 'shown'>) => g.visible ?? g.shown

export const sortGroups = (gs: TopicGroup[], s: Sorting<Sort>) => {
  const way = flipped(TOPIC_SORTS, s) ? -1 : 1
  return [...gs].sort(
    (a, b) =>
      way *
      (s.key === 'name'
        ? a.name.localeCompare(b.name)
        : s.key === 'nothing'
          ? (b.counts.missing ?? 0) - (a.counts.missing ?? 0) || size(b) - size(a)
          : size(b) - size(a)),
  )
}

/** What a topic's status says, in the order that matters: a gap's way forward, then a disagreement, then age. */
export function statusOf(
  t: Pick<TopicGroup, 'counts' | 'rows'>,
): { label: string; tone: 'gap' | 'warn'; href?: string } | undefined {
  const gap = t.rows.find((r) => r.gap)?.gap
  if ((t.counts.missing ?? 0) >= HIDE_UNDER || t.rows.some((r) => r.in.notFound))
    return gap
      ? { label: gap.label, tone: 'gap', href: gap.href }
      : { label: STATE_WORDS.missing, tone: 'gap' }
  if ((t.counts.conflict ?? 0) >= HIDE_UNDER) return { label: STATE_WORDS.conflict, tone: 'warn' }
  if ((t.counts.stale ?? 0) >= HIDE_UNDER) return { label: STATE_WORDS.stale, tone: 'warn' }
  return undefined
}

/** A share in whole per cent, or null when either count is hidden. */
export const share = (part: Count, whole: Count) =>
  part === null || whole === null || whole === 0 ? null : Math.round((part / whole) * 100)

/**
 * How what was asked moved: in per cent when the range before had enough to compare with, else in
 * calls; the same within the margin.
 */
export function askedChange(now: number, before: number): Change & { percent: number | null } {
  const change = countChange(now, before)
  return {
    ...change,
    percent: before >= COMPARE_FROM ? Math.round(((now - before) / before) * 100) : null,
  }
}

/** Observability's reading of a page's data: names, roll-ups and the numbers Overview leads with. */
export function observability(data: ObsData) {
  const { markets } = data

  const topicName = (t: Pick<Topic, 'metric' | 'where'> & Partial<Pick<Topic, 'named'>>) =>
    t.named === 'none' || !t.metric
      ? `${t.where}, no metric named`
      : markets.includes(t.where)
        ? `${t.metric} in ${t.where}`
        : `${t.metric}, ${t.where === 'All markets' ? 'all markets' : t.where}`

  /** The exact scope, as a person reads it: "Orders in Norway, October 2026". */
  const topicTitle = (t: Topic) => `${topicName(t)}, ${monthName(t.month)}`

  const subjects = new Map(data.subjects.map((s) => [s.key, s]))

  /** One group of exact rows: what the binding may show of it, when every one of its rows is here. */
  function groupOf(
    key: string,
    rows: Topic[],
    whole?: Omit<Subject, 'key' | 'topics'>,
  ): TopicGroup {
    const ordered = [...rows].sort((a, b) => b.month.localeCompare(a.month))
    const all = rows.every((r) => r.total !== null)
    // Without the binding's own total, only what every row shows can be added up.
    const counts = whole?.counts ?? noCounts()
    if (!whole)
      for (const k of SHOWN)
        counts[k] = rows.every((r) => r.counts[k] !== null)
          ? rows.reduce((n, r) => n + r.counts[k]!, 0)
          : null
    return {
      key,
      name: topicName(rows[0]!),
      domain: rows[0]!.domain,
      named: rows[0]!.named,
      rows: ordered,
      counts,
      visible: whole ? whole.total : all ? rows.reduce((n, r) => n + r.total!, 0) : null,
      shown: whole ? whole.atLeast : rows.reduce((n, r) => n + (r.total ?? r.atLeast), 0),
      months: ordered.map((r) => r.month),
    }
  }

  /** Topics that share a domain, a metric and a market, joined; the month stays inside as a breakdown and a filter. */
  function rollUp(rows: Topic[]): TopicGroup[] {
    const by = new Map<string, Topic[]>()
    for (const t of rows) by.set(t.subject, [...(by.get(t.subject) ?? []), t])
    return [...by.entries()]
      .map(([key, list]) => {
        const whole = subjects.get(key)
        return groupOf(key, list, whole && whole.topics.length === list.length ? whole : undefined)
      })
      .sort((a, b) => size(b) - size(a))
  }

  /** One exact row as a group of one. */
  const single = (t: Topic): TopicGroup =>
    groupOf(t.subject, [t], { total: t.total, atLeast: t.total ?? t.atLeast, counts: t.counts })

  /** A domain's rows as one group: the binding's own total when all of its topics are here. */
  function domainGroup(
    domain: DomainId | undefined,
    rows: Topic[],
  ): Pick<TopicGroup, 'visible' | 'shown'> {
    const d = data.domains.find((x) => x.domain === domain)
    const every = data.topics.filter((t) => t.domain === domain).length === rows.length
    if (d && every) return { visible: d.total, shown: d.atLeast }
    const all = rows.every((r) => r.total !== null)
    return {
      visible: all ? rows.reduce((n, r) => n + r.total!, 0) : null,
      shown: rows.reduce((n, r) => n + (r.total ?? r.atLeast), 0),
    }
  }

  /** The exact rows in the order they show, for stepping through the answer panel. */
  function rowOrder(rows: Topic[], grouping: Grouping, sort: Sorting<Sort>) {
    if (grouping === 'none') return sortGroups(rows.map(single), sort).flatMap((g) => g.rows)
    return sortGroups(rollUp(rows), sort).flatMap((g) => g.rows)
  }

  /** Every month the topics are about, newest first. */
  const topicMonths = () => [...new Set(data.topics.map((t) => t.month))].sort().reverse()

  /**
   * Found nothing 5 or more times in 7 days about the same thing, counted across a month edge (this
   * changes FR-606 case 1): Orders in Germany, 3 calls about 30 October and 3 about 1 November, is one.
   */
  function notFoundGroups(domain?: DomainId): TopicGroup[] {
    const byId = new Map(data.notFound.topics.map((t) => [t.id, t]))
    return data.notFound.subjects
      .filter((s) => !domain || s.domain === domain)
      .map((s) =>
        groupOf(
          s.key,
          s.topics.map((id) => byId.get(id)!),
          s,
        ),
      )
      .sort((a, b) => size(b) - size(a))
  }

  /**
   * The headline numbers of the view, and how they compare with the range before: what was asked,
   * in calls; what was checked (only Checked, never an answer with a warning) and what found
   * nothing, by their shares. A change is null when a count is hidden or too small to compare.
   */
  function numbers() {
    const { asked, counts, before } = data.numbers
    const nothing = counts.missing
    const checked = counts.grounded
    const both = (now: Count, was: Count) => now !== null && was !== null
    return {
      asked,
      askedBefore: before.asked,
      askedChange: both(asked, before.asked) ? askedChange(asked!, before.asked!) : null,
      checked,
      checkedShare: share(checked, asked),
      checkedChange:
        both(checked, before.grounded) && both(asked, before.asked)
          ? shareChange(checked!, asked!, before.grounded!, before.asked!)
          : null,
      nothing,
      // By its share, as Checked: more questions bring more that found nothing, and that alone is
      // no worse.
      nothingChange:
        both(nothing, before.missing) && both(asked, before.asked) && nothing! >= HIDE_UNDER
          ? shareChange(nothing!, asked!, before.missing!, before.asked!)
          : null,
      nothingShare: share(nothing, asked),
      counts,
    }
  }

  return {
    data,
    topicName,
    topicTitle,
    rollUp,
    single,
    domainGroup,
    rowOrder,
    topicMonths,
    notFoundGroups,
    numbers,
  }
}

export type Observability = ReturnType<typeof observability>
