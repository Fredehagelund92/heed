/*
  The words of a bulk step in the review queue (FR-223), shared by the service and the mock so a
  person reads the same reason for a proposal left out, whichever answers. Each names what is in
  the way and, where there is one, the next step.
*/

type CheckLevel = 'format' | 'matching' | 'delivery' | 'answer_impact' | 'answer_full'

/** A check level as a sentence names it: "A required check failed: Matching." */
export const checkLevelWords: Record<CheckLevel, string> = {
  format: 'Complete',
  matching: 'Finds the right questions',
  delivery: 'Reaches AI apps',
  answer_impact: 'Answers stay right',
  answer_full: 'Whole domain',
}

export const levelList = (levels: readonly { level: CheckLevel }[]) =>
  levels.map((level) => checkLevelWords[level.level]).join(', ')

/** Why a bulk step leaves a proposal out, in words for the person. */
export const bulkSkipWords = {
  notFound: "You can't see it any more.",
  changed: 'It changed since you selected it. Open it to read it again.',
  notWaiting: 'It no longer waits for a decision.',
  own: 'You proposed it, so an owner of its domain or an admin decides it.',
  claimed: 'Another owner is reviewing it.',
  sameItem: 'Another selected proposal changes the same fact. Decide this one on its own.',
  approverNext: 'An owner or an admin already accepted it. It waits for the approver.',
  alreadyTheirs: "It's already theirs.",
  termChanges: 'A name can only be accepted or rejected. Say what to change in its discussion.',
  retirementChanges: 'A proposal to archive a fact can only be accepted or rejected.',
  termDecider: 'An owner of its domain or an admin decides it.',
  itemDecider: 'Only an owner of its domain or an admin can decide it.',
  notClaimed: 'Only a new fact or a change can be claimed. Decide this one as it is.',
  assigner: 'Only an owner of its domain can give it to one of its owners.',
  failed: (levels: string) => `A check it needs failed: ${levels}. Open it to read why.`,
  waiting: (levels: string) => `A check it needs hasn't passed yet: ${levels}.`,
  failedAgain: (levels: string) => `A check it needs didn't pass when it ran again: ${levels}.`,
} as const

/** The order terms are decided in, as a batch: groups, then metrics and dimensions, then values. */
export const termKindOrder: Record<string, number> = {
  metric_group: 0,
  metric: 1,
  dimension: 1,
  dimension_value: 2,
}
