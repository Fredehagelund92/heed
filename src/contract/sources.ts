import * as z from 'zod/mini'
import { connectorIdPattern } from '../domain/connector-id.ts'
import { connectorManifestSchema } from '../domain/connector-manifest.ts'
import { checkStepSchema } from '../domain/connector-runtime.ts'
import { checkFlags } from '../domain/item.ts'

/**
 * What changes in a definition source mean for accepted items. A definition an item references
 * that changed or disappeared flags the item (`needs_check`, `source_missing`) and it is
 * delivered as unverified until an owner records "checked, still correct" or accepts a new
 * version (CON-209 to CON-211). A definition an item only mentions never flags it: the mention
 * goes on the stale-link list, and the item is delivered as before (FR-333).
 */

export const sourceListSchema = z.strictObject({
  areaId: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))),
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(500))),
})

export const flaggedItemSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  areaId: z.string(),
  flag: z.enum(checkFlags),
  /** When the flag was raised, ISO 8601 in UTC. */
  since: z.string(),
  reason: z.nullable(z.string()),
  /** The referenced definitions behind the flag. `renamedTo` names the new id when known. */
  definitions: z.array(
    z.object({
      ref: z.string(),
      name: z.string(),
      status: z.enum(['changed', 'missing']),
      renamedTo: z.nullable(z.string()),
    }),
  ),
})

export const staleLinkStatuses = [
  'retired',
  'replaced',
  'source_changed',
  'source_missing',
  'unresolved',
] as const

export const staleLinkSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  areaId: z.string(),
  field: z.enum(['summary', 'body']),
  position: z.number().check(z.int(), z.minimum(0)),
  /** The author's words. They never change, whatever happened to the target. */
  words: z.string(),
  target: z.object({
    type: z.nullable(z.string()),
    key: z.string(),
    status: z.enum(staleLinkStatuses),
    /** The definition behind a mentioned metric or dimension. */
    definition: z.nullable(z.string()),
    renamedTo: z.nullable(z.string()),
    replacedBy: z.nullable(z.string()),
  }),
})

export type FlaggedItem = z.infer<typeof flaggedItemSchema>
export type StaleLink = z.infer<typeof staleLinkSchema>

// ---- the sources an administrator adds (Administration › Sources, connector interface 3.0) ----

const time = z.string()
const reason = z.string().check(z.minLength(1), z.maxLength(500))
const sourceId = z.string().check(z.regex(/^[a-z][a-z0-9_-]{1,39}$/))
/** The connector a source uses: its manifest's id (`static-definitions`, `cube`). */
const connectorId = z.string().check(z.maxLength(64), z.regex(connectorIdPattern))
const fieldKey = z.string().check(z.regex(/^[a-z][a-zA-Z0-9]{0,39}$/))

/**
 * A connector an admin may add a source of, as Sources lists it: its manifest, which is pure
 * data (CON-112), so the screen draws the form and names the tool from it and no screen names a
 * vendor (CON-101). `writtenTo` is the interface it was written to: 3, or 2 through the adapter.
 */
export const connectorListingSchema = z.object({
  writtenTo: z.number(),
  manifest: connectorManifestSchema,
})

/**
 * A source's settings, by field: text, a number, yes or no, lines of text, or a map of names
 * (domain names). Never a secret. The connector's manifest says which, and checks each value.
 */
export const sourceConfigSchema = z.record(
  fieldKey,
  z.union([
    z.string().check(z.maxLength(20_000)),
    z.number(),
    z.boolean(),
    z.array(z.string().check(z.maxLength(200))).check(z.maxLength(500)),
    z.record(
      z.string().check(z.minLength(1), z.maxLength(200)),
      z.string().check(z.maxLength(200)),
    ),
  ]),
)

/** A secret as written in the form: kept in the server's secret store, never sent back. */
const secretsSchema = z.record(fieldKey, z.string().check(z.minLength(1), z.maxLength(4096)))

/**
 * A source an admin added, as its page shows it: its settings and, for each secret its
 * connector has, whether the store holds one. A secret itself never leaves the service (CON-105).
 */
export const sourceSettingsSchema = z.object({
  id: z.string(),
  /** Its connector's id. */
  type: z.string(),
  name: z.string(),
  /** Its revision; a change names the one it read. */
  revision: z.number(),
  config: sourceConfigSchema,
  secrets: z.array(z.object({ key: z.string(), set: z.boolean() })),
  /** When it was added or last changed, ISO 8601 in UTC, and by whom (a person's id). */
  changedAt: z.nullable(time),
  changedBy: z.nullable(z.string()),
})

export const sourceIdInputSchema = z.strictObject({ id: sourceId })

// Trimmed by the service, which refuses one that is only spaces.
const sourceName = z.string().check(z.minLength(1), z.maxLength(80))

/** Adds a source of a connector, with its settings, its secrets and why. */
export const addSourceSchema = z.strictObject({
  type: connectorId,
  name: sourceName,
  config: sourceConfigSchema,
  secrets: secretsSchema,
  reason,
})

/**
 * Changes a source an admin added: its name and settings, and any secret written again (one
 * left out keeps the one in the store).
 */
export const updateSourceSchema = z.strictObject({
  id: sourceId,
  revision: z.number().check(z.int(), z.minimum(1)),
  name: sourceName,
  config: sourceConfigSchema,
  secrets: secretsSchema,
  reason,
})

/**
 * Tries settings without keeping them or changing anything: the connector's check, then for a
 * definitions connector one read. With the id of a source already added, a secret left out is
 * the one in the store.
 */
export const testSourceSchema = z.strictObject({
  id: z.optional(sourceId),
  type: connectorId,
  config: sourceConfigSchema,
  secrets: secretsSchema,
})

/**
 * What a test found: the connector's check, step by step in its own words (reach, sign in,
 * sample; none for a connector written to interface 2), whether Heed can read the source, the
 * version it read and what it would hold, with the warnings of the read (codes and targets
 * only). A failed test says why in its warnings.
 */
export const sourceCheckSchema = z.object({
  ok: z.boolean(),
  steps: z.array(checkStepSchema),
  /** The version it read: a commit, or a digest of the files. */
  version: z.nullable(z.string()),
  complete: z.boolean(),
  views: z.number(),
  metrics: z.number(),
  dimensions: z.number(),
  warnings: z.array(z.object({ code: z.string(), target: z.string() })),
})

export type ConnectorListing = z.infer<typeof connectorListingSchema>
export type SourceConfig = z.infer<typeof sourceConfigSchema>
export type SourceSettings = z.infer<typeof sourceSettingsSchema>
export type AddSourceInput = z.infer<typeof addSourceSchema>
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>
export type TestSourceInput = z.infer<typeof testSourceSchema>
export type SourceCheck = z.infer<typeof sourceCheckSchema>
