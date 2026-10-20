import {
  agreementOf,
  questionLayers,
  questionVerdict,
  rubricIds,
  scoreTry,
  wordingVerdict,
  type CellScore,
  type JudgeVerdict,
  type QuestionLayers,
  type Verdict,
} from '../../domain/golden-question.ts'
import type {
  EvalRun,
  EvalRunDetail,
  EvalTranscript,
  HistoryPoint,
  TestQuestion,
} from './client.ts'

/*
  Answer runs in the mock, as the Quality page reads them (evals.runs.list, evals.runs.get and
  evals.transcript): the weekly runs of mock-quality.ts as runs with their results and tries, and
  each try's transcript. The answer is scripted: the agent asks get_context with the wording,
  answers with the items it was given and, when it was given every item the question expects,
  with the question's caveat. The tries are scored by the service's rules (scoreTry), so a
  question passes when the run's edition delivers what it expects (mock-quality.ts says what it
  delivers), and fails on the delivered and caveat checks when it does not. Every try of a
  wording gives the same answer.
*/

/** One scripted try: what get_context gave, the answer, the judge's verdict and the score. */
export type ScriptedTry = {
  delivered: string[]
  status: 'matched' | 'no_match'
  answer: string
  verdict: JudgeVerdict
  score: CellScore
}

/** The scripted try of a question that get_context gave `delivered`, of the items it expects. */
export function scriptedTry(question: TestQuestion, delivered: readonly string[]): ScriptedTry {
  const { must_deliver: expected, caveat } = question.expected
  const given = expected.filter((id) => delivered.includes(id))
  const complete = given.length === expected.length
  const status = given.length || !expected.length ? 'matched' : 'no_match'
  const answer = given.length
    ? `The context that applies is ${given.join(', ')}.${complete && caveat ? ` ${caveat}` : ''} It does not say what caused the change, so I do not claim a cause.`
    : 'No context item applies to this question, so I answer from the data alone and do not claim a cause.'
  const verdict: JudgeVerdict = {
    caveat_present: caveat ? complete : null,
    cause_claimed: false,
    asks_clarifying_question: false,
    rubrics: rubricIds(question.rubrics).map((id) => ({ id, passed: true })),
    reason: !caveat
      ? 'The answer claims no cause.'
      : complete
        ? 'The answer gives the expected caveat and claims no cause.'
        : `The answer leaves out the expected caveat ("${caveat}"). It claims no cause.`,
  }
  return {
    delivered: given,
    status,
    answer,
    verdict,
    score: scoreTry(question.expected, question.rubrics, {
      refused: false,
      answer,
      delivered: given,
      applied: given,
      reached: [],
      statuses: [status],
      verdict,
    }),
  }
}

/** A question's verdict and layers when every try of every wording is the scripted one. */
export function scriptedResult(
  question: TestQuestion,
  delivered: readonly string[],
  tries = MOCK_TRIES,
): { verdict: Verdict; layers: QuestionLayers } {
  const { score } = scriptedTry(question, delivered)
  const wordings = question.wordings.map(() => Array.from({ length: tries }, () => score))
  return {
    verdict: questionVerdict(wordings.map((tries) => wordingVerdict(tries))),
    layers: questionLayers(wordings),
  }
}

/** Tries per wording on the candidate arm of a mock run. */
export const MOCK_TRIES = 3

/** The fields every mock run shares: the scripted models and their families. */
const mockModels = {
  modelId: 'mock-scripted-answer',
  judgeModelId: 'mock-scripted-judge',
  modelProvider: 'mock',
  judgeProvider: 'mock',
  modelFamily: 'mock/answer',
  judgeFamily: 'mock/judge',
  judgeSameFamily: false,
  modelVendor: 'mock',
  judgeVendor: 'mock',
  judgeSameVendor: true,
} as const

/** A weekly run of mock-quality.ts as evals.runs.list answers it. */
export function weeklyRun(point: HistoryPoint, digest: (text: string) => string): EvalRun {
  const started = new Date(Date.parse(point.finishedAt) - 30 * 60_000).toISOString()
  return {
    id: point.run,
    kind: 'scheduled',
    state: 'finished',
    areaId: point.area,
    proposalId: null,
    itemVersionId: null,
    edition: point.edition,
    ...mockModels,
    modelId: point.modelId,
    judgeModelId: point.judgeModelId,
    trigger: null,
    toolSchemaDigest: digest('get_context'),
    testSetDigest: digest(`${point.area}:${point.questions}`),
    tries: MOCK_TRIES,
    flipRepeats: 7,
    questions: point.questions,
    setAside: point.setAside,
    estimatedCostMicros: point.estimatedCostMicros,
    actualCostMicros: point.costMicros,
    costCeilingMicros: null,
    passRule: 'majority',
    requestedBy: null,
    approvedBy: null,
    failure: null,
    createdAt: started,
    startedAt: started,
    finishedAt: point.finishedAt,
  }
}

/** A full run a person started: it finishes at once in the mock. */
export function startedRun(
  base: Pick<EvalRun, 'id' | 'areaId' | 'edition' | 'createdAt' | 'requestedBy'>,
  questions: readonly TestQuestion[],
  costMicros: number,
  digest: (text: string) => string,
): EvalRun {
  return {
    ...base,
    kind: 'full',
    state: 'finished',
    proposalId: null,
    itemVersionId: null,
    ...mockModels,
    trigger: null,
    toolSchemaDigest: digest('get_context'),
    testSetDigest: digest(questions.map((q) => `${q.id}:${q.revision}`).join(',')),
    tries: MOCK_TRIES,
    flipRepeats: 7,
    questions: questions.length,
    setAside: 0,
    estimatedCostMicros: costMicros,
    actualCostMicros: costMicros,
    costCeilingMicros: null,
    passRule: 'majority',
    approvedBy: null,
    failure: null,
    startedAt: base.createdAt,
    finishedAt: base.createdAt,
  }
}

/** Cells a run may have: a cell's number is the run's number times this, plus its index. */
const CELLS_PER_RUN = 4096

/** A cell id: the run's id with the cell's number in its last group. */
const cellId = (run: string, index: number) =>
  `${run.slice(0, 24)}${(Number.parseInt(run.slice(24), 16) * CELLS_PER_RUN + index + 1)
    .toString(16)
    .padStart(12, '0')}`

/** The run a cell id was made from (`cellId` backwards). */
export function runOfCell(cell: string): string {
  const number = Number.parseInt(cell.slice(24), 16) - 1
  return `${cell.slice(0, 24)}${Math.floor(number / CELLS_PER_RUN)
    .toString(16)
    .padStart(12, '0')}`
}

/** What a run's edition delivered, and the run it is measured against. */
export type RunWorld = {
  /** The expected items the run's edition gave a question; all of them by default. */
  delivered?: (question: TestQuestion) => readonly string[]
  /** The baseline run and its verdicts: a question that passed there and fails now regressed. */
  baseline?: { run: string; verdicts: ReadonlyMap<string, Verdict> } | null
}

const expectedOf = (question: TestQuestion) => question.expected.must_deliver

/** A run with its results and tries, each question scored on what the run's edition delivered. */
export function runDetail(
  run: EvalRun,
  questions: readonly TestQuestion[],
  costPerTry: number,
  { delivered = expectedOf, baseline = null }: RunWorld = {},
): EvalRunDetail {
  let index = 0
  const scored = questions.map((question) => ({
    question,
    passed: scriptedTry(question, delivered(question)).score.passed,
    ...scriptedResult(question, delivered(question), run.tries),
  }))
  const cells = scored.flatMap(({ question, passed }) =>
    question.wordings.flatMap((_, wording) =>
      Array.from({ length: run.tries }, (_, trial) => ({
        id: cellId(run.id, index++),
        questionId: question.id,
        wording,
        arm: 'candidate' as const,
        // Tries count from 1, as the evaluation worker numbers them.
        trial: trial + 1,
        state: 'finished' as const,
        passed,
        refused: false,
        reused: false,
        error: null,
        failureKind: null,
        costMicros: costPerTry,
      })),
    ),
  )
  const failing = scored.filter((q) => q.verdict === 'fail').map((q) => q.question.id)
  const count = (layer: 'code' | 'judge', verdict: Verdict) =>
    scored.filter((q) => q.layers[layer] === verdict).length
  const failedChecks: Record<string, number> = {}
  for (const { layers } of scored)
    for (const check of layers.failedChecks) failedChecks[check] = (failedChecks[check] ?? 0) + 1
  const heldOut = questions.filter((q) => q.split === 'held_out')
  // The scripted tries all score alike, so the layers disagree only by question.
  const agreement = agreementOf(
    scored.map(({ question, layers }) => ({ id: question.id, layers })),
    scored.flatMap(({ question }) => {
      const { score } = scriptedTry(question, delivered(question))
      return Array.from({ length: question.wordings.length * run.tries }, () => score)
    }),
  )
  return {
    run,
    results: scored.map(({ question, verdict, layers }) => ({
      id: question.id,
      impact: false,
      baseline: verdict,
      candidate: verdict,
      flip: null,
      layers: {
        baseline: { code: layers.code, judge: layers.judge, failedChecks: layers.failedChecks },
        candidate: null,
      },
    })),
    flips: [],
    levels: {},
    scorecard: {
      edition: run.edition,
      questions: questions.length,
      passed: questions.length - failing.length,
      failed: failing.length,
      noAnswer: 0,
      setAside: run.setAside,
      failing,
      regressions: baseline ? failing.filter((id) => baseline.verdicts.get(id) === 'pass') : [],
      baselineRun: baseline?.run ?? null,
      heldOut: {
        questions: heldOut.length,
        answers: heldOut.length * run.tries,
        caveats: { required: 0, present: 0 },
        causeClaims: 0,
        acceptable: heldOut.filter((q) => !failing.includes(q.id)).length,
        meetsTargets: heldOut.length > 0 && heldOut.every((q) => !failing.includes(q.id)),
      },
      layers: {
        code: { passed: count('code', 'pass'), failed: count('code', 'fail') },
        judge: { passed: count('judge', 'pass'), failed: count('judge', 'fail') },
      },
      failedChecks,
      agreement,
    },
    links: null,
    replay: null,
    agreement: { baseline: agreement, candidate: null },
    // The scripted judge grades every rubric of every answer.
    judging: { judged: cells.length, errors: 0 },
    stopped: null,
    cells,
  }
}

/** One try's transcript: the wording, the get_context call, the scripted answer and its score. */
export function transcriptOf(
  detail: EvalRunDetail,
  cell: EvalRunDetail['cells'][number],
  question: TestQuestion,
  delivered: readonly string[] = expectedOf(question),
): EvalTranscript {
  const wording = question.wordings[cell.wording]?.text ?? ''
  const scripted = scriptedTry(question, delivered)
  const input = {
    question: wording,
    ...(question.scope.metrics ? { metrics: question.scope.metrics } : {}),
    ...(question.scope.dimension_filters
      ? { dimension_filters: question.scope.dimension_filters }
      : {}),
  }
  const items = scripted.delivered
  return {
    cellId: cell.id,
    runId: detail.run.id,
    questionId: question.id,
    wording,
    arm: cell.arm,
    trial: cell.trial,
    passed: cell.passed,
    refused: cell.refused,
    // As the service keeps them (evals/worker.ts): the score, the judge's verdict and what the
    // tools gave.
    scores: {
      ...scripted.score,
      verdict: scripted.verdict,
      delivered: items,
      reached: [],
      statuses: [scripted.status],
      calls: 1,
    },
    messages: [
      { role: 'user', content: wording },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'get_context', input }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'get_context',
            output: { type: 'json', value: { status: scripted.status, items } },
          },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: scripted.answer }] },
    ],
    toolCalls: [{ tool: 'get_context', input, status: scripted.status, items }],
  }
}
