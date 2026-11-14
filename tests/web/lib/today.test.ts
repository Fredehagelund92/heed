import { afterEach, describe, expect, it } from 'vitest'
import { relativeDate } from '@/model/history'
import { inForce, ageDays, timeNow } from '@/lib/timeframe'
import { setToday, today, DEMO_TODAY } from '@/lib/today'

// The web has no day of its own: it reads the service's, and the demo world's until one arrives.

afterEach(() => setToday(DEMO_TODAY))

describe("the service's day", () => {
  it('is the demo world’s day until the service names one', () => {
    expect(today()).toBe('2026-10-23')
    expect(relativeDate('2026-10-20')).toBe('3 days ago')
  })

  it('dates what a list says by the day the service names', () => {
    setToday('2027-01-20')
    expect(relativeDate('2027-01-19')).toBe('yesterday')
    expect(relativeDate('2027-01-20')).toBe('today')
    expect(relativeDate('2026-09-10')).toBe('10 Sep 2026')
    expect(ageDays('10 Sep 2026')).toBe(132)
  })

  it('says whether a window is in force on the service’s day', () => {
    const since = { t: 'since', from: Date.UTC(2027, 2, 9) } as const
    expect(timeNow(since)).toBe('Starts 9 Mar 2027')
    setToday('2027-03-09')
    expect(inForce(since)).toBe(true)
    expect(timeNow(since)).toBe('In force now')
  })
})
