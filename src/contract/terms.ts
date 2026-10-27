/**
 * Terms and synonyms on the API (FR-138): the words people write in Definitions, beside the
 * metrics and dimensions the definitions source keeps (the catalogue, read only). A term is a word
 * with its own meaning; a synonym is another name for a metric, a dimension or a term. One word
 * has one meaning: a word that already means something is refused, naming who has it. An owner of
 * the term's domain or an admin writes it; a synonym's domain is what it means.
 */
import * as z from 'zod/mini'
import {
  TERM_BULK_MAX,
  TERM_MEANING_MAX,
  TERM_NAME_MAX,
  termConflictCodes,
  termNamePattern,
  termRefPattern,
  termRefusalCodes,
} from '../domain/terms.ts'

const personId = z.string()
const termId = z.string().check(z.uuid())
const areaId = z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))
const termRef = z.string().check(z.regex(termRefPattern))

const termNameSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(TERM_NAME_MAX),
    z.regex(termNamePattern, "A word can't hold a comma or a line break."),
  )

/** What a synonym means: a metric, a dimension or a term with its own meaning. */
export const termTargetSchema = z.object({
  /** `metric:gross_sales`, `dim:market` or `term:<id>`. */
  ref: z.string(),
  name: z.string(),
  type: z.enum(['metric', 'dimension', 'term']),
})

export const termSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Its meaning, in markdown; null for a synonym, whose meaning is what it names. */
  meaning: z.nullable(z.string()),
  /** What a synonym means; null for a term with its own meaning. */
  sameAs: z.nullable(termTargetSchema),
  /** Its domain; a synonym's is what it means. Null: an admin's. */
  areaId: z.nullable(z.string()),
  createdBy: personId,
  createdAt: z.string(),
  updatedBy: personId,
  updatedAt: z.string(),
  /** Its number of writes; a change names the one it read. */
  revision: z.number(),
  /**
   * How many live context items are about it: the items whose text uses the word or one of its
   * synonyms. Null for a synonym, whose context is its meaning's.
   */
  items: z.nullable(z.number()),
  /**
   * Why it misleads agents now, when it does: a sync gave its word to a metric or a dimension
   * (`source`), or what it means is no longer in the definitions (`missing`).
   */
  conflict: z.nullable(
    z.object({
      code: z.enum(termConflictCodes),
      holder: z.nullable(z.string()),
      message: z.string(),
    }),
  ),
  /** Whether the person may change it: an owner of its domain or an admin. */
  canChange: z.boolean(),
})

export const termListSchema = z.object({ terms: z.array(termSchema) })

/** A word to write: its own meaning, or what it is another name for. */
const termFields = {
  name: termNameSchema,
  /** Its own meaning, in markdown. */
  meaning: z.optional(z.string().check(z.trim(), z.minLength(1), z.maxLength(TERM_MEANING_MAX))),
  /** What it is another name for, instead of a meaning. A synonym of a synonym means what that one means. */
  sameAs: z.optional(termRef),
  /** The domain of a term with its own meaning; a synonym takes its meaning's. */
  areaId: z.optional(z.nullable(areaId)),
}

export const termCreateInputSchema = z.strictObject(termFields)

export const termUpdateInputSchema = z.strictObject({
  id: termId,
  /** The revision the person read: a term changed since is not overwritten. */
  revision: z.number().check(z.int(), z.minimum(1)),
  ...termFields,
})

/** A word that already means something: what it means and who gave it that meaning. */
export const termRefusalSchema = z.object({
  code: z.enum(termRefusalCodes),
  holder: z.string(),
  by: z.nullable(z.string()),
})

export const termIdsInputSchema = z.strictObject({
  ids: z.array(termId).check(z.minLength(1), z.maxLength(TERM_BULK_MAX)),
})

export const termMoveInputSchema = z.strictObject({
  ids: z.array(termId).check(z.minLength(1), z.maxLength(TERM_BULK_MAX)),
  areaId,
})

const termSkipSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** One sentence: why it was left as it was. */
  message: z.string(),
})

/**
 * What a change to many terms did: the terms it changed (a deleted term's synonyms with it), the
 * ones left as they were and why, and the Undo that takes back exactly what it did, within
 * limits.undo_seconds. Null when it changed nothing.
 */
export const termChangeResultSchema = z.object({
  done: z.array(z.object({ id: z.string(), name: z.string() })),
  skipped: z.array(termSkipSchema),
  undo: z.nullable(z.string()),
})

export const termRestoreResultSchema = z.object({
  restored: z.array(z.object({ id: z.string(), name: z.string() })),
  skipped: z.array(termSkipSchema),
})

/** A term someone deleted: Settings, Advanced, Deleted. */
export const deletedTermSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** What a deleted synonym meant, by name. */
  sameAs: z.nullable(z.string()),
  areaId: z.nullable(z.string()),
  personId: z.string(),
  at: z.string(),
  /** The synonyms that went with it, by name: restoring it brings them back. */
  synonyms: z.array(z.string()),
})

export const termVersionSchema = z.object({
  revision: z.number(),
  change: z.enum(['created', 'edited', 'moved', 'deleted', 'restored']),
  name: z.string(),
  meaning: z.nullable(z.string()),
  /** What it meant then, by name, for a synonym. */
  sameAs: z.nullable(z.string()),
  areaId: z.nullable(z.string()),
  personId: z.string(),
  at: z.string(),
})

/**
 * Coverage (Definitions, coverage first): what agents can be asked about that has nothing written
 * down. Every metric and every term with its own meaning counts; a dimension is about every item,
 * and a synonym's context is its meaning's.
 */
export const definitionCoverageSchema = z.object({
  /** Metrics and terms with their own meaning. */
  measurable: z.number(),
  /** Those of them no live context item is about: agents asking about them get Not found. */
  uncovered: z.number(),
  /** Each of them, those with no context first, then by name. */
  rows: z.array(
    z.object({
      /** `metric:orders` or `term:<id>`. */
      ref: z.string(),
      name: z.string(),
      type: z.enum(['metric', 'term']),
      areaId: z.nullable(z.string()),
      /** Live context items about it. */
      items: z.number(),
    }),
  ),
})

export type Term = z.infer<typeof termSchema>
export type TermList = z.infer<typeof termListSchema>
export type TermCreateInput = z.infer<typeof termCreateInputSchema>
export type TermUpdateInput = z.infer<typeof termUpdateInputSchema>
export type TermRefusalData = z.infer<typeof termRefusalSchema>
export type TermChangeResult = z.infer<typeof termChangeResultSchema>
export type TermRestoreResult = z.infer<typeof termRestoreResultSchema>
export type DeletedTerm = z.infer<typeof deletedTermSchema>
export type TermVersion = z.infer<typeof termVersionSchema>
export type DefinitionCoverage = z.infer<typeof definitionCoverageSchema>
