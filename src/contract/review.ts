import * as z from 'zod/mini'
import { creationChannels } from '../domain/item.ts'
import { proposalStates } from '../domain/proposal-state.ts'
import { decisionCapacities, proposalActions } from '../domain/proposal.ts'
import { runStates, verdictSchema } from './evals.ts'
import { findingSchema, proposalTestSchema } from './proposals.ts'

const reason = z.string().check(z.minLength(1), z.maxLength(500))
const itemIdSchema = z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))
const areaIdSchema = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))
const editionLabelSchema = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}\.\d+$/))
export const checkLevels = [
  'format',
  'matching',
  'delivery',
  'answer_impact',
  'answer_full',
] as const

/** Any proposal the review engine handles: item create, change, retire and recheck, and vocabulary. */
export const reviewProposalSchema = z.object({
  id: z.string(),
  number: z.number(),
  subject: z.enum(['item', 'vocabulary']),
  action: z.enum(proposalActions),
  state: z.enum(proposalStates),
  areaId: z.nullable(z.string()),
  itemId: z.nullable(z.string()),
  itemVersionId: z.nullable(z.string()),
  vocabularyVersionId: z.nullable(z.string()),
  termKey: z.nullable(z.string()),
  title: z.string(),
  riskLevel: z.nullable(z.enum(['low', 'normal', 'high'])),
  /** Who proposed it; null when a content source's read made it (CON-603). */
  proposerId: z.nullable(z.string()),
  channel: z.enum(creationChannels),
  revision: z.number(),
  reason: z.nullable(z.string()),
  claimedBy: z.nullable(z.string()),
  dueAt: z.nullable(z.string()),
  submittedAt: z.nullable(z.string()),
  closedAt: z.nullable(z.string()),
  createdAt: z.string(),
})
export type ReviewProposal = z.infer<typeof reviewProposalSchema>

const checkOutcomes = ['passed', 'failed', 'error', 'not_run'] as const

/*
  The details of each check level (FR-505 to FR-516), as the review engine records them. A level
  that has not run, or a result recorded without details, carries an empty object, so every
  field is optional.
*/
/** Level 1: the format findings, the same as a save returns. */
export const formatDetailsSchema = z.object({ findings: z.optional(z.array(findingSchema)) })
const probeScopeSchema = z.object({
  metrics: z.array(z.string()),
  filters: z.record(z.string(), z.array(z.string())),
  window: z.object({ start: z.string(), end: z.string() }),
})
/** One level 2 probe: where the item must be delivered or stay silent, and what happened. */
export const probeResultSchema = z.object({
  /**
   * `inside`, `before_start`, `on_end_day`, `other_value:<dimension>`, `all_values`,
   * `without_dimension:<dimension>` or `other_metric`.
   */
  name: z.string(),
  scope: probeScopeSchema,
  expect: z.enum(['delivered', 'silent']),
  actual: z.enum(['delivered', 'silent']),
  match: z.optional(z.enum(['exact', 'partial'])),
  /** Why the resolver held the item back, when it did. */
  withheld: z.optional(z.string()),
  passed: z.boolean(),
})
/** Level 2: the probes from the item's own scope, on the live edition. */
export const matchingDetailsSchema = z.object({
  edition: z.optional(z.string()),
  probes: z.optional(z.array(probeResultSchema)),
})
/** A test question of the area through the live reply's code, without and with the candidate. */
export const deliveryQuestionSchema = z.object({
  id: z.string(),
  baseline: z.optional(z.boolean()),
  candidate: z.optional(z.boolean()),
  /** It passed before and fails with the candidate, or it names the candidate and fails. */
  regression: z.boolean(),
  /** The question could not be read; it does not count. */
  error: z.optional(z.string()),
  /** Attached to the proposal when the check ran (FR-524). Attaching it changes no outcome. */
  attached: z.optional(z.boolean()),
})
/** Level 3: the candidate through the live reply's code (FR-507). */
export const deliveryDetailsSchema = z.object({
  /** The get_facts input of the item's own probe. */
  probe: z.optional(
    z.object({
      question: z.string(),
      metrics: z.array(z.string()),
      dimension_filters: z.array(z.object({ dimension: z.string(), values: z.array(z.string()) })),
      window: z.object({ from: z.string(), to: z.string() }),
    }),
  ),
  /** The reply's status for that probe. */
  status: z.optional(z.string()),
  /** The probe delivers the candidate. */
  delivered: z.optional(z.boolean()),
  /** The candidate was cut from the reply to fit the size limit. */
  cut: z.optional(z.boolean()),
  /** Items the candidate replaces that the probe still delivers. */
  replacedShown: z.optional(z.array(z.string())),
  questions: z.optional(z.array(deliveryQuestionSchema)),
  note: z.optional(z.string()),
})
/**
 * Levels 4 and 5: the answer run's summary. A level that has not run on the live edition says
 * why in `message`, with the run and its state when one exists.
 */
export const answerDetailsSchema = z.object({
  message: z.optional(z.string()),
  /** The edition the run compared against. */
  edition: z.optional(z.string()),
  /** The evaluation run, for evals.runs.get (impact, flips, transcripts). */
  run: z.optional(z.string()),
  runState: z.optional(z.enum(runStates)),
  questions: z.optional(z.number()),
  setAside: z.optional(z.number()),
  /** The run's cost estimate, in dollars: "$0.42". */
  estimate: z.optional(z.string()),
  /** The outcome of a run on an earlier live edition, while the level runs again. */
  previous: z.optional(z.enum(checkOutcomes)),
  previousEdition: z.optional(z.nullable(z.string())),
  /**
   * The tests attached to the proposal when the run was planned (FR-524), each answered without
   * and with the change. Reported only: they never change the outcome.
   */
  attached: z.optional(
    z.array(z.object({ id: z.string(), baseline: verdictSchema, candidate: verdictSchema })),
  ),
})
const levelResultOf = <Level extends (typeof checkLevels)[number], Details extends z.ZodMiniType>(
  level: Level,
  details: Details,
) =>
  z.object({
    level: z.literal(level),
    outcome: z.enum(checkOutcomes),
    ranAt: z.nullable(z.string()),
    details,
  })
/** The newest result of one check level, with the details of that level. */
export const levelResultSchema = z.discriminatedUnion('level', [
  levelResultOf('format', formatDetailsSchema),
  levelResultOf('matching', matchingDetailsSchema),
  levelResultOf('delivery', deliveryDetailsSchema),
  levelResultOf('answer_impact', answerDetailsSchema),
  levelResultOf('answer_full', answerDetailsSchema),
])
export type LevelResult = z.infer<typeof levelResultSchema>
export type ProbeResult = z.infer<typeof probeResultSchema>
/**
 * A test attached to the proposal (FR-524) with its results on the version under review, taken
 * from the newest checks. Report-only: whatever they say, no level's outcome changes.
 */
export const attachedTestSchema = z.object({
  ...proposalTestSchema.shape,
  /** Level 3 without and with the change; null until level 3 has checked the question. */
  retrieval: z.nullable(z.object({ baseline: z.boolean(), candidate: z.boolean() })),
  /**
   * The answer tests without and with the change, from the run that counts on the live edition;
   * null for a low-risk version (FR-513), and until a run with the test attached has finished.
   */
  answer: z.nullable(
    z.object({ run: z.string(), baseline: verdictSchema, candidate: verdictSchema }),
  ),
})
export type AttachedTest = z.infer<typeof attachedTestSchema>
/** What the database gate reads: the newest result of every required level, and the approvals. */
export const gateSchema = z.object({
  required: z.array(z.enum(checkLevels)),
  levels: z.array(levelResultSchema),
  approvals: z.object({
    /** The first accept: an owner's of the area or an administrator's. */
    owner: z.boolean(),
    approver: z.nullable(z.boolean()),
  }),
  problem: z.nullable(z.string()),
  /** The tests attached to the proposal, reported with the change and never blocking it. */
  attached: z.array(attachedTestSchema),
})
export type Gate = z.infer<typeof gateSchema>

export const decisionSchema = z.object({
  id: z.string(),
  decidedBy: z.string(),
  /** The capacity it was made in; `deputy` only on a decision made before the role went. */
  capacity: z.enum(decisionCapacities),
  outcome: z.enum(['accept', 'request_changes', 'reject', 'retire']),
  reason: z.string(),
  decidedAt: z.string(),
})
export const vocabularyTermSchema = z.object({
  key: z.string(),
  kind: z.enum(['metric', 'metric_group', 'dimension', 'dimension_value']),
  parentKey: z.nullable(z.string()),
  name: z.string(),
  aliases: z.array(z.string()),
  areaId: z.nullable(z.string()),
  /** The source members it names: a metric one at most, a dimension one in each view (CON-208). */
  definitionRefs: z.array(z.string()),
})
export const decideSchema = z.strictObject({
  id: z.string().check(z.uuid()),
  revision: z.number().check(z.int(), z.minimum(1)),
  outcome: z.enum(['accept', 'request_changes', 'reject']),
  reason,
  capacity: z.optional(z.enum(['owner', 'approver', 'administrator'])),
  /**
   * A request for changes may carry a longer comment for the discussion, in the small Markdown
   * subset (bold, italic, code, links, lists and quotes), beside its short reason.
   */
  comment: z.optional(z.string().check(z.minLength(1), z.maxLength(2000))),
})
export const editionSchema = z.object({
  seq: z.number(),
  label: z.string(),
  reason: z.string(),
  actorId: z.nullable(z.string()),
  note: z.nullable(z.string()),
  restores: z.nullable(z.string()),
  digest: z.nullable(z.string()),
  sealedAt: z.nullable(z.string()),
  createdAt: z.string(),
  live: z.boolean(),
})
export type Edition = z.infer<typeof editionSchema>
export const itemReasonSchema = z.strictObject({ id: itemIdSchema, reason })
/** The most source members one term names: a dimension in every view of a large model fits. */
export const TERM_REFS_MAX = 100
/**
 * The most terms one step proposes: a whole model's members and its lists of values fit, so a
 * large model is one batch, decided as one edition. The service checks and stores a batch in a
 * fixed handful of statements, so its time grows with the terms, never with terms times members.
 */
export const TERM_BATCH_MAX = 5_000
/** The largest body a batch of terms may send: room for `TERM_BATCH_MAX` terms of usual size. */
export const TERM_BATCH_BODY_MAX = 4 * 1024 * 1024
/** The most proposals one bulk step decides or assigns: a queue page. */
export const BULK_MAX = 100
/** Why a bulk step leaves a proposal out. */
export const bulkSkipCodes = [
  'not_found',
  'changed',
  'not_waiting',
  'own',
  'claimed',
  'checks_failed',
  'checks_waiting',
  'not_allowed',
  'forbidden',
  'refused',
] as const
/** What happens to a proposal the step decides: published, waiting for the approver, or decided. */
export const bulkEffects = ['publish', 'wait', 'decide'] as const

/**
 * Members of a definition source that no term links yet, as the term to propose for them: a new
 * term, or a live dimension of the same name that links them too (`linked` holds what it links).
 */
export const termCandidateSchema = z.object({
  /** The source that reads the members it links, by id. */
  source: z.string(),
  key: z.string(),
  kind: z.enum(['metric', 'dimension']),
  name: z.string(),
  aliases: z.array(z.string()),
  /** Every member the term links once accepted: one view's for a metric, each view's for a dimension. */
  definitionRefs: z.array(z.string()),
  /** The members the live term links already; empty for a new term. */
  linked: z.array(z.string()),
  areaId: z.nullable(z.string()),
  views: z.array(z.string()),
  description: z.nullable(z.string()),
  valueType: z.nullable(z.string()),
  /** Proposed unless someone says otherwise: not a date or time, and not an id. */
  suggested: z.boolean(),
})
export type TermCandidate = z.infer<typeof termCandidateSchema>

export const editionListSchema = z.strictObject({
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(100))),
  offset: z.optional(z.number().check(z.int(), z.minimum(0))),
})
export const rollbackSchema = z.strictObject({ label: editionLabelSchema, note: reason })
export const stopSchema = z.strictObject({
  scope: z.enum(['all', 'area', 'item']),
  areaId: z.optional(areaIdSchema),
  itemId: z.optional(itemIdSchema),
  on: z.boolean(),
  reason,
})
export const activeStopSchema = z.object({
  /** The overlay event behind the stop; only administrators get it. */
  seq: z.optional(z.number()),
  at: z.string(),
  scope: z.enum(['all', 'area', 'item']),
  areaId: z.nullable(z.string()),
  itemId: z.nullable(z.string()),
  reason: z.nullable(z.string()),
})
