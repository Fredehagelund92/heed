/**
 * Gaps: topics where people asked and the context fell short (requirements FR-604 to FR-616).
 * A topic comes only from the scope used (area, metrics, dimension values, dimensions named without
 * a value, calendar month), never from question text, and nothing here names a person. Pure:
 * callers pass the minimum count.
 */

import type { Verdict } from './golden-question.ts'
import { gapOrigins, type GapOrigin, type GapStatus } from './gap-kinds.ts'

export {
  gapOrigins,
  gapStatuses,
  gapTypes,
  manualGapStatuses,
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

/** The share of calls without items, hidden whenever either count is hidden or there were none. */
export function visibleShare(noItemCalls: number | null, calls: number | null): number | null {
  if (noItemCalls === null || calls === null || calls === 0) return null
  return noItemCalls / calls
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
 * A Not found card's draft (the golden plan's B7): the gap's scope, and when it applies the month
 * agents asked about, as the topic keeps it (FR-604), never "still going on". The person says
 * what to write; the dates are the gap's own until they change them.
 */
export function draftFromGap(topic: TopicScope & { month: string }, areaId: string) {
  const [year, month] = topic.month.split('-').map(Number) as [number, number]
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
  return { ...draftFromTopic(topic, areaId), validity: { start: topic.month, end: next } }
}

/**
 * FR-616: the draft a gap starts, filled with the topic's scope. It has no dates: the topic's
 * month is when people asked, not when the fact applies, and a standing fact dated to that month
 * would stop being delivered when it ends. The person says when it applies.
 */
export function draftFromTopic(topic: TopicScope, areaId: string) {
  return {
    areaId,
    scope: {
      metrics: [...topic.metricKeys],
      dimensions: [...topic.dimensionKeys],
      dimensionValues: topic.valueKeys.map((value) => ({
        dimension: dimensionOfValue(value),
        value,
      })),
    },
  }
}

/**
 * FR-610: the answer runs whose pass verifies a gap's test. An impact run's candidate edition was
 * never sealed, and the delivery check alone checks neither the caveat nor the answer, so neither
 * counts.
 */
export const verifyingRunKinds = ['scheduled', 'full'] as const

/**
 * FR-610: whether a question's verdict in a run is a pass for a gap resolved on `resolvedSeq`: a
 * finished weekly or full answer run on that edition or a later one, in which the question passed.
 * Without a resolving edition (the gap is not resolved, or was resolved before Heed recorded the
 * edition) nothing can pass for it: unknown stays unknown.
 */
export function passVerifies(
  run: { kind: string; finished: boolean; editionSeq: number | null },
  verdict: Verdict | null,
  resolvedSeq: number | null,
): boolean {
  return (
    resolvedSeq !== null &&
    run.finished &&
    (verifyingRunKinds as readonly string[]).includes(run.kind) &&
    run.editionSeq !== null &&
    run.editionSeq >= resolvedSeq &&
    verdict === 'pass'
  )
}

/** A test question linked to a gap, as verification reads it. */
export type LinkedTest = {
  questionId: string
  /** Only an active question counts; a retired or saturated one is set aside (FR-501). */
  active: boolean
  /** Its first recorded pass at or after the resolving edition, with the hour it passed. */
  pass: { editionSeq: number; hour: string } | null
}

export type GapVerification =
  /** No resolving edition is recorded, so nothing can verify the gap. */
  | { state: 'no_edition' }
  /** No active test is linked. */
  | { state: 'no_tests' }
  /** The active tests that have not passed on the resolving edition or a later one. */
  | { state: 'waiting'; waitingFor: string[] }
  /** Every active test passed; the hour and edition of the last of those passes. */
  | { state: 'verified'; editionSeq: number; hour: string }

/**
 * FR-610: a resolved gap is verified by test when every linked, active test has passed on the
 * edition that resolved it or a later one. Verification sits beside `resolved`, never instead of
 * it (FR-609). Once recorded it is a fact that stays: a later failure shows beside it, and a test
 * linked afterwards does not undo it.
 */
export function gapVerification(
  tests: readonly LinkedTest[],
  resolvedSeq: number | null,
): GapVerification {
  if (resolvedSeq === null) return { state: 'no_edition' }
  const counted = tests.filter((test) => test.active)
  if (!counted.length) return { state: 'no_tests' }
  const passed = (test: LinkedTest) => test.pass !== null && test.pass.editionSeq >= resolvedSeq
  const waitingFor = counted
    .filter((test) => !passed(test))
    .map((test) => test.questionId)
    .sort()
  if (waitingFor.length) return { state: 'waiting', waitingFor }
  const last = counted
    .map((test) => test.pass!)
    .reduce((a, b) => {
      const order = Date.parse(b.hour) - Date.parse(a.hour) || b.editionSeq - a.editionSeq
      return order > 0 ? b : a
    })
  return { state: 'verified', editionSeq: last.editionSeq, hour: last.hour }
}

/**
 * FR-610: moving a gap out of `resolved` (to open, proposal made or won't fix) clears its resolving
 * edition, its verification and every pass of its tests. Resolving it again starts afresh.
 */
export function clearsVerification(from: GapStatus, to: GapStatus): boolean {
  return from === 'resolved' && to !== 'resolved'
}
