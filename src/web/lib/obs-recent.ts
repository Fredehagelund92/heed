import * as React from 'react'
import { isDim, type DimKey, type Filters } from '@/lib/obs-chips'

// The dimensions a person filtered Overview by lately, the latest first, for the picker's Recent.
// Kept in this browser alone and never sent anywhere: no record of who filtered by what is kept
// (FR-613). A browser that keeps nothing has no recent ones.

const KEY = 'heed.obs.recent-dimensions'
/** How many the browser keeps; the picker lists 3 of them that are not pinned. */
const KEEP = 5

function read(): DimKey[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(list)
      ? list.filter((k): k is DimKey => typeof k === 'string' && isDim(k))
      : []
  } catch {
    return []
  }
}

function write(list: DimKey[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // A browser that keeps nothing remembers nothing.
  }
}

/** The dimensions used lately with the ones just added first, the last one added first of all. */
export const recentAfter = (was: readonly DimKey[], added: readonly DimKey[]) =>
  [...new Set([...[...added].reverse(), ...was])].slice(0, KEEP)

/** The recent dimensions: a dimension's chip puts it first as it goes on. */
export function useRecentDimensions(chips: Filters): DimKey[] {
  const [recent, setRecent] = React.useState(read)
  const on = chips.flatMap((c) => (isDim(c.key) ? [c.key] : [])).join()
  const last = React.useRef<string[] | null>(null)
  React.useEffect(() => {
    const now = on ? on.split(',') : []
    const seen = last.current
    last.current = now
    if (seen === null) return
    const added = now.filter((k) => !seen.includes(k)) as DimKey[]
    if (!added.length) return
    setRecent((was) => {
      const next = recentAfter(was, added)
      if (next.join() !== was.join()) write(next)
      return next
    })
  }, [on])
  return recent
}
