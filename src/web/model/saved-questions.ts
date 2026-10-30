import { stateLabel, type Answer } from './ask'
import type { DomainId } from './items'

// Saved questions as the app reads them (src/web/api): a question an owner keeps, with the answer
// it should get. After every change that can move an answer (a publish, an archive, a restore, a
// sync, or a check date passing) each one is checked again, for free and the same way every time:
// it checks what agents get, not how an agent words it. The result is Same, Changed (the answer
// moved, not worse) or Needs a look (worse).
//
// One source for every count of them: the Overview cell, Quality, the domain page's health line and
// the sidebar's badge all read the one list, so they can never disagree.

export type SavedResult = 'same' | 'changed' | 'look'
export const RESULT_WORDS: Record<SavedResult, string> = {
  same: 'Same',
  changed: 'Changed',
  look: 'Needs a look',
}

export type SavedQuestion = {
  id: string
  question: string
  domain: DomainId
  savedBy: string
  /** What it should get, in plain words, as the person saved it. */
  expect: string
  result: SavedResult
  /** Why, in a sentence. */
  why: string
  /** When it was last checked. */
  when: string
  /** The item the answer comes from, or came from. */
  factId: string
  /** Before and now, for a result that moved. */
  diff?: { saved: string; now: string }
}

export type SavedCounts = {
  total: number
  same: number
  changed: number
  look: number
  domains: number
}

/** The counts every place shows, from the one list: all of it, or one domain's. */
export function savedCounts(all: SavedQuestion[], domain?: DomainId): SavedCounts {
  const qs = domain ? all.filter((q) => q.domain === domain) : all
  return {
    total: qs.length,
    same: qs.filter((q) => q.result === 'same').length,
    changed: qs.filter((q) => q.result === 'changed').length,
    look: qs.filter((q) => q.result === 'look').length,
    domains: new Set(qs.map((q) => q.domain)).size,
  }
}

/** What the answer should keep getting, in plain words, from what it gets now. */
export function expectationOf(a: Answer) {
  if (!a.state) return 'Nothing was looked up, so there is nothing to keep checking.'
  if (a.state === 'missing') return 'Not found, until someone writes it.'
  const n = a.sources.length
  return `${stateLabel[a.state]}, from ${n === 1 ? 'the item' : `the ${n} items`} it answers from today.`
}
