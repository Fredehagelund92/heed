/**
 * The shapes the API reads and returns, in `zod/mini` so the browser bundle stays small. Every
 * schema is representable as JSON Schema (no transforms, dates are ISO strings), so the OpenAPI
 * document and the runtime validation come from the same definition.
 */
import * as z from 'zod/mini'
import { itemKinds, itemSchema, itemStatuses } from '../domain/item.ts'
import { mentionTargetSchema } from '../domain/mentions.ts'
import { itemTrusts } from '../domain/status.ts'

export { API_PREFIX } from './limits.ts'

const isoDate = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))

/**
 * The item's own fields in a library index row: what the list, the search and the quick switcher
 * need, without the body, the evidence or the change marks. The catalogue counts over these.
 */
export const indexedItemSchema = z.pick(itemSchema, {
  id: true,
  kind: true,
  areaId: true,
  status: true,
  version: true,
  title: true,
  summary: true,
  scope: true,
  validity: true,
  reviewDate: true,
  reviewQuestion: true,
  checkFlag: true,
  ownerId: true,
  proposerId: true,
  updatedAt: true,
})

/** One row of the library index: the item's fields and what the list's columns read from them. */
export const libraryItemSchema = z.extend(indexedItemSchema, {
  /**
   * The last time someone confirmed the current version: its acceptance, which a recheck
   * ("checked, still correct") renews. Null when no decision is on record.
   */
  lastChecked: z.nullable(z.object({ on: isoDate, personId: z.string() })),
  /** Whether it can be trusted today (`itemTrust`), the rule `library.freshness` counts by. */
  trust: z.enum(itemTrusts),
  /**
   * Its scope as people read it: the metrics, then the dimensions, then the values, each by key,
   * named as the live vocabulary names them (the key's id when the vocabulary has no name).
   */
  chips: z.array(z.string()),
  /** Its own owners, by id, when not its domain's (item_owners); empty when its domain's owners answer for it. */
  owners: z.array(z.string()),
  /** Whether the person opened it (item_reads): only opened items can be marked as checked together. */
  opened: z.boolean(),
})

/** Every item the person may read, as one light index. Clients sort and filter it themselves. */
export const libraryIndexSchema = z.object({
  /** Ordered by id, so a client's ties (equally good search matches) fall the same way everywhere. */
  items: z.array(libraryItemSchema),
  /** When the server built this index, as an ISO timestamp. */
  loadedAt: z.string(),
  /** The server's UTC day. Statuses that depend on the date (re-check due, ended) use it. */
  today: isoDate,
})

/**
 * What a mention can point at (section 2.1 of the mentions design: a typed link, never scope). A
 * `term` is a term written in Definitions (FR-138), by its id.
 */
export const linkTargetTypes = [
  'metric',
  'dimension',
  'dimension_value',
  'item',
  'area',
  'term',
] as const

/** `retired`: the target is an item that is out of service. Its name is shown, never more. */
/**
 * `source_changed` and `source_missing` say the Cube definition of a mentioned term changed or
 * disappeared since the item was written. They inform; the item is still delivered (FR-333).
 */
export const linkStatuses = ['current', 'retired', 'source_changed', 'source_missing'] as const

const mentionFieldSchema = z.enum(['summary', 'body'])

/** A mention in this item's text: where it is, the author's words, and what it points at now. */
export const outgoingLinkSchema = z.object({
  field: mentionFieldSchema,
  /** Zero-based order of the mention within its field. */
  position: z.number().check(z.int(), z.minimum(0)),
  /** The words as the author wrote them. They never change when the target is renamed. */
  words: z.string(),
  target: z.object({
    type: z.enum(linkTargetTypes),
    /** The stable target as written in the markup, for example `metric:orders`. */
    key: mentionTargetSchema,
    /** The target's current name: a vocabulary name, an item title or an area name. */
    name: z.string(),
    status: z.enum(linkStatuses),
  }),
})

/** Another item whose text mentions this one ("what links here"). */
export const incomingLinkSchema = z.object({
  field: mentionFieldSchema,
  position: z.number().check(z.int(), z.minimum(0)),
  words: z.string(),
  source: z.object({
    id: z.string(),
    kind: z.enum(itemKinds),
    title: z.string(),
    status: z.enum(itemStatuses),
  }),
})
export type IndexedItem = z.infer<typeof indexedItemSchema>
export type LibraryItem = z.infer<typeof libraryItemSchema>
export type LibraryIndex = z.infer<typeof libraryIndexSchema>
export type LinkTargetType = (typeof linkTargetTypes)[number]
export type OutgoingLink = z.infer<typeof outgoingLinkSchema>
export type IncomingLink = z.infer<typeof incomingLinkSchema>
