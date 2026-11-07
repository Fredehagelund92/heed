import { anyDate, isAnyDate, isCalendarDate, shiftDate, type DateWindow } from './validity.ts'

/*
  The date reader: the period the words of a question name, read the same way for get_context,
  find_context, report and Ask. It reads a day, a range of days, a month, a quarter, a year, the
  periods people name from today ("this year", "last quarter", "year to date") and the days back
  to today ("the last 30 days", "this past week"). A named period is the whole period ("in 2026"
  is 1 Jan to 31 Dec 2026), a "this" period runs to today, a "last" one is the last complete one,
  and a day, month or quarter without a year is the latest one that has started. Words that name a
  period Heed cannot read are never replaced: the reader names them and says what it reads. It is
  a pure function of the text and today, a calendar day in one time zone: the company's, else UTC
  (NFR-048), which `readsAs` names.

  Ask reads people, who write dates loosely, so it reads with `loose` on (FR-720): part of a period
  ("early August", "the end of last quarter"), a season, "two weeks ago", "the past few days", a
  weekend, "before" or "after" a period, and two periods at once, each resolved against today and
  said in `readsAs`. Words it still cannot place never stop the question: they are named, and the
  days they could mean are all read. get_context keeps its strict reader.
*/

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
const shortMonths = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()
const yearOf = (day: string) => Number(day.slice(0, 4))
const monthOf = (day: string) => Number(day.slice(5, 7))

/** A day as people read it: "14 Oct 2026". */
export const dayWords = (day: string) =>
  `${Number(day.slice(8, 10))} ${shortMonths[monthOf(day) - 1]} ${day.slice(0, 4)}`

/** A day as the voice guide writes it in a sentence: "14 October 2026". */
export const longDayWords = (day: string) => {
  const month = monthNames[monthOf(day) - 1]!
  return `${Number(day.slice(8, 10))} ${month[0]!.toUpperCase()}${month.slice(1)} ${day.slice(0, 4)}`
}

/**
 * The days of a window (end exclusive) as people read them: "7 Oct 2026", "1-7 Oct 2026"; every
 * date (`anyDate`) is "any date".
 */
export function windowWords(window: DateWindow, { upTo = false } = {}): string {
  if (isAnyDate(window)) return 'any date'
  if (window.end === null) return `from ${dayWords(window.start)}`
  const last = shiftDate(window.end, -1)
  if (upTo && window.start === anyDate.start) return `up to ${dayWords(last)}`
  if (last <= window.start) return dayWords(window.start)
  const [from, to] = [dayWords(window.start), dayWords(last)]
  if (window.start.slice(0, 7) === last.slice(0, 7)) return `${from.split(' ')[0]}-${to}`
  if (window.start.slice(0, 4) === last.slice(0, 4))
    return `${from.split(' ').slice(0, 2).join(' ')} to ${to}`
  return `${from} to ${to}`
}

const monthWord = (day: string) => {
  const name = monthNames[monthOf(day) - 1]!
  return `${name[0]!.toUpperCase()}${name.slice(1)}`
}
/** The month of a day, with its whole name, as the voice guide writes it: "October 2026". */
export const monthWords = (day: string) => `${monthWord(day)} ${day.slice(0, 4)}`

/** A day with its whole month name, as the voice guide writes it: "14 October 2026". */
export const fullDayWords = (day: string) =>
  `${Number(day.slice(8, 10))} ${monthWord(day)} ${day.slice(0, 4)}`

/**
 * The days of a window (end exclusive) as a phrase that follows a subject, with whole month names
 * (docs/design/voice.md, principle 8): "on 14 October 2026", "from 1 to 7 October 2026", "in
 * September 2026", "from July to September 2026", "in 2026", "from 15 June 2026 on", "at any date".
 */
export function periodWords(window: DateWindow, { upTo = false } = {}): string {
  if (isAnyDate(window)) return 'at any date'
  if (window.end === null) return `from ${fullDayWords(window.start)} on`
  const last = shiftDate(window.end, -1)
  if (upTo && window.start === anyDate.start) return `up to ${fullDayWords(last)}`
  if (last <= window.start) return `on ${fullDayWords(window.start)}`
  const [start, end] = [window.start, last]
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  // Whole months read as months: a month, a quarter, a year.
  if (start.endsWith('-01') && shiftDate(end, 1).endsWith('-01')) {
    if (sameYear && start.slice(5) === '01-01' && end.slice(5) === '12-31')
      return `in ${start.slice(0, 4)}`
    if (start.slice(0, 7) === end.slice(0, 7)) return `in ${monthWord(start)} ${start.slice(0, 4)}`
    return sameYear
      ? `from ${monthWord(start)} to ${monthWord(end)} ${end.slice(0, 4)}`
      : `from ${monthWord(start)} ${start.slice(0, 4)} to ${monthWord(end)} ${end.slice(0, 4)}`
  }
  if (start.slice(0, 7) === end.slice(0, 7))
    return `from ${Number(start.slice(8, 10))} to ${fullDayWords(end)}`
  if (sameYear)
    return `from ${Number(start.slice(8, 10))} ${monthWord(start)} to ${fullDayWords(end)}`
  return `from ${fullDayWords(start)} to ${fullDayWords(end)}`
}

/** A day some months away, on the same day of the month or the last day of a shorter month. */
function addMonths(day: string, months: number): string {
  const index = yearOf(day) * 12 + monthOf(day) - 1 + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return iso(year, month, Math.min(Number(day.slice(8, 10)), daysIn(year, month)))
}

/** Inclusive days. */
export type Period = { from: string; to: string }
/**
 * The periods people name, as inclusive days counted from today; weeks start on Monday. A "this"
 * period runs to today, a "last" one is the last complete one, and a "next" one is whole.
 */
export function periods(today: string) {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
  const monday = shiftDate(today, -weekday)
  const month = `${today.slice(0, 8)}01`
  const quarter = iso(yearOf(today), Math.floor((monthOf(today) - 1) / 3) * 3 + 1, 1)
  const year = `${today.slice(0, 4)}-01-01`
  const before = (start: string, months: number): Period => ({
    from: addMonths(start, -months),
    to: shiftDate(start, -1),
  })
  const after = (start: string, months: number): Period => ({
    from: addMonths(start, months),
    to: shiftDate(addMonths(start, 2 * months), -1),
  })
  return {
    thisWeek: { from: monday, to: today },
    lastWeek: { from: shiftDate(monday, -7), to: shiftDate(monday, -1) },
    nextWeek: { from: shiftDate(monday, 7), to: shiftDate(monday, 13) },
    thisMonth: { from: month, to: today },
    lastMonth: before(month, 1),
    nextMonth: after(month, 1),
    thisQuarter: { from: quarter, to: today },
    lastQuarter: before(quarter, 3),
    nextQuarter: after(quarter, 3),
    thisYear: { from: year, to: today },
    lastYear: before(year, 12),
    nextYear: after(year, 12),
  } satisfies Record<string, Period>
}

/** Where a period sits in the text the reader was given. */
export type DateSpan = { start: number; end: number }
export type DatesRead =
  /** No words in the text name dates. */
  | { status: 'none' }
  /**
   * One period. `readsAs` says how Heed read it, for a person: the days, what they are and the
   * time zone, "1 Jan to 7 Oct 2026 (this year so far; UTC)".
   */
  | {
      status: 'read'
      window: DateWindow
      readsAs: string
      spans: DateSpan[]
      /** With `loose`: words that name dates Heed could not place. */
      unplaced?: string[]
    }
  /** Words that name dates Heed cannot read, or more than one period, and what it reads. */
  | { status: 'unreadable'; spans: DateSpan[]; message: string }

type Unit = 'day' | 'month' | 'quarter' | 'year'
/** A day, month, quarter or year as written, with its year when one was given. */
type Point = { unit: Unit; year: number | null; month: number; day: number }
type Claim = DateSpan & ({ period: Period; what: string[] } | { unreadable: true })

const MONTH =
  '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\b\\.?'
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?\\b'
const YEAR = '((?:19|20)\\d{2})\\b'
const numberWords = 'one two three four five six seven eight nine ten eleven twelve'.split(' ')
const COUNT = `(\\d{1,5}|${numberWords.join('|')})`
const ordinals: Record<string, number> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
}
const monthNumber = (word: string) => {
  const w = word.replace(/\.$/, '')
  return monthNames.findIndex((name) => name === w || name.slice(0, 3) === w.slice(0, 3)) + 1
}
const sticky = (source: string) => new RegExp(source, 'y')
const at = (pattern: RegExp, text: string, index: number) => {
  pattern.lastIndex = index
  return pattern.exec(text)
}

/** The ways a single day, month, quarter or year is written, tried in this order. */
const pointPatterns: [RegExp, (m: RegExpExecArray) => Point | null][] = [
  [
    sticky('(\\d{4})-(\\d{2})-(\\d{2})\\b'),
    (m) => {
      const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
      return isCalendarDate(m[0]) ? { unit: 'day', year, month, day } : null
    },
  ],
  [
    sticky(`(\\d{4})-(\\d{2})\\b(?!-)`),
    (m) => {
      const month = Number(m[2])
      return month >= 1 && month <= 12 ? { unit: 'month', year: Number(m[1]), month, day: 1 } : null
    },
  ],
  [
    sticky(`${DAY} (?:of )?${MONTH}(?:,? ${YEAR})?`),
    (m) => day(m[3], monthNumber(m[2]!), Number(m[1])),
  ],
  [sticky(`${MONTH} ${DAY}(?:,? ${YEAR})?`), (m) => day(m[3], monthNumber(m[1]!), Number(m[2]))],
  [
    sticky(`${MONTH},? ${YEAR}`),
    (m) => ({ unit: 'month', year: Number(m[2]), month: monthNumber(m[1]!), day: 1 }),
  ],
  [
    sticky(`(?:the )?(first|second|third|fourth|1st|2nd|3rd|4th) quarter(?: of)?(?: ${YEAR})?`),
    (m) => quarter(ordinals[m[1]!]!, m[2]),
  ],
  [sticky(`q([1-4])(?:[ /-]?${YEAR})?`), (m) => quarter(Number(m[1]), m[2])],
  [sticky(`${YEAR}[ /-]?q([1-4])\\b`), (m) => quarter(Number(m[2]), m[1])],
]
function day(year: string | undefined, month: number, date: number): Point | null {
  if (date < 1 || date > 31) return null
  return { unit: 'day', year: year ? Number(year) : null, month, day: date }
}
function quarter(q: number, year: string | undefined): Point {
  return { unit: 'quarter', year: year ? Number(year) : null, month: (q - 1) * 3 + 1, day: 1 }
}
/**
 * A month named alone, "in August". "May" and short names ("Mar") count only after a word that
 * makes them a month ("in May") or as the end of a range, as "may" and "mar" are also words.
 */
const lonePattern = sticky(`(${monthNames.join('|')}|${shortMonths.join('|').toLowerCase()})\\b`)
/** A word before a lone "may" or "mar" that makes it a month: "in May", "since March". */
const monthBefore =
  /\b(?:in|during|for|of|from|since|until|till|to|through|by|before|after|early|mid|late|and|between)\s$/
const yearPattern = sticky(YEAR)
/** A number of things, not a year: "2000 euros", "over 2000". */
const quantityAfter =
  /^\s?(?:%|percent|eur|euros?|usd|dollars?|gbp|pounds?|sek|nok|dkk|kr|k|m|bn|users?|customers?|accounts?|people|orders?|transactions?|sessions?|games?|times|items?|rows?|units?|points?|bps)\b/
const quantityBefore =
  /(?:[$€£]|\b(?:over|above|below|under|than|exceeding|least|most|approximately|roughly|nearly|almost|top))\s?$/

/** The first and last day of a point in a year, or null when the day does not exist. */
function bounds(point: Point, year: number): Period | null {
  const { unit, month } = point
  if (unit === 'day')
    return point.day <= daysIn(year, month)
      ? { from: iso(year, month, point.day), to: iso(year, month, point.day) }
      : null
  if (unit === 'month')
    return { from: iso(year, month, 1), to: iso(year, month, daysIn(year, month)) }
  if (unit === 'quarter')
    return { from: iso(year, month, 1), to: iso(year, month + 2, daysIn(year, month + 2)) }
  return { from: iso(year, 1, 1), to: iso(year, 12, 31) }
}
/** The year of a point written without one: the latest in which it has started. */
const latestStarted = (point: Point, today: string) =>
  iso(yearOf(today), point.month, point.day) <= today ? yearOf(today) : yearOf(today) - 1
const startsBefore = (a: Point, b: Point) =>
  a.month < b.month || (a.month === b.month && a.day < b.day)

/** The days a point names, reading a missing year as the latest one that has started. */
function pointPeriod(point: Point, today: string): { period: Period; what: string[] } | null {
  const year = point.year ?? latestStarted(point, today)
  const period = bounds(point, year)
  if (!period) return null
  const what = point.year === null ? [`year not given, so ${year}`] : []
  if (point.unit !== 'day' && period.to > today && period.from <= today)
    what.push(`the whole ${point.unit}, including the days after today`)
  return { period, what }
}
/** Two points as one range: a year given on one side counts for the other. */
function rangePeriod(
  first: Point,
  last: Point,
  today: string,
): { period: Period; what: string[] } | null {
  let [y1, y2] = [first.year, last.year]
  const what: string[] = []
  if (y1 === null && y2 !== null) y1 = startsBefore(last, first) ? y2 - 1 : y2
  if (y1 === null) {
    y1 = latestStarted(first, today)
    what.push(`year not given, so ${y1}`)
  }
  if (y2 === null) y2 = startsBefore(last, first) ? y1 + 1 : y1
  const from = bounds(first, y1)
  const to = bounds(last, y2)
  if (!from || !to || to.to < from.from) return null
  return { period: { from: from.from, to: to.to }, what }
}

type Named = { period: Period; what: string[] }
const trailingPattern = sticky(
  '(?:this past|the past|past|the last) (week|month|quarter|year)\\b(?! of\\b)',
)
const countPattern = sticky(
  `(?:the )?(?:last|past|previous) ${COUNT} (day|week|month|quarter|year)s?\\b`,
)
const calendarPattern = sticky(
  '(this|last|previous|next|coming) (week|month|quarter|year)\\b(?! of\\b)',
)
const toDatePattern = sticky(
  '(ytd|mtd|qtd|wtd|year[ -]to[ -]date|month[ -]to[ -]date|quarter[ -]to[ -]date|week[ -]to[ -]date)\\b',
)
const dayPattern = sticky('(today|yesterday|tomorrow)\\b')
const monthsIn = { month: 1, quarter: 3, year: 12 } as Record<string, number>
const capital = (word: string) => `${word[0]!.toUpperCase()}${word.slice(1)}`

/** The days back to today: "the last 7 days", "this past week", "the past 3 months". */
function trailing(count: number, unit: string, today: string): Named | null {
  if (count < 1 || count > 36600) return null
  const days = unit === 'week' ? 7 * count : count
  if (unit === 'day' || unit === 'week')
    return {
      period: { from: shiftDate(today, 1 - days), to: today },
      what: [`the ${days === 1 ? 'day' : `${days} days`} to today`],
    }
  const months = count * monthsIn[unit]!
  return {
    period: { from: shiftDate(addMonths(today, -months), 1), to: today },
    what: [`the ${months === 1 ? 'month' : `${months} months`} to today`],
  }
}

/** The periods named from today: "this year", "last quarter", "this past week", "ytd". */
function namedPeriod(text: string, index: number, today: string): (Named & { end: number }) | null {
  const p = periods(today)
  let m = at(trailingPattern, text, index)
  if (m) return { ...trailing(1, m[1]!, today)!, end: index + m[0].length }
  m = at(countPattern, text, index)
  if (m) {
    const count = /\d/.test(m[1]!) ? Number(m[1]) : numberWords.indexOf(m[1]!) + 1
    const named = trailing(count, m[2]!, today)
    return named && { ...named, end: index + m[0].length }
  }
  m = at(calendarPattern, text, index)
  if (m) {
    const which = ({ previous: 'last', coming: 'next' } as Record<string, string>)[m[1]!] ?? m[1]!
    const unit = m[2]!
    const period = p[`${which}${capital(unit)}` as keyof typeof p]
    const label =
      which === 'this'
        ? ' so far'
        : unit === 'week'
          ? ', Monday to Sunday'
          : unit === 'quarter'
            ? `, Q${Math.floor((monthOf(period.from) - 1) / 3) + 1} ${yearOf(period.from)}`
            : ''
    return { period, what: [`${which} ${unit}${label}`], end: index + m[0].length }
  }
  m = at(toDatePattern, text, index)
  if (m) {
    const unit = ({ y: 'year', m: 'month', q: 'quarter', w: 'week' } as Record<string, string>)[
      m[1]![0]!
    ]!
    const period = p[`this${capital(unit)}` as keyof typeof p]
    return { period, what: [`${unit} to date`], end: index + m[0].length }
  }
  m = at(dayPattern, text, index)
  if (m) {
    const day = shiftDate(today, { today: 0, yesterday: -1, tomorrow: 1 }[m[1] as 'today'])
    return { period: { from: day, to: day }, what: [m[1]!], end: index + m[0].length }
  }
  return null
}

/** A day, month, quarter or year at `index`; an `endpoint` of a range may be a short month. */
function pointAt(text: string, index: number, endpoint = false) {
  for (const [pattern, read] of pointPatterns) {
    const m = at(pattern, text, index)
    if (m) return { point: read(m), end: index + m[0].length }
  }
  const lone = at(lonePattern, text, index)
  if (lone) {
    const word = lone[1]!
    const plain = monthNames.includes(word) && word !== 'may'
    if (plain || endpoint || monthBefore.test(text.slice(0, index)))
      return {
        point: { unit: 'month', year: null, month: monthNumber(word), day: 1 } as Point,
        end: index + lone[0].length,
      }
  }
  const year = at(yearPattern, text, index)
  if (year && !isQuantity(text, index, index + year[0].length))
    return {
      point: { unit: 'year', year: Number(year[1]), month: 1, day: 1 } as Point,
      end: index + year[0].length,
    }
  return null
}
/** A number of things, not a year: "2000 euros", "over 2000". */
const isQuantity = (text: string, start: number, end: number) =>
  quantityAfter.test(text.slice(end)) || quantityBefore.test(text.slice(0, start))

const separator = sticky('(?:\\s?[-–—]\\s?| (?:to|until|till|through|thru|and) )')
const toToday = sticky(' (?:to|until|till|up to|up until|through) (?:today|now|date)\\b')
const dayRange = sticky(
  `(\\d{1,2})(?:st|nd|rd|th)?(?:\\s?[-–]\\s?| (?:to|until|till|through|and) )`,
)
const monthDayRange = sticky(
  `${MONTH} ${DAY}\\s?(?:[-–]|to|until|through)\\s?${DAY}(?:,? ${YEAR})?`,
)
const lead = sticky('(?:(from|between|since) |so far (?:in |during |for )?)')
const wholeOf = sticky(
  '(?:the )?(?:(?:whole|entire|full|all)(?: of)?|month of|year of|year) (?:the )?',
)
const soFar = sticky(' (?:so far|to date)\\b')
/** The words before a period that make it part of one Heed does not read: "end of", "early". */
const qualified =
  /(?:\b(?:early|mid|late|earlier|later|h[12])[- ]?|\b(?:before|after|until|till|by|around|ending|starting|prior to|earlier than|later than|beyond|spring|summer|autumn|winter|christmas|easter) |\b(?:(?:first|second|third|fourth|last|final|1st|2nd) )?(?:end|start|beginning|middle|rest|remainder|half|part|week|weeks|day|days|weekend|close|turn|most|course) of (?:the )?)$/

/**
 * Words that name a period Heed does not read, after the periods it read are taken out: a period
 * by an event or a season ("since the launch", "this summer"), a count it cannot place ("the past
 * few days", "two weeks ago"), part of a period ("first half"), and dates that do not exist
 * ("2026-02-30"). A word that only says "about now" ("recently", "so far", "right now") names no
 * period: such a question is read at today, and the reply says so.
 */
const unreadablePatterns = [
  /\b(?:(?:a|an|\d+|one|two|three|four|five|six|few|a few|several|couple of|a couple of) )?(?:(?:days?|weeks?|months?|quarters?|years?|while) )?ago\b/g,
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
  /\b(?:19|20)\d{2}\b/g,
  /\bq[1-4]\b/g,
  /\b(?:january|february|march|april|june|july|august|september|october|november|december|jan|feb|apr|jun|jul|aug|sept?|oct|nov|dec)\b/g,
  /\b(?:in|during|since|until|from|early|mid|late) (?:may|mar)\b/g,
  /\b(?:last|past|next|previous|coming|recent|few|couple of|several|this) (?:[a-z0-9]+ )?(?:days?|weeks?|months?|quarters?|years?|fortnight|half|season)\b/g,
  /\b(?:since|before|after|around|over|in|during|this|last|next|early|late) (?:the )?(?:spring|summer|autumn|winter|weekends?)\b/g,
  /\b(?:h[12]|(?:first|second|1st|2nd) half|fiscal|fy ?\d{2,4})\b/g,
  /\b(?:since|before|after) (?:the |our )?(?:launch|release|change|migration|update|campaign|outage|incident|rebrand|merger|switch|cutover|go-live|start|beginning|then)\b/g,
]

/** What only the loose reader names as dates it could not place; the strict reader leaves them be. */
const looseUnreadablePatterns = [
  /\b(?:since|after|before|until|till) the fall\b(?! (?:in|of)\b)/g,
  /\bthe (?:week|month|quarter|year) (?:before|after) (?!(?:last|that|this)\b)(?:the |our )?[a-z][a-z-]*/g,
]

type Found = (Named & { end: number }) | { end: number; bad: true }
/** A date written with slashes, dots or day-first dashes, "12/10/2026", "10.12.2026", "10-12-26": which part is the day is a guess. */
const numericDate = /\b(?:\d{1,4}([/.])\d{1,2}\1\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4})\b/g

/** A period at `index`: a range, a named period or a point, and where it ends. */
function periodAt(text: string, index: number, today: string): Found | null {
  const ranged = (range: Named | null, end: number): Found =>
    range ? { ...range, end } : { end, bad: true }
  // A day before a day and its month: "1 to 7 October 2026", "6 and 7 Oct".
  const days = at(dayRange, text, index)
  if (days) {
    const last = pointAt(text, index + days[0].length, true)
    if (last?.point?.unit === 'day')
      return ranged(
        rangePeriod({ ...last.point, day: Number(days[1]) }, last.point, today),
        last.end,
      )
  }
  // "Oct 1-7, 2026"
  const us = at(monthDayRange, text, index)
  if (us) {
    const month = monthNumber(us[1]!)
    const [a, b] = [day(us[4], month, Number(us[2])), day(us[4], month, Number(us[3]))]
    return ranged(a && b && rangePeriod(a, b, today), index + us[0].length)
  }
  const named = namedPeriod(text, index, today)
  const first = named ? null : pointAt(text, index)
  if (!named && !first) return null
  const firstEnd = named?.end ?? first!.end
  // "from 1 Aug 2026 to today", "2024 up to today"
  const upTo = at(toToday, text, firstEnd)
  const single = named ?? (first!.point && pointPeriod(first!.point, today))
  if (upTo)
    return ranged(
      single && { period: { from: single.period.from, to: today }, what: ['to today'] },
      firstEnd + upTo[0].length,
    )
  // A range: "1 Jan to 30 Sep", "March to May 2026", "2024-2025", "last month to this month".
  const sep = at(separator, text, firstEnd)
  if (sep) {
    const next = firstEnd + sep[0].length
    const last = pointAt(text, next, true)
    if (first && last) {
      if (!first.point || !last.point) return { end: last.end, bad: true }
      return ranged(rangePeriod(first.point, last.point, today), last.end)
    }
    const to = last ? null : namedPeriod(text, next, today)
    if (single && to && sep[0].trim() !== 'and')
      return ranged(
        to.period.to >= single.period.from
          ? { period: { from: single.period.from, to: to.period.to }, what: [] }
          : null,
        to.end,
      )
  }
  return ranged(single, firstEnd)
}

/** A period cut at today, "October 2026 so far"; one that ended before today stays whole. */
const soFarOf = (named: Named, today: string): Named =>
  named.period.to < today || named.what.some((w) => /so far|to date|to today/.test(w))
    ? named
    : {
        period: { from: named.period.from, to: today },
        what: [...named.what.filter((w) => !w.includes('after today')), 'so far'],
      }

/* ---------- what people write that the strict reader does not place ---------- */

const NUMBER_WORD = `\\d{1,3}|${numberWords.join('|')}|an?`
const FEW: Record<string, number> = { few: 3, 'a few': 3, couple: 2, 'a couple': 2, several: 5 }
const countOf = (word: string) =>
  /\d/.test(word)
    ? Number(word)
    : FEW[word] !== undefined
      ? FEW[word]
      : word === 'a' || word === 'an'
        ? 1
        : numberWords.indexOf(word) + 1
const weekdays = 'monday tuesday wednesday thursday friday saturday sunday'.split(' ')
const mondayOf = (day: string) =>
  shiftDate(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7))
export const wholePeriod = (unit: string, today: string): Period => {
  if (unit === 'week') return { from: mondayOf(today), to: shiftDate(mondayOf(today), 6) }
  const months = monthsIn[unit]!
  const start = Math.floor((monthOf(today) - 1) / months) * months + 1
  const from = iso(yearOf(today), start, 1)
  return { from, to: shiftDate(addMonths(from, months), -1) }
}
/** The whole period of a unit some periods back from the one today is in. */
const back = (unit: string, count: number, today: string): Period => {
  const { from } = wholePeriod(unit, today)
  if (unit === 'week') {
    const monday = shiftDate(from, -7 * count)
    return { from: monday, to: shiftDate(monday, 6) }
  }
  const start = addMonths(from, -count * monthsIn[unit]!)
  return { from: start, to: shiftDate(addMonths(start, monthsIn[unit]!), -1) }
}
const daysOf = ({ from, to }: Period) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1

const SEASON_MONTHS: Record<string, [number, string]> = {
  spring: [3, 'March to May'],
  summer: [6, 'June to August'],
  autumn: [9, 'September to November'],
  fall: [9, 'September to November'],
  winter: [12, 'December to February'],
}
const seasonOf = (name: string, year: number): Period => {
  const from = iso(year, SEASON_MONTHS[name]![0], 1)
  return { from, to: shiftDate(addMonths(from, 3), -1) }
}
/** The season the words mean: "this" the one that year, "last" the last ended, alone the latest started. */
function seasonPeriod(name: string, which: string | undefined, today: string): Period {
  let year = yearOf(today)
  const started = (y: number) => seasonOf(name, y).from <= today
  if (which === 'this')
    return seasonOf(name, name === 'winter' && monthOf(today) <= 2 ? year - 1 : year)
  if (which === 'next' || which === 'coming') {
    while (started(year)) year++
    return seasonOf(name, year)
  }
  while (!started(year)) year--
  if (which && seasonOf(name, year).to >= today) year--
  return seasonOf(name, year)
}

const SEASON_LEAD =
  '(this|last|next|past|previous|coming|in|during|over|the|in the|during the|over the)'
const seasonPattern = sticky(
  `(?:${SEASON_LEAD} )?(?:the )?(spring|summer|autumn|fall|winter)(?: of)?(?: ${YEAR})?\\b(?! (?:sales?|campaigns?|collections?|ranges?|promotions?|promos?|launch|drops?|lines?|prices?)\\b)`,
)
const agoPattern = sticky(
  `(?:about |around |roughly )?(${NUMBER_WORD}|a few|few|a couple|couple|several)(?: of)? (day|week|month|quarter|year)s? ago\\b`,
)
const fewPattern = sticky(
  `(?:the |these )?(?:(?:last|past|previous|this past) (?:(few|a few|couple of|couple|several) )|(?:(recent) ))(day|week|month|quarter|year)s\\b`,
)
const fortnightPattern = sticky('(?:(?:the|this) )?(?:(?:last|past|previous) )?fortnight\\b')
const weekendPattern = sticky(
  '(?:(?:the|over the|this past) )?(?:(last|this|next|past|previous) )?weekend\\b',
)
const weekdayPattern = sticky(`(last|this|next|on|past|previous) (${weekdays.join('|')})\\b`)
const nearPattern = sticky('(earlier|later) (?:this|in the) (week|month|quarter|year)\\b')
const beforeLastPattern = sticky(
  'the (week|month|quarter|year) before(?: last\\b| that\\b|\\b(?! (?!(?:compared|versus|vs|against|and|or|than|to|for|in|on|by)\\b)\\S))',
)
const monthOfYearPattern = sticky(
  `(${monthNames.join('|')}|${shortMonths.join('|').toLowerCase()}|q[1-4])(?: of)? (last|this) year\\b`,
)
const lastMonthNamePattern = sticky(`(last|this) (${monthNames.join('|')}|q[1-4])\\b`)
const yearAgoPattern = sticky('(?:this|the same) (time|week|month|quarter)(?: as)? last year\\b')
const fiscalNamedPattern = sticky('(this|last|next) (?:fiscal|financial) (year|quarter)\\b')
const fiscalYearPattern = sticky(`(?:fy|fiscal(?: year)?|financial year) ?'?(\\d{4}|\\d{2})\\b`)
const halfNamePattern = sticky(`h([12])(?:(?: of)? (?:${YEAR}|(last|this) year))?\\b`)
const periodEndPattern = sticky('(?:the )?(week|month|quarter|year)[- ]end\\b')
const weekOfPattern = sticky(
  '(?:the )?(?:week|weekend) (?:of|starting|beginning|commencing) (?:the )?',
)
const partPattern = sticky(
  '(?:the )?(?:very )?(early|mid|middle|late|start|beginning|end|close|(?:first|second) half|(?:first|second|third|fourth|last|final) week|first day|last day|(?:first|last) few days)(?:(?:-| )in|-| of| )(?: the)? ?',
)
const untilPattern = sticky('(before|until|till|by|up to|up until|prior to|earlier than) ')
const afterPattern = sticky('(after|later than|beyond|since) ')
const aroundPattern = sticky('(?:around|about|circa|roughly) ')
const thePeriodPattern = sticky('(?:the |this )?(week|month|quarter|year)\\b')

/** The days of a period a part of it names: "early", "the second half", "the last week". */
function partOf(period: Period, part: string): Period {
  const { from, to } = period
  const days = daysOf(period)
  const third = Math.floor(days / 3)
  const on = (n: number) => shiftDate(from, n)
  if (['early', 'start', 'beginning'].includes(part)) return { from, to: on(third - 1) }
  if (['mid', 'middle'].includes(part)) return { from: on(third), to: on(2 * third - 1) }
  if (['late', 'end', 'close'].includes(part)) return { from: on(2 * third), to }
  if (part.endsWith('half')) {
    const months = Math.round(days / 30.4)
    const split =
      months > 0 && months % 2 === 0
        ? addMonths(from, months / 2)
        : shiftDate(from, Math.floor(days / 2))
    return part.startsWith('first') ? { from, to: shiftDate(split, -1) } : { from: split, to }
  }
  if (part === 'first day') return { from, to: from }
  if (part === 'last day') return { from: to, to }
  if (part === 'first few days') return { from, to: on(2) }
  if (part === 'last few days') return { from: shiftDate(to, -2), to }
  if (part === 'last week' || part === 'final week') return { from: shiftDate(to, -6), to }
  const week = ['first', 'second', 'third', 'fourth'].indexOf(part.split(' ')[0]!)
  const start = on(7 * week)
  const end = shiftDate(start, 6)
  return { from: start, to: end > to ? to : end }
}

/** A loose period at `index`, with where it ends and how it is said, or null. */
function looseAt(text: string, index: number, today: string): (Named & { end: number }) | null {
  const said = (m: RegExpExecArray, period: Period, what = m[0]) => ({
    period,
    what: [what],
    end: index + m[0].length,
  })
  let m = at(partPattern, text, index)
  if (m) {
    const base = baseAt(text, index + m[0].length, today)
    if (base) {
      const period = partOf(base.period, m[1]!)
      return { period, what: [text.slice(index, base.end)], end: base.end }
    }
  }
  m = /(?:^|\s)(?:by|before|until|till|up to|up until|prior to) $/.test(text.slice(0, index))
    ? at(periodEndPattern, text, index)
    : null
  if (m) return said(m, partOf(wholePeriod(m[1]!, today), 'end'))
  m = at(halfNamePattern, text, index)
  if (m) {
    const year = m[2]
      ? Number(m[2])
      : m[3] === 'last'
        ? yearOf(today) - 1
        : m[1] === '2' && monthOf(today) < 7
          ? yearOf(today) - 1
          : yearOf(today)
    return said(
      m,
      partOf(
        { from: iso(year, 1, 1), to: iso(year, 12, 31) },
        `${m[1] === '1' ? 'first' : 'second'} half`,
      ),
    )
  }
  m = at(seasonPattern, text, index)
  const dropOfFall =
    m?.[2] === 'fall' &&
    !m[3] &&
    (m[1] === 'the' ||
      (/^(?:in|during|over)(?: the)?$/.test(m[1] ?? '') &&
        (m[0].endsWith(' of') ||
          /^ (?:in|of) (?!(?:19|20)\d{2}\b)/.test(text.slice(index + m[0].length)))))
  if (m && (m[1] || m[3]) && !dropOfFall) {
    const name = m[2]!
    const which = m[1]?.replace(/^(?:in|during|over)(?: the)?$|^the$/, '') || undefined
    const period = m[3] ? seasonOf(name, Number(m[3])) : seasonPeriod(name, which, today)
    return said(
      m,
      period,
      `${m[0].replace(/^(?:in|during|over)(?: the)? /, '')}, ${SEASON_MONTHS[name]![1]}`,
    )
  }
  m = at(agoPattern, text, index)
  if (m) {
    const count = countOf(m[1]!)
    const unit = m[2]!
    const vague = FEW[m[1]!] !== undefined
    if (unit === 'day') {
      const day = shiftDate(today, -count)
      return said(
        m,
        vague ? { from: shiftDate(day, -1), to: shiftDate(day, 1) } : { from: day, to: day },
      )
    }
    const period = back(unit, count, today)
    return said(
      m,
      vague
        ? { from: back(unit, count + 1, today).from, to: back(unit, count - 1, today).to }
        : period,
    )
  }
  m = at(fewPattern, text, index)
  if (m) {
    const count = m[2] ? 3 : countOf(m[1]!.replace(/ of$/, ''))
    const named = trailing(count, m[3]!, today)
    return named && said(m, named.period)
  }
  m = at(fortnightPattern, text, index)
  if (m) return said(m, { from: shiftDate(today, -13), to: today })
  m = at(weekendPattern, text, index)
  if (m) {
    const saturday = shiftDate(mondayOf(today), 5)
    const start =
      m[1] === 'next'
        ? shiftDate(saturday, 7)
        : m[1] === 'this' || saturday <= shiftDate(today, -1)
          ? saturday
          : shiftDate(saturday, -7)
    return said(m, { from: start, to: shiftDate(start, 1) })
  }
  m = at(weekdayPattern, text, index)
  if (m) {
    const wanted = weekdays.indexOf(m[2]!)
    const now = weekdays.indexOf(weekdays[(new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7]!)
    const gap = (now - wanted + 7) % 7 || 7
    const day =
      m[1] === 'this'
        ? shiftDate(mondayOf(today), wanted)
        : m[1] === 'next'
          ? shiftDate(mondayOf(today), 7 + wanted)
          : shiftDate(today, -gap)
    return said(m, { from: day, to: day })
  }
  m = at(nearPattern, text, index)
  if (m) {
    const { from, to } = wholePeriod(m[2]!, today)
    return m[1] === 'earlier'
      ? said(m, { from, to: shiftDate(today, -1) })
      : said(m, { from: shiftDate(today, 1), to })
  }
  m = at(beforeLastPattern, text, index)
  if (m) return said(m, back(m[1]!, 2, today))
  m = at(monthOfYearPattern, text, index) ?? at(lastMonthNamePattern, text, index)
  if (m) {
    const [first, second] = [m[1]!, m[2]!]
    const named = /^(?:last|this)$/.test(first) ? second : first
    const which = named === first ? second : first
    const point = at(pointPatterns[6]![0], named, 0)
      ? quarter(Number(named[1]), undefined)
      : ({ unit: 'month', year: null, month: monthNumber(named), day: 1 } as Point)
    const lately = latestStarted(point, today)
    // "Last August" is the last whole one; "August last year" is the year before this one.
    const year =
      named === first
        ? yearOf(today) - (which === 'last' ? 1 : 0)
        : which === 'this'
          ? yearOf(today)
          : bounds(point, lately)!.to >= today
            ? lately - 1
            : lately
    return said(m, bounds(point, year)!)
  }
  m = at(yearAgoPattern, text, index)
  if (m) {
    const unit = m[1] === 'time' ? 'month' : m[1]!
    const { from, to } = wholePeriod(unit, addMonths(today, -12))
    return said(m, { from, to })
  }
  m = at(fiscalNamedPattern, text, index)
  if (m) {
    const key = `${m[1]}${capital(m[2]!)}` as keyof ReturnType<typeof periods>
    return said(m, periods(today)[key], `${m[0]}, as the calendar ${m[2]}`)
  }
  m = at(fiscalYearPattern, text, index)
  if (m) {
    const year = m[1]!.length === 2 ? 2000 + Number(m[1]) : Number(m[1])
    if (year < 1900 || year > 9000) return null
    return said(
      m,
      { from: iso(year, 1, 1), to: iso(year, 12, 31) },
      `${m[0]}, as the calendar year`,
    )
  }
  m = at(weekOfPattern, text, index)
  if (m) {
    const point = pointAt(text, index + m[0].length)
    if (point?.point) {
      const named = pointPeriod(point.point, today)
      if (named) {
        const monday = mondayOf(named.period.from)
        return {
          period: { from: monday, to: shiftDate(monday, 6) },
          what: [text.slice(index, point.end)],
          end: point.end,
        }
      }
    }
  }
  return null
}

/** The period a part or a "before" is of: loose or strict, or "the month" as a whole. */
function baseAt(text: string, index: number, today: string) {
  const found = baseRead(text, index, today)
  const unit =
    found && /^(?:the )?this (week|month|quarter|year)$/.exec(text.slice(index, found.end))
  return unit ? { ...found, period: wholePeriod(unit[1]!, today) } : found
}

function baseRead(text: string, index: number, today: string) {
  const loose = looseAt(text, index, today)
  if (loose) return loose
  const the = text.startsWith('the ', index) ? 4 : 0
  const found = periodAt(text, index + the, today)
  if (found && !('bad' in found)) return found
  const m = at(thePeriodPattern, text, index)
  return m ? { period: wholePeriod(m[1]!, today), what: [m[0]], end: index + m[0].length } : null
}

/** "Before August", "by the end of the year", "after the summer": the days on that side of it. */
function sideOf(text: string, index: number, today: string): (Named & { end: number }) | null {
  const around = at(aroundPattern, text, index)
  if (around) return baseAt(text, index + around[0].length, today)
  const until = at(untilPattern, text, index)
  const after = until ? null : at(afterPattern, text, index)
  const lead = until ?? after
  if (!lead) return null
  const base = baseAt(text, index + lead[0].length, today)
  if (!base) return null
  const named = base.what[0]!
  if (
    /^(?:week|month|quarter|year)$/.test(named) ||
    (lead[1] === 'by' && /^the (?:week|month|quarter|year)$/.test(named))
  )
    return null
  const what = [text.slice(index, base.end)]
  if (after) {
    const from = after[1] === 'since' ? base.period.from : shiftDate(base.period.to, 1)
    return { period: { from, to: today }, what, end: base.end }
  }
  const inclusive = lead[1] === 'by' || lead[1]!.startsWith('up') || /[- ]end$/.test(base.what[0]!)
  return {
    period: {
      from: anyDate.start,
      to: inclusive ? base.period.to : shiftDate(base.period.from, -1),
    },
    what,
    end: base.end,
  }
}

/** Every loose period in the words, in order: what the strict reader then leaves alone. */
function loosePeriods(free: string, today: string): Claim[] {
  const claims: Claim[] = []
  for (let i = 0; i < free.length; i++) {
    if (!/[a-z0-9]/.test(free[i]!) || (i > 0 && /[a-z0-9]/.test(free[i - 1]!))) continue
    const found = sideOf(free, i, today) ?? looseAt(free, i, today)
    if (!found || found.period.from > found.period.to) continue
    claims.push({ start: i, ...found })
    i = found.end - 1
  }
  return claims
}

/** A date with slashes or dots as Heed's people write it, the day first: "12/10/2026". */
function numericPeriod(words: string): Named | null {
  const parts = words.split(/[/.-]/).map(Number) as [number, number, number]
  const [a, b, c] =
    words.indexOf('/') === 4 || parts[0] > 31 ? [parts[2], parts[1], parts[0]] : parts
  const [date, month] = b > 12 && a <= 12 ? [b, a] : [a, b]
  const year = c < 100 ? 2000 + c : c
  const day = iso(year, month, date)
  return isCalendarDate(day) ? { period: { from: day, to: day }, what: ['day first'] } : null
}

/**
 * The period the words of a text name. `text` is normalised (lower case, single spaces), and
 * `taken` holds the places other names already took, which are never read as dates. With `loose`,
 * what people write loosely is read too, and nothing comes back unreadable.
 */
export function readDates(
  text: string,
  today: string,
  {
    taken = new Set<number>(),
    timeZone = 'UTC',
    loose = false,
  }: { taken?: ReadonlySet<number>; timeZone?: string; loose?: boolean } = {},
): DatesRead {
  // A name stops a date: "Q3" never runs into the name after it.
  const claims: Claim[] = []
  for (const m of text.matchAll(numericDate)) {
    const [start, end] = [m.index, m.index + m[0].length]
    if ([...Array(end - start).keys()].some((k) => taken.has(start + k))) continue
    const read = loose ? numericPeriod(m[0]) : null
    claims.push(read ? { start, end, ...read } : { start, end, unreadable: true })
  }
  const free0 = [...text]
    .map((char, i) =>
      taken.has(i) || claims.some((c) => c.start <= i && i < c.end) ? '\u0000' : char,
    )
    .join('')
  if (loose) claims.push(...loosePeriods(free0, today))
  const free = [...free0]
    .map((char, i) => (claims.some((c) => c.start <= i && i < c.end) ? '\u0000' : char))
    .join('')
  for (let i = 0; i < free.length; i++) {
    if (!/[a-z0-9]/.test(free[i]!) || (i > 0 && /[a-z0-9]/.test(free[i - 1]!))) continue
    let start = i
    const led = at(lead, free, i)
    let from = i + (led?.[0].length ?? 0)
    // The words before a period that only name it: "the whole of", "all of", "the month of".
    const whole = led ? null : at(wholeOf, free, i)
    if (whole && periodAt(free, i + whole[0].length, today)) from += whole[0].length
    const found = periodAt(free, from, today)
    if (!found) continue
    const after = 'bad' in found ? null : at(soFar, free, found.end)
    const end = found.end + (after?.[0].length ?? 0)
    const qualifier = led ? null : qualified.exec(free.slice(0, start))
    if (qualifier) start -= qualifier[0].length
    if ('bad' in found || qualifier) claims.push({ start, end, unreadable: true })
    else {
      let named: Named = found
      if (led?.[1] === 'since')
        named = { period: { from: found.period.from, to: today }, what: ['to today'] }
      else if (led?.[0].startsWith('so far') || after) named = soFarOf(found, today)
      claims.push(
        named.period.from > named.period.to
          ? { start, end, unreadable: true }
          : { start, end, ...named },
      )
    }
    i = end - 1
  }
  // Words that name dates Heed did not read.
  const rest = [...free]
    .map((char, i) => (claims.some((c) => c.start <= i && i < c.end) ? '\u0000' : char))
    .join('')
  for (const pattern of loose
    ? [...looseUnreadablePatterns, ...unreadablePatterns]
    : unreadablePatterns)
    for (const m of rest.matchAll(pattern)) {
      const end = m.index + m[0].length
      if (/^\d{4}$/.test(m[0]) && isQuantity(rest, m.index, end)) continue
      if (claims.some((c) => c.start < end && m.index < c.end)) continue
      claims.push({ start: m.index, end, unreadable: true })
    }
  claims.sort((a, b) => a.start - b.start)
  if (!claims.length) return { status: 'none' }
  const spans = claims.map(({ start, end }) => ({ start, end }))
  const words = (c: DateSpan) => `'${text.slice(c.start, c.end)}'`
  const unreadable = claims.filter((c) => 'unreadable' in c)
  const read = claims.filter((c): c is DateSpan & Named => 'period' in c)
  const distinct = new Map(read.map((c) => [`${c.period.from}/${c.period.to}`, c]))
  if (loose && (unreadable.length || distinct.size > 1)) {
    const placed = [...distinct.values()]
    const window = placed.length
      ? {
          start: placed.map((c) => c.period.from).sort()[0]!,
          end: shiftDate(
            placed
              .map((c) => c.period.to)
              .sort()
              .at(-1)!,
            1,
          ),
        }
      : anyDate
    const what = [
      ...(placed.length > 1
        ? [`covers ${list(placed.map(words))}`]
        : placed.flatMap((c) => c.what)),
      ...(unreadable.length ? [`could not place ${list(unreadable.map(words))}`] : []),
      timeZone,
    ]
    return {
      status: 'read',
      window,
      readsAs: `${windowWords(window, { upTo: true })} (${what.join('; ')})`,
      spans,
      ...(unreadable.length ? { unplaced: unreadable.map((c) => text.slice(c.start, c.end)) } : {}),
    }
  }
  if (unreadable.length)
    return {
      status: 'unreadable',
      spans,
      message: `${list(unreadable.map(words))} cannot be read as dates. ${whatHeedReads(today)}`,
    }
  if (distinct.size > 1)
    return {
      status: 'unreadable',
      spans,
      message: `The question names more than one period (${list(read.map(words))}), and one is read at a time. Ask about one, or pass window with from and to for the days that cover them.`,
    }
  const { period, what } = read[0]!
  const window = { start: period.from, end: shiftDate(period.to, 1) }
  return {
    status: 'read',
    window,
    readsAs: `${windowWords(window, { upTo: loose })} (${[...new Set(what), timeZone].join('; ')})`,
    spans,
  }
}

const list = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * What the reader reads, with examples counted from today, so an agent or a person can ask again:
 * "The dates that can be read: a day (7 Oct 2026), a range (1-30 Sep 2026), ...".
 */
export function whatHeedReads(today: string): string {
  const { lastMonth, lastQuarter } = periods(today)
  const range = windowWords({ start: lastMonth.from, end: shiftDate(lastMonth.to, 1) })
  const month = `${capital(monthNames[monthOf(lastMonth.from) - 1]!)} ${yearOf(lastMonth.from)}`
  const quarter = `Q${Math.floor((monthOf(lastQuarter.from) - 1) / 3) + 1} ${yearOf(lastQuarter.from)}`
  return `The dates that can be read: a day (${dayWords(today)}), a range of days (${range}), a month (${month}), a quarter (${quarter}), a year (${yearOf(today)}), this, last or next week, month, quarter or year, year to date, and the last 30 days. Ask with one of these, or pass window with from and to.`
}
