import type { Gap, GapDetail, TestQuestion } from '@/api'
import { questionTitle } from './quality'
import { gapsForScope } from './workbench-evidence'

/*
  A gap's verification and its test links as Health and the Gaps page read them (FR-610,
  Workbench plan, slice V5). Resolved and Verified by test are two separate facts: an owner
  resolves a gap; a finished weekly or full run in which every linked, active test passes on the
  resolving edition or a later one verifies it. Pure functions of what `gaps.get` returns, so the
  record only lays them out.
*/

/** Where a gap's verification by test stands. */
export type GapVerificationView =
  /** Not resolved: nothing verifies it until an owner resolves it. */
  | { state: 'unresolved' }
  /** Resolved before Heed recorded the live edition, so no run can verify it. */
  | { state: 'no_edition' }
  /** Resolved, and no active test is linked (only its managers know this). */
  | { state: 'no_tests'; edition: string }
  /**
   * Resolved and waiting for a passing run on `edition` or a later one. Its managers also read how
   * many of the active tests have passed; for anyone else `passed` and `of` are null.
   */
  | { state: 'waiting'; edition: string; passed: number | null; of: number | null }
  /**
   * Verified: the hour and the edition. For its managers, the run of the last pass and the linked
   * tests that fail in their newest run since, which show beside the fact and never undo it.
   */
  | {
      state: 'verified'
      hour: string
      edition: string
      run: string | null
      failing: readonly { question: string; run: string; finishedAt: string }[]
    }

export function gapVerificationView(
  gap: Pick<
    GapDetail,
    'status' | 'resolvedEdition' | 'verifiedAt' | 'verifiedEdition' | 'tests' | 'history'
  >,
): GapVerificationView {
  if (gap.verifiedAt && gap.verifiedEdition) {
    const tests = gap.tests ?? []
    const verified = gap.history?.findLast((entry) => entry.action === 'gap.verified')
    const run =
      typeof verified?.details.run === 'string'
        ? verified.details.run
        : (tests
            .flatMap((test) => (test.passed ? [test.passed] : []))
            .sort((a, b) => b.hour.localeCompare(a.hour))[0]?.run ?? null)
    return {
      state: 'verified',
      hour: gap.verifiedAt,
      edition: gap.verifiedEdition,
      run,
      failing: tests.flatMap((test) =>
        test.active && test.latest?.verdict === 'fail' && test.latest.finishedAt > gap.verifiedAt!
          ? [{ question: test.question, run: test.latest.run, finishedAt: test.latest.finishedAt }]
          : [],
      ),
    }
  }
  if (gap.status !== 'resolved') return { state: 'unresolved' }
  if (!gap.resolvedEdition) return { state: 'no_edition' }
  if (gap.tests === null)
    return { state: 'waiting', edition: gap.resolvedEdition, passed: null, of: null }
  const counted = gap.tests.filter((test) => test.active)
  if (!counted.length) return { state: 'no_tests', edition: gap.resolvedEdition }
  return {
    state: 'waiting',
    edition: gap.resolvedEdition,
    passed: counted.filter((test) => test.passed !== null).length,
    of: counted.length,
  }
}

type QuestionScope = TestQuestion['scope']

/** The last day of a topic's month (`2026-10-01` gives `2026-10-31`). */
function monthEnd(month: string): string {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, number, 0)).toISOString().slice(0, 10)
}

const after = (term: string, prefix: string) =>
  term.startsWith(prefix) ? term.slice(prefix.length) : term

/**
 * A new test question's scope from a gap's topic (Workbench plan, V5): its metrics, its dimension
 * values grouped by dimension, the dimensions it named without a value, and its month as the
 * window. Only the scope: a gap holds no question text, and a test question is invented by its
 * owner, never copied from production (FR-602, NFR-036).
 */
export function scopeOfTopic(topic: Gap['topic']): QuestionScope {
  const filters = new Map<string, string[]>()
  for (const { dimension, value } of topic.dimensionValues) {
    const key = after(dimension, 'dim:')
    const values = filters.get(key) ?? []
    values.push(after(value, `val:${key}/`))
    filters.set(key, values)
  }
  for (const dimension of topic.dimensions) {
    const key = after(dimension, 'dim:')
    if (!filters.has(key)) filters.set(key, [])
  }
  const month = topic.month.slice(0, 7)
  return {
    ...(topic.metrics.length
      ? { metrics: topic.metrics.map((term) => after(term, 'metric:')) }
      : {}),
    ...(filters.size
      ? {
          dimension_filters: [...filters].map(([dimension, values]) => ({ dimension, values })),
        }
      : {}),
    window: { from: `${month}-01`, to: monthEnd(month) },
  }
}

/**
 * The test questions an owner may link to a gap: the active questions of its topic's domains that
 * are not linked yet, those on the gap's scope first (`gapsForScope` the other way round), each
 * group by title.
 */
export function linkCandidates(
  gap: Pick<Gap, 'id' | 'topic' | 'status' | 'lastSeen'>,
  questions: Iterable<TestQuestion>,
  linked: readonly string[],
): { onScope: TestQuestion[]; others: TestQuestion[] } {
  const candidates = [...questions]
    .filter(
      (question) =>
        gap.topic.areaIds.includes(question.area) &&
        question.status === 'active' &&
        !linked.includes(question.id),
    )
    .sort((a, b) => questionTitle(a, a.id).localeCompare(questionTitle(b, b.id)))
  const onScope = (question: TestQuestion) => gapsForScope(question, [gap as Gap]).length > 0
  return {
    onScope: candidates.filter(onScope),
    others: candidates.filter((question) => !onScope(question)),
  }
}
