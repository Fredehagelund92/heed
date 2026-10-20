import * as z from 'zod/mini'
import {
  goldenQuestionSchema,
  passRules,
  questionIdSchema,
  questionSplits,
  questionStatuses,
} from '../domain/golden-question.ts'

/** Test questions, evaluation runs, transcripts and scorecards (requirements section 5.5). */

const areaId = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))
const uuid = z.string().check(z.regex(/^[0-9a-f-]{36}$/))
const editionLabel = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}\.\d+$/))
/** A question's verdict in a run; null when it has none on that side. */
export const verdictSchema = z.nullable(z.enum(['pass', 'fail', 'no_answer']))

export const storedQuestionSchema = z.object({
  ...goldenQuestionSchema.def.shape,
  revision: z.number(),
  setAsideReason: z.nullable(z.string()),
  updatedAt: z.string(),
})
export const questionListSchema = z.object({
  area: z.optional(areaId),
  status: z.optional(z.enum(questionStatuses)),
})
export const questionIdInputSchema = z.object({ id: questionIdSchema })
/** Create with no revision; replace with the revision you read (optimistic concurrency). */
export const saveQuestionSchema = z.object({
  id: questionIdSchema,
  revision: z.optional(z.number().check(z.int(), z.minimum(1))),
  question: goldenQuestionSchema,
})
export const setAsideSchema = z.object({
  id: questionIdSchema,
  revision: z.number().check(z.int(), z.minimum(1)),
  reason: z.nullable(z.string().check(z.minLength(3), z.maxLength(500))),
})
export const importSchema = z.object({
  content: z.string().check(z.minLength(1), z.maxLength(1_000_000)),
  dryRun: z._default(z.boolean(), true),
})
export const importReportSchema = z.object({
  applied: z.boolean(),
  created: z.array(z.string()),
  updated: z.array(z.string()),
  unchanged: z.array(z.string()),
  errors: z.array(z.object({ index: z.number(), id: z.nullable(z.string()), message: z.string() })),
})
export const exportSchema = z.object({ content: z.string() })

export const runStates = [
  'estimated',
  'awaiting_approval',
  'queued',
  'running',
  'finished',
  'failed',
  'cancelled',
  // Stopped before every answer was made; resumable (R6).
  'incomplete',
] as const
export const runSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'impact',
    'full',
    'scheduled',
    'links',
    'assistant_mock',
    'assistant_real',
    'replay',
    // The sealed held-out questions of an area, run with none of their words kept (FR-525).
    'held_out',
  ]),
  state: z.enum(runStates),
  areaId: z.nullable(z.string()),
  proposalId: z.nullable(z.string()),
  itemVersionId: z.nullable(z.string()),
  edition: z.string(),
  modelId: z.string(),
  judgeModelId: z.nullable(z.string()),
  /** The provider that served each model, such as `anthropic` or `vercel-gateway`; null on older runs. */
  modelProvider: z.nullable(z.string()),
  judgeProvider: z.nullable(z.string()),
  /** Vendor and model line, such as `anthropic/claude-sonnet`, whichever provider served it; null on older runs. */
  modelFamily: z.nullable(z.string()),
  judgeFamily: z.nullable(z.string()),
  /** The judge is the answering model's own line, which may favour its answers; null when unknown. */
  judgeSameFamily: z.nullable(z.boolean()),
  /** The company whose model it is, such as `anthropic`; null on older runs. */
  modelVendor: z.nullable(z.string()),
  judgeVendor: z.nullable(z.string()),
  /** A different model line is not a different company: true when one vendor served both. */
  judgeSameVendor: z.nullable(z.boolean()),
  /** Why a full run started without a person: a change the review gate does not see. */
  trigger: z.nullable(z.enum(['source_sync', 'tool_descriptions', 'date_expiry'])),
  toolSchemaDigest: z.string(),
  testSetDigest: z.string(),
  tries: z.number(),
  flipRepeats: z.number(),
  questions: z.number(),
  setAside: z.number(),
  estimatedCostMicros: z.number(),
  /** Every model call of the run as metered, retries and calls of unfinished answers included. */
  actualCostMicros: z.number(),
  /** The most the run may spend, as approved at the command line; null when only the caps apply. */
  costCeilingMicros: z.nullable(z.number()),
  /** How tries decide a wording: the majority (FR-515), or `all`, every try (pass^k). */
  passRule: z.enum(passRules),
  requestedBy: z.nullable(z.string()),
  approvedBy: z.nullable(z.string()),
  failure: z.nullable(z.string()),
  createdAt: z.string(),
  startedAt: z.nullable(z.string()),
  finishedAt: z.nullable(z.string()),
})
export type EvalRun = z.infer<typeof runSchema>

/**
 * One side of a question split into its layers: code checks the tool results and the answer
 * text (delivered, not delivered, cited, linked, status), the judge model the answer (caveat,
 * cause claimed, clarifying question, rubrics). A null layer checks nothing for the question.
 */
const questionLayersSchema = z.object({
  code: verdictSchema,
  judge: verdictSchema,
  failedChecks: z.array(z.string()),
})
const layerCount = z.object({ passed: z.number(), failed: z.number() })
/**
 * Where the judge and the code checks disagreed: questions one layer passed and the other failed,
 * by id (a held-out one as `held-out`), and answered tries by count. A judge that passes what code
 * fails is more lenient than the record of what reached the agent.
 */
export const agreementSchema = z.object({
  questions: z.number(),
  judgePassedCodeFailed: z.array(z.string()),
  codePassedJudgeFailed: z.array(z.string()),
  tries: z.object({
    compared: z.number(),
    judgePassedCodeFailed: z.number(),
    codePassedJudgeFailed: z.number(),
  }),
})
/**
 * Why an answer could not be made: never a quality result (R6). `tool`: the tool server refused
 * one of the answer's tool calls. `judge` is kept for runs made before a judge error was recorded
 * on the answer it could not grade (`judging`).
 */
export const failureKinds = ['throttled', 'provider', 'judge', 'tool', 'error'] as const

const levelOutcome = z.object({
  outcome: z.enum(['passed', 'failed', 'error']),
  message: z.string(),
})
export const scorecardSchema = z.object({
  edition: z.string(),
  questions: z.number(),
  passed: z.number(),
  failed: z.number(),
  noAnswer: z.number(),
  setAside: z.number(),
  failing: z.array(z.string()),
  regressions: z.array(z.string()),
  baselineRun: z.nullable(z.string()),
  /** The section 1.7 targets on the held-out part (FR-503): counts, and whether they are met. */
  heldOut: z.object({
    questions: z.number(),
    answers: z.number(),
    caveats: z.object({ required: z.number(), present: z.number() }),
    causeClaims: z.number(),
    acceptable: z.number(),
    meetsTargets: z.boolean(),
  }),
  /** Questions passing and failing per layer; null on runs scored before layers were kept. */
  layers: z.nullable(z.object({ code: layerCount, judge: layerCount })),
  /** How many questions each check failed; null on older runs. */
  failedChecks: z.nullable(z.record(z.string(), z.number())),
  /** Judge against code; null on older runs. */
  agreement: z.nullable(agreementSchema),
})
const armSummary = z.object({
  answers: z.number(),
  /** Mean tool calls per answer: over-following shows here (R20). */
  calls: z.number(),
  /** Mean cost per answer in micros, counting a reused answer at its original cost. */
  costMicros: z.number(),
  causeClaims: z.number(),
})
/**
 * A links run (FR-523): get_related off (baseline) and on (candidate). `gain` is true when some
 * questions pass only with links, none fail because of them, and no new cause claims appear.
 */
export const linkResultSchema = z.object({
  gained: z.array(z.string()),
  lost: z.array(z.string()),
  arms: z.object({ baseline: armSummary, candidate: armSummary }),
  gain: z.boolean(),
})
export const runDetailSchema = z.object({
  run: runSchema,
  results: z.array(
    z.object({
      id: z.string(),
      impact: z.boolean(),
      baseline: verdictSchema,
      candidate: verdictSchema,
      flip: z.nullable(z.enum(['pass_to_fail', 'fail_to_pass'])),
      /** Null on runs scored before layers were kept. */
      layers: z.nullable(
        z.object({ baseline: questionLayersSchema, candidate: z.nullable(questionLayersSchema) }),
      ),
    }),
  ),
  flips: z.array(z.object({ id: z.string(), flip: z.enum(['pass_to_fail', 'fail_to_pass']) })),
  levels: z.record(z.string(), levelOutcome),
  scorecard: z.nullable(scorecardSchema),
  links: z.nullable(linkResultSchema),
  replay: z.nullable(
    z.object({
      deliveries: z.number(),
      changed: z.number(),
      topics: z.array(
        z.object({ topic: z.string(), area: z.nullable(z.string()), changed: z.number() }),
      ),
      otherChanged: z.number(),
    }),
  ),
  /** Judge against code, per side; null on older runs and runs that did not finish. */
  agreement: z.nullable(
    z.object({ baseline: agreementSchema, candidate: z.nullable(agreementSchema) }),
  ),
  /**
   * The answers the judge was asked to grade, and how many of them it gave no verdict it could use
   * for after its retry: no rubric left out, none twice, none the question does not have. Such an
   * answer is neither a pass nor a fail; `errors / judged` is the run's judge-error rate.
   */
  judging: z.object({ judged: z.number(), errors: z.number() }),
  /** Why an incomplete run stopped, and the answers it still lacks; null otherwise. */
  stopped: z.nullable(
    z.object({
      reason: z.enum(['infrastructure', 'cap', 'ceiling', 'stopped']),
      failed: z.partialRecord(z.enum([...failureKinds, 'missing']), z.number()),
      cells: z.number(),
      at: z.string(),
    }),
  ),
  cells: z.array(
    z.object({
      id: z.string(),
      questionId: z.string(),
      wording: z.number(),
      arm: z.enum(['baseline', 'candidate']),
      trial: z.number(),
      state: z.enum(runStates),
      passed: z.nullable(z.boolean()),
      refused: z.boolean(),
      reused: z.boolean(),
      error: z.nullable(z.string()),
      /** Why the answer could not be made, when it could not. */
      failureKind: z.nullable(z.enum(failureKinds)),
      costMicros: z.number(),
    }),
  ),
})
export const runListSchema = z.object({
  area: z.optional(areaId),
  proposal: z.optional(uuid),
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(100))),
})
export const runIdSchema = z.object({ id: uuid })
export const areaInputSchema = z.object({ id: areaId })
/** `links` estimates a links run: every question on both sides (FR-523). */
export const estimateInputSchema = z.object({
  id: areaId,
  kind: z.optional(z.enum(['full', 'links'])),
})
export const estimateSchema = z.object({
  area: z.string(),
  kind: z.enum(['full', 'links']),
  edition: z.nullable(z.string()),
  questions: z.number(),
  setAside: z.number(),
  cells: z.number(),
  cached: z.number(),
  costMicros: z.number(),
  budgetMicros: z.number(),
  needsApproval: z.boolean(),
  modelId: z.string(),
})
export const transcriptSchema = z.object({
  cellId: z.string(),
  runId: z.string(),
  questionId: z.string(),
  wording: z.string(),
  arm: z.enum(['baseline', 'candidate']),
  trial: z.number(),
  passed: z.nullable(z.boolean()),
  refused: z.boolean(),
  scores: z.record(z.string(), z.unknown()),
  messages: z.array(z.unknown()),
  toolCalls: z.array(z.unknown()),
})
export const areaScorecardSchema = z.object({
  area: z.string(),
  run: z.nullable(runSchema),
  scorecard: z.nullable(scorecardSchema),
  baselineRun: z.nullable(z.string()),
  baselineSetAt: z.nullable(z.string()),
})

/**
 * The retrieval pass (no model): every sealed edition, and the live edition each day, over the
 * whole active test set. A question passes when every wording is served, delivers its expected
 * items, leaves out the forbidden ones and gives the expected status. Ids and booleans only.
 */
export const retrievalChecksSchema = z.object({
  served: z.boolean(),
  delivered: z.boolean(),
  not_delivered: z.boolean(),
  status: z.optional(z.boolean()),
})
export const retrievalResultSchema = z.object({
  id: z.string(),
  revision: z.number(),
  area: z.string(),
  split: z.enum(questionSplits),
  passed: z.boolean(),
  checks: retrievalChecksSchema,
  wordings: z.array(
    z.object({
      passed: z.boolean(),
      status: z.nullable(z.string()),
      /** Expected items that were not delivered. */
      missing: z.array(z.string()),
      /** Forbidden items that were delivered. */
      forbidden: z.array(z.string()),
    }),
  ),
})
/** One pass, counted over the areas asked for (or every area the reader may see). */
export const retrievalPointSchema = z.object({
  id: z.string(),
  edition: z.string(),
  asOf: z.string(),
  /** `edition` when an edition was sealed; `daily` for the live edition on a new day. */
  trigger: z.enum(['edition', 'daily']),
  createdAt: z.string(),
  testSetDigest: z.string(),
  questions: z.number(),
  passed: z.number(),
  failed: z.number(),
  setAside: z.number(),
  /** How many questions each check failed. */
  failedChecks: z.object({
    served: z.number(),
    delivered: z.number(),
    not_delivered: z.number(),
    status: z.number(),
  }),
})
export const retrievalRunSchema = z.object({
  ...retrievalPointSchema.def.shape,
  results: z.array(retrievalResultSchema),
})
export const retrievalEditionSchema = z.object({
  /** The edition asked for (the live one for the latest pass); null when nothing is live. */
  edition: z.nullable(z.string()),
  /** Null until the edition has had its pass. */
  run: z.nullable(retrievalRunSchema),
})
export const retrievalAreaSchema = z.object({ area: z.optional(areaId) })
export const retrievalEditionInputSchema = z.object({
  label: editionLabel,
  area: z.optional(areaId),
})
export const retrievalTrendInputSchema = z.object({
  area: z.optional(areaId),
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(366))),
})
export type RetrievalRun = z.infer<typeof retrievalRunSchema>
export type RetrievalPoint = z.infer<typeof retrievalPointSchema>
