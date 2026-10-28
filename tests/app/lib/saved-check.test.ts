import { describe, expect, it } from 'vitest'
import { cards } from '@/api/mock/data/inbox'
import { reviewFor } from '@/api/mock/data/review'
import { savedSeed } from '@/api/mock/data/saved-questions'
import { createSaved } from '@/api/mock/saved'
import { checkDraft, draftLine, itemOfReview } from '@/lib/saved-check'
import { savedCounts } from '@/model/saved-questions'
import type { Review } from '@/model/review'

// The check against a draft: what the saved questions that answer from an item would get with it.
// Shown before Publish, stored after, and Undo takes it back.

const check = (r: Review) => checkDraft(r, savedSeed, itemOfReview(r, cards))

describe("a draft's check", () => {
  it('marks a question Changed when the sentence moves and the state holds', () => {
    const c = check(reviewFor('sug-ines')!)!
    expect(c.results.map((x) => [x.q.id, x.result])).toEqual([['sq-test-accounts', 'changed']])
    expect(draftLine(c)).toBe('0 of 1 still answers the same. 1 changed.')
  })

  it('marks a question Needs a look when its item would be archived', () => {
    const c = check(reviewFor('sug-lars-retire')!)!
    expect(c.look).toBe(1)
    expect(draftLine(c)).toBe('0 of 1 still answers the same. 1 needs a look.')
  })

  it('has nothing to say about an item no saved question answers from', () => {
    expect(check(reviewFor('gap-spain')!)).toBeNull()
  })

  it('shows the service’s own check where it gave one, for the questions the person sees', () => {
    const r: Review = {
      ...reviewFor('sug-ines')!,
      saved: [
        { id: 'sq-test-accounts', result: 'look', why: 'Worse.', before: 'A.', now: 'B.' },
        { id: 'sq-not-listed', result: 'same', why: 'Same.', before: 'A.', now: 'A.' },
      ],
    }
    const c = check(r)!
    expect(c.results.map((x) => [x.q.id, x.result, x.why])).toEqual([
      ['sq-test-accounts', 'look', 'Worse.'],
    ])
    expect(draftLine(c)).toBe('0 of 1 still answers the same. 1 needs a look.')
    expect(check({ ...r, saved: [] })).toBeNull()
  })
})

describe('after a publish', () => {
  it('keeps a Changed answer as the new saved one, and Undo puts it back', () => {
    const saved = createSaved()
    const before = savedCounts(saved.list())
    const undo = saved.afterPublish(
      reviewFor('sug-ines')!,
      'Jon Abara',
      'itm_s90n5xps',
      'sales',
      true,
    )
    expect(saved.list().find((q) => q.id === 'sq-test-accounts')?.why).toBe(
      'This publish is its new saved answer.',
    )
    undo()
    expect(savedCounts(saved.list())).toEqual(before)
  })

  it("saves a gap's question when the box is ticked, and not when it isn't", () => {
    const saved = createSaved()
    const n = saved.list().length
    const undo = saved.afterPublish(
      reviewFor('gap-spain')!,
      'Jon Abara',
      'itm_gap_spain',
      'sales',
      true,
    )
    expect(saved.list()).toHaveLength(n + 1)
    expect(saved.list()[0]!.question).toBe('What happened to Orders in Spain, October 2026?')
    undo()
    expect(saved.list()).toHaveLength(n)
    saved.afterPublish(reviewFor('gap-spain')!, 'Jon Abara', 'itm_gap_spain', 'sales', false)
    expect(saved.list()).toHaveLength(n)
  })
})
