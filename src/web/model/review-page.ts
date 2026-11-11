import { relationWords } from '@domain/clash-relations'
import { reviewActions } from '@domain/review-actions'
import { lineDiff } from '@/lib/line-diff'
import { kindLabel, type Fact, type Kind } from './items'
import type { Domains } from './people'
import { claimsToCheck, type Relation, type Review } from './review'
import { whenLabel } from './validity'

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

/** Needs care before publishing: a claim to check, or a clash with live context. */
export const needsCare = (r: Review) => claimsToCheck(r) > 0 || !!r.clash

/**
 * What may be done with a suggestion, with the owner's answers to its clash so far: the same
 * rules the service holds (src/domain/review-actions.ts), for the panel, the phone's bar and the key.
 */
export const actionsOf = (r: Review, answers: Record<string, Relation>) =>
  reviewActions({
    mode: r.mode,
    withdrawn: !!r.retire?.withdrawn,
    drafted: !!r.drafted,
    claimsToCheck: claimsToCheck(r),
    clashes: (r.clash?.items ?? []).filter((c) => !answers[c.factId]).length,
  })

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

/**
 * The suggested version as a context item, the way its page will show it once published: the
 * review's own fields and stored text, over the live item it changes (`live`, for an edit). Only
 * what publishing sets stays empty (the day it was checked); null for an archive, which has no
 * suggested version.
 */
export function draftItem(r: Review, live: Fact | undefined, domains: Domains): Fact | null {
  const after = r.fields.after
  if (!after) return null
  const before = r.fields.before
  // The stored text is the summary, then the body after the first blank line.
  const [summary = '', ...rest] = r.source.after.split('\n\n')
  const body = rest.join('\n\n')
  const kind = (Object.keys(kindLabel) as Kind[]).find((k) => kindLabel[k] === after.kind)
  const domain = Object.values(domains).find((d) => d.name === after.domain)?.id
  // The same names as the live item: its terms by key, so a value still reads as its dimension's.
  const sameScope =
    !!live &&
    live.where.length === after.scope.length &&
    live.where.every((w) => after.scope.includes(w))
  // An owner the suggestion leaves alone stays as the live item has it. A new one shows as the
  // item's page shows it: one of the domain's owners reads as all of them, anyone else by name.
  const domainOwners = domain ? (domains[domain]?.owners ?? []) : []
  const owners =
    live && before?.owner === after.owner
      ? live.owners
      : after.owner && after.owner !== 'Not set' && !domainOwners.includes(after.owner)
        ? [after.owner]
        : undefined
  const source = after.sources[0]
  return {
    id: live?.id ?? r.id,
    title: after.title,
    summary,
    ...(body ? { body } : {}),
    domain: domain ?? live?.domain ?? '',
    kind: kind ?? live?.kind ?? 'note',
    where: after.scope,
    ...(sameScope && live.scope ? { scope: live.scope } : {}),
    valid: after.validity,
    when: whenLabel(after.validity),
    status: 'Live',
    checkedBy: '',
    checkedOn: '',
    source: source?.url ?? '',
    quote: source?.quote ?? '',
    dontConclude: after.dontConclude,
    ...(owners ? { owners } : {}),
  }
}
