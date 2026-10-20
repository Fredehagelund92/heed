import { useEffect, useState } from 'react'

/** How long a panel takes to leave: exits are 100 ms (contract 10, rule 3). */
export const EXIT_MS = 100

/**
 * Keeps something on screen for its exit after it is gone: `value` while it is there (null when
 * it is not), and for `ms` after it went, the last value with `leaving` set. A value that comes
 * back while it leaves stays, without leaving.
 */
export function useExit<T>(value: T | null, ms = EXIT_MS): { shown: T | null; leaving: boolean } {
  const [last, setLast] = useState(value)
  if (value !== null && value !== last) setLast(value)
  const leaving = value === null && last !== null
  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => setLast(null), ms)
    return () => window.clearTimeout(timer)
  }, [leaving, ms])
  return { shown: value ?? last, leaving }
}
