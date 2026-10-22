import type { Draft } from './draft.ts'
import { type MentionPart, parseMentions, serializeMentions } from './mentions.ts'
import { shiftDate } from './validity.ts'

/*
  Restoring an item of a deleted domain into another one (FR-814). The item leaves the Bin
  retired, and a proposal opens in the chosen domain with the item's last content, for that
  domain's owners to review: review stays the only way content reaches agents. What the
  content named that the chosen domain cannot keep is changed here, and every change is said,
  never kept silently:

  - the domain is the chosen one;
  - the owner stays when they are an owner of the chosen domain, otherwise its first owner
    takes over;
  - scope terms no longer in the live vocabulary leave the scope, and definitions no longer in
    the source leave the references;
  - mentions of what is no longer available (a retired item, a deleted domain, a term that went)
    become their words as plain text;
  - conflicts with items no longer accepted go;
  - a review date that has passed becomes the default a new draft has.

  Who gets it stays everyone: audience groups are parked, so no version in the Bin has them. The
  service and the mock both decide with this function.
*/

/** The fields a rescue may change, in the order the Restore dialog lists them. */
export const rescueFields = [
  'domain',
  'owner',
  'scope',
  'references',
  'mentions',
  'conflicts',
  'reviewDate',
] as const
export type RescueField = (typeof rescueFields)[number]

/**
 * One change a rescue makes. `before` is what the item had, in words (a day as YYYY-MM-DD);
 * `after` is what the proposal carries instead, or null when the value leaves it. A mention that
 * becomes plain text keeps its words, so its `after` is null too.
 */
export type RescueChange = { field: RescueField; before: string | null; after: string | null }

/** What a rescue checks the item's content against, read on the live edition. */
export type RescueWorld = {
  /** The server's day. */
  today: string
  /** The deleted domain the item belongs to, by name. */
  from: { name: string }
  /** The chosen domain, with its active owners in the order the service picks the first. */
  to: { id: string; name: string; owners: readonly string[] }
  /** The live vocabulary's term keys. */
  terms: ReadonlySet<string>
  /** The definitions the sources hold. */
  definitions: ReadonlySet<string>
  /** The accepted items agents may get, by id. */
  items: ReadonlySet<string>
  /** The domains that exist. */
  areas: ReadonlySet<string>
  /** Words for a person (by id), a term (by key) and an item (by id); the key when none. */
  personName: (id: string) => string
  termName: (key: string) => string
  itemTitle: (id: string) => string
}

/** The review period a new draft gets, in days (proposals service, `defaults`). */
const REVIEW_DAYS = 90

export type Rescue = {
  draft: Draft
  changes: RescueChange[]
  /** Why it cannot go to the chosen domain; null when it can. */
  problem: string | null
}

/** The item's last content, `draft`, made fit for the chosen domain, and what that changed. */
export function rescueDraft(draft: Draft, itemId: string, world: RescueWorld): Rescue {
  const changes: RescueChange[] = [
    { field: 'domain', before: world.from.name, after: world.to.name },
  ]
  const leaves = (field: RescueField, before: string) =>
    changes.push({ field, before, after: null })

  const kept = draft.ownerId && world.to.owners.includes(draft.ownerId)
  const owner = kept ? draft.ownerId : world.to.owners[0]
  if (!kept)
    changes.push({
      field: 'owner',
      before: draft.ownerId ? world.personName(draft.ownerId) : null,
      after: owner ? world.personName(owner) : null,
    })

  const scope = draft.scope ?? { metrics: [], dimensions: [], dimensionValues: [] }
  const live = (key: string) => {
    if (world.terms.has(key)) return true
    leaves('scope', world.termName(key))
    return false
  }
  const nextScope = {
    metrics: scope.metrics.filter(live),
    dimensions: scope.dimensions.filter(live),
    // A value goes with its dimension too, and is named once.
    dimensionValues: scope.dimensionValues.filter((row) => {
      if (world.terms.has(row.dimension) && world.terms.has(row.value)) return true
      leaves('scope', world.termName(row.value))
      return false
    }),
  }

  const references = (draft.references ?? []).filter((ref) => {
    if (world.definitions.has(ref)) return true
    leaves('references', ref)
    return false
  })
  const changeMarks = Object.fromEntries(
    Object.entries(draft.changeMarks ?? {}).filter(([ref]) => references.includes(ref)),
  )

  const available = (target: string) =>
    target.startsWith('item:')
      ? target !== `item:${itemId}` && world.items.has(target.slice(5))
      : target.startsWith('area:')
        ? world.areas.has(target.slice(5))
        : world.terms.has(target)
  const plain = (markup: string | undefined) => {
    if (markup === undefined) return undefined
    const parts = parseMentions(markup).parts.map((part): MentionPart => {
      if (part.kind === 'text' || available(part.target)) return part
      leaves('mentions', part.label)
      return { kind: 'text', text: part.label }
    })
    return serializeMentions(parts)
  }
  const summaryMarkup = plain(draft.summaryMarkup)
  const bodyMarkup = plain(draft.bodyMarkup)

  const conflicts = (draft.conflicts ?? []).filter((id) => {
    if (id !== itemId && world.items.has(id)) return true
    leaves('conflicts', world.itemTitle(id))
    return false
  })

  let reviewDate = draft.reviewDate ?? null
  if (reviewDate !== null && reviewDate < world.today) {
    const after = shiftDate(world.today, REVIEW_DAYS)
    changes.push({ field: 'reviewDate', before: reviewDate, after })
    reviewDate = after
  }

  const order = new Map(rescueFields.map((field, index) => [field, index]))
  changes.sort((a, b) => order.get(a.field)! - order.get(b.field)!)
  const scoped =
    nextScope.metrics.length + nextScope.dimensions.length + nextScope.dimensionValues.length > 0
  return {
    draft: {
      ...draft,
      areaId: world.to.id,
      ...(owner ? { ownerId: owner } : {}),
      scope: nextScope,
      references,
      changeMarks,
      ...(summaryMarkup === undefined ? {} : { summaryMarkup }),
      ...(bodyMarkup === undefined ? {} : { bodyMarkup }),
      conflicts,
      // What it replaced was retired when it was first accepted; a change replaces nothing.
      replaces: [],
      reviewDate,
    },
    changes,
    problem: !owner
      ? `${world.to.name} has no owner to review it. Give it an owner in Administration, Domains, first.`
      : !scoped
        ? 'None of the metrics or markets it applies to exist any more, so agents could never get it.'
        : null,
  }
}
