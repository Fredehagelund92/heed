import * as z from 'zod/mini'
import { appFamilies } from '../domain/app-family.ts'
import { editionChangeKinds } from '../domain/editions.ts'
import { questionIdSchema } from '../domain/golden-question.ts'
import { comparisonFactors, fixKinds } from '../domain/quality.ts'
import { itemKinds } from '../domain/item.ts'
import { calendarDateSchema } from '../domain/validity.ts'
import { retrievalChecksSchema } from './evals.ts'

/**
 * The Quality page's reads (requirements 5.5 and 5.6, Quality design section 7): score history,
 * two runs compared, feedback and upkeep by week, items no test question covers, a ranked
 * "Fix next" list, and for the Workbench one test question across two runs and its history.
 * For owners and deputies of an area and administrators; each answer covers the areas the
 * reader maintains (every area for an administrator), or the one asked for.
 */

const areaId = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))
const uuid = z.string().check(z.regex(/^[0-9a-f-]{36}$/))
const verdict = z.enum(['pass', 'fail', 'no_answer'])
/** A count below the minimum is null: hidden (FR-614). */
const shownCount = z.nullable(z.number())
const weeks = z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(52)))

export const qualityAreaInputSchema = z.strictObject({ area: z.optional(areaId) })
export const qualityWeeksInputSchema = z.strictObject({ area: z.optional(areaId), weeks })

// G2: score history in one call.
export const historyInputSchema = z.strictObject({
  area: z.optional(areaId),
  /** Weekly runs per area, newest first; 12 by default. */
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(52))),
})
/** One finished weekly (scheduled) run of an area, with the retrieval pass of its edition. */
export const historyPointSchema = z.object({
  run: z.string(),
  area: z.string(),
  edition: z.string(),
  finishedAt: z.string(),
  questions: z.number(),
  passed: z.number(),
  failed: z.number(),
  noAnswer: z.number(),
  setAside: z.number(),
  /** Questions that passed in the baseline before this run and fail in it. */
  regressions: z.number(),
  /** Shares from 0 to 1; null when there is nothing to divide by. */
  rates: z.object({
    pass: z.nullable(z.number()),
    /** Required caveats present, on the held-out part (target at least 0.9). */
    caveats: z.nullable(z.number()),
    /** Answers that claim an unproven cause, on the held-out part (target at most 0.05). */
    causeClaims: z.nullable(z.number()),
    /** Held-out questions answered acceptably (target at least 0.8). */
    acceptable: z.nullable(z.number()),
  }),
  /** The section 1.7 targets on the held-out part (FR-503), as counts. */
  heldOut: z.object({
    questions: z.number(),
    answers: z.number(),
    caveats: z.object({ required: z.number(), present: z.number() }),
    causeClaims: z.number(),
    acceptable: z.number(),
    meetsTargets: z.boolean(),
  }),
  /** Questions passing and failing per layer; null on runs scored before layers were kept. */
  layers: z.nullable(
    z.object({
      code: z.object({ passed: z.number(), failed: z.number() }),
      judge: z.object({ passed: z.number(), failed: z.number() }),
    }),
  ),
  failedChecks: z.nullable(z.record(z.string(), z.number())),
  /** The newest no-model retrieval pass of the run's edition, for the area; null without one. */
  retrieval: z.nullable(
    z.object({
      id: z.string(),
      asOf: z.string(),
      questions: z.number(),
      passed: z.number(),
      failed: z.number(),
      rate: z.nullable(z.number()),
    }),
  ),
  /** What the run cost, and what it was estimated at, in micro-dollars (FR-510). */
  costMicros: z.number(),
  estimatedCostMicros: z.number(),
  modelId: z.string(),
  judgeModelId: z.nullable(z.string()),
})

// G3: two runs compared.
export const compareInputSchema = z.strictObject({
  /** The newer run: a finished weekly or full run of an area. */
  id: uuid,
  /** The older run of the same area; by default the weekly run that finished before `id`. */
  against: z.optional(uuid),
})
const runRef = z.object({
  id: z.string(),
  kind: z.enum(['scheduled', 'full']),
  edition: z.string(),
  finishedAt: z.string(),
})
const questionChangeSchema = z.object({
  /** A held-out question the reader may not see is shown as "held-out". */
  id: z.string(),
  from: verdict,
  to: verdict,
  /** Checks the question failed: in the newer run when worse, in the older run when better. */
  failedChecks: z.array(z.string()),
})
export const comparisonSchema = z.object({
  area: z.string(),
  run: runRef,
  /** Null when the area has no earlier weekly run to compare with. */
  against: z.nullable(runRef),
  questions: z.number(),
  better: z.array(questionChangeSchema),
  worse: z.array(questionChangeSchema),
  unchanged: z.object({ pass: z.number(), fail: z.number(), noAnswer: z.number() }),
  added: z.number(),
  removed: z.number(),
  /**
   * The exact two-sided sign test on the questions that changed: a small p-value (below 0.05)
   * says the change is unlikely to be noise. Null when no question changed.
   */
  signTest: z.object({ better: z.number(), worse: z.number(), pValue: z.nullable(z.number()) }),
})

// G8: feedback per verdict, week and area.
export const feedbackCountsSchema = z.object({
  today: calendarDateSchema,
  minimumCount: z.number(),
  rows: z.array(
    z.object({
      /** Null: feedback that names no delivery or gap the service can place in an area (administrators only). */
      area: z.nullable(z.string()),
      week: z.string(),
      helpful: shownCount,
      wrong: shownCount,
      missing: shownCount,
      unclear: shownCount,
      /** Null when the total or any verdict count in the row is hidden, so no count can be found by subtraction. */
      total: shownCount,
    }),
  ),
})

/**
 * The assistant's ratings (FR-712) per verdict, week and area, as G8 counts feedback: each week
 * a cell of its own, so no hidden count can be found by subtracting one period from another.
 * Each count below the minimum is hidden (FR-614). A rating keeps no person, question or answer,
 * only its verdict, area and hour.
 */
export const ratingCountsSchema = z.object({
  today: calendarDateSchema,
  minimumCount: z.number(),
  rows: z.array(
    z.object({
      /** Null: answers about no one domain (administrators only). */
      area: z.nullable(z.string()),
      /** The Monday of the week. */
      week: z.string(),
      helpful: shownCount,
      wrong: shownCount,
      /** Null when either count is hidden, so neither can be found by subtraction. */
      total: shownCount,
    }),
  ),
})

export const appFamilyCountsInputSchema = z.strictObject({
  /** The weeks ending with the current one; this week alone by default. */
  weeks: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(12))),
})

/**
 * How the agents that called Heed's MCP server fared (FR-410), per app family and week, from the
 * request log: tool calls, and of them the reads that needed more detail or matched nothing, the
 * calls with arguments the tool could not read, and Heed's errors. A family is one of a fixed list
 * (src/domain/app-family.ts), never the agent's own name or a person. Each week is a cell of its
 * own and each count below the minimum is hidden (FR-614), so no small count can be found by
 * subtracting one period from another. Only families with calls in the weeks asked for are listed.
 */
export const appFamilyCountsSchema = z.object({
  today: calendarDateSchema,
  minimumCount: z.number(),
  rows: z.array(
    z.object({
      family: z.enum(appFamilies),
      /** The Monday of the week. */
      week: z.string(),
      /** Tool calls, whatever came of them; starting a session or listing tools is not one. */
      calls: shownCount,
      needMoreDetail: shownCount,
      noMatch: shownCount,
      invalidInput: shownCount,
      errors: shownCount,
    }),
  ),
})

// G9: upkeep by week.
export const upkeepSchema = z.object({
  today: calendarDateSchema,
  rows: z.array(
    z.object({
      area: z.string(),
      week: z.string(),
      /** Items served at the end of the week (or today) whose review date had passed. */
      itemsPastReview: z.number(),
      /** Proposals accepted during the week. */
      proposalsAccepted: z.number(),
    }),
  ),
})

// G12: items no test question covers.
export const untestedSchema = z.object({
  edition: z.nullable(z.string()),
  areas: z.array(
    z.object({
      area: z.string(),
      /** Items in the live edition the library shows. */
      items: z.number(),
      /** Items no active test question names (must or must not deliver, or reach through a link). */
      untested: z.number(),
      /** Untested events and examples: FR-502 requires their questions. */
      untestedRequired: z.number(),
      byKind: z.record(z.enum(itemKinds), z.number()),
    }),
  ),
})

// G14: the ranked "Fix next" list.
export const fixNextInputSchema = z.strictObject({
  area: z.optional(areaId),
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(200))),
})
export const fixEntrySchema = z.object({
  kind: z.enum(fixKinds),
  /** Null for a gap whose topic spans areas: it shows in each of them. */
  area: z.nullable(z.string()),
  /** A test question (label null), a gap (label its reference) or an item (label its title). */
  subject: z.object({
    type: z.enum(['question', 'gap', 'item']),
    id: z.string(),
    label: z.nullable(z.string()),
  }),
  /** Higher first. The weights are documented with `rankFixNext` (src/domain/quality.ts). */
  score: z.number(),
  reasons: z.array(z.string()),
  /** The checks a failing test question failed. */
  checks: z.array(z.string()),
  /** When the run or pass that failed finished, the gap was last seen, or the review date. */
  since: z.nullable(z.string()),
})
export const fixNextSchema = z.object({
  edition: z.nullable(z.string()),
  entries: z.array(fixEntrySchema),
})

// The Workbench (slice W3): one test question across two runs, and its history.
const nullableVerdict = z.nullable(verdict)
const layersSchema = z.object({
  code: nullableVerdict,
  judge: nullableVerdict,
  failedChecks: z.array(z.string()),
})
/** A finished weekly or full run of an area, with what decides its answers besides chance. */
const runSetupSchema = z.object({
  id: z.string(),
  kind: z.enum(['scheduled', 'full']),
  edition: z.string(),
  finishedAt: z.string(),
  modelId: z.string(),
  judgeModelId: z.nullable(z.string()),
  /** Digests of the MCP tool descriptions and the answering system prompt; null when not recorded. */
  toolSchemaDigest: z.nullable(z.string()),
  promptDigest: z.nullable(z.string()),
  /** Tries per wording. */
  tries: z.number(),
})

export const compareQuestionInputSchema = z.strictObject({
  question: questionIdSchema,
  /** A finished weekly or full run of the question's area. */
  run: uuid,
  /** Another of the same area; by default the weekly run that finished before `run`. */
  against: z.optional(uuid),
})
/** One try of one wording: what the answer did, item ids and booleans, and the answer itself. */
const questionTrySchema = z.object({
  /** The try's cell, to open its transcript (`evals.transcript`). */
  cell: z.string(),
  trial: z.number(),
  /** Null when there is no answer to score (refused, failed, not run). */
  passed: z.nullable(z.boolean()),
  refused: z.boolean(),
  /** The same inputs were answered before, and this try reuses that answer. */
  reused: z.boolean(),
  error: z.nullable(z.string()),
  checks: z.record(z.string(), z.boolean()),
  /** Items get_facts delivered, and items read by following a link. */
  delivered: z.array(z.string()),
  reached: z.array(z.string()),
  statuses: z.array(z.string()),
  /** The judge's reason; null without a verdict. */
  judgeReason: z.nullable(z.string()),
  /** The answer's final text, from the transcript; null without one. */
  answer: z.nullable(z.string()),
})
/** One run's side: the run, and the question as it ran in it. */
const questionSideSchema = z.object({
  run: runSetupSchema,
  /** The question's revision the run used; null when the question was not in the run. */
  revision: z.nullable(z.number()),
  /** The question's verdict and layers; null when it has none in the run. */
  verdict: nullableVerdict,
  layers: z.nullable(layersSchema),
  /** Per wording (by index), its verdict and each try. */
  wordings: z.array(
    z.object({ wording: z.number(), verdict: nullableVerdict, tries: z.array(questionTrySchema) }),
  ),
})
export const questionComparisonSchema = z.object({
  question: z.string(),
  area: z.string(),
  run: questionSideSchema,
  /** Null when the area has no earlier weekly run to compare with. */
  against: z.nullable(questionSideSchema),
  /**
   * What decides an answer besides chance, sorted: the same in both runs, different, or not
   * recorded by either run (unknown is never counted as held). Only the edition differs when
   * `changed` is `['edition']` and `unknown` is empty. All empty without `against`.
   */
  heldConstant: z.array(z.enum(comparisonFactors)),
  changed: z.array(z.enum(comparisonFactors)),
  unknown: z.array(z.enum(comparisonFactors)),
  /**
   * The items the question names or either run delivered that differ between the two runs'
   * editions, from the editions comparison (`editions.compare`); empty when the editions are the
   * same. `withheld` counts such items with an audience group, which are never shown.
   */
  items: z.array(
    z.object({
      itemId: z.string(),
      title: z.string(),
      kind: z.enum(itemKinds),
      change: z.enum(editionChangeKinds),
      /** The fields that differ, in review order. */
      fields: z.array(z.string()),
      /** How the question names it, in either run's revision. */
      named: z.array(z.enum(['must_deliver', 'must_not_deliver', 'reachable_via_link'])),
      /** Whether any try delivered it, in each run. */
      delivered: z.object({ run: z.boolean(), against: z.boolean() }),
    }),
  ),
  withheld: z.number(),
})

export const questionHistoryInputSchema = z.strictObject({
  question: questionIdSchema,
  /** Runs and editions, newest first; 12 by default. */
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(52))),
})
export const questionHistorySchema = z.object({
  question: z.string(),
  area: z.string(),
  /** The area's finished weekly and full runs, newest first. */
  runs: z.array(
    z.object({
      run: z.string(),
      kind: z.enum(['scheduled', 'full']),
      edition: z.string(),
      finishedAt: z.string(),
      /** `set_aside`: skipped with a reason; `absent`: not in the run (added later, or retired). */
      state: z.enum(['tested', 'set_aside', 'absent']),
      revision: z.nullable(z.number()),
      verdict: nullableVerdict,
      layers: z.nullable(layersSchema),
    }),
  ),
  /** The question's result in the newest retrieval pass of each edition, newest first. */
  retrieval: z.array(
    z.object({
      run: z.string(),
      edition: z.string(),
      asOf: z.string(),
      revision: z.number(),
      passed: z.boolean(),
      checks: retrievalChecksSchema,
    }),
  ),
})

export type HistoryPoint = z.infer<typeof historyPointSchema>
export type Comparison = z.infer<typeof comparisonSchema>
export type FeedbackCounts = z.infer<typeof feedbackCountsSchema>
export type RatingCounts = z.infer<typeof ratingCountsSchema>
export type AppFamilyCounts = z.infer<typeof appFamilyCountsSchema>
export type AppFamilyCountsInput = z.infer<typeof appFamilyCountsInputSchema>
export type Upkeep = z.infer<typeof upkeepSchema>
export type Untested = z.infer<typeof untestedSchema>
export type FixNext = z.infer<typeof fixNextSchema>
export type QuestionComparison = z.infer<typeof questionComparisonSchema>
export type QuestionHistory = z.infer<typeof questionHistorySchema>
