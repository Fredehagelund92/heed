/**
 * Observability's Summary (FR-620): what agents asked over a fixed calendar period, the last whole
 * month or quarter, for a reader who wants a page to pass on rather than a view to explore. Its
 * numbers are counts only, never the words of a question or who asked (FR-602, FR-613), and every
 * one of them goes through one disclosure pass (`disclose`, FR-614), so no two numbers on the page
 * can be subtracted to give a count under the minimum away.
 *
 * A calendar month is not a run of whole weeks, and the trend is weekly (from `obs_weekly`), so
 * the days are cut into pieces: at every Monday and at each period's edges. Each piece lies inside
 * one week, and inside or outside each period. A whole week is read from the weekly roll-up when it
 * keeps it; a piece of a week, or a week it has not counted yet, from the delivery records. Every
 * number on the page is a sum of pieces, which is what the disclosure pass reasons about. Pure:
 * callers pass today and the minimum (`privacy.min_count`).
 */
import type { AlertRuleId } from './alerts.ts'
import { disclose, type Quantity, type Shown, type StateCounts } from './observability.ts'
import { shiftDate } from './validity.ts'

/** The fixed periods a Summary reads: the last whole calendar month, or quarter. */
export const summaryPeriods = ['month', 'quarter'] as const
export type SummaryPeriod = (typeof summaryPeriods)[number]

/** Days from `start` up to, not including, `end`. */
export type Span = { start: string; end: string }

/**
 * How an answer went, in the three ways a page for a reader tells apart: checked (based on checked
 * context), with a warning (partial, two items that disagree, or out of date), and not found.
 * Small counts such as a few conflicts join a bigger one, so fewer numbers are hidden.
 */
export const coarseStates = ['checked', 'warned', 'missing'] as const
export type CoarseState = (typeof coarseStates)[number]
export type Coarse = Record<CoarseState, number>

export const noCoarse = (): Coarse => ({ checked: 0, warned: 0, missing: 0 })
export const coarseOf = (c: StateCounts): Coarse => ({
  checked: c.grounded,
  warned: c.partial + c.conflict + c.stale,
  missing: c.missing,
})
export const coarseTotal = (c: Coarse) => c.checked + c.warned + c.missing

/* ---------- the calendar ---------- */

const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`
/** The first day of the month `n` months from the one `first` starts. */
function addMonths(first: string, n: number) {
  const months = Number(first.slice(0, 4)) * 12 + Number(first.slice(5, 7)) - 1 + n
  return `${String(Math.floor(months / 12)).padStart(4, '0')}-${String((months % 12) + 1).padStart(2, '0')}-01`
}

/**
 * The period a Summary reads, as of `today`: the last whole calendar month or quarter before the
 * one today is in, and the same length before it. A period is always whole: it ends by yesterday.
 */
export function summaryPeriod(kind: SummaryPeriod, today: string): { now: Span; before: Span } {
  const month = firstOfMonth(today)
  const length = kind === 'month' ? 1 : 3
  const end = kind === 'month' ? month : addMonths(month, -((Number(month.slice(5, 7)) - 1) % 3))
  const start = addMonths(end, -length)
  return { now: { start, end }, before: { start: addMonths(start, -length), end: start } }
}

/** The Monday of a day's week (weeks run Monday to Sunday, in UTC, as `obs_weekly` keeps them). */
export const mondayOf = (day: string) =>
  shiftDate(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7))

/** How many weeks the trend draws. */
export const TREND_WEEKS = 13

/** The trend's weeks: the last 13 whole weeks that end by the period's end, oldest first. */
export function trendWeeks(now: Span): string[] {
  const last = mondayOf(shiftDate(now.end, -7))
  return Array.from({ length: TREND_WEEKS }, (_, i) => shiftDate(last, -7 * (TREND_WEEKS - 1 - i)))
}

export const weekSpan = (monday: string): Span => ({ start: monday, end: shiftDate(monday, 7) })

/** A piece of the days: inside one week, and inside or outside each period. */
export type Piece = Span & { week: string; whole: boolean }

/** The days from the earliest span to the latest end, cut at every Monday and every edge. */
export function piecesOf(spans: readonly Span[]): Piece[] {
  if (!spans.length) return []
  const from = spans.reduce((a, s) => (s.start < a ? s.start : a), spans[0]!.start)
  const to = spans.reduce((a, s) => (s.end > a ? s.end : a), spans[0]!.end)
  const cuts = new Set<string>([from, to])
  for (const s of spans) cuts.add(s.start).add(s.end)
  for (let day = shiftDate(mondayOf(from), 7); day < to; day = shiftDate(day, 7)) cuts.add(day)
  const sorted = [...cuts].sort()
  return sorted.slice(0, -1).map((start, i) => {
    const end = sorted[i + 1]!
    const week = mondayOf(start)
    return { start, end, week, whole: start === week && end === shiftDate(week, 7) }
  })
}

const inside = (p: Span, s: Span) => p.start >= s.start && p.end <= s.end

/* ---------- what was caught ---------- */

/**
 * The changes after which Heed checks the saved questions again on its own (a check run's
 * trigger): a publish, an archive, a restore, a sync and a check date passing, in the order a
 * line names them. Check now, a question saved and a new answer kept are not changes.
 */
export const caughtTriggers = ['publish', 'archive', 'restore', 'sync', 'check_date'] as const
export type CaughtTrigger = (typeof caughtTriggers)[number]

/**
 * The alert rules whose raise asks an owner for a decision Heed keeps, so that it can be acted on:
 * a Not found card (its gap), a saved question that needs a look, and a check that is due. The
 * other rules raise something no owner decides in Heed (db/migrations/0033_obs_caught.sql).
 */
export const decidedRules = ['gap', 'saved', 'due'] as const satisfies readonly AlertRuleId[]

/** How long after its raise an alert may be acted on and count as acted on. */
export const ACT_DAYS = 14

/**
 * What was caught in the period besides the answers with a warning: how many times a saved
 * question's answer changed after each kind of change, and the alerts that asked an owner for a
 * decision and how many an owner acted on.
 */
export type CaughtCounts = {
  saved: Record<CaughtTrigger, number>
  alerts: { raised: number; acted: number }
}

export const noCaught = (): CaughtCounts => ({
  saved: { publish: 0, archive: 0, restore: 0, sync: 0, check_date: 0 },
  alerts: { raised: 0, acted: 0 },
})

/** What may be shown of it: each count, or null when it is hidden. */
export type CaughtView = {
  saved: { total: Shown; triggers: Record<CaughtTrigger, Shown> }
  alerts: { raised: Shown; acted: Shown }
}

/** Nothing shown: a Summary with nothing asked, or too little to count. */
export const noCaughtView = (): CaughtView => ({
  saved: {
    total: null,
    triggers: { publish: null, archive: null, restore: null, sync: null, check_date: null },
  },
  alerts: { raised: null, acted: null },
})

/* ---------- what may be shown ---------- */

export type SummaryCounts = {
  /** Every piece of the days the page counts, with its calls by how they were answered. */
  pieces: readonly (Span & { counts: Coarse })[]
  now: Span
  /** The period before, when it is compared; null when it is not. */
  before: Span | null
  /** The trend's weeks, by their Monday. */
  weeks: readonly string[]
  /** What found nothing in the period about each open spot shown, in the order shown. */
  open: readonly number[]
  /** The first day agents asked: every piece that ends on or before it is known to be zero. */
  since: string | null
  /** Changes published after review in the period, and in the one before. */
  changes: { now: number; before: number }
  /** What was caught in the period, besides the answers with a warning. */
  caught: CaughtCounts
}

export type SummaryView = {
  now: Record<'asked' | CoarseState, Shown>
  before: Record<'asked' | 'checked' | 'missing', Shown> | null
  weeks: { start: string; checked: Shown }[]
  open: Shown[]
  changes: { now: Shown; before: Shown }
  caught: CaughtView
  /** How many numbers the page would show are hidden: under the minimum, or keeping one safe. */
  hidden: number
}

/**
 * What a reader may see of a Summary (FR-614), in one pass: the period's calls and the three ways
 * they were answered, the period before (what was asked, checked and not found), each week of the
 * trend (what was checked), and what found nothing about each open spot. What was asked
 * in the period is always counted; its three ways and the period before are kept before a week, so
 * a week of the trend is hidden first when the pieces at a period's edge are small.
 */
export function summaryView(input: SummaryCounts, minimum: number): SummaryView {
  const quantities: Quantity[] = []
  const add = (q: Quantity) => quantities.push(q)
  // The page says when agents first asked, so a piece that ends on or before that day is known to
  // be zero: it adds nothing to a sum, and is left out of the pass.
  const pieces = input.pieces
    .filter((p) => !(input.since !== null && p.end <= input.since && coarseTotal(p.counts) === 0))
    .map((p, i) => ({ ...p, id: `g:${i}` }))
  for (const p of pieces) {
    for (const k of coarseStates)
      add({ id: `${p.id}:${k}`, value: p.counts[k], unpublished: true, parts: [] })
    add({
      id: p.id,
      value: coarseTotal(p.counts),
      unpublished: true,
      parts: [coarseStates.map((k) => `${p.id}:${k}`)],
    })
  }
  const weeks = input.weeks.map((w) => ({ id: `w:${w}`, monday: w, span: weekSpan(w) }))

  /**
   * A span's count and its three ways: each the sum of its pieces and, for a period, also of the
   * trend's weeks inside it and the pieces they leave over, so a week can be hidden to keep it.
   */
  function span(
    id: string,
    s: Span,
    shown: readonly CoarseState[],
    flags: Partial<Quantity> = {},
    trend = true,
  ) {
    const mine = pieces.filter((p) => inside(p, s))
    const within = trend ? weeks.filter((w) => inside(w.span, s)) : []
    const rest = mine.filter((p) => !within.some((w) => inside(p, w.span)))
    const value = (k?: CoarseState) =>
      mine.reduce((n, p) => n + (k ? p.counts[k] : coarseTotal(p.counts)), 0)
    const byWeek = (k?: CoarseState) =>
      within.length
        ? [
            [
              ...within.map((w) => (k ? `${w.id}:${k}` : w.id)),
              ...rest.map((p) => (k ? `${p.id}:${k}` : p.id)),
            ],
          ]
        : []
    for (const k of coarseStates)
      add({
        id: `${id}:${k}`,
        value: value(k),
        ...(shown.includes(k)
          ? id === 'n' || id === 'b'
            ? { keep: [0, 1] }
            : {}
          : { unpublished: true }),
        ...(k === 'missing' && id === 'n' ? { protect: true } : {}),
        parts: [mine.map((p) => `${p.id}:${k}`), ...byWeek(k)],
      })
    add({
      id,
      value: value(),
      ...flags,
      parts: [coarseStates.map((k) => `${id}:${k}`), mine.map((p) => p.id), ...byWeek()],
    })
  }
  for (const w of weeks) span(w.id, w.span, ['checked'], { unpublished: true }, false)
  span('n', input.now, coarseStates, { anchor: true })
  if (input.before) span('b', input.before, ['checked', 'missing'], { keep: [0, 1] })

  // What found nothing about each open spot, and the rest of what found nothing, which a reader
  // could otherwise work out from the period's own count.
  if (input.open.length) {
    const missing = quantities.find((q) => q.id === 'n:missing')!
    const listed = input.open.reduce((a, b) => a + b, 0)
    input.open.forEach((v, i) => add({ id: `o:${i}`, value: v, parts: [] }))
    add({ id: 'o:rest', value: Math.max(0, missing.value - listed), unpublished: true, parts: [] })
    missing.parts = [...missing.parts, [...input.open.map((_, i) => `o:${i}`), 'o:rest']]
    // The period's own count is kept: an open spot's count is hidden first.
    missing.keep = [...(missing.keep ?? []), missing.parts.length - 1]
  }

  // What changed stands alone: no other number on the page is a sum with it.
  add({ id: 'c:n', value: input.changes.now, parts: [] })
  add({ id: 'c:b', value: input.changes.before, parts: [] })

  // What was caught stands apart from what was asked, and its lines are never added up. A saved
  // question's count is kept and hidden only when it is small itself: one of its kinds of change
  // is hidden first. The alerts acted on are never more than those raised, and stand alone.
  const saved = input.caught.saved
  for (const t of caughtTriggers) add({ id: `k:s:${t}`, value: saved[t], parts: [] })
  add({
    id: 'k:s',
    value: caughtTriggers.reduce((n, t) => n + saved[t], 0),
    anchor: true,
    parts: [caughtTriggers.map((t) => `k:s:${t}`)],
  })
  add({ id: 'k:a', value: input.caught.alerts.raised, anchor: true, parts: [] })
  add({ id: 'k:a:acted', value: input.caught.alerts.acted, parts: [] })

  const shown = disclose(quantities, minimum)
  const byId = new Map(quantities.map((q) => [q.id, q]))
  const value = (id: string): Shown => (shown.has(id) ? byId.get(id)!.value : null)
  const published = quantities.filter((q) => !q.unpublished)
  return {
    now: {
      asked: value('n'),
      checked: value('n:checked'),
      warned: value('n:warned'),
      missing: value('n:missing'),
    },
    before: input.before
      ? { asked: value('b'), checked: value('b:checked'), missing: value('b:missing') }
      : null,
    weeks: weeks.map((w) => ({ start: w.monday, checked: value(`${w.id}:checked`) })),
    open: input.open.map((_, i) => value(`o:${i}`)),
    changes: { now: value('c:n'), before: value('c:b') },
    caught: {
      saved: {
        total: value('k:s'),
        triggers: Object.fromEntries(caughtTriggers.map((t) => [t, value(`k:s:${t}`)])) as Record<
          CaughtTrigger,
          Shown
        >,
      },
      alerts: { raised: value('k:a'), acted: value('k:a:acted') },
    },
    hidden: published.filter((q) => !shown.has(q.id)).length,
  }
}
