/*
  What a person may do with a suggestion in review, and which one the screen leads with. One
  answer for the panel, the phone's bar, the keyboard and every other place that asks, instead of
  each working it out again from the same fields.

  The rules follow what the service allows:
  - a suggestion to archive is archived or closed, never returned and never published; it closes
    only once its sender took it back in the comments;
  - anything else is published or returned;
  - Publish waits while a live item it clashes with has no answer (FR-225); a claim to check or a
    withdrawn retirement does not hold it back;
  - a draft for a Not found card is published or edited: nobody wrote a note to answer.

  Pure: no clock, no input or output.
*/

export const reviewActionNames = ['publish', 'archive', 'close', 'return'] as const
export type ReviewAction = (typeof reviewActionNames)[number]

/** Why an offered action is held. */
export type ReviewBlock = 'clash'

export type ReviewActionsInput = {
  mode: 'new' | 'edit' | 'retire'
  /** A retirement its sender took back in the comments. */
  withdrawn: boolean
  /** Live items it clashes with that still have no answer, given or chosen. */
  clashes: number
  /** Claims the copied sentence does not plainly say. */
  claimsToCheck: number
  /** Drafted for a Not found card: nobody wrote it. */
  drafted: boolean
}

export type ReviewActions = {
  /** The actions on offer. An action not here is absent from the screen, not greyed out. */
  can: readonly ReviewAction[]
  /** The one the screen leads with. */
  primary: ReviewAction
  /** Offered actions that wait, and why. */
  blockedBy: Partial<Record<ReviewAction, ReviewBlock>>
  /** The primary action goes out as it stands: it is open and it is not a Return. The key acts on it. */
  ready: boolean
}

export function reviewActions(input: ReviewActionsInput): ReviewActions {
  const { mode, withdrawn, clashes, claimsToCheck, drafted } = input
  const can: ReviewAction[] =
    mode === 'retire'
      ? withdrawn
        ? ['archive', 'close']
        : ['archive']
      : drafted
        ? ['publish']
        : ['publish', 'return']
  const primary: ReviewAction =
    mode === 'retire'
      ? withdrawn
        ? 'close'
        : 'archive'
      : !drafted && claimsToCheck
        ? 'return'
        : 'publish'
  const blockedBy: ReviewActions['blockedBy'] =
    mode !== 'retire' && clashes > 0 ? { publish: 'clash' } : {}
  return { can, primary, blockedBy, ready: primary !== 'return' && !blockedBy[primary] }
}

/** Whether an action may be taken now. */
export const mayDo = (actions: ReviewActions, action: ReviewAction) =>
  actions.can.includes(action) && !actions.blockedBy[action]
