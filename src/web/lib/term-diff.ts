import type { Review } from '@/api'

/** A term as a review shows it, before or after. */
export type VocabularyTerm = NonNullable<Review['vocabulary']>['after']

/*
  What changed in a proposed term (FR-125), as rows a reviewer reads at a glance: a change shows
  only the fields that changed, before and after; a new term shows the fields it sets, never an
  empty one. The model link is shown as the member's name in the model, never as the stored
  reference with its source prefix.
*/

export type TermRowId = 'kind' | 'name' | 'aliases' | 'parent' | 'domain' | 'model'

export const termRowNames: Record<TermRowId, string> = {
  kind: 'Type',
  name: 'Name',
  aliases: 'Other names',
  parent: 'Value of',
  domain: 'Domain',
  model: 'Linked to',
}

/** The rows in the order the Propose terms form asks for them. */
const rowOrder: readonly TermRowId[] = ['kind', 'name', 'aliases', 'parent', 'domain', 'model']

/**
 * The member a definition reference links, without its source prefix: `revenue.net_revenue`. When
 * the two sides of a change name the same member in different sources, the prefix stays, so the
 * difference shows: `cube:revenue.net_revenue` against `dbt:revenue.net_revenue`.
 */
export function modelMember(ref: string | null, other: string | null = null): string | null {
  if (!ref) return null
  const at = ref.indexOf(':')
  if (at === -1) return ref
  const member = ref.slice(at + 1)
  const otherAt = other?.indexOf(':') ?? -1
  if (other && other !== ref && otherAt !== -1 && other.slice(otherAt + 1) === member) return ref
  return member
}

/**
 * The members a term's definition references link, as `modelMember` names each: one for a
 * metric, one per view for a dimension in several (CON-208).
 */
export function modelMembers(refs: readonly string[], others: readonly string[] = []): string[] {
  return refs.map((ref) =>
    modelMember(
      ref,
      others.find((other) => other !== ref && modelMember(other) === modelMember(ref)) ?? null,
    )!,
  )
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

function changed(id: TermRowId, before: VocabularyTerm, after: VocabularyTerm): boolean {
  switch (id) {
    case 'kind':
      return before.kind !== after.kind
    case 'name':
      return before.name !== after.name
    case 'aliases':
      return !sameList(before.aliases, after.aliases)
    case 'parent':
      return before.parentKey !== after.parentKey
    case 'domain':
      return before.areaId !== after.areaId
    case 'model':
      // The whole reference: a member read from another source is a change too.
      return !sameList([...before.definitionRefs].sort(), [...after.definitionRefs].sort())
  }
}

/** Whether a new term sets the field: an empty list, no parent or no model link is left out. */
function set(id: TermRowId, term: VocabularyTerm): boolean {
  switch (id) {
    case 'aliases':
      return term.aliases.length > 0
    case 'parent':
      return term.parentKey !== null
    case 'model':
      return term.definitionRefs.length > 0
    default:
      // A new term always has a type, a name and a domain (or none, which a reviewer must see).
      return true
  }
}

export type TermDiff = {
  /** The rows to show, in the form's order. */
  rows: TermRowId[]
  /** The names of the fields a change leaves alone, for the fold line. */
  unchanged: string[]
}

/** The rows of a term's diff: what changed against the live term, or what a new term sets. */
export function termDiff(before: VocabularyTerm | null, after: VocabularyTerm): TermDiff {
  if (!before) return { rows: rowOrder.filter((id) => set(id, after)), unchanged: [] }
  const rows = rowOrder.filter((id) => changed(id, before, after))
  const unchanged = rowOrder
    // The type and the parent of a live term are fixed; only a change to them is worth a word.
    .filter((id) => id !== 'kind' && id !== 'parent' && !rows.includes(id))
    .filter((id) => id !== 'aliases' || before.aliases.length > 0 || after.aliases.length > 0)
    .filter((id) => id !== 'model' || before.definitionRefs.length > 0)
    .map((id) => termRowNames[id].toLowerCase())
  return { rows, unchanged }
}
