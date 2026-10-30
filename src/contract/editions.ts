import * as z from 'zod/mini'
import { editionChangeKinds } from '../domain/editions.ts'
import { creationChannels, itemKinds, riskLevels } from '../domain/item.ts'
import { decisionCapacities } from '../domain/proposal.ts'
import { editionSchema } from './review.ts'

/**
 * Seeing what changed between editions (Editions design, sections 1 to 6): any two editions
 * compared item by item (G1), who made each change and why (G2), a summary and a sentence for
 * every edition so the feed needs one call (G3), and what going back would do before anyone does
 * it (G7). For owners of any area and administrators; the preview of going back
 * is an administrator's, like going back.
 */

const editionLabel = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}\.\d+$/))
const areaId = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))
const page = {
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(200))),
  offset: z.optional(z.number().check(z.int(), z.minimum(0))),
}

export const changeCountsSchema = z.object({
  added: z.number(),
  changed: z.number(),
  checked: z.number(),
  resaved: z.number(),
  retired: z.number(),
  removed: z.number(),
})

/**
 * Who made a change and why (G2). For an item that is served, the proposal that brought its
 * version in and the decisions that accepted it; for an item that left, its retirement. The
 * proposer and channel are the version's own, so they are there without a proposal (an import).
 */
export const changeWhySchema = z.object({
  proposal: z.nullable(z.object({ id: z.string(), number: z.number() })),
  proposerId: z.nullable(z.string()),
  channel: z.nullable(z.enum(creationChannels)),
  /** The owner who changed the version during review (FR-105). */
  editedBy: z.nullable(z.string()),
  decisions: z.array(
    z.object({
      decidedBy: z.string(),
      capacity: z.enum(decisionCapacities),
      outcome: z.enum(['accept', 'retire']),
      reason: z.string(),
      decidedAt: z.string(),
    }),
  ),
})

const versionRef = z.nullable(z.object({ version: z.number(), versionId: z.string() }))

/** One item that differs between two editions. */
export const itemChangeSchema = z.object({
  itemId: z.string(),
  change: z.enum(editionChangeKinds),
  /** The title, area, kind and risk of the later version, or of the last one for an item that left. */
  title: z.string(),
  areaId: z.string(),
  kind: z.enum(itemKinds),
  riskLevel: z.enum(riskLevels),
  from: versionRef,
  to: versionRef,
  why: changeWhySchema,
})

export const editionCompareInputSchema = z.strictObject({
  /** The earlier state; by default, the edition before `to`. */
  from: z.optional(editionLabel),
  /** The later state; by default, the live edition. Older than `from` compares backwards. */
  to: z.optional(editionLabel),
  change: z.optional(z.enum(editionChangeKinds)),
  areaId: z.optional(areaId),
  kind: z.optional(z.enum(itemKinds)),
  riskLevel: z.optional(z.enum(riskLevels)),
  ...page,
})
/** Net change: each item once, as it was in `from` against how it is in `to`. */
export const editionComparisonSchema = z.object({
  from: z.nullable(editionSchema),
  to: editionSchema,
  /** Editions after the earlier of the two, up to and including the later one. */
  editions: z.number(),
  /** `to` is older than `from`: what going back from `from` to `to` would change. */
  backwards: z.boolean(),
  sentence: z.string(),
  /** Over every changed item, whatever the filters, for the filter menus. */
  facets: z.object({
    change: changeCountsSchema,
    areas: z.array(z.object({ areaId: z.string(), count: z.number() })),
    kinds: z.array(z.object({ kind: z.enum(itemKinds), count: z.number() })),
    risks: z.array(z.object({ riskLevel: z.enum(riskLevels), count: z.number() })),
  }),
  vocabulary: z.number(),
  /** Changed items with an audience group, counted only and left out of everything else. */
  withheld: z.number(),
  /** Items that match the filters, before paging. */
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  /** A page of changed items, in change order (added first), then by title. */
  items: z.array(
    z.extend(itemChangeSchema, {
      /** The fields that differ, in review order; empty when only the version moved. */
      fields: z.array(z.string()),
    }),
  ),
})

export const rollbackPreviewInputSchema = z.strictObject({ label: editionLabel })
/** A version that cannot be served again, with the database's reason (FR-205). */
export const blockedVersionSchema = z.object({
  itemId: z.string(),
  /** Null for a version with an audience group, which the reads do not show. */
  title: z.nullable(z.string()),
  version: z.number(),
  problem: z.string(),
})
/** What going back to an edition would do, before anyone does it (FR-217). */
export const rollbackPreviewSchema = z.object({
  live: editionSchema,
  target: editionSchema,
  /** The live edition compared with the target, backwards: the first page of items. */
  comparison: editionComparisonSchema,
  /** Versions the target serves that cannot be served again; going back is refused while any remain. */
  blocked: z.array(blockedVersionSchema),
})
