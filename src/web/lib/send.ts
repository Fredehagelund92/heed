import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { mockControls } from '@/api'
import { toApiError } from '@/api/errors'

// Sending and being offline, as every Save, Publish and decision shows them. A send is a mutation:
// sending while the binding works, then done, or failed with a retry that keeps everything the
// person wrote. Offline, nothing is sent. The mock's review flags (?state=offline, ?state=failed)
// play out in the binding, so a screen sees them as it would see the real thing.

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  const unsubscribe = mockControls?.subscribe(onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
    unsubscribe?.()
  }
}

const online = () => navigator.onLine && !mockControls?.offline()

/** Whether the app can reach the service: the browser's own signal, and the mock's offline flag. */
export function useOnline() {
  return React.useSyncExternalStore(subscribe, online)
}

export type SendState = 'idle' | 'sending' | 'failed'

/**
 * Save or Publish with its states. `send` runs the write and whatever follows it (a toast, the
 * next page); while it runs the state is `sending`, and if it throws, `failed`. Offline, or while
 * one is still sending, nothing is sent.
 */
export function useSend() {
  const isOnline = useOnline()
  const mutation = useMutation({ mutationFn: (run: () => Promise<unknown>) => run() })
  const state: SendState = mutation.isPending ? 'sending' : mutation.isError ? 'failed' : 'idle'
  /** Why the last send failed, as the binding said it. */
  const error = mutation.error ? toApiError(mutation.error) : null
  const send = (run: () => Promise<unknown>) => {
    if (!isOnline || mutation.isPending) return
    mutation.mutate(run)
  }
  /** Back to idle, for the next item on a page that moves between items. */
  const reset = mutation.reset
  return { state, error, send, online: isOnline, reset }
}

export type Sender = ReturnType<typeof useSend>
