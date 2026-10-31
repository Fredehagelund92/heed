/**
 * What Observability's Summary says in words (FR-620): fixed templates over its counts, never
 * written by a model, and a sentence shows only when its count is shown. The web app says them on
 * the page; the service says them once when it takes a monthly snapshot and keeps them with its
 * counts, so a digest printed from the snapshot later reads as it did that day. Pure: the counts
 * come already through the disclosure pass (src/domain/obs-summary.ts), a hidden one as null.
 */
import { ACT_DAYS, caughtTriggers, type CaughtTrigger, type CaughtView } from './obs-summary.ts'
import { COMPARE_FROM, countChange, shareChange, type Change, type Shown } from './observability.ts'

/** Days from `start` up to, not including, `end`, as UTC timestamps. */
export type Period = { start: number; end: number }

/** What the words read of a Summary: its periods, its counts, and what is open and changed. */
export type SummaryFacts = {
  now: Period
  before: Period
  /** The first day agents asked anything in the domains read. */
  since: number | null
  numbers: { asked: Shown; checked: Shown; warned: Shown; missing: Shown }
  previous: { asked: Shown; checked: Shown; missing: Shown } | null
  notCompared: 'started' | 'not_kept' | null
  open: { total: number }
  changes: { total: Shown }
  /** What was caught besides the answers with a warning; none in a snapshot taken before it was counted. */
  caught?: CaughtView | undefined
}

/** A count under this reads "Fewer than 5" (FR-614). */
const SMALL = 5

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
export const changesWords = (v: Shown) => (v === null ? 'Fewer than 5' : n(v))
/** A count as a sentence says it: "Fewer than 5" for one under 5. */
export const countWords = (v: number) => (v > 0 && v < SMALL ? 'Fewer than 5' : n(v))

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
export function shareWords(part: Shown, whole: Shown): string | null {
  if (part === null || whole === null || whole < COMPARE_FROM) return null
  if (whole >= EXACT_FROM) return `${Math.round((part / whole) * 100)}%`
  if (part === 0) return 'none'
  if (part === whole) return 'all'
  const f = part / whole
  return FRACTIONS.reduce((a, b) => (Math.abs(b[0] - f) < Math.abs(a[0] - f) ? b : a))[1]
}

/* ---------- the numbers ---------- */

/** A move as the page says it: "About the same", or up or down beyond what chance would make. */
export type Move = { direction: Change['direction']; words: string }

const both = (a: Shown, b: Shown) => a !== null && b !== null

/** The headline numbers and how each moved from the period before, when that means something. */
export function summaryNumbers(data: SummaryFacts) {
  const { asked, checked, warned, missing } = data.numbers
  const was = data.previous
  const big = (a: Shown, b: Shown) =>
    a !== null && b !== null && a >= COMPARE_FROM && b >= COMPARE_FROM
  const move = (change: Change | null, words: (c: Change) => string): Move | null =>
    change
      ? {
          direction: change.direction,
          words: change.direction === 'same' ? 'About the same' : words(change),
        }
      : null
  const points = (c: Change) => `${c.by > 0 ? '+' : ''}${c.by} pts`
  const exact = (a: Shown, b: Shown) => (a ?? 0) >= EXACT_FROM && (b ?? 0) >= EXACT_FROM
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
      was && both(missing, was.missing) && both(asked, was.asked) && missing! >= SMALL
        ? move(shareChange(missing!, asked!, was.missing!, was.asked!), shareMove)
        : null,
  }
}

/* ---------- the sentences ---------- */

/** A line of "What we caught": a sentence over a count, or a thing not measured yet. */
export type CaughtLine = { key: string; title: string; text: string; measured: boolean }

/** A change after which Heed checks the saved questions again, as a line says it. */
const TRIGGER_WORDS: Record<CaughtTrigger, string> = {
  publish: 'a publish',
  archive: 'an archive',
  restore: 'a restore',
  sync: 'a sync',
  check_date: 'a check date passed',
}

/** "a, b and c". */
const listWords = (parts: readonly string[]) =>
  parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)!}`

/**
 * A saved question's line: how many times its answer changed after a change, and after which ones,
 * as far as they are shown. The count is hidden only when it is small itself, so null reads
 * "Fewer than 5"; a kind of change that is hidden joins "other changes", which is then at least 5.
 */
function savedText(saved: CaughtView['saved']): string {
  const { total, triggers } = saved
  if (total === 0) return 'No saved question gave a different answer after a change.'
  if (total === null)
    return 'Fewer than 5 times, a saved question gave a different answer after a change.'
  const shown = caughtTriggers.filter((t) => (triggers[t] ?? 0) > 0)
  const rest = total - shown.reduce((n, t) => n + triggers[t]!, 0)
  const parts = shown.map((t) => `${countWords(triggers[t]!)} after ${TRIGGER_WORDS[t]}`)
  if (parts.length && rest > 0) parts.push(`${countWords(rest)} after other changes`)
  return `${countWords(total)} times, a saved question gave a different answer after a change${
    parts.length ? `: ${listWords(parts)}` : ''
  }.`
}

/**
 * The alerts' line: how many asked an owner for a decision, and how many an owner acted on. Both
 * stand alone, so a hidden one is under 5.
 */
function alertsText(alerts: CaughtView['alerts']): string {
  const { raised, acted } = alerts
  if (raised === 0) return 'No alert asked an owner for a decision.'
  const was = raised === null ? 'Fewer than 5' : countWords(raised)
  const them =
    acted === 0
      ? 'none was acted on'
      : acted !== null && acted === raised
        ? 'owners acted on all of them'
        : `owners acted on ${acted === null ? 'fewer than 5' : countWords(acted)} of them`
  return `${was} ${raised === 1 ? 'alert' : 'alerts'} asked an owner for a decision; ${them} within ${ACT_DAYS} days.`
}

/**
 * What the period comes to, in three to five plain sentences from fixed templates: what was
 * asked, how much of it was checked, what found nothing and is still open, and what changed. A
 * sentence shows only when its count is shown; none is ever written by a model.
 */
export function summarySentences(data: SummaryFacts): string[] {
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
  const caught = caughtSentence(data)
  if (caught) out.push(caught)
  return out
}

/**
 * What was caught, as three separate lines that are never added up, and never "prevented": what
 * went out with a warning, the saved questions that changed after a change, and the alerts that
 * asked an owner for a decision and were acted on. A Summary counted before the last two were has
 * them as not measured.
 */
export function caughtLines(data: SummaryFacts): CaughtLine[] {
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
    data.caught
      ? {
          key: 'saved',
          title: 'Saved questions that changed',
          measured: true,
          text: savedText(data.caught.saved),
        }
      : {
          key: 'saved',
          title: 'Saved questions that changed after a publish',
          measured: false,
          text: 'Not measured yet. Quality shows what each saved question says now.',
        },
    data.caught
      ? {
          key: 'alerts',
          title: 'Alerts that owners acted on',
          measured: true,
          text: alertsText(data.caught.alerts),
        }
      : {
          key: 'alerts',
          title: 'Alerts that owners acted on',
          measured: false,
          text: 'Not measured yet. Alerts shows what raises a card in the Inbox.',
        },
  ]
}

/**
 * One sentence on what was caught, for the sentences at the top: the saved questions when one
 * changed, else the alerts acted on, else the answers with a warning; "Nothing was caught" only
 * when all three are shown and none. A hidden saved or alert count stands alone, so it is under 5.
 * Never a total, never "prevented".
 */
export function caughtSentence(data: SummaryFacts): string | null {
  const caught = data.caught
  if (!caught) return null
  const { total, triggers } = caught.saved
  const { raised, acted } = caught.alerts
  const { warned } = data.numbers
  if (total !== 0) {
    const most =
      total === null ? undefined : caughtTriggers.find((t) => (triggers[t] ?? 0) * 2 > total)
    return `Saved questions caught a different answer ${
      total === null
        ? 'fewer than 5 times'
        : `${countWords(total)} ${total === 1 ? 'time' : 'times'}`
    } after a change${most ? `, most of them after ${TRIGGER_WORDS[most]}` : ''}.`
  }
  if (acted !== 0)
    return `Owners acted on ${acted === null ? 'fewer than 5' : countWords(acted)} of the alerts that asked them for a decision.`
  if (warned !== null && warned > 0)
    return `${countWords(warned)} answers went out with a warning, and the agent was told each time.`
  if (raised === 0 && warned === 0) return `Nothing was caught in ${periodName(data.now)}.`
  return null
}

/** Why there is no comparison with the period before, in a line. */
export function notComparedWords(data: SummaryFacts): string | null {
  if (data.notCompared === 'started' && data.since !== null)
    return `No comparison with ${periodName(data.before)}: agents first asked on ${dayName(data.since)}${
      data.since > data.now.start ? `, after ${periodName(data.now)} began` : ''
    }.`
  if (data.notCompared === 'not_kept')
    return `No comparison with ${periodName(data.before)}: its records are no longer all kept.`
  return null
}

/** What a snapshot keeps in words: the sentences, what was caught, and why nothing is compared. */
export type SummaryWords = { sentences: string[]; caught: CaughtLine[]; notes: string[] }

/** The words of a Summary as a snapshot keeps them, said once when it is taken. */
export function summaryWords(data: SummaryFacts & { complete: boolean }): SummaryWords {
  return {
    sentences: summarySentences(data),
    caught: caughtLines(data),
    notes: [
      notComparedWords(data),
      data.complete
        ? null
        : `Some of ${periodName(data.now)} is no longer kept, so its counts may be low.`,
    ].filter((line): line is string => !!line),
  }
}
