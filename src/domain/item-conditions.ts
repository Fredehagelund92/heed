/**
 * Every condition that is true of an item at once (the item page header), beside the one
 * status the library shows (`itemDisplayStatus` in status.ts). Pure: it takes the day as input.
 */
import type { ContextItem } from './item'
import { hasEnded } from './status'

type ConditionInput = Pick<ContextItem, 'kind' | 'status' | 'validity' | 'reviewDate' | 'checkFlag'>

/**
 * Where an item is in its life. A standing fact is `accepted` until it ends or is retired; an
 * issue is `active_issue` while it applies and `resolved_issue` once its last day has passed.
 */
export const itemLifecycles = [
  'accepted',
  'ended',
  'retired',
  'active_issue',
  'resolved_issue',
] as const
export type ItemLifecycle = (typeof itemLifecycles)[number]

/** A condition that asks an owner to look again, most urgent first. */
export const itemWarnings = ['source_missing', 'needs_check', 'stale'] as const
export type ItemWarning = (typeof itemWarnings)[number]

export type ItemConditions = { lifecycle: ItemLifecycle; warnings: ItemWarning[] }

/**
 * Every condition that is true of an item, not only the one the list shows (the item page
 * header): its lifecycle, and each warning beside it. An ended item keeps its source flag,
 * because it is still delivered for its own period; a retired one has no warnings, because it is
 * never delivered. A passed review date only matters while the item still applies.
 */
export function itemConditions(item: ConditionInput, today: string): ItemConditions {
  if (item.status === 'retired') return { lifecycle: 'retired', warnings: [] }
  const ended = hasEnded(item, today)
  const warnings: ItemWarning[] = []
  if (item.checkFlag) warnings.push(item.checkFlag)
  if (!ended && item.reviewDate !== null && item.reviewDate < today) warnings.push('stale')
  const issue = item.kind === 'issue'
  const lifecycle: ItemLifecycle = ended
    ? issue
      ? 'resolved_issue'
      : 'ended'
    : issue
      ? 'active_issue'
      : 'accepted'
  return { lifecycle, warnings }
}
