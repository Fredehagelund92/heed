import * as z from 'zod/mini'
import { claimLevels, creationChannels, riskLevels } from '../domain/item.ts'
import { mentionSchema } from '../domain/mentions.ts'
import { proposalStates } from '../domain/proposal-state.ts'
import { provenanceSchema } from '../domain/provenance.ts'
import { decisionCapacities, proposalActions } from '../domain/proposal.ts'
import { calendarDateSchema } from '../domain/validity.ts'
import { runStates, verdictSchema } from './evals.ts'
import { findingSchema, proposalRecordSchema, proposalTestSchema } from './proposals.ts'

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
  proposerId: z.string(),
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
  /** The get_context input of the item's own probe. */
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
const fieldChangesSchema = z.array(
  z.object({ field: z.string(), before: z.unknown(), after: z.unknown() }),
)
export const reviewSchema = z.object({
  proposal: reviewProposalSchema,
  /** Field by field against the version in service; every field for a new item. */
  diff: fieldChangesSchema,
  /**
   * A proposal resubmitted after a request for changes, while it waits for a decision: field by
   * field from the version the newest request was made on to the version under review, empty
   * when nothing changed. Null when changes were never asked for, or it is not under review.
   */
  sinceRequest: z.nullable(z.object({ decisionId: z.string(), diff: fieldChangesSchema })),
  mentions: z.object({ added: z.array(mentionSchema), removed: z.array(mentionSchema) }),
  /** Never blocks a decision (FR-209). */
  warnings: z.array(z.object({ target: z.string(), label: z.string(), message: z.string() })),
  findings: z.array(findingSchema),
  gate: z.nullable(gateSchema),
  decisions: z.array(decisionSchema),
  vocabulary: z.nullable(
    z.object({ before: z.nullable(vocabularyTermSchema), after: vocabularyTermSchema }),
  ),
  /**
   * The terms proposed in the same step as this one (an administrator's batch): how many the
   * person can see, and how many of them still wait for a decision. Null for any other proposal.
   */
  termBatch: z.nullable(z.object({ id: z.string(), open: z.number(), total: z.number() })),
  /**
   * A rescue (FR-814): an administrator restored an item of a deleted domain into this one, and
   * the proposal carries its last content, fitted to this domain. The diff reads against the
   * version that was live before the Bin. Null for any other proposal.
   */
  rescue: z.nullable(
    z.object({
      /** The deleted domain the item belonged to, by name. */
      deletedDomain: z.string(),
      restoredBy: z.string(),
      restoredAt: z.string(),
    }),
  ),
  /** FR-210: asked on every review screen; an owner may reject with this as the reason. */
  sourceToolQuestion: z.string(),
  /**
   * Where each field came from when an AI agent or the assistant wrote the draft for the
   * proposer, who submitted it (FR-121, FR-707); null for a proposal a person wrote.
   */
  provenance: z.nullable(provenanceSchema),
})

/**
 * A proposal in the review queue, with its checks at a glance (FR-208, FR-223): the required
 * levels whose newest result failed, and the ones that have not passed yet. Null for a term and
 * a retirement, which have no checks.
 */
export const queueEntrySchema = z.object({
  ...reviewProposalSchema.shape,
  checks: z.nullable(
    z.object({ failed: z.array(z.enum(checkLevels)), waiting: z.array(z.enum(checkLevels)) }),
  ),
})
export type QueueEntry = z.infer<typeof queueEntrySchema>

export const reviewIdSchema = z.strictObject({ id: z.string().check(z.uuid()) })
export const queueSchema = z.strictObject({
  areaId: z.optional(areaIdSchema),
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(100))),
  offset: z.optional(z.number().check(z.int(), z.minimum(0))),
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
/**
 * An owner changes what the review decides around the content (FR-105, FR-106,
 * FR-123, FR-324): the risk level, the review date, the claim level with its authority and
 * quote, the owner and the area. Name only what changes; the content stays the proposer's.
 */
export const reviewEditSchema = z.strictObject({
  id: z.string().check(z.uuid()),
  revision: z.number().check(z.int(), z.minimum(1)),
  riskLevel: z.optional(z.enum(riskLevels)),
  /** Null only for an item that ends: an open-ended item needs a review date (FR-127). */
  reviewDate: z.optional(z.nullable(calendarDateSchema)),
  /** `effect_stated` needs the named authority and its quote (FR-324). */
  claim: z.optional(
    z.discriminatedUnion('level', [
      z.strictObject({ level: z.literal(claimLevels[0]) }),
      z.strictObject({
        level: z.literal(claimLevels[1]),
        authority: z.string().check(z.minLength(1), z.maxLength(200)),
        quote: z.string().check(z.minLength(1), z.maxLength(500)),
      }),
    ]),
  ),
  /** An active owner of the area the proposal ends up in. */
  ownerId: z.optional(z.string().check(z.uuid())),
  /** Moves the proposal to another area; its owner takes it unless `ownerId` names one. */
  areaId: z.optional(areaIdSchema),
  /** Why, for the timeline and the history log. */
  reason: z.optional(reason),
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
export const decisionResultSchema = z.object({
  proposal: reviewProposalSchema,
  edition: z.nullable(editionSchema),
})
export const itemReasonSchema = z.strictObject({ id: itemIdSchema, reason })
/** The most source members one term names: a dimension in every view of a large model fits. */
export const TERM_REFS_MAX = 100
export const vocabularyProposalSchema = z.strictObject({
  key: z.string().check(z.regex(/^(group|metric|dim|val):[a-z0-9_/]+$/), z.maxLength(160)),
  kind: z.enum(['metric', 'metric_group', 'dimension', 'dimension_value']),
  parentKey: z.nullable(z.string().check(z.maxLength(160))),
  name: z.string().check(z.minLength(1), z.maxLength(200)),
  aliases: z.array(z.string().check(z.minLength(1), z.maxLength(200))).check(z.maxLength(20)),
  areaId: z.nullable(areaIdSchema),
  /** The source members it names: a metric one at most, a dimension one in each view (CON-208). */
  definitionRefs: z
    .array(z.string().check(z.minLength(1), z.maxLength(500)))
    .check(z.maxLength(TERM_REFS_MAX)),
})
/**
 * The most terms one step proposes: a whole model's members and its lists of values fit, so a
 * large model is one batch, decided as one edition. The service checks and stores a batch in a
 * fixed handful of statements, so its time grows with the terms, never with terms times members.
 */
export const TERM_BATCH_MAX = 5_000
/** The largest body a batch of terms may send: room for `TERM_BATCH_MAX` terms of usual size. */
export const TERM_BATCH_BODY_MAX = 4 * 1024 * 1024
/**
 * Many terms in one step (an administrator's batch): one proposal each, all or none, each still
 * decided by an owner of its area or an administrator. A term may name a parent in the batch.
 */
export const termBatchSchema = z.strictObject({
  terms: z.array(vocabularyProposalSchema).check(z.minLength(1), z.maxLength(TERM_BATCH_MAX)),
  /** Where the terms come from, kept with the batch: "Cube members". */
  sourceName: z.optional(z.string().check(z.minLength(1), z.maxLength(200))),
})
export const termBatchResultSchema = z.object({
  batchId: z.string(),
  proposals: z.array(reviewProposalSchema),
})
/** Accepts or rejects every open term of a batch the person may decide, as one edition. */
export const decideTermBatchSchema = z.strictObject({
  batchId: z.string().check(z.uuid()),
  outcome: z.enum(['accept', 'reject']),
  reason,
  capacity: z.optional(z.enum(['owner', 'administrator'])),
})
export const termBatchDecisionSchema = z.object({
  proposals: z.array(reviewProposalSchema),
  edition: z.nullable(editionSchema),
})
/** The most proposals one bulk step decides or assigns: a queue page. */
export const BULK_MAX = 100
/** One proposal of a bulk step, at the revision the person selected it. */
const bulkTargetSchema = z.strictObject({
  id: z.string().check(z.uuid()),
  revision: z.number().check(z.int(), z.minimum(1)),
})
const bulkTargets = z.array(bulkTargetSchema).check(z.minLength(1), z.maxLength(BULK_MAX))
const bulkOutcome = z.enum(['accept', 'request_changes', 'reject'])
/** What a bulk decision would do to each selected proposal, before it is made (FR-223). */
export const bulkPlanInputSchema = z.strictObject({
  proposals: bulkTargets,
  outcome: bulkOutcome,
})
/**
 * One decision for several proposals in the review queue, with one reason (FR-223). Each still
 * gets its own decision, checks and rules; the ones the person may not decide this way are
 * left out and named. Accepts publish as few editions as the rules allow: one for new and
 * changed items, one for terms, one for retirements, and one per re-check.
 */
export const bulkDecideSchema = z.strictObject({
  proposals: bulkTargets,
  outcome: bulkOutcome,
  reason,
})
/** Claims the selected proposals for a reviewer of their area, or hands them over to one. */
export const bulkAssignSchema = z.strictObject({
  proposals: bulkTargets,
  personId: z.string().check(z.uuid()),
})
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
export const bulkSkipSchema = z.object({
  id: z.string(),
  number: z.nullable(z.number()),
  title: z.nullable(z.string()),
  code: z.enum(bulkSkipCodes),
  /** Why, in words for the person: "A required check failed: Matching." */
  message: z.string(),
})
export type BulkSkip = z.infer<typeof bulkSkipSchema>
/** What happens to a proposal the step decides: published, waiting for the approver, or decided. */
export const bulkEffects = ['publish', 'wait', 'decide'] as const
export const bulkPlanSchema = z.object({
  decided: z.array(
    z.object({
      id: z.string(),
      number: z.number(),
      title: z.string(),
      effect: z.enum(bulkEffects),
    }),
  ),
  skipped: z.array(bulkSkipSchema),
  /** How many editions an accept publishes. */
  editions: z.number(),
})
export const bulkDecisionSchema = z.object({
  proposals: z.array(reviewProposalSchema),
  skipped: z.array(bulkSkipSchema),
  editions: z.array(editionSchema),
})
export const bulkAssignmentSchema = z.object({
  /** The proposals assigned, as the proposal write API returns them. */
  proposals: z.array(proposalRecordSchema),
  skipped: z.array(bulkSkipSchema),
})

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
export const editionDiffInputSchema = z.strictObject({
  label: editionLabelSchema,
  against: z.optional(editionLabelSchema),
})
const versionChange = z.object({
  id: z.string(),
  from: z.nullable(z.number()),
  to: z.nullable(z.number()),
})
export const editionDiffSchema = z.object({
  from: z.nullable(z.string()),
  to: z.string(),
  items: z.array(versionChange),
  vocabulary: z.array(versionChange),
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

/** The items whose served review a page shows: at most one page of the library's facts. */
export const servedReviewsInputSchema = z.strictObject({
  ids: z.array(itemIdSchema).check(z.minLength(1), z.maxLength(100)),
})
/**
 * How the version of an item the live edition serves was reviewed (FR-326), for the review stamp
 * inside Heed (design contract 7.2, `ReviewStamp`): who accepted it, on which day, in which
 * capacity and domain, the edition that first served it, and the check levels it passed. Behind
 * sign-in the stamp names the person; what an AI app receives names only the role. An item the
 * person may not read, or that the live edition does not serve, has no entry.
 */
export const servedReviewSchema = z.object({
  id: itemIdSchema,
  version: z.number().check(z.int(), z.minimum(1)),
  acceptedOn: calendarDateSchema,
  acceptedAs: z.enum(['owner', 'deputy', 'administrator']),
  /** The domain the decision was made in. */
  areaId: z.string(),
  /** Who accepted it; null when that person's record was erased. */
  personId: z.nullable(z.string()),
  edition: editionLabelSchema,
  /** The check levels that passed for this version, in the order checks run. */
  checks: z.array(z.enum(checkLevels)),
})
export type ItemReview = z.infer<typeof servedReviewSchema>
