import type { InboxCard } from '@/model/inbox'
import type { Review } from '@/model/review'
import type { SavedQuestion, SavedResult } from '@/model/saved-questions'

// The check, against a draft: before Publish, the review shows what the saved questions that answer
// from this item would get with it. Shown only, never stored. It never stops Publish: it says it,
// and a draft that would make one worse reads "A draft to check" instead of a plain Ready.
//
// Publishing then stores what the draft showed: a question shown as Changed takes the new answer as
// its saved one (that was the point of the change); one that would need a look is marked so, and
// stays marked until someone fixes the item or keeps the new answer.

export type DraftResult = {
  q: SavedQuestion
  result: SavedResult
  why: string
  before: string
  now: string
}
export type DraftCheck = { results: DraftResult[]; same: number; changed: number; look: number }

/** The item a review lands on or takes away, as its Inbox card names it. */
export const itemOfReview = (r: Review, cards: Pick<InboxCard, 'id' | 'factId'>[]) =>
  r.retire?.factId ?? cards.find((c) => c.id === r.id)?.factId

/**
 * What the saved questions that answer from `item` (the review's, itemOfReview) would get with it.
 * Where the service checked the draft itself (`r.saved`), its results are the ones shown.
 */
export function checkDraft(
  r: Review,
  all: SavedQuestion[],
  item: string | undefined,
): DraftCheck | null {
  if (r.saved) {
    const results = r.saved.flatMap((x): DraftResult[] => {
      const q = all.find((y) => y.id === x.id)
      return q ? [{ q, result: x.result, why: x.why, before: x.before, now: x.now }] : []
    })
    return results.length ? countsOf(results) : null
  }
  if (!item) return null
  const qs = all.filter((q) => q.factId === item)
  if (!qs.length) return null
  const results = qs.map((q): DraftResult => {
    // Archiving the item it answers from: agents would hear nothing is written down.
    if (r.retire)
      return {
        q,
        result: 'look',
        why: 'With its item gone, agents would hear nothing is written down.',
        before: r.tryIt.before.text,
        now: r.tryIt.after.text,
      }
    if (r.formattingOnly || r.tryIt.after.text === r.tryIt.before.text)
      return {
        q,
        result: 'same',
        why: 'Same items, same sentence.',
        before: r.tryIt.before.text,
        now: r.tryIt.after.text,
      }
    return {
      q,
      result: 'changed',
      why: 'The sentence agents get has new words. Still based on checked context.',
      before: r.tryIt.before.text,
      now: r.tryIt.after.text,
    }
  })
  return countsOf(results)
}

const countsOf = (results: DraftResult[]): DraftCheck => ({
  results,
  same: results.filter((x) => x.result === 'same').length,
  changed: results.filter((x) => x.result === 'changed').length,
  look: results.filter((x) => x.result === 'look').length,
})

/** "1 of 1 still answers the same", "2 of 3 still answer the same. 1 needs a look." */
export function draftLine(c: DraftCheck) {
  const n = c.results.length
  const head = `${c.same} of ${n} still ${n === 1 ? 'answers' : 'answer'} the same.`
  const rest = [
    c.changed && `${c.changed} changed`,
    c.look && `${c.look} ${c.look === 1 ? 'needs' : 'need'} a look`,
  ]
    .filter(Boolean)
    .join(', ')
  return rest ? `${head} ${rest.charAt(0).toUpperCase()}${rest.slice(1)}.` : head
}

/* ---------- a gap's draft: also save its question ---------- */

const alsoSave = new Map<string, boolean>()
/** On by default: a gap's question is worth keeping once it is answered. Publish sends the choice. */
export const savesQuestion = (id: string) => alsoSave.get(id) ?? true
export const setSavesQuestion = (id: string, on: boolean) => alsoSave.set(id, on)
