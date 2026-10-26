import { cards } from '@/data/inbox'
import type { Review } from '@/data/review'
import {
  removeSavedQuestion,
  saveQuestion,
  savedQuestions,
  setSavedResult,
  type SavedQuestion,
  type SavedResult,
} from '@/data/saved-questions'

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
export const itemOfReview = (r: Review) =>
  r.retire?.factId ?? cards.find((c) => c.id === r.id)?.factId

export function checkDraft(r: Review, all: SavedQuestion[] = savedQuestions()): DraftCheck | null {
  const item = itemOfReview(r)
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
  return {
    results,
    same: results.filter((x) => x.result === 'same').length,
    changed: results.filter((x) => x.result === 'changed').length,
    look: results.filter((x) => x.result === 'look').length,
  }
}

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
/** On by default: a gap's question is worth keeping once it is answered. */
export const savesQuestion = (id: string) => alsoSave.get(id) ?? true
export const setSavesQuestion = (id: string, on: boolean) => alsoSave.set(id, on)

/**
 * After a publish: store what the draft showed, and save a gap's question if asked. Gives back what
 * takes it all back, for Undo.
 */
export function afterPublish(
  r: Review,
  me: string,
  itemId: string | undefined,
  domain: SavedQuestion['domain'],
): (() => void) | undefined {
  const undo: (() => void)[] = []
  const check = checkDraft(r)
  for (const x of check?.results ?? []) {
    if (x.result === 'same') continue
    const was = { result: x.q.result, why: x.q.why, when: x.q.when, diff: x.q.diff }
    setSavedResult(
      x.q.id,
      x.result === 'changed'
        ? {
            result: 'same',
            why: 'This publish is its new saved answer.',
            when: 'Just now',
            diff: undefined,
          }
        : { result: 'look', why: x.why, when: 'Just now', diff: { saved: x.before, now: x.now } },
    )
    undo.push(() => setSavedResult(x.q.id, was))
  }
  if (r.drafted && savesQuestion(r.id) && itemId) {
    const id = saveQuestion({
      question: `What happened to ${r.drafted.scope}?`,
      domain,
      savedBy: me,
      expect: 'Checked, from the item this draft became.',
      factId: itemId,
    })
    undo.push(() => removeSavedQuestion(id))
  }
  return undo.length ? () => undo.forEach((u) => u()) : undefined
}
