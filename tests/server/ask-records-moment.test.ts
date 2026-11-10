import { describe, expect, it } from 'vitest'
import { momentOf } from '../../src/server/modules/answer/records.ts'
import type { Clock } from '../../src/server/clock.ts'

/*
  The records' moment on a pinned day (HEED_FIXED_TODAY): a day pinned in the past is kept whole,
  so a stamp on it stays the day it says, as the Context list shows it, and has happened by the
  moment, at any hour the service runs; a stamp the database made while it runs moves back onto it.
*/

const pinned = (today: string, real: string): Clock => ({
  now: () => new Date(real),
  today: () => today,
})

describe("the records' moment on a pinned day", () => {
  it('reads a stamp later on the day it keeps as that day, and as past, before that hour as after it', () => {
    for (const real of ['2026-11-10T07:55:00.000Z', '2026-11-10T12:00:00.000Z']) {
      const moment = momentOf(pinned('2026-10-23', real))
      expect(moment.now).toBe('2026-10-23T23:59:59.999Z')
      expect(moment.moved('2026-10-23T09:00:00.000Z')).toBe('2026-10-23T09:00:00.000Z')
      expect(moment.moved('2026-10-05T09:00:00.000Z')).toBe('2026-10-05T09:00:00.000Z')
    }
  })

  it('moves a stamp made while it runs onto the day it keeps', () => {
    const moment = momentOf(pinned('2026-10-23', '2026-11-10T07:55:00.000Z'))
    expect(moment.moved('2026-11-10T07:54:00.000Z')).toBe('2026-10-23T07:54:00.000Z')
    expect(moment.moved('2026-11-07T15:00:00.000Z')).toBe('2026-10-20T15:00:00.000Z')
  })

  it('keeps the real moment on a day that is not pinned', () => {
    const moment = momentOf(pinned('2026-11-10', '2026-11-10T07:55:00.000Z'))
    expect(moment.now).toBe('2026-11-10T07:55:00.000Z')
    expect(moment.moved('2026-11-10T07:54:00.000Z')).toBe('2026-11-10T07:54:00.000Z')
  })
})
