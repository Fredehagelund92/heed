import { addDays, mondayOf } from '@domain/status'
import type { LibraryFreshness, WeeklyCalls } from '@/api'
import { isEndedIssueRow, type LibraryRow } from '@/lib/library'

/**
 * Home's pulse strip (direction A of the Home lab, the captain's pick): "Last week in Heed" in
 * four numbers, the same for every person. Questions from AI agents and the share answered with
 * context come from the anonymous weekly totals (`getWeeklyCalls`: a total is hidden when it
 * would give a count under the privacy minimum away, and the tile then says how many at least);
 * facts added or changed and the share of facts current come from the library
 * index everyone reads, and the share current a week ago from the library's freshness counts
 * (`getLibraryFreshness`). Weeks start on Monday (UTC), as the service counts them. Pure, so the
 * strip, its table, the stories and the tests share one answer.
 */

/** How many full weeks the strip draws, last week last. */
export const PULSE_WEEKS = 12

/** The weeks to ask the weekly totals for: the full weeks and the week under way. */
export const PULSE_WEEKS_READ = PULSE_WEEKS + 1

export type AgentWeek = {
  /** The week's Monday. */
  week: string
  /**
   * Calls from AI agents; null when hidden: under the minimum, or adding under the minimum to
   * the shown topic weeks, which would give a hidden count away.
   */
  calls: number | null
  /** Calls that found no fact; null when hidden, as `calls` is. */
  noItemCalls: number | null
  /** The calls of the week's shown topic weeks: at least this many when `calls` is hidden. */
  shownCalls: number
  /** The share of calls that found facts, 0 to 1; null when either count is hidden or none came. */
  answered: number | null
}

export type AgentPulse = {
  minimum: number
  /** The full weeks, oldest first; the last is last week. */
  weeks: AgentWeek[]
  /** No agent asked anything in any of the weeks. */
  none: boolean
}

/** The share of calls that found facts, or null when it cannot be told. */
export function answeredShare(calls: number | null, noItemCalls: number | null): number | null {
  if (calls === null || noItemCalls === null || calls === 0) return null
  return (calls - noItemCalls) / calls
}

/**
 * The agent half of the pulse from the weekly totals: the full weeks only, since the week under
 * way (the read's last) has only begun.
 */
export function agentPulse(data: WeeklyCalls): AgentPulse {
  const weeks = data.weeks.slice(0, -1).slice(-PULSE_WEEKS)
  return {
    minimum: data.minimumCount,
    weeks: weeks.map((week) => ({
      ...week,
      answered: answeredShare(week.calls, week.noItemCalls),
    })),
    none: weeks.every((week) => week.calls === 0),
  }
}

export type FactWeek = { week: string; changed: number }

export type FactPulse = {
  /** Facts added or changed per full week, oldest first; the last is last week. */
  weeks: FactWeek[]
  /** How many domains last week's changes were in. */
  changedDomains: number
  /**
   * Facts that apply today: not retired and not past their last day. A fact whose period ended
   * still answers for that period and needs no look, so it is left out of the share.
   */
  applyToday: number
  /** Facts that apply today with nothing to look at: accepted, or an issue that applies. */
  current: number
  recheckDue: number
  sourceChanged: number
  sourceMissing: number
}

/** The Monday of the last full week before `today`'s. */
export function lastWeekOf(today: string): string {
  return addDays(mondayOf(today), -7)
}

/** The fact half of the pulse, from the library index and the service's today. */
export function factPulse(rows: readonly LibraryRow[], today: string): FactPulse {
  const last = lastWeekOf(today)
  const weeks = Array.from({ length: PULSE_WEEKS }, (_, index) =>
    addDays(last, -7 * (PULSE_WEEKS - 1 - index)),
  )
  const changed = new Map(weeks.map((week) => [week, 0]))
  const domains = new Set<string>()
  const pulse = { applyToday: 0, current: 0, recheckDue: 0, sourceChanged: 0, sourceMissing: 0 }
  for (const row of rows) {
    const week = mondayOf(row.updatedAt)
    const count = changed.get(week)
    if (count !== undefined) changed.set(week, count + 1)
    if (week === last) domains.add(row.areaId)
    const status = row.displayStatus
    if (status === 'retired' || status === 'expired' || isEndedIssueRow(row)) continue
    pulse.applyToday += 1
    if (status === 'stale') pulse.recheckDue += 1
    else if (status === 'needs_check') pulse.sourceChanged += 1
    else if (status === 'source_missing') pulse.sourceMissing += 1
    else pulse.current += 1
  }
  return {
    weeks: weeks.map((week) => ({ week, changed: changed.get(week)! })),
    changedDomains: domains.size,
    ...pulse,
  }
}

/** Facts that need a look: re-check due, source changed or source missing. */
export function needALook(pulse: FactPulse): number {
  return pulse.recheckDue + pulse.sourceChanged + pulse.sourceMissing
}

/**
 * A share as a whole percent. Never rounds up to 100 or down to 0 while some are left over, so
 * "100%" always means every one.
 */
export function percentText(share: number): string {
  return `${wholePercent(share)}%`
}

/** A share as the whole percent the strip shows it. */
function wholePercent(share: number): number {
  const whole = Math.round(share * 100)
  return share < 1 && whole === 100 ? 99 : share > 0 && whole === 0 ? 1 : whole
}

/**
 * A week's calls in words: "109", "At least 105" when the exact total is hidden but some topic
 * weeks are shown, or "Fewer than 5" when nothing of the week reaches the minimum.
 */
export function callsText(week: Pick<AgentWeek, 'calls' | 'shownCalls'>, minimum: number): string {
  if (week.calls !== null) return week.calls.toLocaleString('en')
  if (week.shownCalls > 0) return `At least ${week.shownCalls.toLocaleString('en')}`
  return `Fewer than ${minimum}`
}

/*
  The trend marks (the captain's option A of the Home colour analysis): each tile's change on the
  week before, an arrow and a signed size, in words for a screen reader. Only a number with a good
  direction gets a verdict: the share of agent questions that found a fact and the share of facts
  that are current are better when they rise, so they turn green or red. A volume (questions
  asked, facts changed) is neither, so its mark stays muted. A change inside the noise floor gets
  no verdict either: under one point is the same, and a share of fewer than 30 questions in
  either week moves too much by chance to call better or worse.
*/

/** A share must move at least this many percentage points to count as a change. */
export const TREND_MIN_POINTS = 1
/** Both weeks need at least this many agent questions before their share is judged. */
export const TREND_MIN_QUESTIONS = 30

export type Trend = {
  direction: 'up' | 'down' | 'flat'
  /**
   * `better` or `worse`: a number with a good direction moved past the noise floor. `none`: a
   * volume, which has no good direction, or a share of too few questions to judge.
   */
  verdict: 'better' | 'worse' | 'none'
  /** As shown: "+2 pts", "−9", "Same". */
  text: string
  /** In words: "up 2 points on the week before, better". */
  spoken: string
}

/** What a change is measured against: last week's against the week before, or today's against a week ago. */
export type TrendBase = 'week before' | 'week ago'
const phrases: Record<TrendBase, { change: string; same: string }> = {
  'week before': { change: 'on the week before', same: 'same as the week before' },
  'week ago': { change: 'since a week ago', same: 'same as a week ago' },
}

const flat = (base: TrendBase): Trend => ({
  direction: 'flat',
  verdict: 'none',
  text: 'Same',
  spoken: phrases[base].same,
})

/**
 * A share's change, on the week before unless `base` says otherwise, better when it rises.
 * Under `TREND_MIN_POINTS` it is no
 * change; with `questions`, the two weeks' counts, it is judged only when both reach
 * `TREND_MIN_QUESTIONS`. The size is the change between the whole percents the tile shows, so it
 * adds up with what a person reads. Null when either share is not known.
 */
export function shareTrend(
  now: number | null,
  before: number | null,
  {
    questions,
    base = 'week before',
  }: {
    questions?: { now: number | null; before: number | null }
    base?: TrendBase
  } = {},
): Trend | null {
  if (now === null || before === null) return null
  const points = wholePercent(now) - wholePercent(before)
  if (Math.abs(now - before) * 100 < TREND_MIN_POINTS || points === 0) return flat(base)
  const up = points > 0
  const size = Math.abs(points)
  const unit = size === 1 ? 'point' : 'points'
  const judged =
    questions === undefined ||
    ((questions.now ?? 0) >= TREND_MIN_QUESTIONS && (questions.before ?? 0) >= TREND_MIN_QUESTIONS)
  const change = `${up ? 'up' : 'down'} ${size} ${unit} ${phrases[base].change}`
  return {
    direction: up ? 'up' : 'down',
    verdict: judged ? (up ? 'better' : 'worse') : 'none',
    text: `${up ? '+' : '−'}${size} ${size === 1 ? 'pt' : 'pts'}`,
    spoken: judged
      ? `${change}, ${up ? 'better' : 'worse'}`
      : `${change}, too few questions to call it better or worse`,
  }
}

/** A count's change on the week before: a size, never a verdict. Null when either is hidden. */
export function countTrend(now: number | null, before: number | null): Trend | null {
  if (now === null || before === null) return null
  const change = now - before
  if (change === 0) return flat('week before')
  const size = Math.abs(change).toLocaleString('en')
  return {
    direction: change > 0 ? 'up' : 'down',
    verdict: 'none',
    text: `${change > 0 ? '+' : '−'}${size}`,
    spoken: `${change > 0 ? 'up' : 'down'} ${size} on the week before`,
  }
}

/**
 * The share of facts current seven days before the service's today, from the freshness counts
 * (`getLibraryFreshness`, today last); null when it is not known or nothing applied then.
 */
export function currentWeekBefore(freshness: LibraryFreshness): number | null {
  const before = freshness.days.at(-2)
  if (before === undefined || before.applying === 0) return null
  return before.current / before.applying
}

const dayMonth = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const dayOnly = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' })

/** A week by its Monday as its days: "5 to 11 Oct", or "29 Sept to 5 Oct" across months. */
export function weekRangeText(monday: string): string {
  const start = new Date(`${monday}T00:00:00Z`)
  const end = new Date(`${addDays(monday, 6)}T00:00:00Z`)
  const sameMonth = start.getUTCMonth() === end.getUTCMonth()
  return `${(sameMonth ? dayOnly : dayMonth).format(start)} to ${dayMonth.format(end)}`
}
