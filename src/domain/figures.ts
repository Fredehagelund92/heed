import { windowWords } from './dates.ts'
import { shiftDate } from './validity.ts'

/*
  Figures in Ask (FR-716): the days a figure is compared with, and the query in words. Pure, so
  Ask, the API and the tests read a figure's scope the same way. A figure is one measure over the
  question's days, compared with the same measure just before; nobody here checks it, and nothing
  here keeps it.
*/

/** Days, both included. */
export type Days = { from: string; to: string }

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
const pad = (n: number) => String(n).padStart(2, '0')
const parts = (day: string) =>
  [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))] as const
const monthStart = (year: number, month: number) => {
  const shifted = new Date(Date.UTC(year, month - 1, 1))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 }
}
const monthNames =
  'January February March April May June July August September October November December'.split(' ')

/** The days between two days, both included. */
export const dayCount = ({ from, to }: Days) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

/** Whether the days are whole months: from the first of one to the last of another. */
function wholeMonths({ from, to }: Days): number | null {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  if (fd !== 1 || td !== daysIn(ty, tm)) return null
  return (ty - fy) * 12 + (tm - fm) + 1
}

/**
 * The days a figure is compared with: the whole months before for whole months ("from July"), the
 * same days of the month before for a month so far ("1 to 22 Sep"), and otherwise as many days
 * just before.
 */
export function comparisonDays(days: Days): Days {
  const [fy, fm] = parts(days.from)
  const months = wholeMonths(days)
  if (months !== null) {
    const start = monthStart(fy, fm - months)
    const end = monthStart(fy, fm - 1)
    return {
      from: `${start.year}-${pad(start.month)}-01`,
      to: `${end.year}-${pad(end.month)}-${pad(daysIn(end.year, end.month))}`,
    }
  }
  const [ty, tm, td] = parts(days.to)
  if (parts(days.from)[2] === 1 && fy === ty && fm === tm) {
    const before = monthStart(fy, fm - 1)
    const last = Math.min(td, daysIn(before.year, before.month))
    const prefix = `${before.year}-${pad(before.month)}`
    return { from: `${prefix}-01`, to: `${prefix}-${pad(last)}` }
  }
  const length = dayCount(days)
  return { from: shiftDate(days.from, -length), to: shiftDate(days.from, -1) }
}

/** Days as people read them: "14 Oct 2026", "1 to 31 Aug 2026", "1 Jul to 30 Sep 2026". */
export const daysWords = ({ from, to }: Days) =>
  windowWords({ start: from, end: shiftDate(to, 1) }).replace(/^(\d+)-/, '$1 to ')

/** What a figure is compared with, after "from": "July", "1 to 22 Sep 2026", "the 23 days before". */
export function comparisonWords(days: Days): string {
  const before = comparisonDays(days)
  if (wholeMonths(days) === 1) return monthNames[parts(before.from)[1] - 1]!
  if (wholeMonths(days) !== null || parts(days.from)[2] === 1) return daysWords(before)
  return `the ${dayCount(before)} days before`
}

/** "Norway", "Norway and Spain", "Norway, Spain and Sweden". */
export const listed = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/** How a measure of a type is worked out, in words. */
function worked(type: string | null, tool: string) {
  if (type === 'sum') return 'added up'
  if (type === 'count' || type === 'countDistinct' || type === 'countDistinctApprox')
    return 'counted'
  if (type === 'avg') return 'averaged'
  if (type === 'min') return 'the lowest'
  if (type === 'max') return 'the highest'
  return `as ${tool} works it out`
}

/** A name inside a sentence: "Invoice day" as "invoice day", "ID" as it is. */
const inSentence = (name: string) =>
  /^[A-Z][a-z]/.test(name) ? name[0]!.toLowerCase() + name.slice(1) : name

/**
 * The query in words, first: "Orders, added up for Norway from 1 to 31 Aug 2026, and the same for
 * 1 to 31 Jul 2026 to compare." With the date it was read by when the view has several: "... from
 * 1 to 31 Aug 2026 by invoice day, ...".
 */
export function queryWords(query: {
  metric: string
  /** The measure's type as the tool says it: `sum`, `count`, `avg`, `number`. */
  type: string | null
  tool: string
  values: readonly string[]
  days: Days
  /** The date the days applied to, as people read it, when the view has several. */
  date?: string
  /** The measure does not add up over days: it was read on the last day. */
  snapshot?: boolean
}): string {
  const span = (days: Days) =>
    days.from === days.to ? `on ${daysWords(days)}` : `from ${daysWords(days)}`
  const where = query.values.length ? ` for ${listed(query.values)}` : ''
  const by = query.date ? ` by ${inSentence(query.date)}` : ''
  const before = comparisonDays(query.days)
  if (query.snapshot) {
    const on = (day: string) => daysWords({ from: day, to: day })
    return `${query.metric}${where} as of ${on(query.days.to)}${by}. It can't be added up over a period, so this is its value on the last day, and the same as of ${on(before.to)} to compare.`
  }
  return `${query.metric}, ${worked(query.type, query.tool)}${where} ${span(query.days)}${by}, and the same for ${daysWords(before)} to compare.`
}
