/**
 * The Editions page as a feed of release notes (Editions design, slice S3): each edition as one
 * sentence that says what changed, who did it and why, grouped by day, newest first, with the way
 * into what changed one click away. Pure functions of what they are given, so the page, the
 * stories and the unit tests read the same days and the same links.
 */
import type { Edition } from '@/api'
import { editionDay } from '@/lib/edition-compare'
import type { EditionCompareSearch } from '@/lib/search-params'

type Entry = { edition: Pick<Edition, 'label'> }

/**
 * One day of the feed: the day its editions were sealed (from their numbers), newest first, and
 * the entry just before the day's oldest, when the feed has read it.
 */
export type FeedDay<T extends Entry> = { day: string; entries: T[]; before: T | undefined }

/** The feed's entries by the day in their numbers, keeping their order (newest first). */
export function feedDays<T extends Entry>(entries: readonly T[]): FeedDay<T>[] {
  const days: FeedDay<T>[] = []
  for (const entry of entries) {
    const day = editionDay(entry.edition.label) ?? ''
    const last = days.at(-1)
    if (last?.day === day) last.entries.push(entry)
    else {
      if (last) last.before = entry
      days.push({ day, entries: [entry], before: undefined })
    }
  }
  return days
}

/** What changed in one edition: it against the edition before it (the comparison's default). */
export const editionChanges = (label: string): EditionCompareSearch => ({ until: label })

/** What changed since an edition: it against the live edition (the comparison's default). */
export const changesSince = (label: string): EditionCompareSearch => ({ since: label })

/**
 * What changed on one day of the feed: from the edition before the day's oldest to the day's
 * newest. The edition before is the next entry in the feed; when it is not read yet, a day of one
 * edition is still that edition's own change, and a day of several has no range (null).
 */
export function dayChanges(day: FeedDay<Entry>): EditionCompareSearch | null {
  const newest = day.entries[0]?.edition.label
  if (!newest) return null
  if (day.before) return { since: day.before.edition.label, until: newest }
  return day.entries.length === 1 ? editionChanges(newest) : null
}
