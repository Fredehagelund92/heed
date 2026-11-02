import { cardTypeLabel, type CardType, type InboxCard } from './inbox'
import { claimsToCheck, type Answer, type Review } from './review'

// What the Inbox pane and the review's quick view say about a card before anyone opens the review:
// the state its chip names, what its one button is called, the few words beside that button that
// say what follows, and what agents answer today and after the decision. Pure rules over a card and
// its review, so every kind of card can be checked without a screen.

/** The words over the two sides of the answers. One list, read by every place that shows them. */
export const ANSWER_SIDES = {
  today: 'Agents say today',
  after: 'After you publish',
  /** A suggestion that clashes with live context: what agents would hear if it went out unchanged. */
  asIs: 'If you publish as it is',
  /** A suggestion that archives an item: the decision is Archive, not Publish. */
  archive: 'After you archive',
} as const

/**
 * The state a card is in, as its chip says it: the kind's word, or Conflict when it clashes. A
 * mention and a suggestion of yours that waits are rows of their own, with a state of their own.
 */
export type PaneState = {
  label: string
  icon: CardType | 'conflict' | 'mention' | 'waiting'
  tone: 'neutral' | 'warn'
}

export function paneState(card: Pick<InboxCard, 'type'>, review?: Review): PaneState {
  if (review?.clash) return { label: 'Conflict', icon: 'conflict', tone: 'warn' }
  return { label: cardTypeLabel[card.type], icon: card.type, tone: 'neutral' }
}

/** What the quick view's one button is called: the decision it opens, never only a step. */
export function reviewAction(r: Review) {
  if (r.clash) return 'Decide how they relate'
  if (r.drafted) return 'Check the draft'
  return 'Review'
}

/** The card's one button: a review names the decision it opens; any other card keeps its own. */
export const primaryLabel = (card: InboxCard, review?: Review) =>
  review ? reviewAction(review) : card.primary

const questions = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`

/**
 * The few words beside a review's button: what follows from it. A count shows only when there is
 * one; nothing on a contributor's screen says "0 questions" (copy rule 2.11).
 */
export function reviewFollows(r: Review): string {
  const claims = claimsToCheck(r)
  if (r.clash) return 'Publishing waits until you say how they relate'
  if (claims)
    return claims === 1
      ? 'Check the claim, then publish'
      : `Check the ${claims} claims, then publish`
  if (r.retire?.withdrawn) return `${r.retire.withdrawn.by} took it back in the comments`
  if (r.drafted) return 'Nobody has checked the draft yet'
  const { before, after, reach } = r.tryIt
  if (after.text === before.text) return 'Agents keep the same answer'
  const what = after.state === 'missing' ? 'Not found' : 'the new answer'
  return reach > 0 ? `${questions(reach)} a week would get ${what}` : `Agents would get ${what}`
}

/** The few words beside any card's button, when there is something worth saying about what follows. */
export function follows(card: InboxCard, review?: Review): string | undefined {
  if (review) return reviewFollows(review)
  switch (card.type) {
    case 'gap':
      return card.gap ? `The editor opens on ${card.gap.scope.slice(0, 2).join(', ')}` : undefined
    case 'check':
      return 'It counts as checked today, by you'
    case 'look':
      return 'Quality shows before and now for each'
    case 'flag':
      return card.factId ? 'It opens beside the list, with the report' : undefined
    default:
      return undefined
  }
}

/** What agents answer today and after the decision, from the review's Try it. */
export type Answers = {
  question: string
  today: Answer
  after: Answer
  /** The label over the after side, from ANSWER_SIDES. */
  afterLabel: string
  /** Both sides say the same words. */
  same: boolean
}

/**
 * The answers a card can show, from its review's Try it pair: suggestions and the drafts for Not
 * found have one; a card without a review (an alert, a check date, a report) has none, and its pane
 * keeps the folded layout.
 */
export function answersOf(review?: Review): Answers | undefined {
  if (!review) return undefined
  const { question, before, after } = review.tryIt
  if (!question || !before.text || !after.text) return undefined
  const afterLabel =
    review.clash || after.state === 'conflict'
      ? ANSWER_SIDES.asIs
      : review.mode === 'retire'
        ? ANSWER_SIDES.archive
        : ANSWER_SIDES.after
  return { question, today: before, after, afterLabel, same: before.text === after.text }
}
