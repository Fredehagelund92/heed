import * as z from 'zod/mini'
import { rescueFields } from '../domain/bin-rescue.ts'
import { itemKinds, itemSchema } from '../domain/item.ts'
import { editionSchema } from './review.ts'

/*
  The Bin: an administrator removes items from the library and brings them back. Moving to the
  Bin is a retirement (FR-218) for an item agents get, in one edition for the whole action, and a
  record of who, when and why; restoring serves the version that was live again, in one edition.
  An item in the Bin is in no list, search, count or catalogue, and agents never get it.

  An item whose domain was deleted has no domain to go back to (FR-814). An administrator
  restores it into another domain instead: it leaves the Bin retired, and a proposal opens in
  that domain with its last content, for the domain's owners to review (src/domain/bin-rescue.ts).
*/

/** The most items one action moves or restores: a filtered view of the library at a time. */
export const BIN_ACTION_MAX = 500

const itemIdSchema = z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))
const itemIdsSchema = z.array(itemIdSchema).check(z.minLength(1), z.maxLength(BIN_ACTION_MAX))
const areaIdSchema = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))

export const binMoveSchema = z.strictObject({
  ids: itemIdsSchema,
  /** One reason for every item of the action, kept in the Bin and the history log. */
  reason: z.string().check(z.minLength(1), z.maxLength(500)),
})
export const binItemsSchema = z.strictObject({ ids: itemIdsSchema })
export const binRestoreSchema = z.strictObject({
  ids: itemIdsSchema,
  /**
   * The existing domain the items whose domain is deleted go to: each leaves the Bin retired, with
   * a proposal there. Left out, such an item is refused; the others restore as they were.
   */
  areaId: z.optional(areaIdSchema),
})
/** The items of a deleted domain to restore into `areaId`; any other item is left out. */
export const binRescuePreviewInputSchema = z.strictObject({
  ids: itemIdsSchema,
  areaId: areaIdSchema,
})

/** What moving items to the Bin would do, before anyone does it. */
export const binPreviewSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string(),
      title: z.string(),
      /** Agents get it now: moving it stops that in a new edition. */
      live: z.boolean(),
      /** Proposals about it that are still open; none can be accepted while it is in the Bin. */
      openProposals: z.number().check(z.int(), z.minimum(0)),
    }),
  ),
})

/** One item in the Bin, newest first. */
export const binEntrySchema = z.object({
  itemId: z.string(),
  kind: z.enum(itemKinds),
  areaId: z.string(),
  title: z.string(),
  version: z.number().check(z.int(), z.minimum(1)),
  reason: z.string(),
  binnedBy: z.string(),
  binnedAt: z.string(),
  /** Agents got it when it was moved: restoring serves it again. Otherwise it comes back retired. */
  wasLive: z.boolean(),
  /**
   * The name of its domain when that domain is deleted (FR-814): it is restored into another
   * domain. Null while its domain exists.
   */
  deletedDomain: z.nullable(z.string()),
  openProposals: z.number().check(z.int(), z.minimum(0)),
})

export const binListSchema = z.object({ items: z.array(binEntrySchema) })

/**
 * One item in the Bin, to read before restoring it: who moved it, when and why, and the item as
 * the library showed it. Administrators only; agents never get it.
 */
export const binItemSchema = z.object({ entry: binEntrySchema, item: itemSchema })

/** One change restoring an item into another domain makes to its content (bin-rescue.ts). */
export const rescueChangeSchema = z.object({
  field: z.enum(rescueFields),
  /** What the item had, in words: a name, or a day as YYYY-MM-DD for the review date. */
  before: z.nullable(z.string()),
  /** What the proposal carries instead; null when the value leaves it, or becomes plain text. */
  after: z.nullable(z.string()),
})

/** What restoring items of a deleted domain into another domain would change, before anyone does. */
export const binRescuePreviewSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string(),
      title: z.string(),
      /** The deleted domain it belongs to, by name. */
      deletedDomain: z.string(),
      changes: z.array(rescueChangeSchema),
      /** Why it cannot go to that domain; null when it can. */
      problem: z.nullable(z.string()),
    }),
  ),
})

export const binMoveResultSchema = z.object({
  items: z.array(binEntrySchema),
  /** The edition that stopped delivery; null when every item was already retired. */
  edition: z.nullable(editionSchema),
})

export const binRestoreResultSchema = z.object({
  restored: z.array(z.string()),
  /** The edition that serves the restored items again; null when every one comes back retired. */
  edition: z.nullable(editionSchema),
  /** The proposals opened for the items restored into another domain, one each. */
  proposals: z.array(z.object({ itemId: z.string(), id: z.string(), number: z.number() })),
})

export type BinMoveInput = z.infer<typeof binMoveSchema>
export type BinItemsInput = z.infer<typeof binItemsSchema>
export type BinRestoreInput = z.infer<typeof binRestoreSchema>
export type BinRescuePreviewInput = z.infer<typeof binRescuePreviewInputSchema>
export type BinRescuePreview = z.infer<typeof binRescuePreviewSchema>
export type RescueChange = z.infer<typeof rescueChangeSchema>
export type BinPreview = z.infer<typeof binPreviewSchema>
export type BinEntry = z.infer<typeof binEntrySchema>
export type BinList = z.infer<typeof binListSchema>
export type BinItem = z.infer<typeof binItemSchema>
export type BinMoveResult = z.infer<typeof binMoveResultSchema>
export type BinRestoreResult = z.infer<typeof binRestoreResultSchema>
