/**
 * The page that shows what changed between two editions (Editions design, slice S2), in the
 * words of the people who read it: owners and the data platform team (design, section 0).
 * "Since" and "Until" name the two editions, "Overall result" is the net change and "Edition by
 * edition" the steps between them. Pure functions of what they are given, so the page, the
 * stories and the unit tests read the same groups, rows and presets.
 */
import type { EditionChangeKind } from '@domain/editions'
import type { Edition } from '@/api'
import type { EditionComparison } from '@/lib/edition-diff'
import { parseEditionLabel } from '@/lib/editions'

/** A changed item as a page of the comparison lists it. */
export type ComparedItem = EditionComparison['items'][number]

/**
 * The order the groups show in: what a person reads for first (a real change, an item that came
 * or went), then what only confirms (checked, saved again). The service pages each group on its
 * own, so the order is the page's choice, not the service's.
 */
export const compareGroupOrder: readonly EditionChangeKind[] = [
  'changed',
  'added',
  'retired',
  'removed',
  'checked',
  'resaved',
]

/**
 * A group that starts closed: "saved again, nothing different" has nothing to read (the design's
 * "collapse the noise"), so its rows wait until someone opens it.
 */
export function groupStartsClosed(kind: EditionChangeKind): boolean {
  return kind === 'resaved'
}

/** One group of the list: its kind, how many items match, the rows loaded so far. */
export type CompareGroup = {
  kind: EditionChangeKind
  /** Items of this kind that match the filters, or null while its first page loads. */
  total: number | null
  items: readonly ComparedItem[]
  collapsed: boolean
}

/** A row of the windowed list: a group's header, a changed item, or a row still to load. */
export type CompareEntry =
  | { type: 'group'; kind: EditionChangeKind; total: number | null; collapsed: boolean }
  | { type: 'item'; kind: EditionChangeKind; item: ComparedItem }
  | { type: 'pending'; kind: EditionChangeKind; index: number }

/**
 * The rows of the list, group by group: a header for each group with items, then its loaded
 * rows and a placeholder for each row not loaded yet, so the list has its full height at once and
 * a placeholder that scrolls into view asks for the next page. A closed group is its header only.
 */
export function compareEntries(groups: readonly CompareGroup[]): CompareEntry[] {
  const entries: CompareEntry[] = []
  for (const group of groups) {
    if (group.total === 0) continue
    entries.push({
      type: 'group',
      kind: group.kind,
      total: group.total,
      collapsed: group.collapsed,
    })
    if (group.collapsed) continue
    for (const item of group.items) entries.push({ type: 'item', kind: group.kind, item })
    // While its first page loads, a group shows a few rows to load into.
    const missing = group.total === null ? 3 : Math.max(0, group.total - group.items.length)
    for (let index = 0; index < missing; index += 1)
      entries.push({ type: 'pending', kind: group.kind, index: group.items.length + index })
  }
  return entries
}

/**
 * What marks an item as viewed: the item and the two versions compared. A later comparison that
 * brings another version of the item reads as not viewed again, as a file in a pull request
 * does when it changes after someone viewed it.
 */
export function viewedKey(change: Pick<ComparedItem, 'itemId' | 'from' | 'to'>): string {
  return `${change.itemId}:${change.from?.versionId ?? '-'}:${change.to?.versionId ?? '-'}`
}

/** How many keys the browser keeps: the oldest go first. */
export const VIEWED_LIMIT = 2_000

/** Marks or unmarks a key, keeping the newest `VIEWED_LIMIT`. */
export function toggledViewed(keys: readonly string[], key: string): string[] {
  if (keys.includes(key)) return keys.filter((candidate) => candidate !== key)
  return [...keys, key].slice(-VIEWED_LIMIT)
}

export const isViewedList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((key) => typeof key === 'string')

/** Where the viewed marks live in this browser (the design's "browser first"). */
export const VIEWED_STORAGE_KEY = 'cl.editions.viewed'

// ---- the ranges a person picks without knowing edition numbers ----

export type ComparePresetId = 'latest' | 'week' | 'month' | 'quarter' | 'year'
export type ComparePreset = { id: ComparePresetId; title: string; days: number | null }

/** The ranges offered above the pickers; every one ends at the live edition. */
export const comparePresets: readonly ComparePreset[] = [
  { id: 'latest', title: 'Latest edition', days: null },
  { id: 'week', title: 'Last 7 days', days: 7 },
  { id: 'month', title: 'Last 30 days', days: 30 },
  { id: 'quarter', title: 'Last 90 days', days: 90 },
  { id: 'year', title: 'Last 12 months', days: 365 },
]

/** A UTC calendar day `days` after `day` (negative goes back). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * The first day a range of the last `days` days covers, today included: the last 7 days on
 * 11 October start on 5 October.
 */
export function presetFirstDay(today: string, days: number): string {
  return addDays(today, -(days - 1))
}

/** The day an edition was sealed, from its number. */
export function editionDay(label: string): string | null {
  return parseEditionLabel(label)?.day ?? null
}

/**
 * The edition that was live when `day` began, from editions newest first: the newest one sealed
 * on an earlier day; undefined when none of these is that old.
 */
export function editionBeforeDay(
  newestFirst: readonly Pick<Edition, 'label'>[],
  day: string,
): Pick<Edition, 'label'> | undefined {
  return newestFirst.find((edition) => (editionDay(edition.label) ?? '') < day)
}

// ---- the grid's columns ----

export const compareColumnIds = ['domain', 'risk', 'by', 'viewed'] as const
export type CompareColumnId = (typeof compareColumnIds)[number]

export type CompareColumnSpec = { title: string; width: number; widthClass: string }

/** The widths equal the `--column-*` tokens behind each class (tokens.css). */
export const compareColumnSpecs: Record<CompareColumnId, CompareColumnSpec> = {
  domain: { title: 'Domain', width: 192, widthClass: 'w-column-domain' },
  risk: { title: 'Risk', width: 128, widthClass: 'w-column-risk' },
  by: { title: 'Decided by', width: 156, widthClass: 'w-column-owner' },
  viewed: { title: 'Viewed', width: 96, widthClass: 'w-column-version' },
}

/** The title's narrowest width: one line of about 40 characters, as on the Gaps page. */
const TITLE_MIN = 320
/** Below this container width every item is the narrow row (contract 8.5, the phone row). */
const NARROW_BELOW = 768
/** Risk leaves first, then who decided, then the domain; Viewed always stays. */
const dropOrder: readonly CompareColumnId[] = ['risk', 'by', 'domain']

/** The columns that fit a container, and whether the list is the narrow row. */
export function fitCompareColumns(
  containerWidth: number,
  gutter: number,
): { columns: CompareColumnId[]; narrow: boolean } {
  const width = (columns: readonly CompareColumnId[]) =>
    gutter * 2 + TITLE_MIN + columns.reduce((sum, id) => sum + compareColumnSpecs[id].width, 0)
  let columns = [...compareColumnIds]
  for (const id of dropOrder) {
    if (width(columns) <= containerWidth) break
    columns = columns.filter((column) => column !== id)
  }
  return { columns, narrow: containerWidth < NARROW_BELOW }
}
