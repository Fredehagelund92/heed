import type { ItemReview } from '@/api/client'
import type { ServedStamp } from '@/lib/agent-reply'
import { formatDay } from '@/lib/library'
import { checkLevelWords } from '@domain/bulk-review'

type CheckLevel = ItemReview['checks'][number]

/*
  Reviewed before served (FR-326, contract 7.2 `ReviewStamp`): one line under a served fact that
  says who accepted it, on which day, and that its checks passed. Inside Heed,
  behind sign-in, it names the person and their role; what an AI app receives names only the
  role, and a stamp falls back to those words until Heed has read who it was.
*/

export type ReviewStampView = {
  /** The UTC day it was accepted. */
  acceptedOn: string
  /** Who accepted it, by name; null while Heed has not read it, or when the record is erased. */
  person: string | null
  /** Their role in words: "owner of Finance" or "admin". */
  role: string
  edition: string
  /** The check levels that passed, in the order checks run; null when not read. */
  checks: readonly CheckLevel[] | null
}

/** The role an acceptance was decided in, as words after a name. */
export function roleWords(as: ItemReview['acceptedAs'], domain: string): string {
  return as === 'administrator' ? 'admin' : `owner of ${domain}`
}

/**
 * What the stamp shows for a served fact: Heed's own record of the review when it has one, else
 * the review as the agent reads it (the role alone). Null for a fact with neither, such as a
 * draft that no one has accepted yet.
 */
export function reviewStampView(
  served: ServedStamp | null,
  review: ItemReview | undefined,
  names: {
    person: (id: string) => string | null | undefined
    domain: (id: string) => string | null | undefined
  },
): ReviewStampView | null {
  if (review) {
    const domain = names.domain(review.areaId) ?? review.areaId
    return {
      acceptedOn: review.acceptedOn,
      person: review.personId ? (names.person(review.personId) ?? null) : null,
      role: roleWords(review.acceptedAs, domain),
      edition: review.edition,
      checks: review.checks,
    }
  }
  if (!served) return null
  return {
    acceptedOn: served.acceptedOn,
    person: null,
    // What an AI app reads says "an administrator"; the screen says admin.
    role: served.by.replace(/^(the|an) /, '').replace(/^administrator$/, 'admin'),
    edition: served.edition,
    checks: null,
  }
}

/** Who accepted it, in words: "Jon Abara, owner of Finance", or "the owner of Finance". */
export function acceptedByWords(view: Pick<ReviewStampView, 'person' | 'role'>): string {
  if (view.person) return `${view.person}, ${view.role}`
  return view.role === 'admin' ? 'an admin' : `the ${view.role}`
}

/** The check levels in words: "Complete, Finds the right questions and Reaches AI apps". */
export function checkWords(checks: readonly CheckLevel[]): string {
  const words = checks.map((level) => checkLevelWords[level])
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words.join('')
}

/**
 * The stamp as one sentence, for a screen reader and a copy. The edition stays on the Editions
 * page (docs/design/voice.md): a person reads the day and who accepted it.
 */
export function reviewStampWords(view: ReviewStampView): string {
  const checks = view.checks?.length ? ` Checks passed: ${checkWords(view.checks)}.` : ''
  return `Accepted ${formatDay(view.acceptedOn)} by ${acceptedByWords(view)}.${checks}`
}
