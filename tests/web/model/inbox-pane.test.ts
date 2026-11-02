import { describe, expect, it } from 'vitest'
import { cards } from '@/api/mock/data/inbox'
import { reviewFor, reviews } from '@/api/mock/data/review'
import { follows, paneState, primaryLabel, reviewFollows } from '@/model/inbox-pane'
import type { Review } from '@/model/review'

// What the Inbox pane says before anyone opens the review, for every kind of card in the demo:
// the state on its chip, the name of its one button, and the words beside that button.

const card = (id: string) => cards.find((c) => c.id === id)!
const r = (id: string) => reviewFor(id)!
const pane = (id: string) => ({
  state: paneState(card(id), reviewFor(id)),
  primary: primaryLabel(card(id), reviewFor(id)),
  follows: follows(card(id), reviewFor(id)),
})

describe('the state on the chip', () => {
  it("is the card's own word, and Conflict for a suggestion that clashes with live context", () => {
    expect(pane('sug-ines').state).toEqual({
      label: 'Suggestion',
      icon: 'suggestion',
      tone: 'neutral',
    })
    expect(pane('sug-sofia-clash').state).toEqual({
      label: 'Conflict',
      icon: 'conflict',
      tone: 'warn',
    })
    expect(pane('gap-spain').state.label).toBe('Not found')
    expect(pane('gap-germany').state.label).toBe('Not found')
    expect(pane('flag-germany').state.label).toBe('Reported')
    expect(pane('look-sales').state.label).toBe('Needs a look')
    expect(pane('alert-orders-norway').state.label).toBe('Alert')
    expect(pane('check-returns').state.label).toBe('Due for a check')
  })

  it('is tinted only where something needs care', () => {
    const tinted = cards.filter((c) => paneState(c, reviewFor(c.id)).tone === 'warn')
    expect(tinted.map((c) => c.id)).toEqual(['sug-sofia-clash'])
  })
})

describe('the one button', () => {
  it('names the decision a review opens', () => {
    expect(pane('sug-ines').primary).toBe('Review')
    expect(pane('sug-sofia-clash').primary).toBe('Decide how they relate')
    expect(pane('gap-spain').primary).toBe('Check the draft')
  })

  it("keeps a card's own action when there is no review", () => {
    expect(pane('gap-germany').primary).toBe('Write context')
    expect(pane('check-returns').primary).toBe('Still true')
    expect(pane('look-sales').primary).toBe('Open in Quality')
    expect(pane('alert-orders-norway').primary).toBe('Open the topic')
    expect(pane('flag-germany').primary).toBe('Open the context item')
  })
})

describe('the words beside the button', () => {
  it('say what follows from it', () => {
    expect(pane('sug-ines').follows).toBe('12 questions a week would get the new answer')
    expect(pane('sug-sofia-clash').follows).toBe('Publishing waits until you say how they relate')
    expect(pane('gap-spain').follows).toBe('Check the 2 claims, then publish')
    expect(pane('sug-agent').follows).toMatch(/^Check the \d+ claims, then publish$/)
    expect(pane('sug-lars-retire').follows).toBe('Lars Dahl took it back in the comments')
    expect(pane('sug-ines-format').follows).toBe('Agents keep the same answer')
    expect(pane('gap-germany').follows).toBe('The editor opens on Orders, Germany')
    expect(pane('check-returns').follows).toBe('It counts as checked today, by you')
    expect(pane('look-sales').follows).toBe('Quality shows before and now for each')
  })

  it('never say a zero count (copy rule 2.11)', () => {
    for (const x of reviews) {
      const none: Review = { ...x, tryIt: { ...x.tryIt, reach: 0 } }
      expect(reviewFollows(none), x.id).not.toMatch(/\b0\b/)
    }
    const once: Review = { ...r('sug-ines'), tryIt: { ...r('sug-ines').tryIt, reach: 1 } }
    expect(reviewFollows(once)).toBe('1 question a week would get the new answer')
    const none: Review = { ...r('sug-ines'), tryIt: { ...r('sug-ines').tryIt, reach: 0 } }
    expect(reviewFollows(none)).toBe('Agents would get the new answer')
  })

  it('are short enough to read beside a button', () => {
    for (const c of cards) {
      const words = follows(c, reviewFor(c.id))
      if (words) expect(words.split(' ').length, c.id).toBeLessThanOrEqual(10)
    }
  })
})
