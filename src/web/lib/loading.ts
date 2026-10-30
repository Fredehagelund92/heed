import * as React from 'react'
import { mockControls } from '@/api'

// Loading, by the motion rules (docs/design/motion.md): nothing for a fast load; a skeleton of the page's
// own shape only after 150ms, then held at least 300ms so it never flashes; a button's spinner
// after 150ms. The mock binding answers at once, so the Slow network switch in Help makes each
// page's first load wait there, so the loading can be seen and reviewed.

export const SHOW_AFTER = 150
export const HOLD_AT_LEAST = 300
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
      const t = window.setTimeout(
        () => React.startTransition(() => setShown(false)),
        Math.max(0, left),
      )
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [busy, shown, after, hold])
  return shown
}

/**
 * Inside a region that loaded after a wait the person saw (Loadable showed its skeleton): true.
 * Only then may a chart grow in; a fast load, a revisit or a filter shows it as it is.
 */
export const ArrivedAfterWait = React.createContext(false)

/* ---------- Slow network: the mock binding's switch in Help ---------- */

/** Whether the mock's Slow network switch is on; false with the http binding, which has none. */
export function useSlowNetwork() {
  return React.useSyncExternalStore(
    (l) => mockControls?.subscribe(l) ?? (() => {}),
    () => mockControls?.slowSwitch() ?? false,
  )
}

export const setSlowNetwork = (on: boolean) => mockControls?.setSlow(on)
