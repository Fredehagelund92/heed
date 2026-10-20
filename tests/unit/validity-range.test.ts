import { describe, expect, it } from 'vitest'
import {
  dateToIso,
  endFromLastDay,
  isoToDate,
  lastDayFromEnd,
  parseDay,
  validityProblems,
} from '@/lib/validity-range'

describe('the half-open validity window', () => {
  it('shows the stored exclusive end as the last day it applies', () => {
    expect(lastDayFromEnd('2026-10-07')).toBe('2026-10-06')
    expect(lastDayFromEnd('2026-03-01')).toBe('2026-02-28')
    expect(lastDayFromEnd('2028-03-01')).toBe('2028-02-29')
    expect(lastDayFromEnd('2027-01-01')).toBe('2026-12-31')
  })

  it('stores the last day a person picks as the next day', () => {
    expect(endFromLastDay('2026-10-06')).toBe('2026-10-07')
    expect(endFromLastDay('2026-12-31')).toBe('2027-01-01')
    expect(endFromLastDay('2028-02-28')).toBe('2028-02-29')
  })

  it('keeps an open end open both ways', () => {
    expect(lastDayFromEnd(null)).toBeNull()
    expect(endFromLastDay(null)).toBeNull()
  })

  it('round trips every day of a leap year', () => {
    let day = '2028-01-01'
    for (let i = 0; i < 366; i += 1) {
      const end = endFromLastDay(day)
      expect(end).not.toBeNull()
      expect(lastDayFromEnd(end)).toBe(day)
      day = end ?? day
    }
  })

  it('a one-day window is valid once stored: the end is after the start', () => {
    const start = '2026-09-25'
    const end = endFromLastDay(start)
    expect(end).toBe('2026-09-26')
    expect(end !== null && end > start).toBe(true)
  })

  it('moves calendar dates as UTC days, whatever the local zone', () => {
    expect(dateToIso(isoToDate('2026-08-04'))).toBe('2026-08-04')
    expect(isoToDate('2026-08-04').toISOString()).toBe('2026-08-04T00:00:00.000Z')
  })
})

describe('reading a typed day', () => {
  it.each([
    ['2026-08-04', '2026-08-04'],
    ['4 Aug 2026', '2026-08-04'],
    ['4 august 2026', '2026-08-04'],
    ['  4  AUG  2026 ', '2026-08-04'],
    ['Aug 4, 2026', '2026-08-04'],
    ['4/8/2026', '2026-08-04'],
    ['04.08.2026', '2026-08-04'],
    ['29 Feb 2028', '2028-02-29'],
    ['4 Sept 2026', '2026-09-04'],
  ])('reads "%s"', (text, day) => {
    expect(parseDay(text)).toBe(day)
  })

  it.each(['', 'tomorrow', '31 Feb 2026', '2026-13-01', '29 Feb 2027', '4 Au 2026', '0000-01-01'])(
    'refuses "%s"',
    (text) => {
      expect(parseDay(text)).toBeNull()
    },
  )
})

describe('what is wrong with a window', () => {
  it('asks for the first day', () => {
    expect(validityProblems({ start: null, lastDay: null })).toEqual([
      { field: 'start', message: 'Enter the first day it applies.' },
    ])
  })

  it('allows an open end, and a last day on the first day', () => {
    expect(validityProblems({ start: '2026-08-04', lastDay: null })).toEqual([])
    expect(validityProblems({ start: '2026-08-04', lastDay: '2026-08-04' })).toEqual([])
  })

  it('refuses a last day before the first', () => {
    expect(validityProblems({ start: '2026-08-04', lastDay: '2026-08-03' })).toEqual([
      { field: 'end', message: 'The last day must be on or after the first day.' },
    ])
  })

  it('asks an ended issue for its last day', () => {
    expect(validityProblems({ start: '2026-09-25', lastDay: null }, { requireEnd: true })).toEqual([
      { field: 'end', message: 'Enter the last day, or choose that it is still going on.' },
    ])
  })
})
