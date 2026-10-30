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

/** What a gap's history shows from the history log (FR-610): its lifecycle, never who. */
export const gapHistoryActions = [
  'gap.status_changed',
  'gap.note_added',
  'gap.draft_started',
  'gap.test_linked',
  'gap.test_unlinked',
  'gap.verified',
  'gap.verification_cleared',
] as const

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

/**
 * FR-610: moving a gap out of `resolved` (to open, proposal made or won't fix) clears its resolving
 * edition, its verification and every pass of its tests. Resolving it again starts afresh.
 */
export function clearsVerification(from: GapStatus, to: GapStatus): boolean {
  return from === 'resolved' && to !== 'resolved'
}
