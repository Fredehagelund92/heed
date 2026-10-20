import { useCallback, useEffect, useRef, useState } from 'react'

/** Drafts save 800 ms after the last change (contract 9.3, FR-110). */
export const AUTOSAVE_DELAY_MS = 800
/** Waits between attempts after a failed save; the last one repeats. */
export const AUTOSAVE_RETRY_MS = [2_000, 5_000, 15_000, 30_000] as const

export type AutosaveStatus =
  /** Nothing to save yet, or everything is saved and nothing changed since. */
  | 'idle'
  /** Changed; the save starts once typing pauses. */
  | 'waiting'
  | 'saving'
  | 'saved'
  /** The last save failed. The text is kept on this device; `retrying` says if it tries again. */
  | 'failed'

export type AutosaveState = {
  status: AutosaveStatus
  /** When the last save succeeded. */
  savedAt: Date | null
  /** The last failure, until a save succeeds. */
  error: unknown
  /** Whether another attempt is scheduled after a failure. */
  retrying: boolean
}

export type Autosave = AutosaveState & {
  /** Saves now if anything is unsaved, and resolves when it is (or when the save fails). */
  flush: () => Promise<void>
  /** Tries a failed save again at once. */
  retry: () => void
  /** Whether the latest value is not saved yet. */
  unsaved: boolean
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The value a failed save left on this device under `key`, if any. */
export function readAutosaveBackup<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

function writeBackup(key: string | undefined, value: unknown) {
  if (!key) return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be full or blocked; the value is still in memory and the retry continues.
  }
}

function clearBackup(key: string | undefined) {
  if (!key) return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

/**
 * Saves a value in the background as a person types (contract 9.3): 800 ms after the last
 * change, one save at a time, the newest value always last. A failed save keeps the value on
 * the device (`backupKey`) and tries again with growing waits; `retry` tries at once. Pair it
 * with `SaveStatus`, which shows "Saving...", "Saved 14:02" or "Not saved. Trying again".
 *
 * What a save is (creating a draft first, carrying a revision, rebasing on a conflict) stays
 * with the caller's `save`. When a failure should not be retried, such as a conflict that needs
 * the person, return false from `shouldRetry`.
 */
export function useAutosave<T>({
  value,
  save,
  enabled = true,
  delay = AUTOSAVE_DELAY_MS,
  retryDelays = AUTOSAVE_RETRY_MS,
  shouldRetry = () => true,
  isEqual = sameJson,
  backupKey,
  initialSavedValue = value,
}: {
  value: T
  save: (value: T) => Promise<unknown>
  /** Off until there is something worth saving, such as a first valid change. */
  enabled?: boolean
  delay?: number
  retryDelays?: readonly number[]
  shouldRetry?: (error: unknown) => boolean
  isEqual?: (a: T, b: T) => boolean
  /** A browser storage key that holds the value while it is not saved. */
  backupKey?: string
  /** The server value before restoring unsaved local edits. */
  initialSavedValue?: T
}): Autosave {
  const [state, setState] = useState<AutosaveState>({
    status: 'idle',
    savedAt: null,
    error: null,
    retrying: false,
  })

  const latest = useRef(value)
  const saved = useRef(initialSavedValue)
  const timer = useRef<number | undefined>(undefined)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const failures = useRef(0)
  const options = useRef({ save, shouldRetry, isEqual, retryDelays, backupKey, delay })
  useEffect(() => {
    latest.current = value
    options.current = { save, shouldRetry, isEqual, retryDelays, backupKey, delay }
  })

  const stopTimer = () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }

  const run = useCallback(async (): Promise<void> => {
    // One save at a time. The value may change while one runs; the check below sees that.
    while (inFlight.current) await inFlight.current
    const { isEqual: equal } = options.current
    if (equal(latest.current, saved.current)) return

    const attempt = (async (): Promise<boolean> => {
      const snapshot = latest.current
      const opts = options.current
      setState((now) => ({ ...now, status: 'saving' }))
      try {
        await opts.save(snapshot)
        saved.current = snapshot
        failures.current = 0
        const dirty = !opts.isEqual(latest.current, snapshot)
        if (!dirty) clearBackup(opts.backupKey)
        setState({
          status: dirty ? 'waiting' : 'saved',
          savedAt: new Date(),
          error: null,
          retrying: false,
        })
        return true
      } catch (error) {
        writeBackup(opts.backupKey, latest.current)
        const again = opts.shouldRetry(error)
        const wait =
          opts.retryDelays[Math.min(failures.current, opts.retryDelays.length - 1)] ?? 30_000
        failures.current += 1
        setState((now) => ({ ...now, status: 'failed', error, retrying: again }))
        if (again) {
          stopTimer()
          timer.current = window.setTimeout(() => {
            timer.current = undefined
            void run()
          }, wait)
        }
        return false
      }
    })()
    inFlight.current = attempt
    const succeeded = await attempt
    inFlight.current = null

    // Typing went on during the save and its pause has already passed: save that too. After a
    // failure the retry timer (or the person) decides when to try again.
    if (
      succeeded &&
      timer.current === undefined &&
      !options.current.isEqual(latest.current, saved.current)
    )
      await run()
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    if (options.current.isEqual(value, saved.current)) return undefined
    // Only a settled draft becomes "waiting"; a save in flight or a failure keeps its status.
    // Returning the same state object matters: a caller may pass a new object on every render.
    setState((now) =>
      now.status === 'idle' || now.status === 'saved' ? { ...now, status: 'waiting' } : now,
    )
    stopTimer()
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      void run()
    }, options.current.delay)
    return undefined
  }, [value, enabled, run])

  useEffect(() => stopTimer, [])

  const flush = useCallback(async () => {
    stopTimer()
    await run()
  }, [run])

  const retry = useCallback(() => {
    stopTimer()
    void run()
  }, [run])

  return {
    ...state,
    flush,
    retry,
    unsaved: state.status === 'waiting' || state.status === 'saving' || state.status === 'failed',
  }
}
