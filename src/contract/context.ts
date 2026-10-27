/**
 * Context on the API (docs/product.md, section 3): a context item's page, the items a person
 * opened, changes to many items at once with their skips and Undo (FR-139), restoring an earlier
 * version as a draft (FR-140), the item's related context, publishing in one step as an owner
 * (FR-137), a draft made from pasted text or a link, and what was deleted (Settings, Advanced).
 */
import * as z from 'zod/mini'
import { bulkActions, bulkRowSkipCodes } from '../domain/context-bulk.ts'
import { draftSchema } from '../domain/draft.ts'
import { itemKinds, itemSchema } from '../domain/item.ts'
import { itemTrusts } from '../domain/status.ts'

const isoDate = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))
const personId = z.string().check(z.uuid())
const itemIdSchema = z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))

/** The most rows one change takes: a long page of the list. */
export const ITEM_BULK_MAX = 200

/** A row of the Context list: a published item by its id, or a draft by its proposal's id. */
const rowId = z.union([itemIdSchema, z.string().check(z.uuid())])

export const itemBulkInputSchema = z.strictObject({
  action: z.enum(bulkActions),
  rows: z.array(rowId).check(z.minLength(1), z.maxLength(ITEM_BULK_MAX)),
  /** Change domain: where to. */
  areaId: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))),
  /** Change kind: to what. `example` is no longer offered. */
  kind: z.optional(z.enum(['event', 'issue', 'note', 'guide'])),
  /** Add or change owner: who. */
  personId: z.optional(personId),
})

const bulkRowSkipSchema = z.object({
  id: z.string(),
  title: z.string(),
  code: z.enum(bulkRowSkipCodes),
  /** A few words for the line under the bar: "owned by Marketing". */
  why: z.string(),
  /** One sentence, for its tooltip. */
  message: z.string(),
})

/** What a change would do, before it is made: the rows it acts on and the rows it leaves alone. */
export const itemBulkPlanSchema = z.object({
  act: z.array(z.object({ id: z.string(), title: z.string() })),
  skipped: z.array(bulkRowSkipSchema),
})

/**
 * What a change did. Each row it could change is done or failed: a failed row is left as it was,
 * with why, to try again. `undo` takes back exactly what it did, within limits.undo_seconds.
 */
export const itemBulkResultSchema = z.object({
  done: z.array(z.string()),
  skipped: z.array(bulkRowSkipSchema),
  failed: z.array(z.object({ id: z.string(), title: z.string(), message: z.string() })),
  /** Its line in the History log; null when it changed nothing. */
  change: z.nullable(z.object({ id: z.string(), summary: z.string() })),
  undo: z.nullable(z.string()),
})

/** A change to many items, as the History log in Settings, Advanced lists it. */
export const itemChangeSchema = z.object({
  id: z.string(),
  action: z.enum(['archived', 'deleted', 'moved', 'kind', 'owners', 'checked']),
  personId: z.string(),
  at: z.string(),
  summary: z.string(),
  /** The items it changed that the person may read. */
  items: z.array(z.object({ id: z.string(), title: z.string(), areaId: z.string() })),
  /** Items it changed that the audience rule hides from the person: counted, never named. */
  withheld: z.number(),
  undone: z.boolean(),
})

/** A draft someone deleted: Settings, Advanced, Deleted. */
export const deletedDraftSchema = z.object({
  id: z.string(),
  title: z.string(),
  areaId: z.nullable(z.string()),
  personId: z.nullable(z.string()),
  at: z.string(),
})

/** What a version of an item changed, as its History says it. */
export const versionKinds = [
  'published',
  'wording',
  'link',
  'dates',
  'checked',
  'moved',
  'retyped',
  'owners',
  'archived',
] as const

export const itemVersionEntrySchema = z.object({
  /** The version's number; null for what changed beside the versions (archived, owners). */
  version: z.nullable(z.number()),
  kind: z.enum(versionKinds),
  personId: z.nullable(z.string()),
  on: isoDate,
  /** The field it changed, and its words before and after, for the read-only difference. */
  field: z.string(),
  before: z.string(),
  after: z.string(),
  /** Its words can come back as a draft (Restore as a draft): a version that changed the words. */
  restorable: z.boolean(),
})

/** A context item's page: the item as published, what its list row reads, and its history. */
export const itemPageSchema = z.object({
  item: itemSchema,
  lastChecked: z.nullable(z.object({ on: isoDate, personId: z.string() })),
  trust: z.enum(itemTrusts),
  chips: z.array(z.string()),
  /** Its own owners, besides its domain's; empty when its domain's owners answer for it. */
  owners: z.array(z.string()),
  /** Newest first. */
  history: z.array(itemVersionEntrySchema),
  /** Whether the person may change it: an owner of its domain or an admin. */
  canChange: z.boolean(),
})

export const restoreAsDraftInputSchema = z.strictObject({
  id: itemIdSchema,
  version: z.number().check(z.int(), z.minimum(1)),
})
export const restoredDraftSchema = z.object({ proposalId: z.string() })

/** Context related to an item, as get_related follows it one step, for people. */
export const relatedNodeSchema = z.object({
  type: z.enum(['item', 'metric', 'dimension', 'dimension_value', 'area', 'other']),
  id: z.string(),
  label: z.string(),
  /** How it relates to the item: mentions, mentioned_by, applies_to, replaces, conflicts_with. */
  relation: z.string(),
  status: z.string(),
  kind: z.optional(z.enum(itemKinds)),
  areaId: z.optional(z.string()),
})
export const relatedSchema = z.object({
  nodes: z.array(relatedNodeSchema),
  /** Neighbours the person may not see: counted, never named. */
  withheld: z.number(),
})

/**
 * Publish in one step (FR-137): an owner of the draft's domain, or an admin, publishes it at once;
 * anyone else sends it to the domain's owners as a suggestion.
 */
export const publishItemInputSchema = z.strictObject({
  draft: draftSchema,
  /** The item it changes; left out for a new item. */
  itemId: z.optional(itemIdSchema),
  /** What is wrong with the current version, for a suggested change. */
  reason: z.optional(z.string().check(z.maxLength(500))),
})
export const publishItemResultSchema = z.union([
  z.object({
    published: z.literal(true),
    itemId: z.string(),
    proposalId: z.string(),
    edition: z.nullable(z.string()),
    undo: z.string(),
  }),
  z.object({
    published: z.literal(false),
    proposalId: z.string(),
    /** The owners it waits for. */
    ownerIds: z.array(z.string()),
  }),
])

/** A draft made from pasted text or a link, with no model: every field it could read filled in. */
export const draftFromTextInputSchema = z.strictObject({
  text: z.string().check(z.minLength(1), z.maxLength(20_000)),
})
export const draftFromTextSchema = z.object({
  draft: draftSchema,
  /** The fields it guessed, for the writer to check: "dates", "kind". */
  unsure: z.array(z.string()),
})

export type ItemBulkInput = z.infer<typeof itemBulkInputSchema>
export type ItemBulkPlan = z.infer<typeof itemBulkPlanSchema>
export type ItemBulkResult = z.infer<typeof itemBulkResultSchema>
export type ItemChange = z.infer<typeof itemChangeSchema>
export type DeletedDraft = z.infer<typeof deletedDraftSchema>
export type ItemVersionEntry = z.infer<typeof itemVersionEntrySchema>
export type ItemPage = z.infer<typeof itemPageSchema>
export type RelatedContext = z.infer<typeof relatedSchema>
export type PublishItemResult = z.infer<typeof publishItemResultSchema>
export type DraftFromText = z.infer<typeof draftFromTextSchema>
