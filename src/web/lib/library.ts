import type { Area, CreationChannel, ItemKind } from '@domain/item'
import { itemKinds } from '@domain/item'
import { itemDisplayStatuses, type ItemDisplayStatus } from '@domain/status'
import type { LibraryItem } from '@/api'
import type { LibrarySearch } from '@/lib/search-params'
import {
  inView,
  kindNames,
  sortOptions,
  type LibraryGroup,
  type LibraryRow,
  type LibrarySort,
  type LibraryViewer,
  type LibraryViewId,
} from '@/lib/library-core'

export {
  attentionInMyDomains,
  buildRows,
  groupOptions,
  inView,
  isLiveIssueRow,
  kindNames,
  libraryGroups,
  librarySorts,
  libraryViews,
  needsALookCount,
  sortOptions,
  type LibraryContext,
  type LibraryGroup,
  type LibraryRow,
  type LibrarySort,
  type LibraryViewer,
  type LibraryViewId,
} from '@/lib/library-core'

/**
 * The library's row model: one pure pipeline from the cached index to the rows on screen.
 * The list, the search field, the quick switcher and previous and next on an item page all go
 * through it, so they always agree on what "the list" is.
 *
 *   index -> rows (names resolved) -> view -> filters -> search -> sort -> groups
 *
 * The rows, the views and what the shell reads of them are in lib/library-core.ts, which the
 * app's first load carries; this module re-exports them.
 */

export const statusNames: Record<ItemDisplayStatus, string> = {
  accepted: 'Accepted',
  stale: 'Check due',
  needs_check: 'Source changed',
  source_missing: 'Source missing',
  active_issue: 'Active issue',
  expired: 'Ended',
  retired: 'Archived',
}

/**
 * The short word a table row shows beside the glyph of a status that asks for a look (heed-ux
 * A8), so the 128 pixel Status column names it without truncating; the full name is the badge's
 * accessible name and, with what it means, its tooltip.
 */
export const statusShortNames: Partial<Record<ItemDisplayStatus, string>> = {
  stale: 'Check due',
  needs_check: 'Changed',
  source_missing: 'Missing',
  active_issue: 'Active',
}

/** What each status means in one line: the status key and the tooltip of the status column. */
export const statusHints: Record<ItemDisplayStatus, string> = {
  source_missing: 'Something this fact is about is gone from its source.',
  needs_check: 'Its source changed. The owner checks that the fact is still right.',
  stale: 'The check date has passed.',
  active_issue: 'An issue that still applies. Agents get it as a warning.',
  accepted: 'Nothing to check.',
  expired: 'Its last day has passed.',
  retired: "Archived. Agents don't get it.",
}

/** A comma separated URL list, kept only where every value is known. */
export function parseList<T extends string>(value: string | undefined, known: readonly T[]): T[] {
  if (!value) return []
  return value.split(',').filter((part): part is T => (known as readonly string[]).includes(part))
}

export function formatList(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(',') : undefined
}

export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
}

export type LibraryFilters = {
  kinds: ItemKind[]
  statuses: ItemDisplayStatus[]
  area: string | undefined
  about: string | undefined
  /** Show the issues that have ended, which the library leaves out by default (requirements 4.4). */
  endedIssues: boolean
  /** Needs a look across every domain, not only the ones the person looks after. */
  allDomains: boolean
}

export function filtersOf(search: LibrarySearch): LibraryFilters {
  return {
    kinds: parseList(search.kind, itemKinds),
    statuses: parseList(search.status, itemDisplayStatuses),
    area: search.area,
    about: search.about,
    endedIssues: search.ended === 'show',
    allDomains: search.domains === 'all',
  }
}

/** How many filters are on, for the badge on the view options button. Search is not counted. */
export function activeFilterCount(search: LibrarySearch): number {
  const filters = filtersOf(search)
  return (
    filters.kinds.length +
    filters.statuses.length +
    (filters.area ? 1 : 0) +
    (filters.about ? 1 : 0) +
    (filters.endedIssues ? 1 : 0)
  )
}

/**
 * The library's `about` values of a scope, in the order of a row's `about` names: a metric id,
 * a value as `dimension:value`, and a dimension with any value as `dimension:*`.
 */
export function aboutKeys(scope: LibraryItem['scope']): string[] {
  return [
    ...scope.metrics,
    ...scope.dimensionValues.map(({ dimension, value }) => `${dimension}:${value}`),
    ...scope.dimensions.map((dimension) => `${dimension}:*`),
  ]
}

/** The kind of an `about` value: a metric, a dimension's value, or a dimension with any value. */
export type AboutKind = 'metric' | 'dimension_value' | 'dimension'

function aboutKind(key: string): AboutKind {
  return key.endsWith(':*') ? 'dimension' : key.includes(':') ? 'dimension_value' : 'metric'
}

const aboutOrder: Record<AboutKind, number> = { metric: 0, dimension_value: 1, dimension: 2 }

/**
 * What the rows are about, each once, for the Filter menu's About: the `about` value the address
 * carries, its name and its kind. Metrics first, then values, then dimensions with any value,
 * each by name.
 */
export function aboutChoices(
  rows: readonly LibraryRow[],
): { key: string; name: string; kind: AboutKind }[] {
  const names = new Map<string, string>()
  for (const row of rows)
    aboutKeys(row.scope).forEach((key, index) => {
      if (!names.has(key)) names.set(key, row.about[index] ?? key)
    })
  return [...names]
    .map(([key, name]) => ({
      key,
      name,
      kind: aboutKind(key),
    }))
    .sort(
      (a, b) =>
        aboutOrder[a.kind] - aboutOrder[b.kind] ||
        a.name.localeCompare(b.name, 'en') ||
        a.key.localeCompare(b.key, 'en'),
    )
}

/** Whether a row is an issue whose last day has passed (`isEndedIssue` in src/domain/status.ts). */
export function isEndedIssueRow(row: LibraryRow): boolean {
  return row.kind === 'issue' && row.displayStatus === 'expired'
}

/**
 * Retired items have left service. They stay out of every view unless the Retired status filter
 * asks for them, the way an archive works in Notion or Linear. Ended issues are history: they
 * stay out until the Ended issues filter (or the Ended status) asks for them. An ended event or
 * note still shows as Ended, because a standing fact that ended is still worth seeing.
 */
export function applyViewAndFilters(
  rows: LibraryRow[],
  view: LibraryViewId,
  filters: LibraryFilters,
  viewer: LibraryViewer,
): LibraryRow[] {
  const showRetired = filters.statuses.includes('retired')
  const showEndedIssues = filters.endedIssues || filters.statuses.includes('expired')
  return rows.filter(
    (row) =>
      (row.displayStatus !== 'retired' || showRetired) &&
      (showEndedIssues || !isEndedIssueRow(row)) &&
      inView(row, view, viewer, filters.allDomains) &&
      (filters.kinds.length === 0 || filters.kinds.includes(row.kind)) &&
      (filters.statuses.length === 0 || filters.statuses.includes(row.displayStatus)) &&
      (filters.area === undefined || row.areaId === filters.area) &&
      (filters.about === undefined || aboutKeys(row.scope).includes(filters.about)),
  )
}

/**
 * How many rows the view holds before the search and the filters, counting the retired items and
 * ended issues the filters bring back: the "of 1,404" in "57 of 1,404 items", never below 57.
 */
export function viewTotal(
  rows: LibraryRow[],
  view: LibraryViewId,
  filters: LibraryFilters,
  viewer: LibraryViewer,
): number {
  const showRetired = filters.statuses.includes('retired')
  const showEndedIssues = filters.endedIssues || filters.statuses.includes('expired')
  return rows.filter(
    (row) =>
      (row.displayStatus !== 'retired' || showRetired) &&
      (showEndedIssues || !isEndedIssueRow(row)) &&
      inView(row, view, viewer, filters.allDomains),
  ).length
}

/** The words of a query, for marking matches in a title. */
export function queryTerms(query: string | undefined): string[] {
  return (query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
}

const statusOrder = new Map(itemDisplayStatuses.map((status, index) => [status, index]))
const kindOrder = new Map(itemKinds.map((kind, index) => [kind, index]))

const compare: Record<LibrarySort, (a: LibraryRow, b: LibraryRow) => number> = {
  updated: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
  title: (a, b) => a.title.localeCompare(b.title),
  start: (a, b) => a.validity.start.localeCompare(b.validity.start),
  // Ongoing items sort after every dated one.
  until: (a, b) => (a.until ?? '9999').localeCompare(b.until ?? '9999'),
  status: (a, b) =>
    (statusOrder.get(a.displayStatus) ?? 0) - (statusOrder.get(b.displayStatus) ?? 0),
  domain: (a, b) => a.areaName.localeCompare(b.areaName),
  owner: (a, b) => a.ownerName.localeCompare(b.ownerName),
}

export type SortState = { sort: LibrarySort; dir: 'asc' | 'desc' } | { sort: 'relevance' }

/** With a search and no chosen sort, the best match comes first. Otherwise the chosen or default sort. */
export function sortStateOf(search: LibrarySearch): SortState {
  if (search.q?.trim() && !search.sort) return { sort: 'relevance' }
  const sort = search.sort ?? 'updated'
  const fallback = sortOptions.find((option) => option.id === sort)?.defaultDir ?? 'asc'
  return { sort, dir: search.dir ?? fallback }
}

export function sortRows(rows: LibraryRow[], state: SortState): LibraryRow[] {
  if (state.sort === 'relevance') return rows
  const by = compare[state.sort]
  const sign = state.dir === 'asc' ? 1 : -1
  // Ties fall back to the title, then the id, so the order never changes between renders.
  return [...rows].sort(
    (a, b) => sign * by(a, b) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  )
}

export type GroupHeader = {
  type: 'group'
  key: string
  label: string
  count: number
  kind?: ItemKind
  status?: ItemDisplayStatus
  areaLabel?: Area['label']
}
export type ListEntry = GroupHeader | { type: 'item'; row: LibraryRow }

function groupKey(row: LibraryRow, group: LibraryGroup): Omit<GroupHeader, 'type' | 'count'> {
  switch (group) {
    case 'kind':
      return { key: row.kind, label: kindNames[row.kind], kind: row.kind }
    case 'domain':
      return { key: row.areaId, label: row.areaName, areaLabel: row.areaLabel }
    case 'status':
      return {
        key: row.displayStatus,
        label: statusNames[row.displayStatus],
        status: row.displayStatus,
      }
    case 'owner':
      return { key: row.ownerId, label: row.ownerName }
  }
}

function groupRank(header: Omit<GroupHeader, 'type' | 'count'>, group: LibraryGroup) {
  if (group === 'kind' && header.kind) return kindOrder.get(header.kind) ?? 0
  if (group === 'status' && header.status) return statusOrder.get(header.status) ?? 0
  return 0
}

/**
 * Turns rows into list entries: group headers followed by their rows, in a stable group order
 * (kinds and statuses in their fixed order, domains and owners by name). Collapsed groups keep
 * their header and hide their rows.
 */
export function groupRows(
  rows: LibraryRow[],
  group: LibraryGroup | undefined,
  collapsed: ReadonlySet<string> = new Set(),
): ListEntry[] {
  if (!group) return rows.map((row) => ({ type: 'item', row }))
  const groups = new Map<
    string,
    { header: Omit<GroupHeader, 'type' | 'count'>; rows: LibraryRow[] }
  >()
  for (const row of rows) {
    const header = groupKey(row, group)
    const existing = groups.get(header.key)
    if (existing) existing.rows.push(row)
    else groups.set(header.key, { header, rows: [row] })
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      groupRank(a.header, group) - groupRank(b.header, group) ||
      a.header.label.localeCompare(b.header.label),
  )
  return ordered.flatMap(({ header, rows: members }): ListEntry[] => [
    { type: 'group', ...header, count: members.length },
    ...(collapsed.has(header.key) ? [] : members.map((row): ListEntry => ({ type: 'item', row }))),
  ])
}

/** Up to two names joined by a middle dot, then "+n" (contract 8.2, About). */
export function aboutSummary(about: string[]): string {
  if (about.length === 0) return ''
  const shown = about.slice(0, 2).join(' · ')
  return about.length > 2 ? `${shown} +${about.length - 2}` : shown
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const longDateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** A UTC day as "31 Dec 2026" (contract 8.2), or "31 December 2026" in long form. */
export function formatDay(isoDate: string, style: 'short' | 'long' = 'short'): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  return (style === 'long' ? longDateFormat : dateFormat).format(date)
}

const momentFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
})
const longMomentFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'UTC',
})

/**
 * A moment as "8 Oct, 09:12" (a timeline row), or "8 October 2026 at 09:12 UTC" in long form for
 * its tooltip. UTC like every day in the app (NFR-048), so the day and the time never disagree.
 */
export function formatMoment(iso: string, style: 'short' | 'long' = 'short'): string {
  const date = new Date(iso)
  return style === 'long'
    ? `${longMomentFormat.format(date)} UTC`
    : momentFormat.format(date).replace(' at ', ', ')
}

/** Whole days from `today` to `date` (UTC days, NFR-048): 0 on the day, negative once it passed. */
export function daysFrom(today: string, date: string): number {
  const day = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  return Math.round((day(date) - day(today)) / 86_400_000)
}

/** Where an item or a proposal came from, as the end of "Written by" (FR-103). */
export const channelText: Record<CreationChannel, string> = {
  form: 'In the web form',
  assistant: 'With the assistant',
  chat: 'From a chat message',
  command_line: 'With the command-line tool',
  mcp: 'Through an agent',
  import: 'In an import',
  source: 'From a document a content source read',
}

export function formatCount(count: number, noun = 'fact'): string {
  return `${count.toLocaleString('en')} ${count === 1 ? noun : `${noun}s`}`
}
