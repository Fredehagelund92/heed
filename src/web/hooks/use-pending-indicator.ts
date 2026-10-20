import { useEffect, useRef, useState } from 'react'

/** How long an action may run before its control shows that it is working (contract 9.3). */
export const PENDING_DELAY_MS = 150
/** How long the indicator stays once shown, so it never flashes (contract 10, rule 7). */
export const PENDING_MIN_MS = 300

/**
 * Whether to show a loading indicator for an action that is `pending`: only after 150 ms, and
 * then for at least 300 ms. A fast action never shows one; a slow one never flickers.
 */
export function usePendingIndicator(pending: boolean): boolean {
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (pending && !shown) {
      const timer = window.setTimeout(() => {
        shownAt.current = Date.now()
        setShown(true)
      }, PENDING_DELAY_MS)
      return () => window.clearTimeout(timer)
    }
    if (!pending && shown) {
      const left = PENDING_MIN_MS - (Date.now() - shownAt.current)
      const timer = window.setTimeout(() => setShown(false), Math.max(0, left))
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [pending, shown])

  return shown
}
