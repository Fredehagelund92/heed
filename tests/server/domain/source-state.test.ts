import { describe, expect, it } from 'vitest'
import {
  READ_MAY_RUN_SECONDS,
  isDue,
  sourceHealth,
  sourceState,
  type SourceStateInput,
} from '../../../src/domain/source-state.ts'

const now = new Date('2026-11-11T10:02:00Z')
const at = (secondsFromNow: number) => new Date(now.getTime() + secondsFromNow * 1000)
// The last read ended a minute ago; the source is read every hour.
const ended = at(-60)
const ok = { at: ended, status: 'ok', keyRefused: false } as const
const partial = { at: ended, status: 'partial', keyRefused: false } as const
const failed = { at: ended, status: 'failed', keyRefused: false } as const
const refused = { at: ended, status: 'failed', keyRefused: true } as const

const source = (over: Partial<SourceStateInput> = {}): SourceStateInput => ({
  enabled: true,
  nextReadAt: at(3_600),
  readingSince: null,
  periodSeconds: 3_600,
  lastRead: ok,
  ...over,
})

describe('a source’s time has come', () => {
  it('is due at the moment it names and after, never before', () => {
    expect(isDue(at(-1), now)).toBe(true)
    expect(isDue(at(0), now)).toBe(true)
    expect(isDue(at(1), now)).toBe(false)
  })
})

/** A case's state, with the health its badge shows; an active one's next read is the input's. */
type Expected =
  | { intent: 'paused'; last: string; health: string }
  | { read: string; retry?: 'period' | 'backoff'; last: string; health: string }

describe('how a source is', () => {
  const cases: [string, Partial<SourceStateInput>, Expected][] = [
    // Connected, or its settings changed: queued (next read written as now), nothing read yet.
    [
      'just connected: queued, never read',
      { nextReadAt: at(0), lastRead: null },
      { read: 'queued', last: 'never', health: 'healthy' },
    ],
    [
      'changed after a good read: queued, the last result stands',
      { nextReadAt: at(0) },
      { read: 'queued', last: 'ok', health: 'healthy' },
    ],
    [
      'read again: queued',
      { nextReadAt: at(0), lastRead: partial },
      { read: 'queued', last: 'partial', health: 'healthy' },
    ],
    // The period is up and the job has not taken it: queued, not reading.
    [
      'its time is up, the job not yet here: queued (not a phantom reading)',
      { nextReadAt: at(-20) },
      { read: 'queued', last: 'ok', health: 'healthy' },
    ],
    [
      'the job has it: reading',
      { nextReadAt: at(-20), readingSince: at(-5) },
      { read: 'reading', last: 'ok', health: 'healthy' },
    ],
    [
      'the first read is running: reading, never read',
      { nextReadAt: at(0), readingSince: at(-5), lastRead: null },
      { read: 'reading', last: 'never', health: 'healthy' },
    ],
    [
      'the read ended: scheduled',
      { nextReadAt: at(3_600) },
      { read: 'scheduled', last: 'ok', health: 'healthy' },
    ],
    [
      'a mark of a job that died is no read: queued again',
      { nextReadAt: at(-1_000), readingSince: at(-(READ_MAY_RUN_SECONDS + 1)) },
      { read: 'queued', last: 'ok', health: 'healthy' },
    ],
    // A failure stays shown while a retry waits or runs.
    [
      'failed, retry in a minute: scheduled, failed, backing off',
      { nextReadAt: at(60), lastRead: failed },
      { read: 'scheduled', retry: 'backoff', last: 'failed', health: 'failed' },
    ],
    [
      'failed for a reason an admin must fix: scheduled a whole period on, not backing off',
      { nextReadAt: at(3_540), lastRead: failed },
      { read: 'scheduled', retry: 'period', last: 'failed', health: 'failed' },
    ],
    [
      'key refused: tried again a whole period on',
      { nextReadAt: at(3_540), lastRead: refused },
      { read: 'scheduled', retry: 'period', last: 'refused', health: 'reauth' },
    ],
    [
      'failed, retry queued',
      { nextReadAt: at(-10), lastRead: failed },
      { read: 'queued', retry: 'backoff', last: 'failed', health: 'failed' },
    ],
    [
      'failed, retrying now',
      { nextReadAt: at(-10), readingSince: at(-2), lastRead: failed },
      { read: 'reading', retry: 'backoff', last: 'failed', health: 'failed' },
    ],
    [
      'key refused, retry queued',
      { nextReadAt: at(-10), lastRead: refused },
      { read: 'queued', retry: 'backoff', last: 'refused', health: 'reauth' },
    ],
    // Paused: nothing is pending, the last result is kept, and a stale mark counts for nothing.
    [
      'paused after a good read',
      { enabled: false },
      { intent: 'paused', last: 'ok', health: 'paused' },
    ],
    [
      'paused after a failure keeps it',
      { enabled: false, lastRead: failed, nextReadAt: at(-10) },
      { intent: 'paused', last: 'failed', health: 'paused' },
    ],
    [
      'paused before its first read',
      { enabled: false, lastRead: null, nextReadAt: at(0), readingSince: at(-1) },
      { intent: 'paused', last: 'never', health: 'paused' },
    ],
  ]

  it.each(cases)('%s', (_name, over, expected) => {
    const input = source(over)
    const state = sourceState(input, now)
    const { health, ...rest } = expected
    expect(state).toEqual(
      'intent' in rest
        ? rest
        : { intent: 'active', nextReadAt: input.nextReadAt, retry: null, ...rest },
    )
    expect(sourceHealth(state)).toBe(health)
  })
})
