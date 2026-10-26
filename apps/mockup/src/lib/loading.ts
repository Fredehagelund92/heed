import * as React from "react"
import { useRoute } from "@/lib/router"

// Loading, by the motion rules (docs/motion.md): nothing for a fast load; a skeleton of the page's
// own shape only after 150ms, then held at least 300ms so it never flashes; a button's spinner
// after 150ms. The mockup's data is in memory, so nothing ever waits: the Slow network switch in
// Help makes each page's first visit wait, so the loading can be seen and reviewed.

export const SHOW_AFTER = 150
export const HOLD_AT_LEAST = 300
/** How long a page's first visit waits with Slow network on. */
export const SLOW_LOAD = 900
/** How long a send (Publish, Save, a decision) takes: a little longer with Slow network on. */
export const sendTime = (slow: boolean) => (slow ? 1500 : 600)

/** True once `flag` has stayed true for `after` ms: a spinner that never flashes on a fast action. */
export function useAfter(flag: boolean, after = SHOW_AFTER) {
  const [shown, setShown] = React.useState(false)
  React.useEffect(() => {
    if (!flag) return
    const t = window.setTimeout(() => setShown(true), after)
    return () => {
      window.clearTimeout(t)
      setShown(false)
    }
  }, [flag, after])
  return flag && shown
}

/**
 * Whether to show a loading state for `busy`: only once it has lasted 150ms, then for at least
 * 300ms. Ending it is a transition, so a <ViewTransition> around the content can fade it in.
 */
export function useDelayedBusy(busy: boolean, after = SHOW_AFTER, hold = HOLD_AT_LEAST) {
  const [shown, setShown] = React.useState(false)
  const since = React.useRef(0)
  React.useEffect(() => {
    if (busy && !shown) {
      const t = window.setTimeout(() => {
        since.current = performance.now()
        setShown(true)
      }, after)
      return () => window.clearTimeout(t)
    }
    if (!busy && shown) {
      const left = hold - (performance.now() - since.current)
      const t = window.setTimeout(() => React.startTransition(() => setShown(false)), Math.max(0, left))
      return () => window.clearTimeout(t)
    }
  }, [busy, shown, after, hold])
  return shown
}

/**
 * Inside a region that loaded after a wait the person saw (Loadable showed its skeleton): true.
 * Only then may a chart grow in; a fast load, a revisit or a filter shows it as it is.
 */
export const ArrivedAfterWait = React.createContext(false)

/* ---------- Slow network: a switch in Help, or ?slow=1 in the address ---------- */

const KEY = "heed-slow-network"
const read = () => {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}
let slow = read()
const listeners = new Set<() => void>()
/** Pages already loaded this visit: a second visit is a background refresh, which shows nothing. */
const loaded = new Set<string>()

export function setSlowNetwork(on: boolean) {
  slow = on
  loaded.clear()
  try {
    localStorage.setItem(KEY, on ? "1" : "0")
  } catch {
    // Private windows can refuse storage; the switch still works for this visit.
  }
  listeners.forEach((l) => l())
}

export function useSlowNetwork() {
  const { query } = useRoute()
  const stored = React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => slow
  )
  return stored || query.get("slow") === "1"
}

/** With Slow network on, a page's first visit waits; later visits show what is there at once. */
export function useFirstLoad(key: string) {
  const isSlow = useSlowNetwork()
  const [, done] = React.useReducer((n: number) => n + 1, 0)
  const waiting = isSlow && !loaded.has(key)
  React.useEffect(() => {
    if (!waiting) return
    const t = window.setTimeout(() => {
      loaded.add(key)
      done()
    }, SLOW_LOAD)
    return () => window.clearTimeout(t)
  }, [waiting, key])
  return waiting
}
