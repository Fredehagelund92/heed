import * as z from 'zod/mini'
import { connectorIdPattern } from '../domain/connector-id.ts'
import { connectorManifestSchema } from '../domain/connector-manifest.ts'
import { checkStepSchema } from '../domain/connector-runtime.ts'

export const staleLinkStatuses = [
  'retired',
  'replaced',
  'source_changed',
  'source_missing',
  'unresolved',
] as const

// ---- the sources an administrator adds (Administration › Sources, connector interface 3.0) ----

const count = z.number().check(z.int(), z.minimum(0))
const time = z.string()
const reason = z.string().check(z.minLength(1), z.maxLength(500))
const sourceId = z.string().check(z.regex(/^[a-z][a-z0-9_-]{1,39}$/))
/** The connector a source uses: its manifest's id (`static-definitions`, `cube`). */
const connectorId = z.string().check(z.maxLength(64), z.regex(connectorIdPattern))
const fieldKey = z.string().check(z.regex(/^[a-z][a-zA-Z0-9]{0,39}$/))

/**
 * A connector an admin may add a source of, as Sources lists it: its manifest, which is pure
 * data (CON-112), so the screen draws the form and names the tool from it and no screen names a
 * vendor (CON-101). `writtenTo` is the interface it was written to: 3 for every connector today.
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

/**
 * A scope an admin chose: a folder, space or page of a content source, with the one domain its
 * documents go to (CON-602); or a group of a definitions source (a Cube view), with the domain its
 * definitions belong to, or none to leave them shared. Its id is the connector's, as discover or
 * the test gave it.
 */
export const chosenScopeSchema = z.strictObject({
  id: z.string().check(z.minLength(1), z.maxLength(500)),
  title: z.string().check(z.minLength(1), z.maxLength(300)),
  domain: z.nullable(z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))),
})
const chosenScopesSchema = z.array(chosenScopeSchema).check(z.maxLength(200))
export type ChosenScopeInput = z.infer<typeof chosenScopeSchema>

/**
 * How often a source is read (CON-115), as an ISO 8601 duration of days, hours and minutes
 * (`PT1H`, `P1D`); never under its connector's minimum.
 */
const scheduleSchema = z.string().check(z.regex(/^P(?=\d|T\d)(\d+D)?(T(?=\d)(\d+H)?(\d+M)?)?$/))

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
  /**
   * The scopes chosen: a content source's, each with its domain; a definitions source's groups,
   * each with its domain or none. A definitions source with none chosen reads every group.
   */
  scopes: chosenScopesSchema,
  /** How often it is read; null for its connector's default. */
  schedule: z.nullable(scheduleSchema),
  /** When it is read next, ISO 8601 in UTC; null until its first read. */
  nextReadAt: z.nullable(time),
  /** When it was added or last changed, ISO 8601 in UTC, and by whom (a person's id). */
  changedAt: z.nullable(time),
  changedBy: z.nullable(z.string()),
})

export const sourceIdInputSchema = z.strictObject({ id: sourceId })

// Trimmed by the service, which refuses one that is only spaces.
const sourceName = z.string().check(z.minLength(1), z.maxLength(80))

/**
 * Adds a source of a connector, with its settings, its secrets and why; a content source with
 * the scopes chosen for it, each mapped to a domain (CON-602), and either with how often it is
 * read (its connector's default when left out).
 */
export const addSourceSchema = z.strictObject({
  type: connectorId,
  name: sourceName,
  config: sourceConfigSchema,
  secrets: secretsSchema,
  scopes: z.optional(chosenScopesSchema),
  schedule: z.optional(z.nullable(scheduleSchema)),
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
  /** Left out, the chosen scopes stay as they are. */
  scopes: z.optional(chosenScopesSchema),
  /** Left out, the schedule stays; null goes back to the connector's default. */
  schedule: z.optional(z.nullable(scheduleSchema)),
  reason,
})

/**
 * Tries settings without keeping them or changing anything: the connector's check, then for a
 * definitions connector one read, and for a content connector what it may cover (discover). With
 * the id of a source already added, a secret left out is the one in the store.
 */
export const testSourceSchema = z.strictObject({
  id: z.optional(sourceId),
  type: connectorId,
  config: sourceConfigSchema,
  secrets: secretsSchema,
})

/**
 * What a test found: the connector's check, step by step in its own words (reach, sign in,
 * sample), whether Heed can read the source, the
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
  /**
   * The scopes an admin may choose, each with the domain it most likely belongs to: a content
   * connector's folders, spaces or pages (discover); a definitions connector's groups (a Cube
   * view: a member's name up to its last dot), as the read found them, each with what it holds
   * and the domain the tool names for most of it. Absent when the test could not read.
   */
  scopes: z.optional(
    z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        suggestedDomain: z.nullable(z.string()),
        /** A group's metrics and dimensions; absent for a content scope. */
        metrics: z.optional(count),
        dimensions: z.optional(count),
      }),
    ),
  ),
})

/**
 * Disconnects a source an admin added, with why (CON-118): it is read no more, its secrets are
 * removed from the store, its open suggestions are withdrawn, and what it read stays.
 */
export const removeSourceSchema = z.strictObject({ id: sourceId, reason })

export const removedSourceSchema = z.object({ id: z.string() })

/** A read of one source queued now (Read again, CON-115). */
export const sourceReadSchema = z.object({
  id: z.string(),
  status: z.literal('queued'),
})

export type ConnectorListing = z.infer<typeof connectorListingSchema>
export type SourceConfig = z.infer<typeof sourceConfigSchema>
export type SourceSettings = z.infer<typeof sourceSettingsSchema>
export type AddSourceInput = z.infer<typeof addSourceSchema>
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>
export type TestSourceInput = z.infer<typeof testSourceSchema>
export type SourceCheck = z.infer<typeof sourceCheckSchema>
export type RemoveSourceInput = z.infer<typeof removeSourceSchema>

// ---- the sources as Settings › Integrations shows them (CON-104, CON-115) ----

/**
 * How a source is, as its row and its page say it: paused by an admin; asked to read now and
 * waiting for the job to read it (Read again, or a change to its settings); its last read refused
 * its key; its last read failed for another reason; or read as it should be.
 */
export const sourceHealths = ['healthy', 'reading', 'failed', 'reauth', 'paused'] as const

/**
 * One read of a source, codes and counts only (CON-104): never a target, which may name a
 * document. A definitions read counts the definitions it held, and of them the new, the changed
 * and the gone; a content read the documents it looked at and what it did with them.
 */
export const sourceReadEntrySchema = z.object({
  id: z.string(),
  /** When it ended, ISO 8601 in UTC. */
  at: time,
  status: z.enum(['ok', 'partial', 'failed']),
  /** The source's first read that did not fail. */
  first: z.boolean(),
  durationMs: z.nullable(z.number()),
  definitions: z.nullable(z.object({ seen: count, added: count, changed: count, gone: count })),
  documents: z.nullable(
    z.object({
      seen: count,
      suggested: count,
      replaced: count,
      withdrawn: count,
      waiting: count,
      skipped: count,
    }),
  ),
  /** Its warnings, each code once with how many times it came. */
  warnings: z.array(z.object({ code: z.string(), count })),
})

/**
 * A source as Integrations lists it: its connector, how it is, when it was read and is read next,
 * and what it holds now. The server's own sources are listed too: their settings are whoever runs
 * the server's, so the page offers no change to them.
 */
export const sourceRowSchema = z.object({
  id: z.string(),
  /** Its connector's id (`cube`, `google-drive`), whose manifest names the tool and the kind. */
  type: z.string(),
  tool: z.string(),
  kind: z.enum(['definitions', 'content']),
  name: z.string(),
  origin: z.enum(['workspace', 'server']),
  health: z.enum(sourceHealths),
  /** How often it is read, its own or its connector's default, as an ISO 8601 duration. */
  schedule: z.string(),
  /** How long it may go unread before its copy is out of date, as an ISO 8601 duration. */
  staleAfter: z.string(),
  /** When it is read next, ISO 8601 in UTC; null before the job first reads it, and while paused. */
  nextReadAt: z.nullable(time),
  /** Its last read, failed or not; and when it last read without failing. */
  lastRead: z.nullable(sourceReadEntrySchema),
  lastGoodAt: z.nullable(time),
  /** Reads in a row that failed. */
  failures: count,
  /**
   * A definitions source: the metrics and dimensions its copy holds, its groups (a Cube view) and
   * how many of them map to no domain, and the live items flagged by a change to one of them.
   */
  definitions: z.nullable(
    z.object({
      metrics: count,
      dimensions: count,
      groups: count,
      groupsWithoutDomain: count,
      flagged: count,
    }),
  ),
  /**
   * A content source: the documents it holds, its suggestions waiting for owners and for how
   * many domains, the suggestions it made over the last 24 hours and how many it may (CON-607).
   */
  documents: z.nullable(
    z.object({
      held: count,
      waiting: count,
      waitingDomains: count,
      madeToday: count,
      perDay: count,
    }),
  ),
  /** Who added it and when; null for the server's own. */
  addedAt: z.nullable(time),
  addedBy: z.nullable(z.string()),
})

/**
 * What a document of a content source came to: a suggestion waiting for owners, published,
 * returned with a note, declined or withdrawn; past the day's suggestions, waiting for the next
 * read; not offered (`skipReason` says why); or gone from the tool.
 */
export const sourceDocumentStates = [
  'suggested',
  'published',
  'returned',
  'declined',
  'withdrawn',
  'held',
  'skipped',
  'gone',
] as const

/**
 * A source's activity, for its page: its reads, newest first; what it reads (a definitions
 * source's groups, a content source's chosen scopes), each with the domain it maps to; and a
 * content source's documents read most recently, never their text (CON-605).
 */
export const sourceActivitySchema = z.object({
  reads: z.array(sourceReadEntrySchema),
  groups: z.array(
    z.object({
      name: z.string(),
      metrics: count,
      dimensions: count,
      domain: z.nullable(z.string()),
    }),
  ),
  scopes: z.array(
    z.object({ id: z.string(), title: z.string(), domain: z.string(), documents: count }),
  ),
  documents: z.array(
    z.object({
      title: z.string(),
      link: z.string(),
      scope: z.string(),
      domain: z.nullable(z.string()),
      state: z.enum(sourceDocumentStates),
      skipReason: z.nullable(z.string()),
      /** When a read last saw it, ISO 8601 in UTC. */
      readAt: time,
      /** Its suggestion, while it has one, and who last decided it, by name. */
      proposalId: z.nullable(z.string()),
      decidedBy: z.nullable(z.string()),
    }),
  ),
})

/** Pauses reading a source, or lets it go on, with why (kept in the history log). */
export const pauseSourceSchema = z.strictObject({
  id: sourceId,
  paused: z.boolean(),
  reason,
})

export const pausedSourceSchema = z.object({ id: z.string(), paused: z.boolean() })

export type SourceRow = z.infer<typeof sourceRowSchema>
export type SourceReadEntry = z.infer<typeof sourceReadEntrySchema>
export type SourceActivity = z.infer<typeof sourceActivitySchema>
export type SourceHealth = (typeof sourceHealths)[number]
export type SourceDocumentState = (typeof sourceDocumentStates)[number]
export type PauseSourceInput = z.infer<typeof pauseSourceSchema>
