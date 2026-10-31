/**
 * Conflicts on the API (FR-220): the pairs of context items an owner said disagree, one pair read
 * side by side with what agents would say with each alone, and settling it with a reason: keep one
 * (the other is archived), keep both, or not a conflict. Who may do what is checked against the item
 * each action changes; a side the reader may not read comes back without its words (FR-128).
 */
import * as z from 'zod/mini'
import { SETTLE_QUOTE_MAX, SETTLE_REASON_MAX, settleOutcomes } from '../domain/conflicts.ts'
import { itemKinds } from '../domain/item.ts'
import { answerBriefSchema } from './review-path.ts'

const isoDate = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))
const itemIdSchema = z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))

/** One item of a pair, as the view shows it. `readable` false: only its domain and owners. */
export const conflictSideSchema = z.object({
  id: itemIdSchema,
  readable: z.boolean(),
  title: z.nullable(z.string()),
  summary: z.nullable(z.string()),
  kind: z.enum(itemKinds),
  area: z.object({ id: z.string(), name: z.string() }),
  /** Who answers for it: its own owners, or else its domain's. */
  owners: z.array(z.object({ id: z.string(), name: z.string() })),
  /** The version agents get now: a decision names both, and a change in between holds it. */
  version: z.number(),
  checked: z.nullable(z.object({ on: isoDate, personId: z.nullable(z.string()) })),
  /** Its first source and the line its owner copied from it. */
  source: z.nullable(z.object({ url: z.string(), quote: z.string() })),
  /** When it applies from, as stored; null for always. */
  from: z.nullable(isoDate),
})

/** A decision on a pair, as both items' history keeps it. */
export const conflictDecisionSchema = z.object({
  id: z.string(),
  outcome: z.enum(settleOutcomes),
  keptId: z.nullable(z.string()),
  reason: z.string(),
  quote: z.nullable(z.string()),
  personId: z.string(),
  at: z.string(),
})

/** What the person may do with the pair, each checked against the item it changes. */
export const conflictRightsSchema = z.object({
  keepHolder: z.boolean(),
  keepOther: z.boolean(),
  editHolder: z.boolean(),
  editOther: z.boolean(),
  keepBoth: z.boolean(),
  notConflict: z.boolean(),
})

/** A row of the Conflicts list. */
export const conflictRowSchema = z.object({
  /** `holderId.otherId`: the pair's address. */
  key: z.string(),
  holder: z.object({ id: z.string(), title: z.nullable(z.string()), areaId: z.string() }),
  other: z.object({ id: z.string(), title: z.nullable(z.string()), areaId: z.string() }),
  /** What both apply to, in words built from their scope: "Orders in Norway". */
  topic: z.string(),
  /** Agent questions that got this pair as a Conflict in the last 7 days. */
  asked: z.number(),
  /** The day the later of the two went live: since when agents get both. */
  since: z.nullable(isoDate),
  /** Whether the person can settle it in some way, or can only ask the owner. */
  canSettle: z.boolean(),
  /** One of the two is in a domain the person owns. */
  mine: z.boolean(),
})

export const conflictListInputSchema = z.strictObject({
  whose: z.optional(z.enum(['mine', 'all'])),
})
export const conflictListSchema = z.object({ rows: z.array(conflictRowSchema) })

export const conflictReadInputSchema = z.strictObject({
  holderId: itemIdSchema,
  otherId: itemIdSchema,
})

/** One pair, side by side, with what agents say now and would say after each way of settling it. */
export const conflictViewSchema = z.object({
  key: z.string(),
  holder: conflictSideSchema,
  other: conflictSideSchema,
  topic: z.string(),
  /** What both apply to, as the item's own Applies to reads. */
  where: z.array(z.string()),
  asked: z.number(),
  since: z.nullable(isoDate),
  /**
   * The answer to the holder's own question, with no model: as it is (Conflict), with only the
   * holder, with only the other, and with the flag removed. Null when the reader may not read a side.
   */
  said: z.nullable(
    z.object({
      now: answerBriefSchema,
      onlyHolder: answerBriefSchema,
      onlyOther: answerBriefSchema,
      withoutFlag: answerBriefSchema,
    }),
  ),
  rights: conflictRightsSchema,
  /** The pair was kept as both and neither has changed since: it is off the conflict lists. */
  keptBoth: z.nullable(conflictDecisionSchema),
})

export const settleConflictInputSchema = z.strictObject({
  holderId: itemIdSchema,
  otherId: itemIdSchema,
  outcome: z.enum(settleOutcomes),
  /** For kept_one: the item that stays; the other is archived. */
  keepId: z.optional(itemIdSchema),
  reason: z.string().check(z.minLength(1), z.maxLength(SETTLE_REASON_MAX)),
  quote: z.optional(z.string().check(z.maxLength(SETTLE_QUOTE_MAX))),
  /** The versions the person saw; a newer one of either holds the decision. */
  versions: z.strictObject({ holder: z.number(), other: z.number() }),
})

export const settledConflictSchema = z.object({
  decision: conflictDecisionSchema,
  /** `conflict:<id>`, for Undo (decisions.undo) within the undo window, by the person who decided. */
  undo: z.string(),
})

export type ConflictSide = z.infer<typeof conflictSideSchema>
export type ConflictDecision = z.infer<typeof conflictDecisionSchema>
export type ConflictRow = z.infer<typeof conflictRowSchema>
export type ConflictList = z.infer<typeof conflictListSchema>
export type ConflictView = z.infer<typeof conflictViewSchema>
export type SettleConflictInput = z.infer<typeof settleConflictInputSchema>
export type SettledConflict = z.infer<typeof settledConflictSchema>
