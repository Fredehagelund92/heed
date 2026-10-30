/**
 * The kinds, statuses and origins of a gap, apart from the rest of `gaps.ts`, so an address that
 * filters by them (the routes' search schemas, which the shell loads before any page) does not
 * bring the counting and verification rules along.
 */

/** FR-607. */
export const gapTypes = [
  'missing',
  'outdated',
  'incorrect',
  'duplicate',
  'contradictory',
  'wrong_item_chosen',
  'scope_too_narrow',
  'scope_too_wide',
  'unclear_question',
] as const
export type GapType = (typeof gapTypes)[number]

/** FR-609. A `wont_fix` gap never reopens by itself. */
export const gapStatuses = ['open', 'proposal_made', 'wont_fix', 'resolved'] as const
export type GapStatus = (typeof gapStatuses)[number]

/**
 * FR-606: the ways a gap is opened, by case number. Case 5 is a person who reports one from Try it
 * or the assistant; like every other origin, it records no person (FR-608, FR-613).
 */
export const gapOrigins = [
  'no_item_calls',
  'report_gap',
  'feedback',
  'source_change',
  'person',
] as const
export type GapOrigin = (typeof gapOrigins)[number]
