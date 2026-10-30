import { COMPARE_FROM, countChange, shareChange, type Change } from '@domain/observability'
import type { SummaryPeriod } from '@domain/obs-summary'
import type { DomainId } from './items'
import { HIDE_UNDER, type Count } from './observability'

// Observability's Summary: the last whole calendar month or quarter, for someone who reads it
// rather than explores it, such as a manager the page is passed to. Every count comes from the
// binding already through one disclosure pass (src/domain/obs-summary.ts): a count under 5 is null,
// and none gives a hidden one away. The sentences here are fixed templates over those counts, never
// written by a model, and a sentence shows only when its count is shown.

export type { SummaryPeriod }
export const SUMMARY_PERIODS: Record<SummaryPeriod, string> = {
  month: 'Last month',
  quarter: 'Last quarter',
}

/** Days from `start` up to, not including, `end`, as UTC timestamps. */
export type Period = { start: number; end: number }

export type SummaryData = {
  /** Nothing asked yet; fewer than 5 in the period (no counts at all); or counted. */
  state: 'empty' | 'quiet' | 'normal'
  period: SummaryPeriod
  /** The last day counted: the numbers are as of its end. */
  last: number
  now: Period
  before: Period
  /** The first day agents asked anything in the domains read. */
  since: number | null
  /** Whether every day of the period is still counted. */
  complete: boolean
  numbers: { asked: Count; checked: Count; warned: Count; missing: Count }
  /** The period before, or null when it is not compared. */
  previous: { asked: Count; checked: Count; missing: Count } | null
  /** Why the period before is not compared: agents first asked after it began, or it is no longer all counted. */
  notCompared: 'started' | 'not_kept' | null
  /** The trend: what was checked each week, oldest first. */
  weeks: { at: number; counted: boolean; checked: Count }[]
  /** Topics whose questions found nothing and that are still open, the biggest first. */
  open: {
    total: number
    spots: {
      id: string
      title: string
      domain?: DomainId
      /** The first day its questions found nothing. */
      since: number
      /** What found nothing about it in the period. */
      missing: Count
      /** What waits for it: a draft, a suggestion, or nothing yet. */
      label: string
      href: string
    }[]
  }
  /** Changes approved in review and published in the period, the latest five. */
  changes: {
    total: Count
    before: Count
    latest: { at: number; title: string; domain?: DomainId; by: string; href?: string }[]
  }
  /** How many numbers on the page are hidden. */
  hidden: number
}

/* ---------- words ---------- */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const DAY = 86_400_000

/** "September 2026"; a quarter as "July to September 2026", or across a year "November 2026 to January 2027". */
export function periodName(p: Period) {
  const a = new Date(p.start)
  const b = new Date(p.end - DAY)
  const month = (d: Date) => MONTHS[d.getUTCMonth()]!
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear())
    return `${month(a)} ${a.getUTCFullYear()}`
  return a.getUTCFullYear() === b.getUTCFullYear()
    ? `${month(a)} to ${month(b)} ${b.getUTCFullYear()}`
    : `${month(a)} ${a.getUTCFullYear()} to ${month(b)} ${b.getUTCFullYear()}`
}

/** "23 Oct 2026": a day as the page says it. */
export const dayName = (at: number) => {
  const d = new Date(at)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)} ${d.getUTCFullYear()}`
}

const n = (v: number) => v.toLocaleString('en-GB')
/** A count of changes as the page says it: hidden means under 5. */
export const changesWords = (v: Count) => (v === null ? 'Fewer than 5' : n(v))
/** A count as a sentence says it: "Fewer than 5" for one under 5. */
export const countWords = (v: number) => (v > 0 && v < HIDE_UNDER ? 'Fewer than 5' : n(v))

/** Shares in whole per cent from this many questions; below it, words; under COMPARE_FROM, none. */
export const EXACT_FROM = 100

const FRACTIONS: [number, string][] = [
  [1 / 10, 'about one in ten'],
  [1 / 5, 'about one in five'],
  [1 / 4, 'about one in four'],
  [1 / 3, 'about one in three'],
  [2 / 5, 'about two in five'],
  [1 / 2, 'about half'],
  [3 / 5, 'about three in five'],
  [2 / 3, 'about two in three'],
  [3 / 4, 'about three in four'],
  [4 / 5, 'about four in five'],
  [9 / 10, 'about nine in ten'],
]

/**
 * A share as the page may say it: "65%" from 100 questions; "about two in three" from 30; and
 * nothing under 30, or when either count is hidden, as a share of so few says nothing.
 */
export function shareWords(part: Count, whole: Count): string | null {
  if (part === null || whole === null || whole < COMPARE_FROM) return null
  if (whole >= EXACT_FROM) return `${Math.round((part / whole) * 100)}%`
  if (part === 0) return 'none'
  if (part === whole) return 'all'
  const f = part / whole
  return FRACTIONS.reduce((a, b) => (Math.abs(b[0] - f) < Math.abs(a[0] - f) ? b : a))[1]
}

/** What each headline number counts, exactly: one click away on the page and printed under it. */
export const DEFINITIONS = {
  asked:
    'Calls from AI agents to the answer tool whose question named something that could be read, such as a metric or a market. Questions are counted, not people: the words of a question and who asked are never kept.',
  checked:
    'Questions whose answer was based on checked context: an owner published it with a source and a check date, and it applies to what was asked. Answers with a warning are not counted here.',
  warned:
    'Questions answered with a warning: only part of what was asked was covered, two items disagreed, or an item was past its check date.',
  missing:
    'Questions with nothing written down for them. The agent was told so, and the topic waits for an owner to write it.',
  changes:
    'Changes to context items that an owner approved in review and published, so agents get them from then on.',
} as const

/* ---------- the numbers ---------- */

/** A move as the page says it: "About the same", or up or down beyond what chance would make. */
export type Move = { direction: Change['direction']; words: string }

const both = (a: Count, b: Count) => a !== null && b !== null

/** The headline numbers and how each moved from the period before, when that means something. */
export function summaryNumbers(data: SummaryData) {
  const { asked, checked, warned, missing } = data.numbers
  const was = data.previous
  const big = (a: Count, b: Count) =>
    a !== null && b !== null && a >= COMPARE_FROM && b >= COMPARE_FROM
  const move = (change: Change | null, words: (c: Change) => string): Move | null =>
    change
      ? {
          direction: change.direction,
          words: change.direction === 'same' ? 'About the same' : words(change),
        }
      : null
  const points = (c: Change) => `${c.by > 0 ? '+' : ''}${c.by} pts`
  const exact = (a: Count, b: Count) => (a ?? 0) >= EXACT_FROM && (b ?? 0) >= EXACT_FROM
  // A share's move in points only when both shares are given in per cent; else only its way.
  const shareMove = (c: Change) =>
    exact(asked, was?.asked ?? null) ? points(c) : c.direction === 'up' ? 'Higher' : 'Lower'
  return {
    asked,
    checked,
    warned,
    missing,
    checkedShare: shareWords(checked, asked),
    warnedShare: shareWords(warned, asked),
    missingShare: shareWords(missing, asked),
    askedBefore: was?.asked ?? null,
    // Counts move by more or fewer calls, compared only when both periods have enough.
    askedMove:
      was && big(asked, was.asked)
        ? move(countChange(asked!, was.asked!), (c) => {
            const pct = Math.round((c.by / was.asked!) * 100)
            return `${pct > 0 ? '+' : ''}${pct}%`
          })
        : null,
    checkedMove:
      was && both(checked, was.checked) && both(asked, was.asked)
        ? move(shareChange(checked!, asked!, was.checked!, was.asked!), shareMove)
        : null,
    missingMove:
      was && both(missing, was.missing) && both(asked, was.asked) && missing! >= HIDE_UNDER
        ? move(shareChange(missing!, asked!, was.missing!, was.asked!), shareMove)
        : null,
  }
}

/* ---------- the sentences ---------- */

/** A line of "What we caught": a sentence over a count, or a thing not measured yet. */
export type CaughtLine = { key: string; title: string; text: string; measured: boolean }

/**
 * What the period comes to, in three to five plain sentences from fixed templates: what was
 * asked, how much of it was checked, what found nothing and is still open, and what changed. A
 * sentence shows only when its count is shown; none is ever written by a model.
 */
export function summarySentences(data: SummaryData): string[] {
  const s = summaryNumbers(data)
  const out: string[] = []
  const name = periodName(data.now)
  const before = periodName(data.before)
  if (s.asked !== null) {
    const was =
      s.askedBefore !== null
        ? s.askedMove?.direction === 'same'
          ? `, about the same as in ${before} (${countWords(s.askedBefore)})`
          : ` (${countWords(s.askedBefore)} in ${before})`
        : ''
    out.push(`Agents asked ${countWords(s.asked)} questions in ${name}${was}.`)
  }
  if (s.checked !== null)
    out.push(
      s.checked === 0
        ? 'None of them had an answer based on checked context.'
        : `${countWords(s.checked)}${s.checkedShare ? ` (${s.checkedShare})` : ''} had an answer fully based on checked context.`,
    )
  if (s.missing !== null && s.missing > 0) {
    const open = data.open.total
    out.push(
      `${countWords(s.missing)} found nothing written down${
        open
          ? `; ${open === 1 ? 'one topic like that is' : `${n(open)} topics like that are`} still open`
          : ''
      }.`,
    )
  }
  const changes = data.changes.total
  out.push(
    changes === 0
      ? `No change was approved and published in ${name}.`
      : `${changes === null ? 'Fewer than 5' : n(changes)} changes were approved by an owner and published.`,
  )
  return out
}

/**
 * What was caught, as three separate lines that are never added up, and never "prevented": what
 * went out with a warning, which is counted today, and two that are not measured yet.
 */
export function caughtLines(data: SummaryData): CaughtLine[] {
  const { warned } = data.numbers
  return [
    {
      key: 'warned',
      title: 'Answered with a warning',
      measured: true,
      text:
        warned === null
          ? 'Hidden this period, so it cannot give a count under 5 away.'
          : warned === 0
            ? 'No answer went out with a warning.'
            : `${countWords(warned)} answers went out with a warning: only part of the question was covered, two items disagreed, or an item was past its check date. The agent was told each time.`,
    },
    {
      key: 'saved',
      title: 'Saved questions that changed after a publish',
      measured: false,
      text: 'Not measured yet. Quality shows what each saved question says now.',
    },
    {
      key: 'alerts',
      title: 'Alerts that owners acted on',
      measured: false,
      text: 'Not measured yet. Alerts shows what raises a card in the Inbox.',
    },
  ]
}

/** Why there is no comparison with the period before, in a line. */
export function notComparedWords(data: SummaryData): string | null {
  if (data.notCompared === 'started' && data.since !== null)
    return `No comparison with ${periodName(data.before)}: agents first asked on ${dayName(data.since)}${
      data.since > data.now.start ? `, after ${periodName(data.now)} began` : ''
    }.`
  if (data.notCompared === 'not_kept')
    return `No comparison with ${periodName(data.before)}: its records are no longer all kept.`
  return null
}
