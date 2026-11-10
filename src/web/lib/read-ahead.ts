import * as React from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { itemPageQuery } from '@/api/queries'

// A context item's own read, started before its quick view opens, so the quick view opens whole:
// when a person points at a row or a chip that opens it (after a short dwell, so a sweep down a
// list reads nothing), when it takes keyboard focus, and for the few items an answer cites once
// it is written. A read already in the cache and fresh is not sent again.

/** How long the pointer rests on a row before its item is read ahead: a pass over it reads nothing. */
export const POINT_DWELL = 80
/** The most items an answer's own reads ahead: the ones it cites first. */
export const ANSWER_READS_AHEAD = 5

export const readItemAhead = (queryClient: QueryClient, id: string) =>
  void queryClient.prefetchQuery(itemPageQuery(id))

/**
 * The handlers for a row or a chip that opens an item's quick view: spread them on it. Pointing at
 * it reads the item ahead after POINT_DWELL; focusing it at once.
 */
export function useReadAhead() {
  const queryClient = useQueryClient()
  const timer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  return React.useCallback(
    (id: string) => ({
      onPointerEnter: () => {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => readItemAhead(queryClient, id), POINT_DWELL)
      },
      onPointerLeave: () => window.clearTimeout(timer.current),
      onFocus: () => readItemAhead(queryClient, id),
    }),
    [queryClient],
  )
}

/** Reads ahead the first items an answer cites, once it is written (`ready`). */
export function useReadCitedAhead(ids: readonly string[], ready: boolean) {
  const queryClient = useQueryClient()
  const first = ids.slice(0, ANSWER_READS_AHEAD).join(' ')
  React.useEffect(() => {
    if (!ready || !first) return
    for (const id of first.split(' ')) readItemAhead(queryClient, id)
  }, [ready, first, queryClient])
}
