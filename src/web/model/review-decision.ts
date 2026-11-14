import type { JSONContent } from '@tiptap/core'
import type { ApiErrorKind } from '@/api/errors'
import { mayDo, type ReviewAction, type ReviewActions } from '@domain/review-actions'

// The state of one decision on the review page, in one place: the panel and the phone's bar are
// two views of it, so a failure carries its action and "Try again" has nothing to guess. A note
// travels with the Return being sent, and a retried Return sends the note as the editor holds it
// now; a reason travels with a Close the same way. A pure reducer; the page sends the write and tells it how it went. What may be done comes
// from `reviewActions` (src/domain/review-actions.ts), passed with the events that need it.
//
//   idle ──ask archive──▶ confirmingArchive ──press──▶ sending ──ok──▶ done ──finish──▶ idle
//   idle ──ask return───▶ writingReturn ─────press──▶ sending ──error─▶ failed ──retry──▶ sending
//   idle ──ask close────▶ confirmingClose ───press──▶ sending (with the owner's reason)
//   idle ──press (publish, close)────────────────────▶ sending
//   confirmingArchive, confirmingClose, writingReturn, failed ──cancel──▶ idle
//
// Every state names the suggestion it is for: a write that answers after the person moved on is
// not theirs to see, and `open` starts a new suggestion clean.

export type DecisionState<D> =
  | { kind: 'idle'; id: string }
  /** Archiving takes context away from agents, so it asks first. */
  | { kind: 'confirmingArchive'; id: string }
  /** A suggestion to archive its sender did not take back closes with the owner's reason. */
  | { kind: 'confirmingClose'; id: string }
  | { kind: 'writingReturn'; id: string }
  /** `note` is the words of a Return being sent, `reason` the owner's reason for a Close. */
  | { kind: 'sending'; id: string; action: ReviewAction; note?: JSONContent; reason?: string }
  /**
   * `failure` is how it went wrong: what a person can do about it depends on it. `reason` is the
   * service's, when it refused; null when it only failed.
   */
  | {
      kind: 'failed'
      id: string
      action: ReviewAction
      failure: ApiErrorKind
      reason: string | null
    }
  | { kind: 'done'; id: string; done: D }

export type DecisionEvent<D> =
  | { type: 'open'; id: string }
  | { type: 'ask'; action: AskedAction; actions: ReviewActions }
  | { type: 'cancel' }
  | {
      type: 'press'
      action: ReviewAction
      actions: ReviewActions
      note?: JSONContent
      reason?: string
    }
  /**
   * `note` is what the editor holds now: a failed Return sends that, never what it sent before;
   * `reason` is a failed Close's reason as it is written now.
   */
  | { type: 'retry'; actions: ReviewActions; note?: JSONContent; reason?: string }
  | { type: 'ok'; id: string; done: D }
  | { type: 'error'; id: string; failure: ApiErrorKind; reason: string | null }
  | { type: 'finish' }

/** The actions that take a step of their own before they are sent. */
export type AskedAction = 'archive' | 'return' | 'close'

const askedState = {
  archive: 'confirmingArchive',
  return: 'writingReturn',
  close: 'confirmingClose',
} as const

export const idle = (id: string): DecisionState<never> => ({ kind: 'idle', id })

/**
 * A Return is only sent with the words of its note; with none on screen there is nothing to send.
 * A Close takes the reason it was given, if any: the service says when it needs one.
 */
const sendOf = (
  id: string,
  action: ReviewAction,
  note?: JSONContent,
  reason?: string,
): DecisionState<never> | null =>
  action === 'return'
    ? note
      ? { kind: 'sending', id, action, note }
      : null
    : action === 'close' && reason?.trim()
      ? { kind: 'sending', id, action, reason: reason.trim() }
      : { kind: 'sending', id, action }

/** The next state; the same object when the event does not apply, so a caller can tell. */
export function decide<D>(state: DecisionState<D>, event: DecisionEvent<D>): DecisionState<D> {
  const { id } = state
  switch (event.type) {
    case 'open':
      return event.id === id ? state : idle(event.id)
    case 'ask':
      if (state.kind !== 'idle' && state.kind !== 'failed') return state
      if (!mayDo(event.actions, event.action)) return state
      return { kind: askedState[event.action], id }
    case 'cancel':
      return state.kind === 'confirmingArchive' ||
        state.kind === 'confirmingClose' ||
        state.kind === 'writingReturn' ||
        state.kind === 'failed'
        ? idle(id)
        : state
    case 'press': {
      if (!mayDo(event.actions, event.action)) return state
      // Archive and Return are pressed from their own step; a Close from its own step when it
      // takes a reason, else from the buttons; the rest from the buttons.
      const from: DecisionState<D>['kind'][] =
        event.action === 'archive'
          ? ['confirmingArchive']
          : event.action === 'return'
            ? ['writingReturn']
            : event.action === 'close'
              ? ['idle', 'confirmingClose']
              : ['idle']
      const fromFailedReturn =
        event.action === 'return' && state.kind === 'failed' && state.action === 'return'
      if (!from.includes(state.kind) && !fromFailedReturn) return state
      return sendOf(id, event.action, event.note, event.reason) ?? state
    }
    case 'retry':
      // The action travels with the failure; it still has to be one that may be done.
      return (
        (state.kind === 'failed' &&
          mayDo(event.actions, state.action) &&
          sendOf(id, state.action, event.note, event.reason)) ||
        state
      )
    case 'ok':
      return state.kind === 'sending' && event.id === id
        ? { kind: 'done', id, done: event.done }
        : state
    case 'error':
      return state.kind === 'sending' && event.id === id
        ? { kind: 'failed', id, action: state.action, failure: event.failure, reason: event.reason }
        : state
    case 'finish':
      return state.kind === 'done' ? idle(id) : state
  }
}

/** The action being sent, if one is. */
export const sendingOf = (state: DecisionState<unknown>) =>
  state.kind === 'sending' ? state.action : null

/** The note is on screen: being written, sent, or kept after it failed. */
export const writingReturn = (state: DecisionState<unknown>) =>
  state.kind === 'writingReturn' ||
  ((state.kind === 'sending' || state.kind === 'failed') && state.action === 'return')

/**
 * What the service said when it refused: a reason a person can act on. A failure with no answer,
 * or one of the service's own, has none to give.
 */
export const reasonOf = (error: { kind: ApiErrorKind; message: string }) =>
  error.kind === 'forbidden' || error.kind === 'conflict' || error.kind === 'invalid'
    ? error.message
    : null
