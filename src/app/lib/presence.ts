import * as React from "react"

// Rows that leave and arrive (docs/motion.md): a row that goes collapses in 150ms, then the change is
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
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** Collapses the row `id`, then runs `commit`: the change is seen as the row going, not as a jump. */
export function leaveThen(id: string, commit: () => void) {
  if (reduced()) return commit()
  leaving.add(id)
  notify()
  window.setTimeout(() => {
    leaving.delete(id)
    commit()
    notify()
  }, LEAVE_MS)
}

/** Several rows leave together, then one change is made. */
export function leaveAllThen(ids: string[], commit: () => void) {
  if (reduced() || !ids.length) return commit()
  ids.forEach((id) => leaving.add(id))
  notify()
  window.setTimeout(() => {
    ids.forEach((id) => leaving.delete(id))
    commit()
    notify()
  }, LEAVE_MS)
}

/** Whether the row `id` is on its way out: put it on the row as data-leaving. */
export function useLeaving(id: string) {
  return React.useSyncExternalStore(subscribe, () => leaving.has(id))
}

/** Every row on its way out, for a list that draws its rows in one loop. */
export function useLeavingRows() {
  return React.useSyncExternalStore(subscribe, () => snapshot)
}

/** On a list: from the frame after it first shows, rows added to it open instead of appearing. */
export function arriveRef(el: HTMLElement | null) {
  if (el && !el.hasAttribute("data-arrive")) requestAnimationFrame(() => el.setAttribute("data-arrive", ""))
}
