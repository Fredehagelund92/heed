import type { Area, Vocabulary } from '@domain/item'
import {
  gapOrigins,
  gapStatuses,
  gapTypes,
  type GapOrigin,
  type GapStatus,
  type GapType,
} from '@domain/gaps'
import type { Gap, TopicCounts } from '@/api'
import { queryTerms } from '@/lib/library'
import type { GapsSearch } from '@/lib/search-params'

/*
  The Gaps page's model (front end plan, screen 8 and slice W9): gaps and topic counts as rows
  with their names resolved, the filters and groups of the page, and the one rule for showing a
  count. The page, the docked panel, the chart and their tests all read it, so they agree.

    gaps -> rows (topic named) -> filters -> search -> groups
*/

/** The views of the Gaps page: the gaps themselves, and what agents were asked about. */
export const gapViews = [
  { id: 'gaps', title: 'Gaps' },
  { id: 'topics', title: 'Topic counts' },
] as const
export type GapViewId = (typeof gapViews)[number]['id']

export function gapViewOf(search: Pick<GapsSearch, 'view'>): GapViewId {
  return search.view === 'topics' ? 'topics' : 'gaps'
}

export const gapStatusNames: Record<GapStatus, string> = {
  open: 'Open',
  proposal_made: 'Draft started',
  wont_fix: "Won't fix",
  resolved: 'Resolved',
}

/** FR-607, in everyday words. */
export const gapTypeNames: Record<GapType, string> = {
  missing: 'Missing',
  outdated: 'Outdated',
  incorrect: 'Incorrect',
  duplicate: 'Duplicate',
  contradictory: 'Contradictory',
  wrong_item_chosen: 'Wrong fact chosen',
  scope_too_narrow: 'Applies too narrowly',
  scope_too_wide: 'Applies too widely',
  unclear_question: 'Unclear question',
}

/** What each type means, for the filter menu and the docked panel. */
export const gapTypeHints: Record<GapType, string> = {
  missing: 'No fact covers it',
  outdated: 'A fact is out of date',
  incorrect: 'A fact is wrong',
  duplicate: 'Two facts say the same thing',
  contradictory: 'Two facts disagree',
  wrong_item_chosen: 'An agent got the wrong fact',
  scope_too_narrow: 'A fact applies too narrowly',
  scope_too_wide: 'A fact applies too widely',
  unclear_question: 'The question was unclear',
}

/**
 * The types in a contributor's words, as Report a gap groups them: three plain questions first,
 * each with its precise types under it. The stored types are FR-607's, unchanged.
 */
export const gapTypeGroups: readonly { label: string; types: readonly GapType[] }[] = [
  { label: 'Something is missing', types: ['missing'] },
  {
    label: 'Something is wrong or out of date',
    types: ['outdated', 'incorrect', 'contradictory', 'duplicate'],
  },
  {
    label: 'The wrong thing came back',
    types: ['wrong_item_chosen', 'scope_too_narrow', 'scope_too_wide', 'unclear_question'],
  },
]

/** FR-606: how a gap was opened. */
export const gapOriginNames: Record<GapOrigin, string> = {
  no_item_calls: 'Agents asked and found nothing',
  report_gap: 'An agent reported it',
  feedback: 'Negative feedback on an answer',
  source_change: 'A source definition changed',
  person: 'A person reported it',
}

/** The Origin filter's words: people's reports count wherever they landed, not only first. */
export const gapOriginFilterNames: Record<GapOrigin, string> = {
  no_item_calls: 'Agents found nothing',
  report_gap: 'Reported by an agent',
  feedback: 'Negative feedback',
  source_change: 'A source changed',
  person: 'Reported by people',
}

export { gapOrigins, gapStatuses, gapTypes }

/** Where a gap stands, the groups of the list in order. */
export const gapStages = ['open', 'drafting', 'closed'] as const
export type GapStage = (typeof gapStages)[number]

export const gapStageNames: Record<GapStage, string> = {
  open: 'Open',
  drafting: 'Draft started',
  closed: 'Closed',
}

export function gapStageOf(status: GapStatus): GapStage {
  if (status === 'open') return 'open'
  if (status === 'proposal_made') return 'drafting'
  return 'closed'
}

// ---- the privacy rule (FR-614) ---------------------------------------------------------------

/**
 * A count as a person may see it. The service hides a count from one to just under the minimum
 * (null) for anyone who does not manage the gap; this page never prints such a count to anyone,
 * on any surface, so a value below the minimum is shown as "Fewer than 5" even when the service
 * sent it (an owner's own gap). A hidden total is "Hidden": the weeks it adds up may themselves
 * be hidden, so "fewer than" would not be true.
 */
export type ShownCount =
  { kind: 'value'; value: number } | { kind: 'fewer'; minimum: number } | { kind: 'hidden' }

export function shownCount(
  value: number | null,
  minimum: number | null,
  {
    /** True where the service hides exactly the counts from one to just under the minimum. */
    nullMeansFewer = false,
  }: { nullMeansFewer?: boolean } = {},
): ShownCount {
  if (value === 0) return { kind: 'value', value: 0 }
  // Without the minimum nothing but zero can be shown safely.
  if (minimum === null) return { kind: 'hidden' }
  if (value === null) return nullMeansFewer ? { kind: 'fewer', minimum } : { kind: 'hidden' }
  return value < minimum ? { kind: 'fewer', minimum } : { kind: 'value', value }
}

export function countText(count: ShownCount): string {
  if (count.kind === 'value') return count.value.toLocaleString('en')
  if (count.kind === 'fewer') return `Fewer than ${count.minimum}`
  return 'Hidden'
}

/** The short form for a chart label: "<5". */
export function countLabel(count: ShownCount): string {
  if (count.kind === 'value') return count.value.toLocaleString('en')
  if (count.kind === 'fewer') return `<${count.minimum}`
  return '-'
}

/** The number a chart may draw: only a shown value, never a hidden one. */
export function countValue(count: ShownCount): number | null {
  return count.kind === 'value' ? count.value : null
}

/** "42%", or "Hidden" when either count behind it is hidden. */
export function shareText(share: number | null): string {
  return share === null ? 'Hidden' : `${Math.round(share * 100)}%`
}

/** The sentence under every count of the page, so a hidden count never reads as a fault. */
export function privacyNote(minimum: number | null): string {
  return minimum === null
    ? 'We hide small counts, so nobody can tell who asked.'
    : `We hide counts below ${minimum}, so nobody can tell who asked.`
}

// ---- names ---------------------------------------------------------------------------------

export type GapTopic = Gap['topic']

/** The names a topic is told in, from the vocabulary. An unknown key keeps its own words. */
export function topicParts(topic: GapTopic, vocabulary: Vocabulary | undefined) {
  const idOf = (key: string) => key.slice(key.indexOf(':') + 1)
  const metrics = topic.metrics.map((key) => ({
    key,
    name: vocabulary?.metrics.find((metric) => metric.id === idOf(key))?.name ?? idOf(key),
  }))
  const values = topic.dimensionValues.map(({ dimension, value }) => {
    const known = vocabulary?.dimensions.find((candidate) => candidate.id === idOf(dimension))
    const valueId = idOf(value).split('/').pop() ?? value
    return {
      key: value,
      dimension: known?.name ?? idOf(dimension),
      name: known?.values.find((candidate) => candidate.id === valueId)?.name ?? valueId,
    }
  })
  return { metrics, values }
}

const listFormat = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' })

/** "Orders in Norway", "Active customers and Marketing spend", "Poland". */
export function topicTitle(topic: GapTopic, vocabulary: Vocabulary | undefined): string {
  const { metrics, values } = topicParts(topic, vocabulary)
  const metricText = listFormat.format(metrics.map((metric) => metric.name))
  const valueText = listFormat.format(values.map((value) => value.name))
  if (metricText && valueText) return `${metricText} in ${valueText}`
  return metricText || valueText || 'Any topic'
}

const monthFormat = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const shortMonthFormat = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** The topic's calendar month: "October 2026", or "Oct 2026". */
export function monthText(month: string, style: 'short' | 'long' = 'long'): string {
  const date = new Date(`${month.slice(0, 7)}-01T00:00:00Z`)
  return (style === 'long' ? monthFormat : shortMonthFormat).format(date)
}

const weekFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const longWeekFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** A week by its Monday: "5 Oct", or "Week of 5 October 2026". */
export function weekText(week: string, style: 'short' | 'long' = 'short'): string {
  const date = new Date(`${week.slice(0, 10)}T00:00:00Z`)
  return style === 'long' ? `Week of ${longWeekFormat.format(date)}` : weekFormat.format(date)
}

// ---- rows ----------------------------------------------------------------------------------

/**
 * The domain of a topic: its area, or the one domain its metrics have. Null when they span
 * domains or have none; `topicDomainsText` then names them.
 */
export function topicArea(
  topic: Pick<Gap['topic'], 'areaId' | 'areaIds'>,
  areas: readonly Area[],
): { name: string; label: Area['label'] } | null {
  const id = topic.areaId ?? (topic.areaIds.length === 1 ? topic.areaIds[0]! : null)
  if (id === null) return null
  const area = areas.find((candidate) => candidate.id === id)
  return { name: area?.name ?? 'Unknown domain', label: area?.label ?? 'gray' }
}

/** What a topic without one domain says instead: "2 domains: Customer value, Marketing". */
export function topicDomainsText(
  topic: Pick<Gap['topic'], 'areaIds'>,
  areas: readonly Pick<Area, 'id' | 'name'>[],
): string {
  if (!topic.areaIds.length) return 'No domain'
  const names = topic.areaIds.map(
    (id) => areas.find((area) => area.id === id)?.name ?? 'Unknown domain',
  )
  return `${names.length} ${names.length === 1 ? 'domain' : 'domains'}: ${names.join(', ')}`
}

export type GapRow = {
  id: string
  title: string
  month: string
  type: GapType
  status: GapStatus
  stage: GapStage
  /** Null when the topic spans domains or has none. */
  areaId: string | null
  /** The topic's domains: a domain filter shows the gap under each. */
  areaIds: string[]
  /** Null when the topic spans domains or has none: `domainsText` names them. */
  areaName: string | null
  areaLabel: Area['label'] | null
  domainsText: string
  reports: ShownCount
  /** The part of the reports people made from Try it or the assistant. */
  personReports: ShownCount
  openedBy: GapOrigin
  /** Opened by a person's report, or reported by people since: the "From people" badge. */
  fromPeople: boolean
  noItemCalls: ShownCount
  lastSeen: string
  canManage: boolean
}

/**
 * Whether people reported a gap: a person's report opened it, or people's reports counted on it
 * since. A hidden count (null) may be zero, so only a count above zero says so.
 */
export function reportedByPeople(gap: Pick<Gap, 'openedBy' | 'personReports'>): boolean {
  return gap.openedBy === 'person' || (gap.personReports ?? 0) > 0
}

export function toGapRow(
  gap: Gap,
  {
    areas,
    vocabulary,
    minimum,
  }: { areas: readonly Area[]; vocabulary: Vocabulary | undefined; minimum: number | null },
): GapRow {
  const area = topicArea(gap.topic, areas)
  return {
    id: gap.id,
    title: topicTitle(gap.topic, vocabulary),
    month: gap.topic.month,
    type: gap.type,
    status: gap.status,
    stage: gapStageOf(gap.status),
    areaId: gap.topic.areaId,
    areaIds: gap.topic.areaIds,
    areaName: area?.name ?? null,
    areaLabel: area?.label ?? null,
    domainsText: topicDomainsText(gap.topic, areas),
    reports: shownCount(gap.reports, minimum),
    personReports: shownCount(gap.personReports, minimum),
    openedBy: gap.openedBy,
    fromPeople: reportedByPeople(gap),
    noItemCalls: shownCount(gap.noItemCalls, minimum),
    lastSeen: gap.lastSeen,
    canManage: gap.canManage,
  }
}

/** Whether a gap came from an origin: how it opened, or for people, any report of theirs. */
export function gapFromOrigin(row: Pick<GapRow, 'openedBy' | 'fromPeople'>, origin: GapOrigin) {
  return origin === 'person' ? row.fromPeople : row.openedBy === origin
}

/** The status, type, origin, domain and search filters of the address, in the service's order. */
export function visibleGapRows(rows: readonly GapRow[], search: GapsSearch): GapRow[] {
  const terms = queryTerms(search.q)
  return rows.filter(
    (row) =>
      (search.status === undefined || row.status === search.status) &&
      (search.type === undefined || row.type === search.type) &&
      (search.origin === undefined || gapFromOrigin(row, search.origin)) &&
      (search.area === undefined || row.areaIds.includes(search.area)) &&
      terms.every((term) =>
        [row.title, monthText(row.month), gapTypeNames[row.type]].some((text) =>
          text.toLowerCase().includes(term),
        ),
      ),
  )
}

export function gapFilterCount(search: GapsSearch): number {
  return [search.status, search.type, search.origin, search.area].filter(
    (value) => value !== undefined,
  ).length
}

export type GapEntry =
  { type: 'group'; stage: GapStage; count: number } | { type: 'gap'; row: GapRow }

/** Open first, then gaps with a draft, then closed ones; each group keeps the service's order. */
export function groupGapRows(rows: readonly GapRow[]): GapEntry[] {
  return gapStages.flatMap((stage): GapEntry[] => {
    const inStage = rows.filter((row) => row.stage === stage)
    if (!inStage.length) return []
    return [
      { type: 'group', stage, count: inStage.length },
      ...inStage.map((row): GapEntry => ({ type: 'gap', row })),
    ]
  })
}

/** "Status: Open, Type: Missing and Domain: Commercial", for "No gaps match". */
export function describeGapFilters(search: GapsSearch, areaName: (id: string) => string): string {
  const parts = [
    search.q?.trim() ? `"${search.q.trim()}"` : null,
    search.status ? `Status: ${gapStatusNames[search.status]}` : null,
    search.type ? `Type: ${gapTypeNames[search.type]}` : null,
    search.origin ? `Origin: ${gapOriginFilterNames[search.origin]}` : null,
    search.area ? `Domain: ${areaName(search.area)}` : null,
  ].filter((part): part is string => part !== null)
  return parts.length
    ? `Nothing matches ${listFormat.format(parts)}.`
    : 'Nothing matches the search.'
}

// ---- topic counts --------------------------------------------------------------------------

export type TopicRow = {
  key: string
  title: string
  month: string
  week: string
  areaId: string | null
  /** The topic's domains: a domain filter shows the topic under each. */
  areaIds: string[]
  areaName: string | null
  areaLabel: Area['label'] | null
  domainsText: string
  calls: ShownCount
  noItemCalls: ShownCount
  share: number | null
}

export function toTopicRows(
  counts: TopicCounts,
  { areas, vocabulary }: { areas: readonly Area[]; vocabulary: Vocabulary | undefined },
): TopicRow[] {
  return counts.rows.map((row) => {
    const area = topicArea(row.topic, areas)
    const noItemCalls = shownCount(row.noItemCalls, counts.minimumCount, { nullMeansFewer: true })
    return {
      key: `${row.week}|${row.topic.areaId ?? ''}|${row.topic.metrics.join(',')}|${row.topic.dimensionValues.map((value) => value.value).join(',')}|${row.topic.month}`,
      title: topicTitle(row.topic, vocabulary),
      month: row.topic.month,
      week: row.week,
      areaId: row.topic.areaId,
      areaIds: row.topic.areaIds,
      areaName: area?.name ?? null,
      areaLabel: area?.label ?? null,
      domainsText: topicDomainsText(row.topic, areas),
      calls: shownCount(row.calls, counts.minimumCount),
      noItemCalls,
      // A share is shown only when both counts behind it are.
      share: noItemCalls.kind === 'value' ? row.noItemShare : null,
    }
  })
}

export function visibleTopicRows(rows: readonly TopicRow[], search: GapsSearch): TopicRow[] {
  const terms = queryTerms(search.q)
  return rows.filter(
    (row) =>
      (search.area === undefined || row.areaIds.includes(search.area)) &&
      terms.every((term) =>
        [row.title, monthText(row.month)].some((text) => text.toLowerCase().includes(term)),
      ),
  )
}

export type TopicEntry =
  { type: 'group'; week: string; count: number } | { type: 'topic'; row: TopicRow }

/** One group per week, newest first, as the service orders the rows. */
export function groupTopicRows(rows: readonly TopicRow[]): TopicEntry[] {
  const weeks = [...new Set(rows.map((row) => row.week))]
  return weeks.flatMap((week): TopicEntry[] => {
    const inWeek = rows.filter((row) => row.week === week)
    return [
      { type: 'group', week, count: inWeek.length },
      ...inWeek.map((row): TopicEntry => ({ type: 'topic', row })),
    ]
  })
}

// ---- the weekly counts of one gap -----------------------------------------------------------

export type WeekPoint = {
  week: string
  label: string
  reports: ShownCount
  personReports: ShownCount
  noItemCalls: ShownCount
}

/** A gap's weeks for the chart and its table: every count through the one rule above. */
export function gapWeeks(gap: Pick<Gap, 'weeks'>, minimum: number | null): WeekPoint[] {
  return gap.weeks.map((week) => ({
    week: week.week,
    label: weekText(week.week),
    reports: shownCount(week.reports, minimum, { nullMeansFewer: true }),
    // Never "fewer than": a reader who does not manage the gap gets none of them (readerWeek).
    personReports: shownCount(week.personReports, minimum),
    noItemCalls: shownCount(week.noItemCalls, minimum, { nullMeansFewer: true }),
  }))
}
