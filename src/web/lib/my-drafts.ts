import type { ProposalRecord } from '@/api'

/*
  The person's own proposals, and which of them are drafts they have not submitted. Home's Your
  drafts, the Draft, not submitted group of Proposals > Mine, and the Drafts entry under the
  Context library all read this one module, so they always agree on what a draft is and how many
  there are. It is small on purpose: the shell's sidebar carries it in the app's first load.
*/

/** A page of the person's own proposals: the service answers at most 100. */
export const MINE = { own: true, limit: 100 } as const

/**
 * What Mine lists: the person's item creates and changes, and the vocabulary terms they proposed
 * (pilot walk C9), so a term waiting for a decision can be found and withdrawn.
 */
export function mineProposals(records: readonly ProposalRecord[]): ProposalRecord[] {
  return records.filter(
    (record) =>
      record.subject === 'vocabulary' ||
      (record.subject === 'item' && (record.action === 'create' || record.action === 'change')),
  )
}

/**
 * A draft its writer has not submitted: only they see it, and no owner has it yet. Made in the
 * form, by the assistant or by an agent, it is the same draft.
 */
export function isUnsubmittedDraft(record: Pick<ProposalRecord, 'state'>): boolean {
  return record.state === 'draft'
}

/** The person's unsubmitted drafts among their proposals, the one they touched last first. */
export function myDrafts(records: readonly ProposalRecord[]): ProposalRecord[] {
  return mineProposals(records)
    .filter(isUnsubmittedDraft)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number)
}

/** Where every draft is listed: Proposals > Mine, showing the drafts only. */
export const draftsLink = {
  to: '/proposals',
  search: { view: 'mine', state: 'draft' },
} as const

/**
 * How long ago a draft was last edited, in words: "Just now", "5 minutes ago", "3 hours ago",
 * "Yesterday", "4 days ago", "2 weeks ago", and the day itself ("12 Aug 2026") after 30 days.
 * `now` is the moment the page reads it; a time after it (a clock a little behind) is just now.
 */
export function editedAgoWords(at: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000)
  const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'} ago`
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return plural(minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return plural(hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return plural(days, 'day')
  if (days < 30) return plural(Math.floor(days / 7), 'week')
  return dayFormat.format(new Date(at))
}

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
