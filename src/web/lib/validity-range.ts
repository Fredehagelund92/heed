import { addDays, lastValidDay } from '@domain/status'
import { isCalendarDate } from '@domain/validity'

/**
 * When an item applies, as the screen shows it and as the service stores it. The stored end is
 * exclusive (requirements, Appendix A, C08): an item that applies through 6 October is stored
 * with `end: '2026-10-07'`. People never see the exclusive day; the screen asks for and shows
 * the last day it applies. These helpers are the only place the two meet.
 */

/** The stored window: `end` is the first day it no longer applies, or null when open. */
export type StoredValidity = { start: string | null; end: string | null }

/** The last day it applies (inclusive), for a stored exclusive end. */
export function lastDayFromEnd(end: string | null): string | null {
  return end === null ? null : lastValidDay(end)
}

/** The stored exclusive end, for the last day a person picked. */
export function endFromLastDay(lastDay: string | null): string | null {
  return lastDay === null ? null : addDays(lastDay, 1)
}

/** A UTC day as a Date at midnight UTC, for the calendar. */
export function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

/** A calendar Date back to its UTC day. */
export function dateToIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Today, as a UTC day (NFR-048). */
export function utcToday(): string {
  return dateToIso(new Date())
}

const monthNames = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

function iso(year: number, month: number, day: number): string | null {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isCalendarDate(value) ? value : null
}

/**
 * Reads a typed day: "2026-08-04", "4 Aug 2026", "4 August 2026", "Aug 4, 2026" or "4/8/2026"
 * (day first, as the app writes dates). Returns the UTC day, or null when it is not a real day.
 */
export function parseDay(text: string): string | null {
  const value = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ')
  if (value === '') return null

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))

  const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value)
  if (numeric) return iso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]))

  const monthOf = (word: string) => {
    if (word.length < 3) return 0
    return monthNames.findIndex((name) => name.startsWith(word.replace(/\.$/, ''))) + 1
  }
  const dayFirst = /^(\d{1,2}) ([a-z.]+) (\d{4})$/.exec(value)
  if (dayFirst) {
    const month = monthOf(dayFirst[2] ?? '')
    return month ? iso(Number(dayFirst[3]), month, Number(dayFirst[1])) : null
  }
  const monthFirst = /^([a-z.]+) (\d{1,2}) (\d{4})$/.exec(value)
  if (monthFirst) {
    const month = monthOf(monthFirst[1] ?? '')
    return month ? iso(Number(monthFirst[3]), month, Number(monthFirst[2])) : null
  }
  return null
}

export type ValidityProblem = { field: 'start' | 'end'; message: string }

/**
 * What is wrong with a window as a person entered it, in plain words. `requireEnd` is set when
 * the person said it ended (an issue) and so must name the last day.
 */
export function validityProblems(
  { start, lastDay }: { start: string | null; lastDay: string | null },
  { requireEnd = false }: { requireEnd?: boolean } = {},
): ValidityProblem[] {
  const problems: ValidityProblem[] = []
  if (start === null) problems.push({ field: 'start', message: 'Enter the first day it applies.' })
  if (requireEnd && lastDay === null)
    problems.push({
      field: 'end',
      message: 'Enter the last day, or choose that it is still going on.',
    })
  if (start !== null && lastDay !== null && lastDay < start)
    problems.push({ field: 'end', message: 'The last day must be on or after the first day.' })
  return problems
}
