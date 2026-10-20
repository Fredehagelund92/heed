import type { AttachedTest, ProposalTest } from '@/api'
import type { RiskLevel } from '@domain/item'
import type { ProposalState } from '@domain/proposal-state'
import type { CheckState } from './gate'

/*
  A test question attached to a draft or proposal (FR-524, Workbench plan, slice V6), in words.
  Its results are reported with the change and never block it, whatever they say: level 3 says
  whether Heed delivers it what it needs without and with the change, and the answer tests of
  normal and high risk answer it without and with the change. Pure functions of what
  `proposals.tests` and the gate's `attached` return, so the parts only lay them out.
*/

/** The words every list of attached tests carries: the results never decide anything. */
export const reportOnly = 'We report them, and they never block a decision.'

/** One attached test, with its results once the checks have reported on it. */
export type AttachedTestReading = {
  question: string
  /** One glyph for the test: the answer's result when there is one, else delivery's. */
  state: CheckState
  /** Level 3, without and with the change. */
  delivery: string
  /** The answer tests, without and with the change. */
  answer: string
}

type Verdict = NonNullable<AttachedTest['answer']>['candidate']

const passes = (verdict: Verdict) => verdict === 'pass'

function deliveryWords(
  retrieval: AttachedTest['retrieval'] | undefined,
  state: ProposalState,
): string {
  if (!retrieval)
    return state === 'draft'
      ? "We check whether it finds the fact once it's sent."
      : 'Not checked yet.'
  const { baseline, candidate } = retrieval
  if (candidate && baseline) return 'It finds the fact, with and without this change.'
  if (candidate) return 'It finds the fact with this change, not without it.'
  if (baseline) return 'It no longer finds the fact with this change.'
  return "It still doesn't find the fact with this change."
}

function answerWords(
  answer: AttachedTest['answer'] | undefined,
  state: ProposalState,
  risk: RiskLevel | null,
): string {
  if (risk === 'low')
    return "Low risk runs no answer tests. It's answered once the change is accepted."
  if (!answer) return state === 'draft' ? "Answered once it's sent." : 'Not answered yet.'
  const { baseline, candidate } = answer
  if (candidate === null) return 'Not answered with this change.'
  if (candidate === 'no_answer') return 'No answer with this change.'
  if (passes(candidate)) {
    return passes(baseline) ? 'Passes with and without this change.' : 'Passes with this change.'
  }
  return passes(baseline) ? 'Fails with this change.' : 'Still fails with this change.'
}

function stateOf(test: Partial<Pick<AttachedTest, 'retrieval' | 'answer'>>): CheckState {
  if (test.answer && test.answer.candidate !== null)
    return passes(test.answer.candidate) ? 'passed' : 'failed'
  if (test.retrieval) return test.retrieval.candidate ? 'passed' : 'failed'
  return 'not_run'
}

/**
 * An attached test in words: where delivery and the answer tests stand with the change. A
 * set-aside question is no longer checked, so it has no results to read.
 */
export function readAttachedTest(
  test: ProposalTest & Partial<Pick<AttachedTest, 'retrieval' | 'answer'>>,
  { state, risk }: { state: ProposalState; risk: RiskLevel | null },
): AttachedTestReading {
  if (!test.active)
    return {
      question: test.question,
      state: 'not_run',
      delivery: "Set aside, so it's no longer checked.",
      answer: '',
    }
  return {
    question: test.question,
    state: stateOf(test),
    delivery: deliveryWords(test.retrieval, state),
    answer: answerWords(test.answer, state, risk),
  }
}

/**
 * The attached tests, oldest first as the service lists them, each with its results from the
 * gate when there is one (a draft has none until it is submitted).
 */
export function withResults(
  tests: readonly ProposalTest[],
  results: readonly AttachedTest[] | undefined,
): (ProposalTest & Partial<Pick<AttachedTest, 'retrieval' | 'answer'>>)[] {
  const byQuestion = new Map((results ?? []).map((result) => [result.question, result]))
  return tests.map((test) => {
    const result = byQuestion.get(test.question)
    return result ? { ...test, retrieval: result.retrieval, answer: result.answer } : test
  })
}
