/**
 * The search behind the "Applies to" picker (FR-107): a page of metrics, dimensions and values.
 * See `src/domain/scope-search.ts`.
 */
import * as z from 'zod/mini'

const dimensionKey = z.string().check(z.regex(/^dim:[a-z0-9_]+$/))

export const scopeHitSchema = z.object({
  /** The key the draft stores: `metric:orders`, `dim:market` or `val:market/norway`. */
  key: z.string(),
  kind: z.enum(['metric', 'dimension', 'dimension_value']),
  name: z.string(),
  /** The dimension of a value. */
  dimension: z.nullable(z.object({ key: z.string(), name: z.string() })),
  /** The other name the words matched, when not the name itself. */
  alias: z.nullable(z.string()),
  /** In the person's own recent drafts. */
  recent: z.boolean(),
  /** Live items whose scope names it. */
  uses: z.number().check(z.int(), z.minimum(0)),
})

export const scopeSearchInputSchema = z.object({
  /** The words typed. Empty finds only the person's recent terms, except inside one dimension. */
  q: z._default(z.string().check(z.maxLength(200)), ''),
  /** Only the values of this dimension, a page at a time. */
  dimension: z.optional(dimensionKey),
  /** Where the page starts, from the last page's `nextCursor`. */
  cursor: z.optional(z.string().check(z.regex(/^\d{1,6}$/))),
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(50))),
})

export const scopeSearchSchema = z.object({
  /** With no words and no dimension: the person's recent terms, newest first. */
  recent: z.array(scopeHitSchema),
  metrics: z.array(scopeHitSchema),
  /** Per dimension: the dimension itself ("any value"), how many values match and the first few. */
  groups: z.array(
    z.object({
      dimension: scopeHitSchema,
      /** The words named the dimension itself (or there were none), so `count` is all its values. */
      named: z.boolean(),
      count: z.number().check(z.int(), z.minimum(0)),
      values: z.array(scopeHitSchema),
    }),
  ),
  nextCursor: z.nullable(z.string()),
})

export type ScopeSearchInput = z.input<typeof scopeSearchInputSchema>
export type ScopeSearchResult = z.infer<typeof scopeSearchSchema>
export type ScopeHit = z.infer<typeof scopeHitSchema>
