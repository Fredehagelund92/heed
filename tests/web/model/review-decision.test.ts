import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import type { ApiErrorKind } from '@/api/errors'
import {
  decide,
  idle,
  reasonOf,
  sendingOf,
  writingReturn,
  type DecisionEvent,
  type DecisionState,
} from '@/model/review-decision'
import { reviewActions, type ReviewActionsInput } from '@domain/review-actions'

// One row of the decision's transition table per test: the panel and the phone's bar are two views
// of this state, so what a failure retries is the state's own business.

type S = DecisionState<string>
type E = DecisionEvent<string>

const actionsFor = (patch: Partial<ReviewActionsInput>) =>
  reviewActions({
    mode: 'edit',
    withdrawn: false,
    clashes: 0,
    claimsToCheck: 0,
    drafted: false,
    ...patch,
  })
const edit = actionsFor({})
const clashing = actionsFor({ clashes: 1 })
const withdrawn = actionsFor({ mode: 'retire', withdrawn: true })
const retire = actionsFor({ mode: 'retire' })

const note = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const written = note('Which page says 340?')
const clearer = note('Which page says 340? Please link the page.')

const at: S = idle('a')
const sending = (action: 'publish' | 'archive' | 'return' | 'close', words?: JSONContent): S => ({
  kind: 'sending',
  id: 'a',
  action,
  ...(words ? { note: words } : {}),
})
const failed = (
  action: 'publish' | 'archive' | 'return' | 'close',
  reason: string | null = null,
  failure: ApiErrorKind = 'failed',
): S => ({
  kind: 'failed',
  id: 'a',
  action,
  failure,
  reason,
})
const run = (state: S, ...events: E[]) => events.reduce(decide, state)

describe('the decision', () => {
  it('idle: pressing an action that may be done sends it', () => {
    expect(run(at, { type: 'press', action: 'publish', actions: edit })).toEqual(sending('publish'))
    expect(run(at, { type: 'press', action: 'close', actions: withdrawn })).toEqual(
      sending('close'),
    )
  })

  it('idle: an action that is not offered, or is held, is not sent', () => {
    // Return where the service refuses it; Publish while a clash has no answer.
    expect(run(at, { type: 'ask', action: 'return', actions: retire })).toBe(at)
    expect(run(at, { type: 'press', action: 'publish', actions: clashing })).toBe(at)
    expect(run(at, { type: 'press', action: 'close', actions: edit })).toBe(at)
  })

  it('archives and returns only through their own step', () => {
    const asking = run(at, { type: 'ask', action: 'archive', actions: retire })
    expect(asking).toEqual({ kind: 'confirmingArchive', id: 'a' })
    // Archive is never pressed straight from idle: it asks first.
    expect(run(at, { type: 'press', action: 'archive', actions: retire })).toBe(at)
    expect(run(asking, { type: 'press', action: 'archive', actions: retire })).toEqual(
      sending('archive'),
    )
    const writing = run(at, { type: 'ask', action: 'return', actions: edit })
    expect(writing).toEqual({ kind: 'writingReturn', id: 'a' })
    expect(run(at, { type: 'press', action: 'return', actions: edit, note: written })).toBe(at)
    expect(run(writing, { type: 'press', action: 'return', actions: edit, note: written })).toEqual(
      sending('return', written),
    )
  })

  it('cancel goes back to idle from a step or a failure, and from nowhere else', () => {
    expect(run({ kind: 'confirmingArchive', id: 'a' }, { type: 'cancel' })).toEqual(at)
    expect(run({ kind: 'writingReturn', id: 'a' }, { type: 'cancel' })).toEqual(at)
    expect(run(failed('return'), { type: 'cancel' })).toEqual(at)
    const busy = sending('return')
    expect(run(busy, { type: 'cancel' })).toBe(busy)
  })

  it('sending: ok is done, an error is failed with the action and the service’s reason', () => {
    expect(run(sending('publish'), { type: 'ok', id: 'a', done: 'Published' })).toEqual({
      kind: 'done',
      id: 'a',
      done: 'Published',
    })
    expect(
      run(sending('close'), {
        type: 'error',
        id: 'a',
        failure: 'forbidden',
        reason: 'Another owner is reviewing it.',
      }),
    ).toEqual(failed('close', 'Another owner is reviewing it.', 'forbidden'))
  })

  it('a failure keeps its kind, so a session that ended is told apart from a refusal', () => {
    for (const failure of ['signed-out', 'unanswered', 'conflict', 'failed'] as const)
      expect(run(sending('publish'), { type: 'error', id: 'a', failure, reason: null })).toEqual(
        failed('publish', null, failure),
      )
  })

  it('an answer for a suggestion the person has left is not theirs to see', () => {
    const away = run(sending('publish'), { type: 'open', id: 'b' })
    expect(away).toEqual(idle('b'))
    expect(run(away, { type: 'ok', id: 'a', done: 'Published' })).toBe(away)
    expect(run(away, { type: 'error', id: 'a', failure: 'failed', reason: null })).toBe(away)
    // Opening the same suggestion again changes nothing.
    expect(run(sending('publish'), { type: 'open', id: 'a' })).toEqual(sending('publish'))
  })

  it('failed: retry sends the same action, whichever panel asks', () => {
    for (const action of ['publish', 'close'] as const) {
      const actions = action === 'close' ? withdrawn : edit
      expect(run(failed(action), { type: 'retry', actions })).toEqual(sending(action))
    }
  })

  it('failed return: retry sends the note as the editor holds it now, not the one that failed', () => {
    const first = run(
      at,
      { type: 'ask', action: 'return', actions: edit },
      {
        type: 'press',
        action: 'return',
        actions: edit,
        note: written,
      },
    )
    expect(first).toEqual(sending('return', written))
    const refused = run(first, { type: 'error', id: 'a', failure: 'invalid', reason: 'Too long.' })
    expect(run(refused, { type: 'retry', actions: edit, note: clearer })).toEqual(
      sending('return', clearer),
    )
  })

  it('failed return: with nothing in the editor there is nothing to send again', () => {
    const held = failed('return')
    expect(run(held, { type: 'retry', actions: edit })).toBe(held)
    expect(run(held, { type: 'press', action: 'return', actions: edit })).toBe(held)
  })

  it('failed: retry does not send an action that may no longer be done', () => {
    const held = failed('publish')
    expect(run(held, { type: 'retry', actions: clashing })).toBe(held)
  })

  it('failed return: an edited note can be posted again', () => {
    expect(
      run(failed('return'), { type: 'press', action: 'return', actions: edit, note: clearer }),
    ).toEqual(sending('return', clearer))
    expect(
      run(failed('publish'), { type: 'press', action: 'return', actions: edit, note: clearer }),
    ).toEqual(failed('publish'))
  })

  it('failed: a decision can still be returned instead, but not where Return is refused', () => {
    expect(run(failed('publish'), { type: 'ask', action: 'return', actions: edit })).toEqual({
      kind: 'writingReturn',
      id: 'a',
    })
    const closing = failed('close')
    expect(run(closing, { type: 'ask', action: 'return', actions: withdrawn })).toBe(closing)
  })

  it('done: finish goes back to idle, and other events leave it alone', () => {
    const done: S = { kind: 'done', id: 'a', done: 'Published' }
    expect(run(done, { type: 'finish' })).toEqual(at)
    expect(run(done, { type: 'press', action: 'publish', actions: edit })).toBe(done)
    expect(run(done, { type: 'retry', actions: edit })).toBe(done)
  })

  it('does not send twice', () => {
    const busy = sending('publish')
    expect(run(busy, { type: 'press', action: 'publish', actions: edit })).toBe(busy)
    expect(run(busy, { type: 'retry', actions: edit })).toBe(busy)
    expect(run(busy, { type: 'ask', action: 'return', actions: edit })).toBe(busy)
  })

  it('names what is being sent and whether the note is on screen', () => {
    expect(sendingOf(sending('close'))).toBe('close')
    expect(sendingOf(at)).toBeNull()
    expect(writingReturn({ kind: 'writingReturn', id: 'a' })).toBe(true)
    expect(writingReturn(sending('return'))).toBe(true)
    expect(writingReturn(failed('return'))).toBe(true)
    expect(writingReturn(failed('publish'))).toBe(false)
    expect(writingReturn(at)).toBe(false)
  })

  it('gives the service’s reason when it refused, and none when it only failed', () => {
    for (const kind of ['forbidden', 'conflict', 'invalid'] as const)
      expect(reasonOf({ kind, message: 'Say how this relates to “X” first.' })).toBe(
        'Say how this relates to “X” first.',
      )
    for (const kind of ['failed', 'unanswered', 'not-found', 'signed-out'] as const)
      expect(reasonOf({ kind, message: "Couldn't save that." })).toBeNull()
  })
})
