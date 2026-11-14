import type { ConflictSide } from '@/model/conflicts'

// The state of one decision on a conflict, in one place: the confirm box carries the versions of
// both items it was opened on, and those are what the decision sends, never what the cache read
// last. A read that brings a newer version of either while the box is open closes it: the person
// sees what changed before deciding again. A pure reducer; the view sends the write and tells it
// how it went.
//
//   reading ──open──▶ confirming ──confirm──▶ sending ──ok──▶ settled ──finish──▶ reading
//   confirming ──cancel──▶ reading               sending ──failed──▶ confirming (the words shown)
//   confirming ──a newer version read──▶ stale   sending ──refused as stale──▶ stale
//   stale ──Show what changed──▶ reading
//
// Every state names the pair it is for: an answer that comes after the view moved to another
// pair is not this one's to show.

/** The versions of the two items, as the conflict reads them. */
export type Versions = { holder: number; other: number }

/** What the confirm box is for. */
export type Pending =
  | { how: 'kept_one'; keep: ConflictSide; other: ConflictSide }
  | { how: 'kept_both' }
  | { how: 'not_conflict' }
  /** Someone who may not archive an item suggests it to its owners instead (FR-112). */
  | { how: 'suggest_archive'; goes: ConflictSide; stays: ConflictSide }

export type DecisionState<D> =
  /** `arrival` is a box to open once the pair is read, as after an edit made from the conflict. */
  | { kind: 'reading'; key: string; arrival: 'not_conflict' | null }
  /** `seen` is what the box showed; `failure` the words of the last send that failed. */
  | { kind: 'confirming'; key: string; pending: Pending; seen: Versions; failure: string | null }
  | { kind: 'sending'; key: string; pending: Pending; seen: Versions }
  /** One of the two changed while the person read: nothing is decided until they have seen it. */
  | { kind: 'stale'; key: string }
  | { kind: 'settled'; key: string; done: D }

export type DecisionEvent<D> =
  | { type: 'pair'; key: string }
  /** The pair was read, first or again. */
  | { type: 'read'; key: string; versions: Versions; notConflict: boolean }
  | { type: 'open'; pending: Pending; versions: Versions; online: boolean }
  | { type: 'cancel' }
  | { type: 'confirm'; online: boolean }
  /** `done` is the outcome to show; null when there is none, as for a suggestion. */
  | { type: 'ok'; key: string; done: D | null }
  | { type: 'failed'; key: string; failure: string }
  /** The service said a newer version of either exists. */
  | { type: 'refused'; key: string }
  | { type: 'seenChange' }
  /** The outcome is over: undone, or the view moves on. */
  | { type: 'finish' }

export const reading = (
  key: string,
  arrival: 'not_conflict' | null = null,
): DecisionState<never> => ({ kind: 'reading', key, arrival })

const newer = (read: Versions, seen: Versions) =>
  read.holder > seen.holder || read.other > seen.other

/** The next state; the same object when the event does not apply, so a caller can tell. */
export function decide<D>(state: DecisionState<D>, event: DecisionEvent<D>): DecisionState<D> {
  const { key } = state
  switch (event.type) {
    case 'pair':
      return event.key === key ? state : reading(event.key)
    case 'read':
      if (event.key !== key) return state
      if (state.kind === 'reading' && state.arrival)
        return event.notConflict
          ? {
              kind: 'confirming',
              key,
              pending: { how: 'not_conflict' },
              seen: event.versions,
              failure: null,
            }
          : reading(key)
      return state.kind === 'confirming' && newer(event.versions, state.seen)
        ? { kind: 'stale', key }
        : state
    case 'open':
      return state.kind === 'reading' && event.online
        ? { kind: 'confirming', key, pending: event.pending, seen: event.versions, failure: null }
        : state
    case 'cancel':
      // Not while sending: the decision is on its way, and its answer is shown in the box.
      return state.kind === 'confirming' ? reading(key) : state
    case 'confirm':
      return state.kind === 'confirming' && event.online
        ? { kind: 'sending', key, pending: state.pending, seen: state.seen }
        : state
    case 'ok':
      if (state.kind !== 'sending' || event.key !== key) return state
      return event.done === null ? reading(key) : { kind: 'settled', key, done: event.done }
    case 'failed':
      return state.kind === 'sending' && event.key === key
        ? { ...state, kind: 'confirming', failure: event.failure }
        : state
    case 'refused':
      return state.kind === 'sending' && event.key === key ? { kind: 'stale', key } : state
    case 'seenChange':
      return state.kind === 'stale' ? reading(key) : state
    case 'finish':
      return state.kind === 'settled' ? reading(key) : state
  }
}
