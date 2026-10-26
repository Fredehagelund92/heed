import * as React from 'react'
import { stateLabel, type Answer } from '@/data/ask'
import type { DomainId } from '@/data/world'

// Saved questions: a question an owner keeps, with the answer it should get. After every change
// that can move an answer (a publish, an archive, a restore, a sync, or a check date passing) each
// one is checked again, for free and the same way every time: it checks what agents get, not how an
// agent words it. The result is Same, Changed (the answer moved, not worse) or Needs a look (worse).
//
// One source for every count of them: the Overview cell, Quality, the domain page's health line and
// the sidebar's badge all read this list, so they can never disagree.

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

const seed: SavedQuestion[] = [
  {
    id: 'sq-support-norway',
    question: 'Why did support contacts in Norway rise in autumn 2025?',
    domain: 'sales',
    savedBy: 'Jon Abara',
    expect: 'Checked: the payment provider switch in Norway on 9 July 2025.',
    result: 'look',
    why: 'Used to answer from 1 item. Now it says nothing is written down.',
    when: 'Today, 09:41',
    factId: 'itm_kh4llvi9',
    diff: {
      saved:
        'We moved Norway payments to a new provider on 9 July 2025, and customers had to add their cards again.',
      now: 'Not found. The item it answered from is archived.',
    },
  },
  {
    id: 'sq-gross-margin',
    question: 'What should I rule out before explaining a jump in gross margin?',
    domain: 'sales',
    savedBy: 'Sofia Brandt',
    expect: 'Checked: the guide for a jump in gross margin.',
    result: 'look',
    why: 'The item it answers from has a check date that passed.',
    when: 'Today, 07:00',
    factId: 'itm_kcy22j54',
    diff: {
      saved: 'Checked: What to rule out before explaining a jump in Gross margin.',
      now: 'Outdated: the same item, its check date passed on 22 Oct.',
    },
  },
  {
    id: 'sq-norway-august',
    question: 'Why did orders in Norway drop in August?',
    domain: 'sales',
    savedBy: 'Jon Abara',
    expect: 'Checked: the customs stop on 4 August 2026.',
    result: 'changed',
    why: 'The sentence agents get has new words. Still based on checked context.',
    when: 'Tue 20 Oct',
    factId: 'itm_norway_stop',
    diff: {
      saved: 'A new customs rule stopped online sales to Norway from 4 August 2026.',
      now: 'A new customs rule stopped all online sales to Norway from 4 August 2026, so orders there fell to almost nothing.',
    },
  },
  same(
    'sq-gift-cards',
    'Do Norway orders include gift cards?',
    'sales',
    'Jon Abara',
    'itm_gift_card_only',
  ),
  same(
    'sq-store-credit',
    'Does Norway count store credit in orders?',
    'sales',
    'Sofia Brandt',
    'itm_gift_store_credit',
  ),
  same(
    'sq-early-orders',
    'Can I compare orders from before 19 January 2026?',
    'sales',
    'Jon Abara',
    'itm_r6lyl1pc',
  ),
  same(
    'sq-test-accounts',
    'Do units sold include test accounts?',
    'sales',
    'Sofia Brandt',
    'itm_s90n5xps',
  ),
  same(
    'sq-promotions-norway',
    'Were price promotions paused in Norway in May?',
    'marketing',
    'Tomas Eriksen',
    'itm_za26xpzv',
  ),
  same(
    'sq-vat-norway',
    'Which VAT rate applies in Norway?',
    'marketing',
    'Tomas Eriksen',
    'itm_7ini5esz',
  ),
  same(
    'sq-new-customers',
    "Why are yesterday's new customers short?",
    'customer_value',
    'Noor Haddad',
    'itm_p9lchmy0',
  ),
  same(
    'sq-spain-provider',
    'Did the payment provider change in Spain?',
    'customer_value',
    'Alex Moreau',
    'itm_m84x8rur',
  ),
  same(
    'sq-roas-campaign',
    'How do I read return on ad spend for one campaign?',
    'paid_media',
    'Priya Nair',
    'itm_roas_campaign',
  ),
]

function same(
  id: string,
  question: string,
  domain: DomainId,
  savedBy: string,
  factId: string,
): SavedQuestion {
  return {
    id,
    question,
    domain,
    savedBy,
    expect: 'Checked, from the item it answers from today.',
    result: 'same',
    why: 'Same items, same sentence.',
    when: 'Today, 09:41',
    factId,
  }
}

let list: SavedQuestion[] = seed
const listeners = new Set<() => void>()

export const savedQuestions = () => list

export function useSavedQuestions() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => list,
  )
}

/** Saves a question: it answers as saved until the next change says otherwise. */
export function saveQuestion(q: Omit<SavedQuestion, 'result' | 'why' | 'when' | 'id'>) {
  const id = `sq-${list.length + 1}-${q.question
    .toLowerCase()
    .replace(/[^a-z]+/g, '-')
    .slice(0, 24)}`
  list = [
    {
      ...q,
      id,
      result: 'same',
      why: 'Just saved: it is checked again after the next change.',
      when: 'Just now',
    },
    ...list,
  ]
  listeners.forEach((l) => l())
  return id
}

/** Undo for a save, or the owner's own choice to stop checking it. */
export function removeSavedQuestion(id: string) {
  list = list.filter((q) => q.id !== id)
  listeners.forEach((l) => l())
}

/** A check's result, stored: after a publish, or put back by Undo. */
export function setSavedResult(
  id: string,
  r: Pick<SavedQuestion, 'result' | 'why' | 'when' | 'diff'>,
) {
  list = list.map((q) => (q.id === id ? { ...q, ...r } : q))
  listeners.forEach((l) => l())
}

/** Keep the new answer: what it says now becomes what it should say. */
export function keepNewAnswer(id: string) {
  list = list.map((q) =>
    q.id === id
      ? {
          ...q,
          result: 'same',
          why: 'The new answer is kept as the saved one.',
          when: 'Just now',
          diff: undefined,
        }
      : q,
  )
  listeners.forEach((l) => l())
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
  if (a.state === 'missing') return 'Not found, until someone writes it.'
  const n = a.sources.length
  return `${stateLabel[a.state]}, from ${n === 1 ? 'the item' : `the ${n} items`} it answers from today.`
}
