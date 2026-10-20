/*
  Deleting a domain (the specification's area; FR-814), in one step. The administrator reads what
  goes with it and types `permanently delete`; Heed then handles everything under the domain in
  one transaction, and nothing has to be moved first:

  - its accepted items move to the Bin, with the reason "Domain deleted", in one new edition, so
    agents stop getting them at once and each can be restored from the Bin;
  - its vocabulary terms are retired in the same edition, except a term another domain still uses
    (an accepted item of another domain names it, or a live term of another domain sits under it),
    which stays in service without a domain, so no other domain's context breaks;
  - a term whose domain only the definition source gives loses it in that edition;
  - its open proposals are withdrawn with the reason "Domain deleted";
  - its drafts stay with their authors, marked "Domain deleted", to send to another domain or
    discard;
  - its team's roles end;
  - its history stays as history, and keeps its name.

  A domain that nothing names afterwards (it held nothing) is deleted for good. One that history
  names is kept as an archived row, which people read as deleted: it leaves every list and picker,
  and an administrator can restore it at any time, with its team's roles and its terms. The
  demo domain always exists (FR-811). The service and the mock both decide with these functions.
*/

/** What a domain holds, as deleting it counts it. */
export type AreaHoldings = {
  /** Accepted items of the live edition in the domain: they move to the Bin. */
  items: number
  /** Vocabulary terms the live edition puts in the domain: retired, or kept without a domain. */
  terms: number
  /** Proposals waiting for a decision or for changes: withdrawn. */
  openProposals: number
  /** Members a definition source puts in the domain now: they get no domain. */
  sourceMembers: number
  /** Drafts that name the domain: they stay with their authors. */
  drafts: number
  /** People who hold a role in the domain now: their roles end. */
  team: number
  /** Whether anything else names the domain. */
  history: boolean
}

export type AreaRemovalOutcome = 'delete' | 'archive' | 'blocked'

/** What the administrator types to confirm, as AWS asks: the same words for every domain. */
export const DELETE_DOMAIN_PHRASE = 'permanently delete'

/** The reason the Bin, a withdrawn proposal and the history log give for what deleting did. */
export const DOMAIN_DELETED_REASON = 'Domain deleted'

/**
 * What deleting does with the domain's own row: `delete` when nothing names it (it held nothing,
 * so nothing moved), `archive` when anything does, so its history keeps its name. Only the demo
 * domain is refused.
 */
export function areaRemovalOutcome(holdings: AreaHoldings, demo: boolean): AreaRemovalOutcome {
  if (demo) return 'blocked'
  const moves =
    holdings.items +
    holdings.terms +
    holdings.openProposals +
    holdings.drafts +
    holdings.sourceMembers
  return holdings.history || moves > 0 ? 'archive' : 'delete'
}

/** Whether the typed words confirm the deletion: exactly the phrase, ignoring space at the ends. */
export function confirmsDeletion(typed: string): boolean {
  return typed.trim() === DELETE_DOMAIN_PHRASE
}

/** A live vocabulary term of the domain being deleted, as the plan reads it. */
export type DomainTerm = {
  key: string
  /** The term it sits under (a metric's group, a value's dimension), or null. */
  parentKey: string | null
  /** An accepted item of another domain names it in its scope. */
  usedElsewhere: boolean
}

/** What deleting does with a term: `retired`, or `kept` in service without a domain. */
export type TermFate = 'retired' | 'kept'

/**
 * Each term's fate. A term stays (without a domain) when another domain still uses it: an
 * accepted item of another domain names it, or a live term outside the domain sits under it
 * (`parentsOfOthers`). A term a kept term sits under stays too, so no live term is left under a
 * retired one. Every other term is retired.
 */
export function termFates(
  terms: readonly DomainTerm[],
  parentsOfOthers: ReadonlySet<string>,
): Map<string, TermFate> {
  const byKey = new Map(terms.map((term) => [term.key, term]))
  const kept = new Set(
    terms
      .filter((term) => term.usedElsewhere || parentsOfOthers.has(term.key))
      .map((term) => term.key),
  )
  // Up the parent chain: a group above a kept metric, a dimension above a kept value.
  for (const key of [...kept]) {
    let parent = byKey.get(key)?.parentKey ?? null
    while (parent !== null && byKey.has(parent) && !kept.has(parent)) {
      kept.add(parent)
      parent = byKey.get(parent)?.parentKey ?? null
    }
  }
  return new Map(terms.map((term) => [term.key, kept.has(term.key) ? 'kept' : 'retired']))
}
