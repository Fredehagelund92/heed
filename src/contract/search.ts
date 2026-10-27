import * as z from 'zod/mini'
import { itemKinds, itemStatuses } from '../domain/item.ts'

/** The most rows one group of `search.all` returns: enough for the command palette. */
export const SEARCH_GROUP_MAX = 5

/** Search everywhere (the command palette): the words, as typed. */
export const searchAllInputSchema = z.object({
  q: z.string().check(z.minLength(1), z.maxLength(200)),
})

/**
 * What the words find, grouped, each group best match first and at most SEARCH_GROUP_MAX long.
 * A name that starts with the words comes before one that only has them.
 */
export const searchResultsSchema = z.object({
  /** Items the person may read whose title, summary or text has the words. */
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(itemKinds),
      areaId: z.string(),
      status: z.enum(itemStatuses),
      title: z.string(),
      summary: z.string(),
    }),
  ),
  /** Metrics and dimensions of the live vocabulary whose name or another name has the words. */
  definitions: z.array(
    z.object({
      /** The vocabulary key: `metric:orders`, `dim:market`. */
      key: z.string(),
      kind: z.enum(['metric', 'dimension']),
      name: z.string(),
      aliases: z.array(z.string()),
    }),
  ),
  /** Domains whose name has the words. */
  domains: z.array(z.object({ id: z.string(), name: z.string() })),
  /** People still here whose name has the words. */
  people: z.array(z.object({ id: z.string(), name: z.string() })),
})

export type SearchAllInput = z.infer<typeof searchAllInputSchema>
export type SearchResults = z.infer<typeof searchResultsSchema>
