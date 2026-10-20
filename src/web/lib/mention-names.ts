import type { ItemLinks } from '@/api'

/*
  The names of mention targets and their states, kept apart from the search (mention-targets.ts)
  so a page that only shows chips does not load the search index.
*/

export type MentionTargetType = 'metric' | 'dim' | 'val' | 'item' | 'area'
/** Current, retired (an item), or the source definition of a term changed or went missing. */
export type MentionStatus = ItemLinks['mentions'][number]['target']['status']

/** The words a screen reader adds after the name, so a chip is never told by its look alone. */
export const mentionTypeWords: Record<MentionTargetType, string> = {
  metric: 'metric',
  dim: 'dimension',
  val: 'value',
  item: 'fact',
  area: 'domain',
}

const statusWords: Record<MentionStatus, string | null> = {
  current: null,
  retired: 'archived',
  source_changed: 'source changed',
  source_missing: 'source missing',
}

/** What a screen reader says for a mention: "Net revenue, metric", "Old note, fact, archived". */
export function mentionSpokenName(type: MentionTargetType, name: string, status: MentionStatus) {
  return [name, mentionTypeWords[type], statusWords[status]].filter(Boolean).join(', ')
}

/** The type of a stored target, from its prefix. */
export function targetType(key: string): MentionTargetType | null {
  const prefix = key.slice(0, key.indexOf(':'))
  return prefix === 'metric' ||
    prefix === 'dim' ||
    prefix === 'val' ||
    prefix === 'item' ||
    prefix === 'area'
    ? prefix
    : null
}

/**
 * The state of every target an item's text mentions, from `items.links`, for the chips of a text
 * that already exists (a suggested change, a review). The vocabulary read has no definition state
 * yet (back end gap G8), so this is where "source changed" and "source missing" come from.
 */
export function linkStatuses(
  links: Pick<ItemLinks, 'mentions'> | null | undefined,
): Record<string, MentionStatus> {
  return Object.fromEntries(
    (links?.mentions ?? []).map((link) => [link.target.key, link.target.status]),
  )
}
