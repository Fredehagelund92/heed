import { relationWords } from '@domain/clash-relations'
import { lineDiff } from '@/lib/line-diff'
import type { Relation, Review } from './review'

// The review's rules that only the full review page uses: the answers to a clash, and how long a
// change takes to read. Apart from model/review.ts, which the Inbox loads up front, so these and
// the line diff load on demand with the review page.

/** Each answer as the review offers it, and what it does when the suggestion is published, as the service says it. */
export const relationText: Record<Relation, { label: string; hint: string }> = {
  replaces: relationWords.replaces,
  disagree: relationWords.disagrees,
  unrelated: relationWords.unrelated,
}

/**
 * What publishing does to the live items it overlaps, once each has an answer, in a sentence;
 * null while one still has none.
 */
export function clashOutcome(r: Review, answers: Record<string, Relation>): string | null {
  const items = r.clash?.items ?? []
  const given = items.map((c) => answers[c.factId])
  if (!items.length || given.some((x) => !x)) return null
  if (given.length === 1) return relationText[given[0]!].hint
  const n = (x: Relation) => given.filter((g) => g === x).length
  const archived = n('replaces')
  const stay = given.length - archived
  const parts = [
    archived && `${archived} ${archived === 1 ? 'live item is' : 'live items are'} archived`,
    stay && `${stay} ${stay === 1 ? 'stays' : 'stay'}`,
  ].filter(Boolean)
  const disagree = n('disagree')
  return `When you publish, ${parts.join(' and ')}.${disagree ? ' Where you said they disagree, agents say context disagrees.' : ''}`
}

/** What publishing did, for its toast: the live items it archived by name, and where both stay. */
export function publishedWords(r: Review, answers: Record<string, Relation>): string {
  const items = r.clash?.items ?? []
  const archived = items.filter((c) => answers[c.factId] === 'replaces').map((c) => c.title)
  const disagree = items.filter((c) => answers[c.factId] === 'disagree').length
  if (items.length === 1 && disagree) return 'Both stay live; agents say context disagrees.'
  const words = [
    archived.length ? `Archived: ${archived.join('; ')}.` : '',
    disagree ? 'Where you said they disagree, both stay live and agents say so.' : '',
  ].filter(Boolean)
  return words.length ? words.join(' ') : 'Agents get it from the next question.'
}

/** Needs care before publishing: an unverified claim, or a clash with live context. */
export const needsCare = (r: Review) => !!r.claims || !!r.clash

/**
 * How long a change has to be on screen before it counts as read: longer for more changed words,
 * from a second and a half for a date to eight seconds for a long rewording.
 */
export const readTime = (r: Review) =>
  r.readMs ??
  Math.min(
    8000,
    Math.max(
      1500,
      1000 +
        12 *
          lineDiff(r.source.before, r.source.after)
            .filter((x) => x.t === '+')
            .reduce((n, x) => n + x.line.length, 0),
    ),
  )
