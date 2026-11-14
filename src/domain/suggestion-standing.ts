/*
  Whether a waiting suggestion is still written against what agents get. A change is written
  against the version it edits; a suggestion to archive against the version it saw. Once the item
  gets a new live version (a check, another publish) or is archived another way, the suggestion
  is stale: it cannot go out as it is. A change goes back to its sender, who sends it again
  against the live version; a suggestion to archive is closed, with a reason.

  One answer for the review's sheet, its buttons and the decision. Pure: no clock, no input or
  output.
*/

export type Standing = 'current' | 'stale'

export type StandingInput = {
  /**
   * The version it was written against: the one a change edits, or the one an archive saw; null
   * for a new item, which agents get no version of yet.
   */
  written: string | null
  /** The version agents get now; null when they get none. */
  live: string | null
}

export const standingOf = ({ written, live }: StandingInput): Standing =>
  written === live ? 'current' : 'stale'

/** Why a stale suggestion is not published or archived, and what to do instead. */
export const staleWords: Record<'edit' | 'retire', string> = {
  edit: 'It was written against an earlier version of this item. Return it, so its sender writes it against the version agents get now.',
  retire: 'The item changed, or was archived, after this was suggested. Close it, with a reason.',
}
