/**
 * Conflicts between context items (FR-220): a pair an owner said disagree, the rules for who may
 * settle one and how, and whether a pair kept as both is still as it was. A conflict is declared by
 * a person, never computed: an item version names the items it disagrees with, and agents get both
 * with the Conflict state until an owner settles it. Nothing here reads what the items say.
 */

/** How a conflict is settled: one kept and the other archived, both kept, or the flag removed. */
export const settleOutcomes = ['kept_one', 'kept_both', 'not_conflict'] as const
export type SettleOutcome = (typeof settleOutcomes)[number]

/** The longest reason and quote a decision keeps. */
export const SETTLE_REASON_MAX = 500
export const SETTLE_QUOTE_MAX = 500

/** An item as the pairing reads it: its id and the items its live version says it disagrees with. */
export type Linked = { id: string; conflicts: readonly string[] }

/** A pair agents get both of: the item that holds the link first, then the other. */
export type ConflictPair = { holderId: string; otherId: string }

/** The key of a pair, the same whichever item holds the link. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}.${b}` : `${b}.${a}`)

/**
 * Every pair among live items, once each, holder first. When both items name each other, the one
 * with the smaller id holds it, so the pair is always read the same way.
 */
export function conflictPairs(items: readonly Linked[]): ConflictPair[] {
  const live = new Map(items.map((i) => [i.id, i]))
  const seen = new Set<string>()
  const pairs: ConflictPair[] = []
  for (const holder of [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
    for (const otherId of holder.conflicts) {
      if (otherId === holder.id || !live.has(otherId)) continue
      const key = pairKey(holder.id, otherId)
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push({ holderId: holder.id, otherId })
    }
  return pairs
}

/** The pair two items form, holder first, or null when neither names the other. */
export function pairOf(a: Linked, b: Linked): ConflictPair | null {
  if (a.id === b.id) return null
  const [first, second] = a.id < b.id ? [a, b] : [b, a]
  if (first.conflicts.includes(second.id)) return { holderId: first.id, otherId: second.id }
  if (second.conflicts.includes(first.id)) return { holderId: second.id, otherId: first.id }
  return null
}

/** A person as the rules read them: whether an admin, and the domains they own. */
export type Settler = { id: string; admin: boolean; owns: readonly string[] }
/** An item as the rules read it: its domain and its own owners, if it has any. */
export type SettledItem = { id: string; areaId: string; owners: readonly string[] }

/** May change this item: an admin, an owner of its domain, or one of its own owners. */
export const mayChange = (person: Settler, item: SettledItem) =>
  person.admin || person.owns.includes(item.areaId) || item.owners.includes(person.id)

/**
 * Who may do what with a pair (the conflict view's table). Each action is checked against the item
 * it changes: keeping one archives the other, so it needs the other's owner; editing needs that
 * item's owner; keeping both needs an owner of either; removing the flag changes the item that holds
 * it, so it needs that item's owner (and the other's too when both items hold it). An admin may do
 * all of it. Asking the owner is open to anyone who may read the pair.
 */
export function settleRights(
  person: Settler,
  holder: SettledItem,
  other: SettledItem,
  otherHoldsToo = false,
) {
  const h = mayChange(person, holder)
  const o = mayChange(person, other)
  return {
    keepHolder: o,
    keepOther: h,
    editHolder: h,
    editOther: o,
    keepBoth: h || o,
    notConflict: h && (!otherHoldsToo || o),
  }
}
export type SettleRights = ReturnType<typeof settleRights>

/** Whether a person may settle a pair this way. */
export function maySettle(
  rights: SettleRights,
  outcome: SettleOutcome,
  keep: 'holder' | 'other' | null,
): boolean {
  if (outcome === 'kept_both') return rights.keepBoth
  if (outcome === 'not_conflict') return rights.notConflict
  return keep === 'holder' ? rights.keepHolder : keep === 'other' ? rights.keepOther : false
}

/**
 * Whether a pair kept as both is still as it was decided: both items at the versions the decision
 * saw. Then it stays off the conflict lists and the Conflict alert; a new version of either brings it back.
 */
export const stillKept = (
  decided: { holderVersion: number; otherVersion: number },
  now: { holderVersion: number; otherVersion: number },
) => decided.holderVersion === now.holderVersion && decided.otherVersion === now.otherVersion
