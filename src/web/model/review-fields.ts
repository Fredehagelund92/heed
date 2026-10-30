import type { FieldSide } from './review'
import { dateLabel, whenLabel } from './validity'

// The Fields table of a review: every field of a context item other than its text, compared as
// what it is (a date as a date, what it applies to as names added and removed, a source by its
// address and quote), each row changed or the same. Two sides in, so the same table compares a
// suggestion with the live item, or any two versions. Pure: the parts draw it.

export const fieldKeys = [
  'title',
  'kind',
  'domain',
  'owner',
  'scope',
  'validity',
  'reviewDate',
  'sources',
  'dontConclude',
] as const
export type FieldKey = (typeof fieldKeys)[number]

/** Each field by the name the editor gives it. */
export const fieldLabel: Record<FieldKey, string> = {
  title: 'Title',
  kind: 'Kind',
  domain: 'Domain',
  owner: 'Owner',
  scope: 'Applies to',
  validity: 'When',
  reviewDate: 'Check date',
  sources: 'Source',
  dontConclude: "Don't conclude",
}

type Source = FieldSide['sources'][number]

/**
 * One row: its value on each side (absent where that side is missing: a new item has no before,
 * an archive no after) and how it moved. `changed` is only ever true when both sides exist.
 */
export type FieldRow = { key: FieldKey; label: string; changed: boolean } & (
  | { type: 'words'; before?: string; after?: string }
  | { type: 'value'; before?: string; after?: string }
  | { type: 'names'; before?: string[]; after?: string[]; added: string[]; removed: string[] }
  | { type: 'sources'; before?: Source[]; after?: Source[] }
)

/** A value in the words the table shows: a missing date or source says it is not set. */
const NOT_SET = 'Not set'
const when = (s: FieldSide) => whenLabel(s.validity)
const checkDate = (s: FieldSide) => (s.reviewDate ? dateLabel(s.reviewDate) : NOT_SET)
const sameSources = (a: Source[], b: Source[]) =>
  a.length === b.length && a.every((s, i) => s.url === b[i]!.url && s.quote === b[i]!.quote)

export function fieldRows(before: FieldSide | null, after: FieldSide | null): FieldRow[] {
  const both = !!before && !!after
  const pick = <T>(f: (s: FieldSide) => T) => ({
    ...(before ? { before: f(before) } : {}),
    ...(after ? { after: f(after) } : {}),
  })
  const text = (key: FieldKey, type: 'words' | 'value', f: (s: FieldSide) => string): FieldRow => {
    const v = pick(f)
    return { key, label: fieldLabel[key], type, changed: both && v.before !== v.after, ...v }
  }
  const was = before?.scope ?? []
  const now = after?.scope ?? []
  const added = both ? now.filter((x) => !was.includes(x)) : []
  const removed = both ? was.filter((x) => !now.includes(x)) : []
  const sources = pick((s) => s.sources)
  return [
    text('title', 'words', (s) => s.title),
    text('kind', 'value', (s) => s.kind),
    text('domain', 'value', (s) => s.domain),
    text('owner', 'value', (s) => s.owner),
    {
      key: 'scope',
      label: fieldLabel.scope,
      type: 'names',
      // The same names in another order is the same scope.
      changed: added.length + removed.length > 0,
      added,
      removed,
      ...pick((s) => s.scope),
    },
    text('validity', 'value', when),
    text('reviewDate', 'value', checkDate),
    {
      key: 'sources',
      label: fieldLabel.sources,
      type: 'sources',
      changed: both && !sameSources(sources.before!, sources.after!),
      ...sources,
    },
    text('dontConclude', 'words', (s) => s.dontConclude),
  ]
}
