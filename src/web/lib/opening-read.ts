import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { askQuery } from '@/api/queries'
import { toApiError } from '@/api/errors'
import type { Answer, AskInput } from '@/model/ask'

/** How the first read of a chat that opens on one has gone (src/web/model/ask-session.ts). */
export type Opening =
  | { state: 'none' }
  | { state: 'reading' }
  | { state: 'read'; answer: Answer }
  | { state: 'failed'; message: string }

/**
 * The first answer of an example or a chat opened again, read once. It is a look-up that costs a
 * model call, so it is read as an event of the thread and not through a subscribed query: no write,
 * regain of focus or remount asks it again. An answer already kept for these words (by `remember`
 * in src/web/pages/ask.tsx, or an earlier read) is used as it is.
 */
export function useOpeningRead(read: AskInput | null): Opening {
  const queryClient = useQueryClient()
  const key = read ? JSON.stringify(askQuery(read).queryKey) : null
  const [done, setDone] = React.useState<{ key: string; opening: Opening } | null>(null)
  React.useEffect(() => {
    if (!read || !key) return
    if (queryClient.getQueryData(askQuery(read).queryKey)) return
    let current = true
    void queryClient
      .fetchQuery({ ...askQuery(read), staleTime: Infinity })
      .then(
        (answer): Opening => ({ state: 'read', answer }),
        (error): Opening => ({ state: 'failed', message: toApiError(error).message }),
      )
      .then((opening) => current && setDone({ key, opening }))
    return () => {
      current = false
    }
    // The words decide the read; `read` is made afresh each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, queryClient])
  if (!read || !key) return { state: 'none' }
  const cached = queryClient.getQueryData(askQuery(read).queryKey)
  if (cached) return { state: 'read', answer: cached }
  return done?.key === key ? done.opening : { state: 'reading' }
}
