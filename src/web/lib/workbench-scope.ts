import type { Area } from '@domain/item'
import type { Comparison } from '@/api'
import type { DomainHealth } from './quality'

/** A count out of a total: "8 of 9" questions. */
export type Tally = { passed: number; questions: number }

/**
 * What the Workbench's scope strip says (Workbench plan, 3.2): the retrieval and answer results of
 * the domain in scope, or of every domain the person looks after added up, and how many questions
 * got worse. A domain with no test questions yet says so instead of numbers.
 */
export type ScopeSummary =
  | { state: 'pending' }
  | { state: 'not_started'; area: Area }
  | {
      state: 'ready'
      /** The newest retrieval pass, checked without a model; null before the first one. */
      retrieval: Tally | null
      /** The newest weekly answer run; null before the first one. */
      answers: Tally | null
      /** Questions that got worse against the run compared with; null until a comparison is read. */
      worse: number | null
    }

/**
 * The summary for one domain (`area`) or for all the rows. One domain's "got worse" comes from
 * its comparison with the run the person chose (or the run before), the same comparison the Got
 * worse view lists; every domain's adds up each one's newest run against the run before.
 */
export function scopeSummary({
  rows,
  area,
  comparison,
}: {
  rows: readonly DomainHealth[] | null
  area?: string
  /** The domain's comparison, when one domain is in scope. */
  comparison?: Comparison | null
}): ScopeSummary {
  if (rows === null) return { state: 'pending' }
  if (area !== undefined) {
    const row = rows.find((candidate) => candidate.area.id === area)
    if (!row) return { state: 'pending' }
    if (row.state.kind === 'not_started') return { state: 'not_started', area: row.area }
    return {
      state: 'ready',
      retrieval: row.retrieval
        ? { passed: row.retrieval.passed, questions: row.retrieval.questions }
        : null,
      answers: row.answers
        ? { passed: row.answers.passed, questions: row.answers.questions }
        : null,
      worse: comparison ? comparison.signTest.worse : (row.flips?.worse ?? null),
    }
  }
  const add = (tallies: (Tally | null)[]): Tally | null => {
    const known = tallies.filter((tally): tally is Tally => tally !== null)
    if (known.length === 0) return null
    return {
      passed: known.reduce((sum, tally) => sum + tally.passed, 0),
      questions: known.reduce((sum, tally) => sum + tally.questions, 0),
    }
  }
  const compared = rows.filter((row) => row.flips !== null)
  return {
    state: 'ready',
    retrieval: add(rows.map((row) => row.retrieval)),
    answers: add(rows.map((row) => row.answers)),
    worse: compared.length ? compared.reduce((sum, row) => sum + row.flips!.worse, 0) : null,
  }
}
