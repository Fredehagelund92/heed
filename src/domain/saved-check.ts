/**
 * The free check of a saved question (FR-526, docs/product.md, section 10): a question an owner or
 * an administrator keeps for a domain, with the answer it should keep getting. After every change
 * that can move an answer (a publish, an archive, a restore, a sync, a check date passing) the
 * answer engine answers it again on what agents get now, with no model, and this compares the
 * two: Same, Changed (the answer moved and is no worse) or Needs a look (it got worse, or an item
 * it should answer from is gone). A check that could not run is a failure of the run, never a
 * result. A check never blocks a publish.
 *
 * It compares what agents get, not how an agent words it: the answer state and the items given,
 * by their title and the sentence agents read (their summary). Pure: the service runs the engine
 * and stores what it gives; the app reads the words below.
 */
import { answerLine, type AnswerState } from './answer-state.ts'

/** The results of a check, in the order Quality lists them last to first. */
export const savedResults = ['same', 'changed', 'look'] as const
export type SavedResult = (typeof savedResults)[number]

/**
 * Why a result is what it is. Same: it was just `saved`, it answers the `same`, its new answer
 * was `kept`, or a publish of the item it answers from made the new answer its saved one
 * (`published`). Changed: the sentence has new `words`, it answers from other `items`, or it
 * answers `better`. Needs a look: it got `worse`, or an item it should answer from is `gone`.
 */
export const savedReasons = [
  'saved',
  'same',
  'kept',
  'published',
  'words',
  'items',
  'better',
  'worse',
  'gone',
] as const
export type SavedReason = (typeof savedReasons)[number]

/** What starts a check: a question saved, a new answer kept, a change agents get, or Check now. */
export const checkTriggers = [
  'saved',
  'kept',
  'publish',
  'archive',
  'restore',
  'sync',
  'check_date',
  'manual',
] as const
export type CheckTrigger = (typeof checkTriggers)[number]

/** An item an answer gave, as the check keeps it: what agents read of it. */
export type SavedItem = {
  id: string
  title: string
  summary: string
  /** Why it may be out of date, when it may be (FR-349's Outdated). */
  unverified: 'needs_check' | 'source_missing' | 'past_review_date' | null
}

/** An answer as the check keeps it: its state, the items it gave, and what a person hears. */
export type SavedAnswer = { state: AnswerState; items: SavedItem[]; say: string }

/** The answer engine's answer (src/domain/answer.ts), as the check keeps it. */
export function savedAnswerOf(a: {
  state: AnswerState
  say: string
  items: readonly {
    id: string
    title: string
    summary: string
    unverifiedReason: SavedItem['unverified']
  }[]
}): SavedAnswer {
  return {
    state: a.state,
    say: a.say,
    items: a.items.map((i) => ({
      id: i.id,
      title: i.title,
      summary: i.summary,
      unverified: i.unverifiedReason,
    })),
  }
}

/**
 * How sure an answer is, best first: Checked; Partial, which covers part of it; Outdated, which
 * may be wrong; Conflict, which says two things; Not found; and Not checked, which could not run.
 * An answer that moves down this list needs a look.
 */
const certainty: Record<AnswerState, number> = {
  grounded: 0,
  partial: 1,
  stale: 2,
  conflict: 3,
  missing: 4,
  failed: 5,
}

const byId = (items: readonly SavedItem[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))
const sameItems = (a: readonly SavedItem[], b: readonly SavedItem[]) => {
  if (a.length !== b.length) return false
  const x = byId(a)
  const y = byId(b)
  return x.every((i, n) => i.id === y[n]!.id)
}
const sameWords = (a: readonly SavedItem[], b: readonly SavedItem[]) => {
  const y = new Map(b.map((i) => [i.id, i]))
  return a.every((i) => y.get(i.id)?.title === i.title && y.get(i.id)?.summary === i.summary)
}

const newlyUnverified = (saved: SavedAnswer, now: SavedAnswer) =>
  now.items.find((i) => i.unverified && !saved.items.find((x) => x.id === i.id)?.unverified)

/**
 * The result of a check: `now` against the answer the question should keep getting (`saved`),
 * with the items it should answer from (`expect`, a person may leave some out when saving).
 * A worse state, or an expected item that is no longer given, needs a look; anything else that
 * moved is Changed.
 */
export function compareSaved(
  saved: SavedAnswer,
  now: SavedAnswer,
  expect: readonly string[],
): { result: SavedResult; reason: SavedReason } {
  if (certainty[now.state] > certainty[saved.state]) return { result: 'look', reason: 'worse' }
  // An item that may be out of date now, though it was not when saved: its check date passed, or
  // its source changed. A Partial answer stays Partial, but it needs a look all the same.
  if (newlyUnverified(saved, now)) return { result: 'look', reason: 'worse' }
  const given = new Set(now.items.map((i) => i.id))
  if (expect.some((id) => !given.has(id))) return { result: 'look', reason: 'gone' }
  const items = sameItems(saved.items, now.items)
  if (items && sameWords(saved.items, now.items) && saved.state === now.state)
    return { result: 'same', reason: 'same' }
  if (certainty[now.state] < certainty[saved.state]) return { result: 'changed', reason: 'better' }
  if (!items) return { result: 'changed', reason: 'items' }
  return { result: 'changed', reason: 'words' }
}

/** What an answer says, for before and now: the sentences of its items, or what a person hears. */
export const answerText = (a: SavedAnswer) =>
  a.items.length ? a.items.map((i) => i.summary).join(' ') : a.say

/** What starts a check, from the reason the newest edition was published for (editions/release.ts). */
export function triggerOfEdition(reason: string): CheckTrigger {
  if (reason === 'item_retired' || reason === 'area_deleted') return 'archive'
  if (reason === 'item_restored' || reason === 'area_restored' || reason === 'decision_undone')
    return 'restore'
  if (reason === 'vocabulary_changed') return 'sync'
  return 'publish'
}

const label = (state: AnswerState) => answerLine(state).label
const still: Record<AnswerState, string> = {
  grounded: 'Still based on checked context.',
  partial: 'Still covers only part of it.',
  stale: 'Still may be out of date.',
  conflict: 'Still two items disagree.',
  missing: 'Still nothing written down.',
  failed: 'Still not checked.',
}
const outdated: Record<NonNullable<SavedItem['unverified']>, string> = {
  past_review_date: 'The item it answers from has a check date that passed.',
  needs_check: 'A definition the item it answers from relies on changed at its source.',
  source_missing: 'A definition the item it answers from relies on is gone from its source.',
}
const itemCount = (n: number) => (n === 1 ? '1 item' : `${n} items`)

/** Why, in a sentence, for Quality, the review and the domain's page (docs/design/copy.md). */
export function savedWhy(r: {
  reason: SavedReason
  saved: SavedAnswer
  now: SavedAnswer
  expect: readonly string[]
}): string {
  const { saved, now } = r
  switch (r.reason) {
    case 'saved':
      return 'Just saved: it is checked again after the next change.'
    case 'same':
      return 'Same items, same sentence.'
    case 'kept':
      return 'The new answer is kept as the saved one.'
    case 'published':
      return 'This publish is its new saved answer.'
    case 'words':
      return `The sentence agents get has new words. ${still[now.state]}`
    case 'items':
      return `It answers from other items now. ${still[now.state]}`
    case 'better':
      return `It was ${label(saved.state)} when saved. Now it is ${label(now.state)}.`
    case 'gone': {
      const given = new Set(now.items.map((i) => i.id))
      const n = r.expect.filter((id) => !given.has(id)).length
      return n === 1
        ? 'An item it should answer from is no longer in the answer.'
        : `${n} items it should answer from are no longer in the answer.`
    }
    case 'worse': {
      if (now.state === 'missing')
        return saved.items.length
          ? `Used to answer from ${itemCount(saved.items.length)}. Now it says nothing is written down.`
          : 'Now it says nothing is written down.'
      const why = (newlyUnverified(saved, now) ?? now.items.find((i) => i.unverified))?.unverified
      if (why && certainty[now.state] <= certainty.stale) return outdated[why]
      return `It was ${label(saved.state)} when saved. Now it is ${label(now.state)}.`
    }
  }
}

/** What a saved question should keep getting, in plain words, as Quality says it. */
export function expectWords(saved: SavedAnswer, expect: readonly string[]) {
  const titles = saved.items.filter((i) => expect.includes(i.id)).map((i) => i.title)
  if (saved.state === 'missing' || !titles.length) return 'Not found, until someone writes it.'
  return `${label(saved.state)}, from ${titles.join(' and ')}.`
}
