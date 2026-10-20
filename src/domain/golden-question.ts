/**
 * A golden question (FR-501, FR-504): a question an agent should answer well, with the context
 * items it must and must not receive and what a good answer contains. The same shape is the
 * open file format (YAML or JSON) that owners import and export, so existing suites can be
 * reused. Pure definitions and scoring: no input or output.
 */
import * as z from 'zod/mini'
import { isCalendarDate } from './validity.ts'

export const questionStatuses = ['active', 'saturated', 'retired'] as const
export const questionSplits = ['development', 'held_out'] as const
export const deliveryStatuses = ['matched', 'no_match', 'need_more_detail'] as const

const date = z.string().check(z.refine(isCalendarDate, 'Expected a calendar date'))
const key = z.string().check(z.minLength(1), z.maxLength(160))
const itemId = z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/, 'Expected an item id'))

export const questionIdSchema = z
  .string()
  .check(z.regex(/^[a-z0-9][a-z0-9-]{2,80}$/, 'Use 3-81 lower-case letters, digits and dashes'))

/** One way of asking. A question needs a natural wording and a precise one (FR-501). */
export const wordingSchema = z.object({
  text: z.string().check(z.minLength(3), z.maxLength(2000)),
  kind: z.enum(['natural', 'precise']),
})

/** The governed scope the question is about, in get_context's own input form. */
export const questionScopeSchema = z.object({
  metrics: z.optional(z.array(key).check(z.maxLength(10))),
  dimension_filters: z.optional(
    z
      .array(
        // No values: the question names the dimension and every value is in ("by market").
        z.object({ dimension: key, values: z.array(key).check(z.maxLength(50)) }),
      )
      .check(z.maxLength(10)),
  ),
  window: z.optional(
    z
      .object({ from: date, to: date })
      .check(z.refine((w) => w.from <= w.to, 'The window ends before it starts')),
  ),
})

/**
 * What a good answer shows. `caveat` is a must-have caveat: it is scored with strict pass, so
 * every try must contain it (FR-515). `status` is the status the agent's context tool must give:
 * get_context, or find_context, which replies in the same shape.
 * A link-follow question (FR-523) names the items whose context the answer must reach through a
 * link (`read_item` or `get_related`), and the stale or hidden link targets it must neither read
 * nor cite. Both are optional, so earlier questions keep their exact text and cache keys.
 */
export const expectedSchema = z.object({
  must_deliver: z._default(z.array(itemId).check(z.maxLength(20)), []),
  must_not_deliver: z._default(z.array(itemId).check(z.maxLength(20)), []),
  reachable_via_link: z.optional(z.array(itemId).check(z.minLength(1), z.maxLength(20))),
  forbidden_links: z.optional(z.array(key).check(z.minLength(1), z.maxLength(20))),
  status: z.optional(z.enum(deliveryStatuses)),
  caveat: z.optional(z.string().check(z.minLength(3), z.maxLength(500))),
  no_cause_claim: z._default(z.boolean(), true),
  clarifying_question: z._default(z.boolean(), false),
})

export const goldenQuestionSchema = z
  .object({
    id: questionIdSchema,
    area: z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/)),
    wordings: z.array(wordingSchema).check(z.minLength(2), z.maxLength(6)),
    scope: questionScopeSchema,
    expected: expectedSchema,
    rubrics: z._default(
      z.array(z.string().check(z.minLength(3), z.maxLength(300))).check(z.maxLength(10)),
      [],
    ),
    risk: z._default(z.enum(['low', 'normal', 'high']), 'normal'),
    source: z.string().check(z.minLength(1), z.maxLength(200)),
    status: z._default(z.enum(questionStatuses), 'active'),
    split: z._default(z.enum(questionSplits), 'development'),
    /**
     * The day the question is asked on (a golden case's `as_of`): a run reads it at that day, so a
     * wording without dates ("this past week") means the week its expectations were written for.
     * Absent: the run's own day.
     */
    as_of: z.optional(date),
  })
  .check(
    z.refine(
      (q) =>
        q.wordings.some((w) => w.kind === 'natural') &&
        q.wordings.some((w) => w.kind === 'precise'),
      { message: 'Give at least one natural and one precise wording', path: ['wordings'] },
    ),
    z.refine(
      (q) => !q.expected.must_deliver.some((id) => q.expected.must_not_deliver.includes(id)),
      { message: 'An item cannot be both expected and forbidden', path: ['expected'] },
    ),
    z.refine(
      (q) =>
        !(q.expected.reachable_via_link ?? []).some((id) =>
          (q.expected.forbidden_links ?? []).includes(id),
        ),
      { message: 'A link target cannot be both reachable and forbidden', path: ['expected'] },
    ),
  )
export type GoldenQuestion = z.infer<typeof goldenQuestionSchema>
export type GoldenQuestionInput = z.input<typeof goldenQuestionSchema>
export type Expected = z.infer<typeof expectedSchema>

/** The file format: a list of questions, optionally under `questions:`. */
export const questionFileSchema = z.union([
  z.object({ questions: z.array(z.unknown()) }),
  z.array(z.unknown()),
])

/**
 * The key the judge grades a rubric by: `rubric_1` for the first, as the check is named. A free
 * number is not a key: one judge numbered rubrics from 1, or as 1.23 and 2.34, in most of its
 * tries (round 6), and a lookup by position then read every rubric as failed.
 */
export const rubricIds = (rubrics: readonly string[]): string[] =>
  rubrics.map((_, index) => `rubric_${index + 1}`)

const verdictShape = <Id extends z.ZodMiniType<string>>(id: Id) =>
  z.object({
    caveat_present: z.nullable(z.boolean()),
    cause_claimed: z.boolean(),
    asks_clarifying_question: z.boolean(),
    rubrics: z.array(z.object({ id, passed: z.boolean() })),
    reason: z.string().check(z.maxLength(500)),
  })

/** What a judge model reports about one answer. Booleans only; reasons stay short. */
export const judgeVerdictSchema = verdictShape(z.string())
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>

/**
 * The verdict for one answer's rubrics: a rubric's key can only be one of theirs, so a judge with
 * native structured output cannot invent one. Whether every key is there once is checked apart
 * (`rubricProblem`), as a schema for the model cannot say it.
 */
export const judgeVerdictSchemaFor = (rubrics: readonly string[]) => {
  const [first, ...rest] = rubricIds(rubrics)
  return verdictShape(first ? z.enum([first, ...rest]) : z.string())
}

/**
 * Why a verdict's rubrics cannot be read against the question's: a rubric left out, given twice,
 * or one the question does not have. Null when each rubric is graded exactly once. A verdict with
 * a problem is the judge's failure, never the answer's: it is no pass and no fail. It reads any
 * JSON a judge gave, so an entry keyed by a number (`{ "index": 1.23 }`) is named as it came.
 */
export function rubricProblem(
  verdict: { rubrics: readonly unknown[] },
  rubrics: readonly string[],
): string | null {
  const ids = rubricIds(rubrics)
  const keyOf = (entry: unknown) => {
    const id = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined
    return typeof id === 'string' && ids.includes(id) ? id : null
  }
  const given = verdict.rubrics.map(keyOf)
  const unknown = verdict.rubrics.filter((entry) => keyOf(entry) === null)
  const twice = ids.filter((id) => given.filter((g) => g === id).length > 1)
  const missing = ids.filter((id) => !given.includes(id))
  const parts = [
    ...(missing.length ? [`left out ${missing.join(', ')}`] : []),
    ...(twice.length ? [`graded ${twice.join(', ')} twice`] : []),
    // Shown as JSON and cut short: it came from a model.
    ...(unknown.length
      ? [`graded rubrics the question does not have (${JSON.stringify(unknown).slice(0, 80)})`]
      : []),
  ]
  return parts.length ? `The judge ${parts.join('; ')}` : null
}

/** What one try showed: the answer's tool results and the judge's verdict. */
export type Observation = {
  /** The model declined (a refusal): no answer, never a pass or a fail. */
  refused: boolean
  answer: string
  /** Items the agent's context calls (get_context or find_context) gave it. */
  delivered: string[]
  /**
   * The delivered items given as applying to the scope asked: a word match of find_context is a
   * search hit, not a claim that it applies, so only these can break `must_not_deliver`.
   */
  applied: string[]
  /** Items whose content the agent read by following a link: read_item or get_related. */
  reached: string[]
  statuses: string[]
  verdict: JudgeVerdict | null
  /** Why the judge gave no verdict it could use, after its retry; the answer has no score. */
  judgeError?: string | null
}

export type CellChecks = Record<string, boolean>
export type CellScore = {
  /** null when there is no answer to score. */
  passed: boolean | null
  /** The must-have caveat held (strict pass, FR-515); null when the question has none. */
  caveat: boolean | null
  checks: CellChecks
  /**
   * The answer was made, but the judge gave no verdict that fits its rubrics: no pass and no fail
   * of the model. The run counts these (the judge-error rate). Absent otherwise.
   */
  judgeError?: string
}

/** Scores one try (FR-508): caveat present, cause not claimed, item id cited, clarifying question. */
export function scoreTry(
  expected: Expected,
  rubrics: readonly string[],
  o: Observation,
): CellScore {
  if (o.refused) return { passed: null, caveat: null, checks: {} }
  const judgeError = o.judgeError ?? (o.verdict ? rubricProblem(o.verdict, rubrics) : null)
  if (judgeError) return { passed: null, caveat: null, checks: {}, judgeError }
  if (!o.verdict) return { passed: null, caveat: null, checks: {} }
  const verdict = o.verdict
  const delivered = new Set(o.delivered)
  const applied = new Set(o.applied)
  const reached = new Set(o.reached)
  const linked = expected.reachable_via_link ?? []
  const shown = [
    ...expected.must_deliver.filter((id) => delivered.has(id)),
    ...linked.filter((id) => reached.has(id)),
  ]
  const checks: CellChecks = {
    delivered: expected.must_deliver.every((id) => delivered.has(id)),
    not_delivered: !expected.must_not_deliver.some((id) => applied.has(id)),
    cited: shown.every((id) => o.answer.includes(id)),
  }
  if (linked.length) checks.linked = linked.every((id) => reached.has(id))
  // A stale target is a marker with the author's words: reading or citing it is a fault.
  if (expected.forbidden_links?.length)
    checks.no_forbidden_link = !expected.forbidden_links.some(
      (id) => reached.has(id) || o.answer.includes(id),
    )
  if (expected.status) checks.status = o.statuses.includes(expected.status)
  if (expected.caveat) checks.caveat = verdict.caveat_present === true
  if (expected.no_cause_claim) checks.no_cause_claim = !verdict.cause_claimed
  if (expected.clarifying_question) checks.clarifying_question = verdict.asks_clarifying_question
  // Each rubric is graded exactly once (rubricProblem), so every key finds its grade.
  for (const id of rubricIds(rubrics)) checks[id] = verdict.rubrics.find((r) => r.id === id)!.passed
  return {
    passed: Object.values(checks).every(Boolean),
    caveat: expected.caveat ? checks.caveat! : null,
    checks,
  }
}

/** How many graded answers the judge gave no usable verdict for, as a run summary says it. */
export type Judging = { judged: number; errors: number }
export function judgingWords(judging: Judging, unit: string): string {
  const { judged, errors } = judging
  const rate = judged ? ` (${((100 * errors) / judged).toFixed(1)}%)` : ''
  return `Judge errors: ${errors} of ${judged} judged ${unit}${rate}${errors ? ': each is neither a pass nor a fail' : ''}.`
}

export type Verdict = 'pass' | 'fail' | 'no_answer'

/**
 * How a wording's tries decide its verdict: `majority`, the default (FR-515), or `all`, the
 * reliability mode (pass^k): a wording passes only when every one of its tries was answered and
 * passed, so a case that passes two tries of three counts as failing.
 */
export const passRules = ['majority', 'all'] as const
export type PassRule = (typeof passRules)[number]

/**
 * One wording on one edition: the majority of answered tries decides, but a must-have caveat
 * needs every answered try (FR-515). Without any answered try there is no verdict. Under `all`,
 * any failed try fails it, and a try without an answer leaves it without a verdict.
 */
export function wordingVerdict(tries: readonly CellScore[], rule: PassRule = 'majority'): Verdict {
  const answered = tries.filter((t) => t.passed !== null)
  if (!answered.length) return 'no_answer'
  if (answered.some((t) => t.caveat === false)) return 'fail'
  const passes = answered.filter((t) => t.passed).length
  if (rule === 'all')
    return passes < answered.length ? 'fail' : answered.length < tries.length ? 'no_answer' : 'pass'
  return passes * 2 > answered.length ? 'pass' : 'fail'
}

/** A question passes on an edition when every wording passes. */
export function questionVerdict(wordings: readonly Verdict[]): Verdict {
  if (wordings.includes('fail')) return 'fail'
  if (wordings.includes('no_answer') || !wordings.length) return 'no_answer'
  return 'pass'
}

/**
 * Who decides a check: code reads the tool results and the answer text (items delivered, not
 * delivered, cited, linked, check-report status); the judge model reads the answer (caveat, cause
 * claimed, clarifying question, rubrics). Kept apart so a drop can be traced to a layer.
 */
export const checkLayers = ['code', 'judge'] as const
export type CheckLayer = (typeof checkLayers)[number]
const judged = new Set(['caveat', 'no_cause_claim', 'clarifying_question'])
export const layerOf = (check: string): CheckLayer =>
  judged.has(check) || check.startsWith('rubric_') ? 'judge' : 'code'

/** One try's score restricted to one layer's checks; null when that layer checks nothing. */
function layerScore(score: CellScore, layer: CheckLayer): CellScore | null {
  if (score.passed === null) return score
  const checks = Object.fromEntries(
    Object.entries(score.checks).filter(([name]) => layerOf(name) === layer),
  )
  if (!Object.keys(checks).length) return null
  return {
    passed: Object.values(checks).every(Boolean),
    caveat: layer === 'judge' ? score.caveat : null,
    checks,
  }
}

/** What one question showed per layer: its verdict and the checks that decided a failure. */
export type QuestionLayers = {
  /** null when the layer checks nothing for this question. */
  code: Verdict | null
  judge: Verdict | null
  /** Checks that failed a wording, by the same rules as the verdict (majority; strict caveat). */
  failedChecks: string[]
}

/**
 * Splits a question's tries (one list per wording) into the code and judge layers, with the same
 * pass rule and strict-caveat rule as the overall verdict.
 */
export function questionLayers(
  wordings: readonly (readonly CellScore[])[],
  rule: PassRule = 'majority',
): QuestionLayers {
  const answered = wordings.flat().filter((t) => t.passed !== null)
  const verdictOf = (layer: CheckLayer): Verdict | null => {
    const checks = answered.some((t) => Object.keys(t.checks).some((n) => layerOf(n) === layer))
    if (answered.length && !checks) return null
    return questionVerdict(
      wordings.map((tries) =>
        wordingVerdict(
          tries.map((t) => layerScore(t, layer)).filter((t): t is CellScore => t !== null),
          rule,
        ),
      ),
    )
  }
  const failed = new Set<string>()
  for (const tries of wordings) {
    const scored = tries.filter((t) => t.passed !== null)
    const names = new Set(scored.flatMap((t) => Object.keys(t.checks)))
    for (const name of names) {
      const seen = scored.filter((t) => name in t.checks)
      const passes = seen.filter((t) => t.checks[name]).length
      const strict = name === 'caveat' || rule === 'all'
      if (strict ? passes < seen.length : passes * 2 <= seen.length) failed.add(name)
    }
  }
  return { code: verdictOf('code'), judge: verdictOf('judge'), failedChecks: [...failed].sort() }
}

/**
 * Whether the judge and the code checks reached the same verdict on a question. They check
 * different things (the judge the caveat, cause claims and rubrics; code the items delivered and
 * cited), so a judge that passes what code fails is more lenient than the run's own record of
 * what reached the agent: a first-class signal before relying on the judge (try-it-2, round 3).
 * Null when either layer has no pass or fail to compare.
 */
export type LayerAgreement = 'agree' | 'judge_passed_code_failed' | 'code_passed_judge_failed'
export function layerAgreement(
  layers: Pick<QuestionLayers, 'code' | 'judge'>,
): LayerAgreement | null {
  const { code, judge } = layers
  if (!(code === 'pass' || code === 'fail') || !(judge === 'pass' || judge === 'fail')) return null
  if (code === judge) return 'agree'
  return judge === 'pass' ? 'judge_passed_code_failed' : 'code_passed_judge_failed'
}

/** The same comparison for one answered try, from its own checks. */
export function tryAgreement(score: CellScore): LayerAgreement | null {
  if (score.passed === null) return null
  const verdict = (layer: CheckLayer): Verdict | null => {
    const checks = Object.entries(score.checks).filter(([name]) => layerOf(name) === layer)
    return checks.length ? (checks.every(([, ok]) => ok) ? 'pass' : 'fail') : null
  }
  return layerAgreement({ code: verdict('code'), judge: verdict('judge') })
}

/** How often the layers disagreed: questions by id, and answered tries by count. */
export type Agreement = {
  /** Questions where both layers gave a pass or a fail. */
  questions: number
  judgePassedCodeFailed: string[]
  codePassedJudgeFailed: string[]
  tries: { compared: number; judgePassedCodeFailed: number; codePassedJudgeFailed: number }
}
export function agreementOf(
  questions: readonly { id: string; layers: Pick<QuestionLayers, 'code' | 'judge'> }[],
  tries: readonly CellScore[],
): Agreement {
  const of = questions.map((q) => ({ id: q.id, agreement: layerAgreement(q.layers) }))
  const t = tries.map(tryAgreement)
  return {
    questions: of.filter((q) => q.agreement !== null).length,
    judgePassedCodeFailed: of
      .filter((q) => q.agreement === 'judge_passed_code_failed')
      .map((q) => q.id),
    codePassedJudgeFailed: of
      .filter((q) => q.agreement === 'code_passed_judge_failed')
      .map((q) => q.id),
    tries: {
      compared: t.filter((a) => a !== null).length,
      judgePassedCodeFailed: t.filter((a) => a === 'judge_passed_code_failed').length,
      codePassedJudgeFailed: t.filter((a) => a === 'code_passed_judge_failed').length,
    },
  }
}

export type Flip = 'pass_to_fail' | 'fail_to_pass'
export function flipOf(baseline: Verdict, candidate: Verdict): Flip | null {
  if (baseline === 'pass' && candidate === 'fail') return 'pass_to_fail'
  if (baseline === 'fail' && candidate === 'pass') return 'fail_to_pass'
  return null
}

/** What get_context gave one wording: its status and the ids of the items it delivered. */
export type DeliveryObservation = { status: string | null; delivered: readonly string[] }
export type RetrievalChecks = {
  /** The reply was served: the context checks ran. */
  served: boolean
  delivered: boolean
  not_delivered: boolean
  /** Only when the question expects a check-report status. */
  status?: boolean
}

/**
 * The retrieval layer of one wording (FR-504, FR-507), checked by code with no model: the
 * expected items appear, the forbidden ones do not, and the status is the expected one.
 */
export function retrievalChecks(
  expected: Pick<Expected, 'must_deliver' | 'must_not_deliver' | 'status'>,
  o: DeliveryObservation,
): RetrievalChecks {
  const shown = new Set(o.delivered)
  return {
    served: o.status !== null && o.status !== 'check_failed',
    delivered: expected.must_deliver.every((id) => shown.has(id)),
    not_delivered: !expected.must_not_deliver.some((id) => shown.has(id)),
    ...(expected.status ? { status: o.status === expected.status } : {}),
  }
}
