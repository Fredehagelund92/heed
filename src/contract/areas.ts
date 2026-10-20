/**
 * Creating and editing an area from settings (FR-801). Its owners and approvers may be named as
 * it is created, and are later given and removed with `grants.apply` (FR-804), each change
 * recorded on its own. What the area is (its summary and description) its owners or an
 * administrator write with `areas.describe` (FR-813). An administrator deletes an area with
 * `areas.remove` and brings a deleted one back with `areas.restore` (FR-814).
 */
import * as z from 'zod/mini'
import { AREA_DESCRIPTION_MAX, AREA_SUMMARY_MAX, domainHues, itemKinds } from '../domain/item.ts'
import { editionSchema } from './review.ts'

const reason = z.string().check(z.minLength(1), z.maxLength(500))
/** Text a person reads: no space at either end, no line break or other control character. */
const line = (max: number) =>
  z.string().check(
    z.minLength(1),
    z.maxLength(max),
    z.regex(/^\S(?:.*\S)?$/),
    // eslint-disable-next-line no-control-regex
    z.regex(/^[^\u0000-\u001f\u007f]*$/),
  )

/** A domain's summary: one line, or empty. */
export const areaSummarySchema = z.string().check(
  z.maxLength(AREA_SUMMARY_MAX),
  z.regex(/^(?:\S(?:.*\S)?)?$/, 'One line with no space at either end'),
  // eslint-disable-next-line no-control-regex
  z.regex(/^[^\u0000-\u001f\u007f]*$/, 'Text only, with no line break'),
)
/** A domain's description: plain text with light markdown, line breaks allowed, or empty. */
export const areaDescriptionSchema = z.string().check(
  z.maxLength(AREA_DESCRIPTION_MAX),
  z.regex(/^(?:\S(?:[\s\S]*\S)?)?$/, 'No space or empty line at either end'),
  // eslint-disable-next-line no-control-regex
  z.regex(/^[^\u0000-\u0009\u000b-\u001f\u007f]*$/, 'Text and line breaks only'),
)

/** What a domain is and what kind of data it holds (FR-813). */
const descriptionFields = {
  /** One line for lists and pickers. */
  summary: areaSummarySchema,
  /** The full text, for the domain's page, the assistant and AI clients. */
  description: areaDescriptionSchema,
}

const areaFields = {
  name: line(60),
  /** The area's hue on the ring of domain hues. */
  label: z.enum(domainHues),
  /** The review time: working days an owner has to decide a proposal. */
  reviewDays: z.number().check(z.int(), z.minimum(1), z.maximum(30)),
  /** The area's chat channel, as the chat connector names it; null for none. */
  chatChannel: z.nullable(line(100)),
  /** The team that owns the area's numbers, shown to agents with the area; null for none. */
  ownerTeam: z.nullable(line(100)),
  ...descriptionFields,
}

/** The most owners an area may be created with. */
export const AREA_OWNERS_MAX = 50
/** The most approvers an area may be created with. */
export const AREA_APPROVERS_MAX = 50

const areaIdField = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))

export const createAreaSchema = z.strictObject({
  /** Stays for good: items, mentions and history name the area by it. */
  id: areaIdField,
  ...areaFields,
  summary: z._default(areaSummarySchema, ''),
  description: z._default(areaDescriptionSchema, ''),
  /** Why, for the history log; a new area needs none, as creating it says what happened. */
  reason: z.optional(reason),
  /**
   * Who looks after the area from the start, given in the same step as one batch of role changes
   * with the area's reason. Without it the area starts with nobody assigned.
   */
  team: z.optional(
    z.strictObject({
      ownerIds: z.optional(z.array(z.uuid()).check(z.maxLength(AREA_OWNERS_MAX))),
      approverIds: z.optional(z.array(z.uuid()).check(z.maxLength(AREA_APPROVERS_MAX))),
    }),
  ),
})

export const updateAreaSchema = z.strictObject({
  id: areaIdField,
  /** The revision you read; a newer one is a conflict. */
  revision: z.number().check(z.int(), z.minimum(1), z.maximum(1_000_000)),
  ...areaFields,
  reason,
})

/**
 * A domain's summary and description, written by one of its owners or an administrator
 * (FR-813). Recorded in the history log like any other change to the domain.
 */
export const describeAreaSchema = z.strictObject({
  id: areaIdField,
  /** The revision you read; a newer one is a conflict. */
  revision: z.number().check(z.int(), z.minimum(1), z.maximum(1_000_000)),
  ...descriptionFields,
})

/** One area as settings shows and edits it. */
export const areaDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.enum(domainHues),
  reviewDays: z.number(),
  chatChannel: z.nullable(z.string()),
  ownerTeam: z.nullable(z.string()),
  /** The built-in demo area (FR-811). */
  demo: z.boolean(),
  summary: z.string(),
  description: z.string(),
  /** Its owners now, longest-serving first; empty while it has none. */
  ownerIds: z.array(z.string()),
  approverIds: z.array(z.string()),
  createdAt: z.string(),
  /** One more with every edit. */
  revision: z.number(),
})
export type AreaDetail = z.infer<typeof areaDetailSchema>

/**
 * What a domain holds, as deleting it counts it (FR-814). Nothing must move first: deleting
 * handles each kind itself, and the lists below name what goes.
 */
export const areaHoldingsSchema = z.object({
  /** Accepted items of the live edition in the domain: they move to the Bin. */
  items: z.number(),
  /** Vocabulary terms the live edition puts in the domain: retired, or kept without a domain. */
  terms: z.number(),
  /** Proposals that wait for a decision or for changes: withdrawn. */
  openProposals: z.number(),
  /** Members a definition source puts in the domain now (for Cube, its views' domain). */
  sourceMembers: z.number(),
  /** Drafts that name the domain: they stay with their authors. */
  drafts: z.number(),
  /** People who hold a role in the domain now: their roles end. */
  team: z.number(),
  /** Whether anything else names it (decided proposals, retired items, tests, gaps). */
  history: z.boolean(),
})
export type AreaHoldings = z.infer<typeof areaHoldingsSchema>

/** The most of each kind a deletion's preview names; the counts above give every one. */
export const AREA_DELETION_LIST_MAX = 200

const named = { id: z.string(), title: z.string() }

/** One accepted item that moves to the Bin. */
export const deletedItemSchema = z.object({ ...named, kind: z.enum(itemKinds) })
/**
 * One vocabulary term. `retired`: agents stop getting it. `kept`: another domain still uses it,
 * so it stays in service without a domain. `source`: only the definition source put it in the
 * domain, and it loses the domain.
 */
export const deletedTermSchema = z.object({
  key: z.string(),
  name: z.string(),
  kind: z.enum(['metric', 'metric_group', 'dimension', 'dimension_value']),
  fate: z.enum(['retired', 'kept', 'source']),
})
/** One open proposal, withdrawn with the reason "Domain deleted". */
export const deletedProposalSchema = z.object({
  ...named,
  number: z.number(),
  subject: z.enum(['item', 'vocabulary']),
})
/** One draft, which stays with its author, marked "Domain deleted". */
export const deletedDraftSchema = z.object({ ...named, author: z.string() })
/** One role on the domain's team, which ends. */
export const deletedRoleSchema = z.object({
  personId: z.string(),
  name: z.string(),
  role: z.enum(['owner', 'approver']),
})

/** What deleting a domain does to each kind of thing under it, named, at most the list limit. */
const deletionLists = {
  items: z.array(deletedItemSchema),
  terms: z.array(deletedTermSchema),
  openProposals: z.array(deletedProposalSchema),
  drafts: z.array(deletedDraftSchema),
  team: z.array(deletedRoleSchema),
}

/** What deleting a domain would do, for the person to read before they do it (FR-814). */
export const areaRemovalSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The revision read; deleting names it, so a change since is a conflict. */
  revision: z.number(),
  /** The built-in demo domain always exists (FR-811). */
  demo: z.boolean(),
  /**
   * What happens to the domain's own row. `delete`: nothing names it, so it goes for good.
   * `archive`: history names it, so it is kept as history, out of every list and picker, and
   * can be restored at any time; people read both as deleted. `blocked`: the demo domain.
   */
  outcome: z.enum(['delete', 'archive', 'blocked']),
  holdings: areaHoldingsSchema,
  ...deletionLists,
})
export type AreaRemoval = z.infer<typeof areaRemovalSchema>

export const removeAreaSchema = z.strictObject({
  id: areaIdField,
  /** The revision you read; a newer one is a conflict. */
  revision: z.number().check(z.int(), z.minimum(1), z.maximum(1_000_000)),
  /** The words `permanently delete`, typed by the person to confirm. */
  confirm: z.string().check(z.maxLength(60)),
  /** Why, for the history log. */
  reason: z.optional(reason),
})

export const areaRemovedSchema = z.object({
  outcome: z.enum(['deleted', 'archived']),
  /** The domain as it was, so the person can undo: create it again, or restore it. */
  area: areaDetailSchema,
  /** The edition that stopped delivery of its items and terms; null when it served nothing. */
  edition: z.nullable(editionSchema),
  /** What it did, by kind, as the preview counted it. */
  holdings: areaHoldingsSchema,
})
export type AreaRemoved = z.infer<typeof areaRemovedSchema>

/** A deleted domain that history keeps, which an administrator may restore at any time. */
export const archivedAreaSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.enum(domainHues),
  summary: z.string(),
  /** When it was deleted. */
  archivedAt: z.string(),
  /** The people whose roles ended when it was deleted; restoring gives them back. */
  team: z.number(),
  /** The terms deleting it retired or took it from; restoring serves them again. */
  terms: z.number(),
  /** Its items still in the Bin, which come back through the Bin's Restore. */
  binnedItems: z.number(),
})
export type ArchivedArea = z.infer<typeof archivedAreaSchema>

export const restoreAreaSchema = z.strictObject({
  id: areaIdField,
  /** Why, for the history log. */
  reason: z.optional(reason),
})

/** What restoring a domain did, and the items of it that wait in the Bin. */
export const areaRestoredSchema = z.object({
  area: areaDetailSchema,
  /** The edition that served its terms again; null when it had none to serve. */
  edition: z.nullable(editionSchema),
  /** The terms served again in that edition. */
  terms: z.number(),
  /** The people given their role back. */
  team: z.number(),
  /** Its items still in the Bin, newest first: restore them there. */
  binnedItems: z.array(deletedItemSchema),
})
export type AreaRestored = z.infer<typeof areaRestoredSchema>
