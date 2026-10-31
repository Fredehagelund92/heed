import type { AnchorField, CommentAnchor } from '@domain/comments'
import { fieldLabel, type FieldKey } from './review-fields'

// Where a thread hangs on a review's source: a field of the Fields table, or a line of the text on
// the side it was read on, against the two versions the review compares. Apart from the comments
// model, which the first page load reads, since only the review and a thread's own view use it.

/**
 * Where on a review's source a thread hangs, without the versions: a field of the Fields table,
 * or a line of the text on the side it was read on.
 */
export type SourcePlace = { field: FieldKey } | { side: 'before' | 'after'; line: number }

/** The two versions a review compares, as a thread on its source names them. */
export type ReviewVersions = { before: string | null; after: string | null }

// The Fields table's rows are the fields a comment may hang on, one for one.
const sameFields: [FieldKey, AnchorField] extends [AnchorField, FieldKey] ? true : never = true
void sameFields

/** A place as one key, the same for the same line or field: "field:title", "after:7". */
export const placeKey = (at: SourcePlace) =>
  'field' in at ? `field:${at.field}` : `${at.side}:${at.line}`

/** A place from its key; null for a key that is not one. */
export function placeFromKey(key: string): SourcePlace | null {
  const [kind, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  if (kind === 'field') return { field: rest as FieldKey }
  const line = Number(rest)
  if ((kind === 'before' || kind === 'after') && Number.isInteger(line) && line > 0)
    return { side: kind, line }
  return null
}

/** The place of an anchor. */
export const placeOf = (anchor: CommentAnchor): SourcePlace =>
  'field' in anchor ? { field: anchor.field } : { side: anchor.side, line: anchor.line }

/** Whether a thread was written against these two versions: otherwise, against an earlier one. */
export const onVersions = (anchor: CommentAnchor, versions: ReviewVersions) =>
  anchor.before === versions.before && anchor.after === versions.after

/** A place as the review names it: "Line 7", "Removed line 3", "Title". */
export const placeLabel = (at: SourcePlace) =>
  'field' in at
    ? fieldLabel[at.field]
    : at.side === 'before'
      ? `Removed line ${at.line}`
      : `Line ${at.line}`
