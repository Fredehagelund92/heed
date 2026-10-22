import { describe, expect, it } from 'vitest'
import { streamTopics } from '@/api/live'
import {
  notificationSentence,
  notificationTarget,
  sentenceText,
  sentenceWithNote,
  type NotificationLine,
} from '@/lib/notifications'

/* The words of each notification (slice W7) and where one leads. */

const line = (overrides: Partial<NotificationLine> = {}): NotificationLine => ({
  kind: 'proposal.claimed',
  state: 'in_review',
  title: 'Units sold lags by two days in the source tool',
  actor: { id: 'per_jon', name: 'Jon Abara' },
  subject: { type: 'proposal', id: 'p1' },
  ...overrides,
})

const say = (overrides: Partial<NotificationLine>) =>
  sentenceText(notificationSentence(line(overrides)))

describe('notificationSentence', () => {
  const T = 'Units sold lags by two days in the source tool'

  it('says who did what, and to which proposal', () => {
    expect(say({})).toBe(`Jon Abara claimed the review: ${T}`)
    expect(say({ kind: 'proposal.submitted', actor: { id: 'm', name: 'Maria Lindqvist' } })).toBe(
      `Maria Lindqvist sent a proposal for review: ${T}`,
    )
    expect(say({ kind: 'proposal.handed_over' })).toBe(`Jon Abara handed the review to you: ${T}`)
    expect(say({ kind: 'proposal.withdrawn' })).toBe(`Jon Abara withdrew the proposal: ${T}`)
    expect(say({ kind: 'proposal.commented' })).toBe(`Jon Abara commented: ${T}`)
  })

  it('names the decision from the state it left the proposal in', () => {
    expect(say({ kind: 'proposal.decided', state: 'accepted' })).toBe(
      `Jon Abara accepted the proposal: ${T}`,
    )
    expect(say({ kind: 'proposal.decided', state: 'changes_requested' })).toBe(
      `Jon Abara asked for changes: ${T}`,
    )
    expect(say({ kind: 'proposal.decided', state: 'rejected' })).toBe(
      `Jon Abara rejected the proposal: ${T}`,
    )
    expect(say({ kind: 'proposal.decided', state: null })).toBe(
      `Jon Abara decided on the proposal: ${T}`,
    )
    expect(say({ kind: 'proposal.approved', state: 'in_review' })).toBe(
      `Jon Abara accepted the proposal. It needs one more yes before agents get it: ${T}`,
    )
  })

  it('names no person for what the definition source changed', () => {
    const flagged = notificationSentence(
      line({
        kind: 'item.flagged',
        state: 'source_missing',
        actor: null,
        subject: { type: 'item', id: 'itm_1' },
        title: 'Net revenue excludes discounts',
      }),
    )
    expect(flagged).toEqual({
      actor: null,
      action: 'A definition this fact uses is gone from its source',
      subject: 'Net revenue excludes discounts',
    })
    expect(
      say({
        kind: 'vocabulary.domain_changed',
        subject: { type: 'vocabulary', id: 'metric:orders' },
        title: 'Orders',
      }),
    ).toBe('Its source moved this name to another domain: Orders')
  })

  it('names no person for a gap a run verified, and no test either', () => {
    expect(
      notificationSentence(
        line({
          kind: 'gap.verified',
          state: null,
          actor: null,
          subject: { type: 'gap', id: '0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b' },
          title: null,
        }),
      ),
    ).toEqual({
      actor: null,
      action: 'A question that had no answer now gets one',
      subject: 'A gap in a domain you own',
    })
  })

  it('says what the subject is when its title is not shown', () => {
    expect(say({ title: null })).toBe(
      'Jon Abara claimed the review: A proposal you can no longer see',
    )
    expect(say({ actor: null })).toBe(`Someone claimed the review: ${T}`)
    expect(
      say({
        kind: 'edition.published',
        subject: { type: 'edition', id: '2026-10-07.2' },
        title: null,
      }),
    ).toBe('Jon Abara updated what agents get: 7 October 2026')
    expect(say({ kind: 'eval.scorecard', actor: null })).toBe('New answer test results are ready')
  })

  it('has words for every topic and for one it does not know', () => {
    for (const kind of streamTopics) expect(say({ kind }).length).toBeGreaterThan(10)
    expect(say({ kind: 'gap.opened' })).toBe(`Something changed: ${T}`)
  })
})

describe('notificationTarget', () => {
  it('leads to the proposal, the item, the term or the edition', () => {
    expect(notificationTarget({ type: 'proposal', id: 'p1' }, true)).toEqual({
      to: '/proposals/$proposalId',
      params: { proposalId: 'p1' },
    })
    expect(notificationTarget({ type: 'item', id: 'itm_1' }, true)).toEqual({
      to: '/library/$itemId',
      params: { itemId: 'itm_1' },
    })
    expect(notificationTarget({ type: 'vocabulary', id: 'metric:orders' }, true)).toEqual({
      to: '/catalogue/metric/$id',
      params: { id: 'orders' },
    })
    expect(notificationTarget({ type: 'vocabulary', id: 'dim:market' }, true)).toEqual({
      to: '/catalogue/dimension/$id',
      params: { id: 'market' },
    })
    expect(notificationTarget({ type: 'edition', id: '2026-10-07.2' }, true)).toEqual({
      to: '/editions/$label',
      params: { label: '2026-10-07.2' },
    })
  })

  it('opens a gap in Health', () => {
    const id = '0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b'
    expect(notificationTarget({ type: 'gap', id }, false)).toEqual({
      to: '/health',
      search: { open: `gap:${id}` },
    })
  })

  it('links an edition only for someone who may open Editions', () => {
    expect(notificationTarget({ type: 'edition', id: '2026-10-07.2' }, false)).toBeNull()
    expect(notificationTarget({ type: 'proposal', id: 'p1' }, false)).not.toBeNull()
  })

  it('leads nowhere for a subject without a page', () => {
    expect(notificationTarget({ type: 'inbox', id: 'per_maria' }, true)).toBeNull()
    expect(notificationTarget({ type: 'vocabulary', id: 'val:market/norway' }, true)).toBeNull()
  })
})

describe('sentenceWithNote', () => {
  const asked = notificationSentence(line({ kind: 'proposal.decided', state: 'changes_requested' }))

  it('quotes the note after the sentence, with one stop between them', () => {
    expect(sentenceWithNote(asked, 'Add the source.')).toBe(
      'Jon Abara asked for changes: Units sold lags by two days in the source tool. “Add the source.”',
    )
    const ended = notificationSentence(
      line({
        kind: 'proposal.decided',
        state: 'changes_requested',
        title: 'Online sales stopped.',
      }),
    )
    expect(sentenceWithNote(ended, 'Add the source.')).toBe(
      'Jon Abara asked for changes: Online sales stopped. “Add the source.”',
    )
  })

  it('is the sentence alone without a note', () => {
    expect(sentenceWithNote(asked, null)).toBe(sentenceText(asked))
  })
})
