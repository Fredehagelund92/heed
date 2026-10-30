import * as React from 'react'

// Rows that leave and arrive (docs/design/motion.md): a row that goes collapses in 150ms, then the change is
// made; a row added later opens in 220ms. Rows already there when a list first shows do not move,
// so a page never animates in. CSS: the row-presence utility in index.css.

/** How long a row takes to leave; none with reduced motion. */
export const LEAVE_MS = 150

const leaving = new Set<string>()
let snapshot: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()
const notify = () => {
  snapshot = new Set(leaving)
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Collapses the row `id`, then runs `commit`: the change is seen as the row going, not as a jump.
 * When `commit` returns a promise (a save, then the refreshed list), the row stays collapsed until
 * it settles, so it never shows again on its way out; if the save fails, it opens again.
 */
export function leaveThen(id: string, commit: () => unknown) {
  return leaveAllThen([id], commit)
}

/** Several rows leave together, then one change is made. */
export function leaveAllThen(ids: string[], commit: () => unknown): Promise<void> {
  if (reduced() || !ids.length) return Promise.resolve(commit()).then(() => undefined)
  ids.forEach((id) => leaving.add(id))
  notify()
  return new Promise((resolve, reject) =>
    window.setTimeout(() => {
      Promise.resolve()
        .then(commit)
        .finally(() => {
          ids.forEach((id) => leaving.delete(id))
          notify()
        })
        .then(() => resolve(), reject)
    }, LEAVE_MS),
  )
}

/** Whether the row `id` is on its way out. */
export const isLeaving = (id: string) => leaving.has(id)

/** Whether the row `id` is on its way out: put it on the row as data-leaving. */
export function useLeaving(id: string) {
  return React.useSyncExternalStore(subscribe, () => isLeaving(id))
}

/** Every row on its way out, for a list that draws its rows in one loop. */
export function useLeavingRows() {
  return React.useSyncExternalStore(subscribe, () => snapshot)
}

/** On a list: from the frame after it first shows, rows added to it open instead of appearing. */
export function arriveRef(el: HTMLElement | null) {
  if (el && !el.hasAttribute('data-arrive'))
    requestAnimationFrame(() => el.setAttribute('data-arrive', ''))
}
