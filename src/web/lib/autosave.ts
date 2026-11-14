import * as React from 'react'
import { useOnline } from '@/lib/send'

// A page that saves itself (About our business, a domain): each change waits a moment, then is
// sent, one save at a time. Words typed while a save is on its way wait for its answer and go
// next, so two saves never race (the service refuses the second, built on the version before the
// first). A failed save keeps what it carried and says so until Try again or the next change sends
// it. Leaving the page sends what is still waiting. "Saved" only when what is stored is what is
// shown.

/** Whether what a page holds is saved, in one word each, as `SaveStatus` says it. */
export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'failed' | 'offline'

export type Autosave<T> = {
  /** Changes not sent yet, merged in the order they were made. */
  waiting: T | null
  /** What is on its way to the service: at most one save at a time. */
  sending: T | null
  /** The last save failed; what it carried is back in `waiting`. */
  failed: boolean
  /** Something was saved since the page opened. */
  saved: boolean
}

export type AutosaveEvent<T> =
  { type: 'edit'; value: T } | { type: 'discard' } | { type: 'send' } | { type: 'answered' } | { type: 'failed' }

/** Changes made close together are saved together: by default the newest stands for them all. */
export type Merge<T> = (older: T, newer: T) => T
const newest = <T>(_: T, newer: T) => newer

export const autosaveStart: Autosave<never> = {
  waiting: null,
  sending: null,
  failed: false,
  saved: false,
}

/** One step of the machine, with nothing done: the hook sends and keeps the time. */
export function autosaveStep<T>(
  s: Autosave<T>,
  e: AutosaveEvent<T>,
  merge: Merge<T> = newest,
): Autosave<T> {
  switch (e.type) {
    case 'edit':
      return {
        ...s,
        waiting: s.waiting === null ? e.value : merge(s.waiting, e.value),
        failed: false,
      }
    case 'discard':
      return { ...s, waiting: null, failed: false }
    case 'send':
      if (s.sending !== null || s.waiting === null) return s
      return { ...s, sending: s.waiting, waiting: null, failed: false }
    case 'answered':
      return { ...s, sending: null, saved: true }
    case 'failed':
      if (s.sending === null) return s
      return {
        ...s,
        sending: null,
        waiting: s.waiting === null ? s.sending : merge(s.sending, s.waiting),
        failed: true,
      }
  }
}

/** The word for the state: Saved only when nothing is waiting or on its way. */
export function saveStateOf(s: Autosave<unknown>, online: boolean): SaveState {
  if (s.failed) return 'failed'
  if (s.sending !== null) return 'saving'
  if (s.waiting !== null) return online ? 'dirty' : 'offline'
  return s.saved ? 'saved' : 'clean'
}

type Options<T> = {
  save: (value: T) => Promise<unknown>
  onError?: (error: unknown) => void
  merge?: Merge<T>
  delay?: number
}

/** The machine with its timer and its one save in flight, outside React so answers outlive pages. */
function autosaveMachine<T>() {
  let state: Autosave<T> = autosaveStart
  let options: Options<T> & { online: boolean } = { save: async () => {}, online: true }
  let timer = 0
  let error: unknown = null
  const listeners = new Set<() => void>()
  const step = (e: AutosaveEvent<T>) => {
    state = autosaveStep(state, e, options.merge)
    for (const l of listeners) l()
  }
  /** Send what is waiting now, unless a save is on its way (its answer sends it next). */
  const send = (force = false) => {
    window.clearTimeout(timer)
    if (state.sending !== null || state.waiting === null || (!options.online && !force)) return
    step({ type: 'send' })
    options.save(state.sending as T).then(
      () => {
        step({ type: 'answered' })
        send(force)
      },
      (e: unknown) => {
        error = e
        step({ type: 'failed' })
        options.onError?.(e)
      },
    )
  }
  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => void listeners.delete(l)
  }
  return {
    get: () => state,
    subscribe,
    configure: (next: typeof options) => {
      options = next
    },
    send,
    /** Drops what is waiting, and its timer: it is no longer what the page shows. */
    discard: () => {
      window.clearTimeout(timer)
      step({ type: 'discard' })
    },
    change: (value: T) => {
      step({ type: 'edit', value })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => send(), options.delay ?? 700)
    },
    flush: () =>
      new Promise<void>((resolve, reject) => {
        const check = () => {
          if (state.failed) reject(new Error('Not saved', { cause: error }))
          else if (state.sending === null && state.waiting === null) resolve()
          else return
          off()
        }
        const off = subscribe(check)
        send(true)
        check()
      }),
  }
}

/**
 * Saves `change`d values with `save`, `delay` ms after the last change, one at a time. `onError`
 * hears why a save failed (a toast); the status says Not saved until it is sent again. Offline,
 * nothing is sent until the app is back.
 */
export function useAutosave<T>(options: Options<T>) {
  const online = useOnline()
  const [machine] = React.useState(autosaveMachine<T>)
  React.useEffect(() => machine.configure({ ...options, online }))
  const state = React.useSyncExternalStore(machine.subscribe, machine.get)
  // Back online: what waited is sent.
  React.useEffect(() => {
    if (online) machine.send()
  }, [online, machine])
  // Leaving the page sends what is still waiting, a failed save once more, so a quick change is
  // never lost.
  React.useEffect(() => () => machine.send(true), [machine])
  return {
    status: saveStateOf(state, online),
    change: machine.change,
    discard: machine.discard,
    /** Try the failed save again now. */
    retry: () => machine.send(true),
    /** Sends what is waiting now; settles when all of it is stored, or fails with the save. */
    flush: machine.flush,
  }
}
