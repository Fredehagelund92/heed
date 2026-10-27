import type { SourceErrorClass } from './connector-runtime.ts'

/*
  When a source is read next (CON-115, docs/connectors.md "Warnings, health and schedules"). Each
  source has its own schedule, at or above its connector's minimum. A good read, or one that
  failed for a reason an administrator must fix, waits a whole period. A failure that clears by
  itself (a timeout, too many requests) is tried again sooner, doubling the wait each time, but
  never later than half of how long the source may go unread, and never sooner than the tool
  asked.
*/

/** The first wait after a failure that clears by itself, in seconds. */
export const RETRY_FIRST_SECONDS = 60

/** The period a source is read at, in seconds: its own, but never under the connector's minimum. */
export function scheduleSeconds(
  own: number | null,
  connector: { defaultSeconds: number; minimumSeconds: number },
): number {
  return Math.max(own ?? connector.defaultSeconds, connector.minimumSeconds)
}

/**
 * When to read next, after a read that ended now: `failures` counts the failed reads in a row,
 * this one included (0 after a good read).
 */
export function nextReadAt(
  now: Date,
  read: {
    periodSeconds: number
    staleAfterSeconds: number
    failures: number
    failure?: SourceErrorClass
    retryAfterSeconds?: number
  },
): Date {
  let wait = read.periodSeconds
  if (read.failures > 0 && read.failure === 'transient') {
    const backoff = RETRY_FIRST_SECONDS * 2 ** Math.min(read.failures - 1, 20)
    wait = Math.min(backoff, read.periodSeconds, Math.max(read.staleAfterSeconds / 2, 60))
    wait = Math.max(wait, read.retryAfterSeconds ?? 0)
  }
  return new Date(now.getTime() + wait * 1000)
}

/** Seconds as an ISO 8601 duration of days, hours and minutes: 3600 is `PT1H`, 86400 `P1D`. */
export function durationText(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const rest = minutes % 60
  const time = `${hours ? `${hours}H` : ''}${rest ? `${rest}M` : ''}`
  return `P${days ? `${days}D` : ''}${time ? `T${time}` : days ? '' : 'T0M'}`
}
