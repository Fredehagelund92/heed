import { namedItems, withoutItems, type NamesItems } from '../../../domain/mentions.ts'
import type { Queryable } from '../../db/database.ts'

/**
 * The audience rule for what names other items (FR-128, NFR-029). A document, a draft or a version
 * the reader may read can still name an item the rule hides from them: a mention in its markup,
 * or its replaces and conflicts lists. Every read path that returns one passes it through here, so
 * the hidden item's id and link never reach the reader; the mention reads as its words only.
 * The database decides which items are hidden (`cl_item_open`, 0083).
 */

/** Of these item ids, the ones the reader may not receive. */
export async function hiddenItems(tx: Queryable, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await tx.query<{ id: string }>(
    'select id from unnest($1::text[]) as id where not cl_item_open(id)',
    [[...new Set(ids)]],
  )
  return new Set(rows.map((row) => row.id))
}

/** Each value as the reader may see it, with one query for all of them. */
export async function forReader<T extends NamesItems>(
  tx: Queryable,
  values: readonly T[],
): Promise<T[]> {
  const hidden = await hiddenItems(tx, values.flatMap(namedItems))
  return values.map((value) => withoutItems(value, hidden))
}
