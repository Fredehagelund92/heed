/**
 * What the library shows as an item's status, derived from the item and the date (design
 * contract section 1, "Statuses"). Pure: the server can use the same rules later.
 */
import type { ContextItem } from './item.ts'

/**
 * The statuses an accepted or retired item can show in the library, most urgent first. Proposal
 * states (draft, waiting for review and so on) belong to proposals, not to library items.
 * `active_issue` is an issue that still applies: a live warning, not a problem with the item.
 */
export const itemDisplayStatuses = [
  'source_missing',
  'needs_check',
  'stale',
  'active_issue',
  'accepted',
  'expired',
  'retired',
] as const
export type ItemDisplayStatus = (typeof itemDisplayStatuses)[number]

type StatusInput = Pick<ContextItem, 'kind' | 'status' | 'validity' | 'reviewDate' | 'checkFlag'>

/** Whether the item's last day has passed (the stored end date is exclusive). */
export function hasEnded(item: Pick<ContextItem, 'validity'>, today: string): boolean {
  return item.validity.end !== null && item.validity.end <= today
}

/**
 * Retired wins, then an ended validity (the stored end date is exclusive: an item that ends on
 * 1 January applies through 31 December), then the source flags, then a passed review date. An
 * issue that still applies and has none of these is an active issue.
 */
export function itemDisplayStatus(item: StatusInput, today: string): ItemDisplayStatus {
  if (item.status === 'retired') return 'retired'
  if (hasEnded(item, today)) return 'expired'
  if (item.checkFlag) return item.checkFlag
  if (item.reviewDate !== null && item.reviewDate < today) return 'stale'
  if (item.kind === 'issue') return 'active_issue'
  return 'accepted'
}

/**
 * Whether an item can be trusted today, as the library index says it and `library.freshness`
 * counts it: `ended` once it is retired or its last day has passed, `needs_check` while a source
 * flag is on or its review date has passed, else `current`.
 */
export const itemTrusts = ['current', 'needs_check', 'ended'] as const
export type ItemTrust = (typeof itemTrusts)[number]

export function itemTrust(
  item: Pick<ContextItem, 'status' | 'validity' | 'reviewDate' | 'checkFlag'>,
  today: string,
): ItemTrust {
  if (item.status === 'retired' || hasEnded(item, today)) return 'ended'
  if (item.checkFlag || (item.reviewDate !== null && item.reviewDate < today)) return 'needs_check'
  return 'current'
}

/**
 * "Needs a look" (contract open question 11): re-check due, source changed or source missing.
 * These are the items an owner should look at again.
 */
export function needsALook(status: ItemDisplayStatus): boolean {
  return status === 'stale' || status === 'needs_check' || status === 'source_missing'
}

/**
 * Whether a status is shown in the warning tone: everything that needs a look, and an active
 * issue, which warns everyone who reads about its period while nothing is wrong with the item.
 */
export function asksForALook(status: ItemDisplayStatus): boolean {
  return needsALook(status) || status === 'active_issue'
}

/**
 * An issue whose last day has passed. It stays in service for questions about its own period,
 * but the library leaves it out of the default view (requirements 4.4).
 */
export function isEndedIssue(item: StatusInput, today: string): boolean {
  return item.kind === 'issue' && item.status !== 'retired' && hasEnded(item, today)
}

/** Adds days to an ISO date (UTC days, NFR-048). */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** The Monday of a day's week (UTC), as PostgreSQL's `date_trunc('week', day)`. */
export function mondayOf(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

/** The last day an item applies. The stored end date is exclusive (requirements, C08). */
export function lastValidDay(end: string): string {
  return addDays(end, -1)
}
