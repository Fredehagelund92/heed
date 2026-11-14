import { describe, expect, it } from 'vitest'
import {
  mayDo,
  reviewActions,
  type ReviewActionsInput,
} from '../../../src/domain/review-actions.ts'

/*
  What a person may do with a suggestion in review, and which action leads. One row per kind of
  suggestion, so the panel, the phone's bar and the key cannot each work it out differently. The
  rules follow the service: a suggestion to archive is archived or closed, never returned; Publish
  waits for a clash with no answer, and a stale suggestion is returned or closed, not sent out.
*/

const plain: ReviewActionsInput = {
  mode: 'edit',
  withdrawn: false,
  stale: false,
  clashes: 0,
  claimsToCheck: 0,
  drafted: false,
}
const input = (patch: Partial<ReviewActionsInput>): ReviewActionsInput => ({ ...plain, ...patch })

describe('what may be done with a suggestion', () => {
  const rows: [string, Partial<ReviewActionsInput>, ReturnType<typeof reviewActions>][] = [
    [
      'a plain change',
      {},
      { can: ['publish', 'return'], primary: 'publish', blockedBy: {}, ready: true },
    ],
    [
      'a new item',
      { mode: 'new' },
      { can: ['publish', 'return'], primary: 'publish', blockedBy: {}, ready: true },
    ],
    [
      'a change with claims to check: Return leads, Publish anyway stays',
      { claimsToCheck: 2 },
      { can: ['publish', 'return'], primary: 'return', blockedBy: {}, ready: false },
    ],
    [
      'a draft for a Not found card: published or edited, never returned',
      { mode: 'new', drafted: true },
      { can: ['publish'], primary: 'publish', blockedBy: {}, ready: true },
    ],
    [
      'a draft with claims still leads with Publish',
      { mode: 'new', drafted: true, claimsToCheck: 3 },
      { can: ['publish'], primary: 'publish', blockedBy: {}, ready: true },
    ],
    [
      'a clash with no answer holds Publish',
      { clashes: 2 },
      {
        can: ['publish', 'return'],
        primary: 'publish',
        blockedBy: { publish: 'clash' },
        ready: false,
      },
    ],
    [
      'claims and a clash: Return leads, Publish anyway waits',
      { clashes: 1, claimsToCheck: 1 },
      {
        can: ['publish', 'return'],
        primary: 'return',
        blockedBy: { publish: 'clash' },
        ready: false,
      },
    ],
    [
      'a change written against an earlier version: Return leads, Publish waits',
      { stale: true },
      {
        can: ['publish', 'return'],
        primary: 'return',
        blockedBy: { publish: 'stale' },
        ready: false,
      },
    ],
    [
      'a suggestion to archive: archived, or closed with a reason; never returned or published',
      { mode: 'retire' },
      { can: ['archive', 'close'], primary: 'archive', blockedBy: {}, ready: true },
    ],
    [
      'a suggestion to archive written against an earlier version: closed, not archived',
      { mode: 'retire', stale: true },
      { can: ['archive', 'close'], primary: 'close', blockedBy: { archive: 'stale' }, ready: true },
    ],
    [
      'a suggestion to archive its sender took back: closed, or archived anyway',
      { mode: 'retire', withdrawn: true },
      { can: ['archive', 'close'], primary: 'close', blockedBy: {}, ready: true },
    ],
  ]
  for (const [name, patch, expected] of rows)
    it(`for ${name}`, () => {
      expect(reviewActions(input(patch))).toEqual(expected)
    })

  it('never offers Return where the service refuses it', () => {
    for (const withdrawn of [false, true])
      for (const claimsToCheck of [0, 2])
        for (const clashes of [0, 1])
          expect(
            reviewActions(input({ mode: 'retire', withdrawn, claimsToCheck, clashes })).can,
          ).not.toContain('return')
  })

  it('never holds an archive or a close for a clash', () => {
    const retire = reviewActions(input({ mode: 'retire', withdrawn: true, clashes: 2 }))
    expect(retire.blockedBy).toEqual({})
    expect(mayDo(retire, 'close')).toBe(true)
    expect(mayDo(retire, 'archive')).toBe(true)
  })

  it('answers whether one action may be done now', () => {
    const held = reviewActions(input({ clashes: 1 }))
    expect(mayDo(held, 'publish')).toBe(false)
    expect(mayDo(held, 'return')).toBe(true)
    expect(mayDo(held, 'archive')).toBe(false)
    expect(mayDo(held, 'close')).toBe(false)
    expect(mayDo(reviewActions(input({ clashes: 0 })), 'publish')).toBe(true)
  })
})
