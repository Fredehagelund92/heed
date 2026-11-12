/*
  How a connected source is (CON-104, CON-115): one pure function the sources' job, their page, the
  operations view and the web all read, instead of each deriving it from the stored columns.

  Three facts are independent and kept apart:

  - the admin's intent: the source is active or paused (`connectors.enabled`)
  - the pending read, for an active source: scheduled (waiting for its time), queued (its time is
    up, or an admin asked, or it was just connected or changed, and the job has not taken it) or
    reading (the job has it now)
  - how the last read went: never read, ok, in part, failed, or failed because its key was refused

  A pending read is stored as one thing: `next_read_at` is when the source is read next, and a
  source is queued when that time has come. "Queued" is written as `now()`, never as NULL. A read
  that is running is the job's mark in `reading_since`, which is cleared when the read ends.
*/

/** The flat value a source's row and page show: the intent and the last read, not the pending read. */
export const sourceHealths = ['healthy', 'failed', 'reauth', 'paused'] as const
export type SourceHealth = (typeof sourceHealths)[number]

/** A source's pending read. */
export const sourceReads = ['scheduled', 'queued', 'reading'] as const
export type SourceRead = (typeof sourceReads)[number]

/** How the last read went; `refused` is a failure whose key was refused or is missing. */
export type SourceLast = 'never' | 'ok' | 'partial' | 'failed' | 'refused'

/**
 * The longest a read may run. A mark older than this is a job that died, so the source is queued
 * again, not reading for good. The job queue expires a run after the same time.
 */
export const READ_MAY_RUN_SECONDS = 15 * 60

/**
 * Whether a source's time has come. The one place that says it, for the job that reads the due
 * sources and the page that shows them queued; `now` is the database's clock.
 */
export const isDue = (nextReadAt: Date, now: Date): boolean => nextReadAt.getTime() <= now.getTime()

/** A read's warnings that say the source's key was refused, or is missing: it needs a new one. */
export const KEY_REFUSED_CODES: ReadonlySet<string> = new Set(['unauthorized', 'secret_missing'])

export interface SourceStateInput {
  /** False while an admin has paused reading it. */
  enabled: boolean
  /** When it is read next; at or before now, it is queued. */
  nextReadAt: Date
  /** When the job took it, while a read is running. */
  readingSince: Date | null
  /** Its last read; null before the first. */
  lastRead: { status: 'ok' | 'partial' | 'failed'; keyRefused: boolean } | null
}

export interface SourceState {
  /** Null while paused: nothing is pending for a source that is not read. */
  read: SourceRead | null
  last: SourceLast
  health: SourceHealth
}

export function sourceState(source: SourceStateInput, now: Date): SourceState {
  const last = lastOf(source.lastRead)
  if (!source.enabled) return { read: null, last, health: 'paused' }
  const running =
    source.readingSince !== null &&
    now.getTime() - source.readingSince.getTime() < READ_MAY_RUN_SECONDS * 1000
  const read: SourceRead = running
    ? 'reading'
    : isDue(source.nextReadAt, now)
      ? 'queued'
      : 'scheduled'
  return { read, last, health: healthOf(last) }
}

function lastOf(read: SourceStateInput['lastRead']): SourceLast {
  if (!read) return 'never'
  if (read.status !== 'failed') return read.status
  return read.keyRefused ? 'refused' : 'failed'
}

function healthOf(last: SourceLast): SourceHealth {
  if (last === 'refused') return 'reauth'
  return last === 'failed' ? 'failed' : 'healthy'
}
