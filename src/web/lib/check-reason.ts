import { useSyncExternalStore } from 'react'

/**
 * The reason an owner gave for their last check, one per kind of check, for this session: an
 * upkeep run checks many items the same way, so the next check's dialog starts with it filled in.
 * It stays editable and still required (FR-203); nothing is recorded without the dialog. It
 * belongs to the person who gave it: another person signed in on the same tab never sees it.
 */
export type CheckKind = 'checked' | 'still_going_on'

let owner = ''
const reasons = new Map<CheckKind, string>()
const listeners = new Set<() => void>()

export function rememberCheckReason(personId: string, kind: CheckKind, reason: string) {
  if (!personId) return
  if (personId !== owner) {
    reasons.clear()
    owner = personId
  }
  reasons.set(kind, reason)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The reason this person gave for their last check of this kind, or an empty string. */
export function useCheckReason(personId: string, kind: CheckKind): string {
  return useSyncExternalStore(
    subscribe,
    () => (personId && personId === owner ? (reasons.get(kind) ?? '') : ''),
    () => '',
  )
}
