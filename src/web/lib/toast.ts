import { useSyncExternalStore } from 'react'

/**
 * Toasts load the first time one is shown: the toast region (Base UI Toast, with swipe to
 * dismiss) is not part of the first load. `showToast` queues the message until it is ready.
 */
export type ToastMessage = {
  title: string
  description?: string
  /** A toast that is closed or replaced by its id. */
  id?: string
  /**
   * How long it stays, in milliseconds: 5 seconds, or 10 with an action so there is time to reach
   * it. Hover and focus pause it.
   */
  timeout?: number
  /** One action beside the message, such as Undo. It is done once: its toast goes with it. */
  action?: ToastAction
  /** Runs once when the toast closes: it timed out, was dismissed or was replaced. */
  onClose?: () => void
}
export type ToastAction = { label: string; onClick: () => void }
export type ToastOptions = Omit<ToastMessage, 'title' | 'description'>

let deliver: ((message: ToastMessage) => void) | null = null
let dismiss: ((id: string) => void) | null = null
const queue: ToastMessage[] = []
let wanted = false
const listeners = new Set<() => void>()

export function showToast(title: string, description?: string, options: ToastOptions = {}) {
  const message = { title, description, ...options }
  if (deliver) {
    deliver(message)
    return
  }
  queue.push(message)
  if (!wanted) {
    wanted = true
    listeners.forEach((listener) => listener())
  }
}

/** Closes a toast by its id; a queued one never shows. */
export function closeToast(id: string) {
  const waiting = queue.findIndex((message) => message.id === id)
  if (waiting !== -1) {
    const [message] = queue.splice(waiting, 1)
    message?.onClose?.()
    return
  }
  dismiss?.(id)
}

/** Called by the toast region once it is mounted. */
export function connectToasts(add: (message: ToastMessage) => void, close: (id: string) => void) {
  deliver = add
  dismiss = close
  queue.splice(0).forEach(add)
  return () => {
    deliver = null
    dismiss = null
  }
}

/** Whether the toast region should be mounted (a toast was asked for). */
export function useToastsWanted() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => wanted,
    () => false,
  )
}
