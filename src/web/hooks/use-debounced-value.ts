import { useEffect, useState } from 'react'

/** How long typing rests before a search on the server runs (people pickers, the People page). */
export const SEARCH_DEBOUNCE_MS = 150

/** `value`, once it has stayed the same for `ms`: a search runs on the words, not each key. */
export function useDebouncedValue<T>(value: T, ms = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return settled
}
