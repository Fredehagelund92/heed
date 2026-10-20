import * as z from 'zod/mini'
import {
  catalogueStatuses,
  catalogueTermKinds,
  definitionStates,
  termDomainSources,
} from '../domain/catalogue.ts'
import { catalogueTermIdPattern } from '../domain/catalogue-term-id.ts'
import type { ItemKind } from '../domain/item.ts'
import { calendarDateSchema } from '../domain/validity.ts'

/**
 * The catalogue (FR-136): every metric and dimension of the live vocabulary, with a labelled
 * copy of what the definition source last read and what the library holds about it. Heed keeps
 * no calculation (CON-207): a page links to the source for the formula.
 */

/** What the definition source last read about a term's definition. Never a calculation. */
export const catalogueDefinitionSchema = z.object({
  /** The stable id in the source tool, for example `cube:payments.orders`. */
  ref: z.string(),
  /** The member's name in the source, for example `payments.orders`. */
  name: z.string(),
  title: z.nullable(z.string()),
  /**
   * The source's short description, a copy of at most 500 characters refreshed at every read
   * (CON-207). Show it labelled as a copy; null when the source has none.
   */
  descriptionCopy: z.nullable(z.string()),
  valueType: z.nullable(z.string()),
  state: z.enum(definitionStates),
  /** The new id of a definition that is gone, when the source names it (CON-512). */
  renamedTo: z.nullable(z.string()),
  /** When the source last changed it after Heed first read it; null when it never did. */
  changedAt: z.nullable(z.string()),
  /** The newest read that listed it (ISO 8601): the age of the copy. */
  readAt: z.nullable(z.string()),
  /** The connector that reads it, one of `sources`. */
  sourceId: z.string(),
  /** The tool that connector reads, as people say it ("Cube"), for the words on screen. */
  tool: z.string(),
})

const kindCounts = z.object({
  note: z.number(),
  event: z.number(),
  guide: z.number(),
  example: z.number(),
  issue: z.number(),
} satisfies Record<ItemKind, unknown>)

/** What the library holds about a term: the same items and statuses the library shows. */
export const catalogueShelfSchema = z.object({
  /** Accepted items whose scope names the term. */
  items: z.number(),
  byKind: kindCounts,
  /** Re-check due, source changed or source missing. */
  needsALook: z.number(),
  /** Issues about the term that still apply. */
  activeIssues: z.number(),
  /** Accepted items whose last day has passed. */
  ended: z.number(),
  /** Open gaps whose topic names the term. */
  gaps: z.number(),
  /** Items whose text mentions the term: the total `items.list` with `mentions` returns. */
  mentionedBy: z.number(),
  /** The newest change to an accepted item about the term, or null. */
  lastUpdated: z.nullable(z.string()),
})

export const catalogueTermSchema = z.object({
  /** The vocabulary key: `metric:orders`, `dim:market`. */
  key: z.string(),
  kind: z.enum(catalogueTermKinds),
  /** The key without its prefix, as `vocabulary.get` names it. */
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  /** The metric group; null for a dimension and a metric outside a group. */
  group: z.nullable(z.object({ key: z.string(), name: z.string() })),
  /** The vocabulary's area first, the source's hint second, no domain third. */
  domain: z.object({ areaId: z.nullable(z.string()), source: z.enum(termDomainSources) }),
  /**
   * The definition that speaks for the term (`speakingDefinition`): of a dimension in several
   * views, the first one gone, else the first one changed, else the first. Null when the term
   * names no definition, or the source has never listed one.
   */
  definition: z.nullable(catalogueDefinitionSchema),
  /** Every definition the term names that the source has listed, by ref (CON-208). */
  definitions: z.array(catalogueDefinitionSchema),
  status: z.enum(catalogueStatuses),
  shelf: catalogueShelfSchema,
})

/** A definition source and its newest read. While it fails, the copies are the last known ones. */
export const catalogueSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The tool the source reads, as people say it ("Cube"), for the words on screen. */
  tool: z.string(),
  /** The newest read that succeeded (ISO 8601), or null before the first. */
  readAt: z.nullable(z.string()),
  /** The model version that read saw, for example a Git tag. */
  sourceVersion: z.nullable(z.string()),
  /** The newest attempt failed (CON-213). */
  failing: z.boolean(),
})

export const catalogueSchema = z.object({
  /** Metrics first, then dimensions, each by name. */
  terms: z.array(catalogueTermSchema),
  sources: z.array(catalogueSourceSchema),
  /** Metrics with no domain, against all metrics (CON-516). */
  coverage: z.object({ metrics: z.number(), withoutDomain: z.number() }),
  today: calendarDateSchema,
})

export const catalogueValueSchema = z.object({
  /** `val:market/norway`. */
  key: z.string(),
  id: z.string(),
  name: z.string(),
  /** Other names for the value (FR-107). */
  aliases: z.array(z.string()),
  /** Accepted items whose scope names the value. */
  items: z.number(),
  /** Items whose text mentions the value. */
  mentionedBy: z.number(),
})

export const catalogueTermDetailSchema = z.extend(catalogueTermSchema, {
  /** The values of a dimension, by name; owners keep them in the vocabulary (CON-514). Empty for a metric. */
  values: z.array(catalogueValueSchema),
  /** The source that reads the definition, and its newest read. */
  source: z.nullable(catalogueSourceSchema),
  /**
   * The model file that defines the definition, when the source names one: its path in the model
   * folder, and its address in the Git host's web view, built from the `sources.cube_model_url`
   * setting (null while that is off). The service never calls Git. Null with no definition or file.
   */
  modelFile: z.nullable(z.object({ path: z.string(), url: z.nullable(z.string()) })),
  today: calendarDateSchema,
})

export const catalogueTermInputSchema = z.strictObject({
  kind: z.enum(catalogueTermKinds),
  id: z.string().check(z.regex(catalogueTermIdPattern)),
})

export type Catalogue = z.infer<typeof catalogueSchema>
export type CatalogueTerm = z.infer<typeof catalogueTermSchema>
export type CatalogueTermDetail = z.infer<typeof catalogueTermDetailSchema>
export type CatalogueDefinition = z.infer<typeof catalogueDefinitionSchema>
export type CatalogueSource = z.infer<typeof catalogueSourceSchema>
export type CatalogueValue = z.infer<typeof catalogueValueSchema>
