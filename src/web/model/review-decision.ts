import type { ApiErrorKind } from '@/api/errors'
import { mayDo, type ReviewAction, type ReviewActions } from '@domain/review-actions'

// The state of one decision on the review page, in one place: the panel and the phone's bar are
// two views of it, so a failure carries its action and "Try again" has nothing to guess. A pure
// reducer; the page sends the write and tells it how it went. What may be done comes from
// `reviewActions` (src/domain/review-actions.ts), passed with the events that need it.
//
//   idle ──ask archive──▶ confirmingArchive ──press──▶ sending ──ok──▶ done ──finish──▶ idle
//   idle ──ask return───▶ writingReturn ─────press──▶ sending ──error─▶ failed ──retry──▶ sending
//   idle ──press (publish, close)────────────────────▶ sending
//   confirmingArchive, writingReturn, failed ──cancel──▶ idle
//
// Every state names the suggestion it is for: a write that answers after the person moved on is
// not theirs to see, and `open` starts a new suggestion clean.

export type DecisionState<D> =
  | { kind: 'idle'; id: string }
  /** Archiving takes context away from agents, so it asks first. */
  | { kind: 'confirmingArchive'; id: string }
  | { kind: 'writingReturn'; id: string }
  | { kind: 'sending'; id: string; action: ReviewAction }
  /** `reason` is the service's, when it refused; null when it only failed. */
  | { kind: 'failed'; id: string; action: ReviewAction; reason: string | null }
  | { kind: 'done'; id: string; done: D }

export type DecisionEvent<D> =
  | { type: 'open'; id: string }
  | { type: 'ask'; action: 'archive' | 'return'; actions: ReviewActions }
  | { type: 'cancel' }
  | { type: 'press'; action: ReviewAction; actions: ReviewActions }
  | { type: 'retry'; actions: ReviewActions }
  | { type: 'ok'; id: string; done: D }
  | { type: 'error'; id: string; reason: string | null }
  | { type: 'finish' }

export const idle = (id: string): DecisionState<never> => ({ kind: 'idle', id })

/** The next state; the same object when the event does not apply, so a caller can tell. */
export function decide<D>(state: DecisionState<D>, event: DecisionEvent<D>): DecisionState<D> {
  const { id } = state
  switch (event.type) {
    case 'open':
      return event.id === id ? state : idle(event.id)
    case 'ask':
      if (state.kind !== 'idle' && state.kind !== 'failed') return state
      if (!mayDo(event.actions, event.action)) return state
      return { kind: event.action === 'archive' ? 'confirmingArchive' : 'writingReturn', id }
    case 'cancel':
      return state.kind === 'confirmingArchive' ||
        state.kind === 'writingReturn' ||
        state.kind === 'failed'
        ? idle(id)
        : state
    case 'press': {
      if (!mayDo(event.actions, event.action)) return state
      // Archive and Return are pressed from their own step; the rest from the buttons.
      const from =
        event.action === 'archive'
          ? 'confirmingArchive'
          : event.action === 'return'
            ? 'writingReturn'
            : 'idle'
      return state.kind === from ? { kind: 'sending', id, action: event.action } : state
    }
    case 'retry':
      // The action travels with the failure; it still has to be one that may be done.
      return state.kind === 'failed' && mayDo(event.actions, state.action)
        ? { kind: 'sending', id, action: state.action }
        : state
    case 'ok':
      return state.kind === 'sending' && event.id === id
        ? { kind: 'done', id, done: event.done }
        : state
    case 'error':
      return state.kind === 'sending' && event.id === id
        ? { kind: 'failed', id, action: state.action, reason: event.reason }
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
