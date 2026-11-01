import { ApiError } from '../errors'
import { isPageRead, type HeedApiMethod } from '../client'
import { storageKey } from '@/lib/brand'
import type { ObsState } from '@/model/observability'

// What can go wrong, made reviewable, as the mock binding plays it. The app passes the address to
// the mock on every move (ScenarioSync in App.tsx), and the mock reads its review flags from it:
//
// - ?state=loading keeps a page's own load waiting until the address changes.
// - ?state=failed makes a page's load fail on its first try, so Retry brings it back, and each kind
//   of send (Publish, Save, a decision) fail on its first try too.
// - ?state=offline takes the app offline: nothing is sent. The browser going offline counts too.
// - ?slow=1, or the Slow network switch in Help, makes each page's first load wait 900ms and every
//   send take 1.5s instead of 0.6s.
// - ?decide=fail fails each Inbox card's first save, ?bulk=fail the first change to many rows.
//
// Integrations keep their own ?state for a sync, and Observability its own for its data, so only
// offline counts there. Only the reads a screen's loading state shows (pageReads) wait or fail;
// the shared reads every screen needs never do. The http binding has none of this.

export type Fault = 'loading' | 'failed' | 'offline' | null

/** How long a page's first load waits with Slow network on. */
export const SLOW_LOAD = 900
/** A load tried again after it failed: the round trip the person sees. */
export const RETRY_TIME = 700
/** How long a send (Publish, Save, a decision) takes: a little longer with Slow network on. */
export const sendTime = (slow: boolean) => (slow ? 1500 : 600)

export type Address = { path: string; query: Record<string, string | undefined> }

const SLOW_KEY = storageKey('slow-network')
const readSlow = () => {
  try {
    return localStorage.getItem(SLOW_KEY) === '1'
  } catch {
    return false
  }
}

const parts = (path: string) => path.split('/').filter(Boolean)

/** The fault an address sets: Integrations and Observability keep `state` for their own data. */
export function faultOf({ path, query }: Address): Fault {
  const s = query.state
  const [first, second] = parts(path)
  if ((first === 'settings' && second === 'integrations') || first === 'observability')
    return s === 'offline' ? 'offline' : null
  return s === 'loading' || s === 'failed' || s === 'offline' ? s : null
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createScenario() {
  let address: Address = { path: '/', query: {} }
  let fault: Fault = null
  let slowSwitch = readSlow()
  /** Page loads already made this visit: a second one is a background refresh, which never waits. */
  const loaded = new Set<string>()
  /** Page loads that failed: the next try takes a round trip. */
  const failed = new Set<string>()
  /** Page loads and kinds of send that already failed once under a fault flag. */
  const failedOnce = new Set<string>()
  /** Loads waiting for ?state=loading to go. */
  let waiting: (() => void)[] = []
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((l) => l())

  const slow = () => slowSwitch || address.query.slow === '1'
  const offline = () => fault === 'offline'

  return {
    /** The address the app is at. Says whether what the binding answers may have changed. */
    setAddress(next: Address): { fault: boolean; data: boolean } {
      const before = fault
      const flagsBefore = this.dataFlags()
      address = next
      fault = faultOf(next)
      if (before === 'loading' && fault !== 'loading') {
        const go = waiting
        waiting = []
        go.forEach((resume) => resume())
      }
      if (before !== fault) {
        failedOnce.clear()
        notify()
      }
      return { fault: before !== fault, data: this.dataFlags() !== flagsBefore }
    },
    address: () => address,
    /**
     * The review flags that change what the mock answers rather than whether it answers: a new one
     * means every read may have changed.
     */
    dataFlags() {
      const q = address.query
      return JSON.stringify([this.obsState(), q.snapshot, q.quality, q.links, q.figures, q.connect])
    },
    /** Observability's own review flag: ?state=empty (nothing connected), quiet (under 5), busy. */
    obsState(): ObsState {
      const s = address.query.state
      return parts(address.path)[0] === 'observability' &&
        (s === 'empty' || s === 'quiet' || s === 'busy')
        ? s
        : 'normal'
    },
    offline,
    slow,
    setSlow: (on: boolean) => {
      slowSwitch = on
      loaded.clear()
      try {
        localStorage.setItem(SLOW_KEY, on ? '1' : '0')
      } catch {
        // Private windows can refuse storage; the switch still works for this visit.
      }
      notify()
    },
    slowSwitch: () => slowSwitch,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** A read as the scenario plays it: a page's own load may wait or fail; any other read answers. */
    async read<T>(method: HeedApiMethod, key: string, run: () => T): Promise<T> {
      if (isPageRead(method)) {
        const id = `${method}:${key}`
        if (fault === 'loading') await new Promise<void>((resume) => waiting.push(resume))
        if (fault === 'failed' && !failedOnce.has(id)) {
          failedOnce.add(id)
          failed.add(id)
          throw new ApiError('failed', "Couldn't load this.", { status: 500 })
        }
        if (failed.delete(id)) await wait(RETRY_TIME)
        else if (slow() && !loaded.has(id)) await wait(SLOW_LOAD)
        loaded.add(id)
      }
      return run()
    },

    /** Whether a ?<flag>=fail address fails this kind of change: once, on its first try. */
    failsOnce(flag: 'decide' | 'bulk', key = ''): boolean {
      const kind = `${flag}:${key}`
      if (address.query[flag] !== 'fail' || failedOnce.has(kind)) return false
      failedOnce.add(kind)
      return true
    },

    /**
     * A send as the scenario plays it: refused offline, as long as a send takes, and with a fault
     * flag the first one of its kind fails (`key` names the kind: a card for ?decide=fail).
     */
    async send<T>(
      method: HeedApiMethod,
      run: () => T,
      options: { key?: string; flag?: 'decide' | 'bulk' } = {},
    ): Promise<T> {
      if (offline()) throw new ApiError('unanswered', "You're offline.")
      await wait(sendTime(slow()))
      const kind = `${method}:${options.key ?? ''}`
      const flagged =
        fault === 'failed' || (options.flag !== undefined && address.query[options.flag] === 'fail')
      if (flagged && !failedOnce.has(kind)) {
        failedOnce.add(kind)
        throw new ApiError('failed', "Couldn't save that.", { status: 500 })
      }
      return run()
    },
  }
}

export type Scenario = ReturnType<typeof createScenario>
