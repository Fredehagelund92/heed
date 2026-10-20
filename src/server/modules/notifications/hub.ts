import type { Database } from '../../db/database.ts'

/**
 * Wakes the open live streams when relayed events may be waiting. Streams read the events
 * themselves, so a wake-up carries no data and several wake-ups while a stream is busy collapse
 * into one more read: no event is lost and none is sent twice.
 *
 * The relay's NOTIFY wakes streams at once (see `relay.ts`). While a stream is open, the hub also
 * checks the newest relayed event every `pollMs`, which covers a missed notification and another
 * instance's relay.
 */
export interface Subscription {
  /**
   * Resolves after a wake-up since the previous call, after `timeoutMs`, or when `signal` aborts.
   * Resolves `false` once the hub has closed: the stream should end.
   */
  wait(signal: AbortSignal, timeoutMs: number): Promise<boolean>
  close(): void
}

export interface Hub {
  subscribe(): Subscription
  /** New events may be readable: wake every open stream. */
  wake(): void
  /** Open streams. */
  readonly size: number
  close(): void
}

interface Subscriber {
  pending: boolean
  closed: boolean
  resolve?: () => void
}

export function createHub(database: Database, { pollMs = 5_000 } = {}): Hub {
  const subscribers = new Set<Subscriber>()
  let timer: NodeJS.Timeout | undefined
  let head: string | undefined

  function wake() {
    for (const subscriber of subscribers) {
      subscriber.pending = true
      subscriber.resolve?.()
    }
  }

  async function poll() {
    try {
      const [row] = await database.query<{ head: string }>(
        'select coalesce(max(relay_seq), 0)::text as head from outbox_events',
      )
      if (head !== undefined && row?.head !== head) wake()
      head = row?.head
    } catch {
      // The next poll tries again; streams also wake on their own idle timeout.
    }
  }

  function stopPolling() {
    clearInterval(timer)
    timer = undefined
    head = undefined
  }

  return {
    subscribe() {
      const subscriber: Subscriber = { pending: false, closed: false }
      subscribers.add(subscriber)
      if (!timer) {
        timer = setInterval(() => void poll(), pollMs)
        timer.unref()
        void poll()
      }
      return {
        async wait(signal, timeoutMs) {
          if (!subscriber.pending && !subscriber.closed && !signal.aborted) {
            await new Promise<void>((resolve) => {
              const done = () => {
                clearTimeout(timeout)
                signal.removeEventListener('abort', done)
                subscriber.resolve = undefined
                resolve()
              }
              const timeout = setTimeout(done, timeoutMs)
              signal.addEventListener('abort', done, { once: true })
              subscriber.resolve = done
            })
          }
          subscriber.pending = false
          return !subscriber.closed
        },
        close() {
          subscriber.closed = true
          subscriber.resolve?.()
          subscribers.delete(subscriber)
          if (!subscribers.size) stopPolling()
        },
      }
    },
    wake,
    get size() {
      return subscribers.size
    },
    close() {
      stopPolling()
      for (const subscriber of subscribers) {
        subscriber.closed = true
        subscriber.resolve?.()
      }
      subscribers.clear()
    },
  }
}
