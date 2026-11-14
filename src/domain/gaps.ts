/**
 * Gaps: topics where people asked and the context fell short (requirements FR-604 to FR-616).
 * A topic comes only from the scope used (area, metrics, dimension values, dimensions named without
 * a value, calendar month), never from question text, and nothing here names a person. Pure:
 * callers pass the minimum count.
 */

import { gapOrigins, type GapOrigin, type GapStatus } from './gap-kinds.ts'

export {
  gapOrigins,
  gapStatuses,
  gapTypes,
  type GapOrigin,
  type GapStatus,
  type GapType,
} from './gap-kinds.ts'
export const gapOrigin = (openedByCase: number): GapOrigin => {
  const origin = gapOrigins[openedByCase - 1]
  if (!origin) throw new Error(`Unknown gap case ${openedByCase}`)
  return origin
}

export const gapNoteSources = ['report_gap', 'feedback', 'owner', 'person'] as const
export type GapNoteSource = (typeof gapNoteSources)[number]

/** What a gap's history shows from the history log (FR-610): its moves, never who. */
export const gapHistoryActions = ['gap.status_changed'] as const

/**
 * The only moves a gap makes, as `gap_transitions` lists them: a publish that names it covers it,
 * Not something we write down sets it aside, and the Undo of either opens it again. A miss seen
 * again after it was covered opens a new gap instead.
 */
export const gapMoves = {
  cover: { from: 'open', to: 'resolved' },
  uncover: { from: 'resolved', to: 'open' },
  set_aside: { from: 'open', to: 'wont_fix' },
  reopen: { from: 'wont_fix', to: 'open' },
} as const satisfies Record<string, { from: GapStatus; to: GapStatus }>
export type GapMove = keyof typeof gapMoves

/**
 * FR-614: a count from one to just under the minimum could point at a few people, so it is
 * hidden (null). Zero and counts at or above the minimum are shown.
 */
export function visibleCount(count: number, minimum: number): number | null {
  return count === 0 || count >= minimum ? count : null
}

/**
 * FR-614 for a total over counts that are shown one by one (Home's weekly agent totals over the
 * topic weeks): the total is shown only when it is, and when what it adds over the shown parts
 * is, zero or at least the minimum. Otherwise the shown parts and the total would give away the
 * hidden ones by subtraction, such as one topic week of four calls (complementary suppression).
 */
export function visibleTotal(total: number, shown: number, minimum: number): number | null {
  return visibleCount(total, minimum) !== null && visibleCount(total - shown, minimum) !== null
    ? total
    : null
}

/**
 * The total asked and the calls of the topics not listed, safe beside everything else the reader has:
 * the rows listed and the domain totals. What is left of either after taking the domain totals and
 * the listed rows of every other domain is zero or at least the minimum, else it is null, so no small
 * count of a domain without a total is worked out by subtraction (FR-614).
 */
export function askedTotals(
  listed: readonly { domain: string | null; size: number }[],
  unlistedCalls: number,
  allCalls: number,
  domains: Readonly<Record<string, number>>,
  minimum: number,
): { asked: number | null; hidden: number | null } {
  const shown = listed.reduce((n, r) => n + r.size, 0)
  const rowsOf = (inKnown: boolean) =>
    listed
      .filter((r) => (r.domain !== null && r.domain in domains) === inKnown)
      .reduce((n, r) => n + r.size, 0)
  const totals = Object.values(domains).reduce((n, t) => n + t, 0)
  const safeBeside = (n: number | null, taken: number) =>
    n !== null && visibleCount(n - taken, minimum) !== null ? n : null
  const hidden = safeBeside(visibleCount(unlistedCalls, minimum), totals - rowsOf(true))
  return {
    hidden,
    asked: safeBeside(
      visibleTotal(allCalls, shown + (hidden ?? 0), minimum),
      totals + rowsOf(false),
    ),
  }
}

/** A topic's calls as a reader may have them: a count, or a floor, and what found nothing. */
export type TopicCalls = { count: number | null; atLeast: number; nothing?: number | null }

/** Only a topic with a shown count of at least the minimum is listed at all (FR-614). */
export const listedTopics = <T extends TopicCalls>(rows: readonly T[], minimum: number): T[] =>
  rows.filter((row) => (row.count ?? row.atLeast) >= minimum)

/** A topic's calls in a table: the number, "13+", or "Fewer than 5" when not even a floor shows. */
export function askedCell(row: TopicCalls, minimum: number): string {
  const n = (v: number) => v.toLocaleString('en-GB')
  if (row.count !== null) return n(row.count)
  return row.atLeast >= minimum ? `${n(row.atLeast)}+` : `Fewer than ${minimum}`
}

/**
 * One week of a gap as a reader who cannot manage it sees it (FR-614). People's reports (case 5)
 * are left out of it entirely: anyone signed in may add them, so a reader who reported a few
 * times could otherwise push a hidden count over the minimum and subtract their own. What is
 * left is hidden from one to just under the minimum, as every count is. `shown` says whether the
 * week reaches the minimum at all, without the reports people made.
 */
export function readerWeek(
  week: { reports: number; personReports: number; noItemCalls: number },
  minimum: number,
) {
  const reports = week.reports - week.personReports
  return {
    shown: reports + week.noItemCalls >= minimum,
    reports: visibleCount(reports, minimum),
    personReports: null,
    noItemCalls: visibleCount(week.noItemCalls, minimum),
  }
}

export type TopicScope = {
  metricKeys: readonly string[]
  valueKeys: readonly string[]
  /** Dimensions the questions named without a value. */
  dimensionKeys: readonly string[]
}

/** A dimension value key `val:<dimension>/<value>` names its dimension. */
export const dimensionOfValue = (valueKey: string) => `dim:${valueKey.slice(4).split('/')[0]}`
