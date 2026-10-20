import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { LiveStatus } from '@/api/live'
import { queryKeys } from '@/api/queries'

let status: LiveStatus = 'connecting'
const listeners = new Set<() => void>()

function setStatus(next: LiveStatus) {
  status = next
  for (const listener of listeners) listener()
}

/**
 * Keeps every open screen current while the app is open (slice W7): reads the live stream and
 * refreshes what each event makes stale. Mounted once, by the shell. The stream reader is
 * fetched when the shell mounts, so it is not part of the first load.
 */
export function useLiveUpdates() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const controller = new AbortController()
    let cache: { dispose: () => void } | undefined
    void import('@/api/live').then(({ createLiveCache, runLiveUpdates }) => {
      if (controller.signal.aborted) return
      const live = createLiveCache(queryClient)
      cache = live
      return runLiveUpdates({
        open: (options) => api.streamEvents(options),
        signal: controller.signal,
        onEvent: (event) => live.event(event),
        onRefetch: (reason) => live.refetch(reason),
        onStatus: setStatus,
        // The session ended: reading it again answers 401, which opens the signed-out page.
        onSignedOut: () => void queryClient.invalidateQueries({ queryKey: queryKeys.session }),
      })
    })
    return () => {
      controller.abort()
      cache?.dispose()
    }
  }, [queryClient])
}

/** Whether live updates are on, still connecting, or paused while the app polls instead. */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => status,
    () => status,
  )
}
