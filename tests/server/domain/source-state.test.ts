import { describe, expect, it } from 'vitest'
import {
  READ_MAY_RUN_SECONDS,
  isDue,
  sourceState,
  type SourceStateInput,
} from '../../../src/domain/source-state.ts'

const now = new Date('2026-11-11T10:02:00Z')
const at = (secondsFromNow: number) => new Date(now.getTime() + secondsFromNow * 1000)
const ok = { status: 'ok', keyRefused: false } as const
const partial = { status: 'partial', keyRefused: false } as const
const failed = { status: 'failed', keyRefused: false } as const
const refused = { status: 'failed', keyRefused: true } as const

const source = (over: Partial<SourceStateInput> = {}): SourceStateInput => ({
  enabled: true,
  nextReadAt: at(3_600),
  readingSince: null,
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

describe('how a source is', () => {
  const cases: [string, Partial<SourceStateInput>, ReturnType<typeof sourceState>][] = [
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
      'failed, retry in a minute: scheduled, failed',
      { nextReadAt: at(60), lastRead: failed },
      { read: 'scheduled', last: 'failed', health: 'failed' },
    ],
    [
      'failed, retry queued',
      { nextReadAt: at(-10), lastRead: failed },
      { read: 'queued', last: 'failed', health: 'failed' },
    ],
    [
      'failed, retrying now',
      { nextReadAt: at(-10), readingSince: at(-2), lastRead: failed },
      { read: 'reading', last: 'failed', health: 'failed' },
    ],
    [
      'key refused, retry queued',
      { nextReadAt: at(-10), lastRead: refused },
      { read: 'queued', last: 'refused', health: 'reauth' },
    ],
    // Paused: nothing is pending, the last result is kept, and a stale mark counts for nothing.
    ['paused after a good read', { enabled: false }, { read: null, last: 'ok', health: 'paused' }],
    [
      'paused after a failure keeps it',
      { enabled: false, lastRead: failed, nextReadAt: at(-10) },
      { read: null, last: 'failed', health: 'paused' },
    ],
    [
      'paused before its first read',
      { enabled: false, lastRead: null, nextReadAt: at(0), readingSince: at(-1) },
      { read: null, last: 'never', health: 'paused' },
    ],
  ]

  it.each(cases)('%s', (_name, over, expected) => {
    expect(sourceState(source(over), now)).toEqual(expected)
  })
})
