import { useEffect, useState } from 'react'

/**
 * The time now, read again every `every` milliseconds (a minute by default), so words such as
 * "5 minutes ago" stay true while a page is open.
 */
export function useNow(every = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  return now
}
