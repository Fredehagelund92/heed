import { conflictPairs, settleRights, type SettledItem } from '@domain/conflicts'
import {
  SAID_NOW,
  type Conflict,
  type ConflictDecision,
  type ConflictRow,
  type ConflictSide,
} from '@/model/conflicts'
import { servedToAgents, type Fact } from '@/model/items'
import { ownersOf, type Domains, type Person } from '@/model/people'

// The demo's conflicts (FR-220), as the service reads them: the pairs an owner linked as
// disagreeing, the item that holds the link first, both live. The topic is built from what both
// apply to; what agents would say with one side is that item's own words, as Try it gives them.

/** When a pair started and how often agents met it this week. Counts only, as everywhere. */
const ASKED: Record<string, { since: string; asked: number }> = {
  itm_gift_card_only: { since: '24 Sep', asked: 31 },
  itm_gift_store_credit: { since: '24 Sep', asked: 31 },
  itm_spain_vat_in: { since: '12 Oct', asked: 18 },
  itm_france_switch_12: { since: '23 Oct', asked: 4 },
}

/** A stamp of what an item says now, so keeping both lasts only until either item changes. */
export const stampOf = (f: Fact) =>
  JSON.stringify([f.title, f.summary, f.where, f.valid, f.status, f.disagreesWith])

export type KeptPair = { decision: ConflictDecision; stamps: Record<string, string> }

/** The live pairs among the demo's items, holder first. */
export function pairsOf(facts: readonly Fact[]): [Fact, Fact][] {
  const live = facts.filter(servedToAgents)
  const byId = new Map(live.map((f) => [f.id, f]))
  return conflictPairs(
    live.map((f) => ({ id: f.id, conflicts: f.disagreesWith ? [f.disagreesWith] : [] })),
  ).map((p) => [byId.get(p.holderId)!, byId.get(p.otherId)!])
}

/** "Orders in Norway": the first thing both apply to, in the rest. */
export function topicOf(a: Fact, b: Fact) {
  const shared = a.where.filter((w) => b.where.includes(w))
  const [first, ...rest] = shared.length ? shared : a.where
  return rest.length ? `${first} in ${rest.join(', ')}` : (first ?? a.title)
}

/** Whether a pair kept as both is still as it was decided. */
export const stillKept = (kept: KeptPair | undefined, holder: Fact, other: Fact) =>
  !!kept && kept.stamps[holder.id] === stampOf(holder) && kept.stamps[other.id] === stampOf(other)

const asSettled = (f: Fact, domains: Domains): SettledItem => ({
  id: f.id,
  areaId: f.domain,
  owners: ownersOf(f, domains),
})

/** Who may do what, each checked against the item it changes. */
export function rightsOf(me: Person, holder: Fact, other: Fact, domains: Domains) {
  return settleRights(
    { id: me.name, admin: me.admin, owns: me.owns },
    asSettled(holder, domains),
    asSettled(other, domains),
    other.disagreesWith === holder.id,
  )
}

function sideOf(f: Fact, domains: Domains): ConflictSide {
  return {
    id: f.id,
    readable: true,
    title: f.title,
    summary: f.summary,
    kind: f.kind,
    domain: f.domain,
    domainName: domains[f.domain]?.name ?? f.domain,
    owners: ownersOf(f, domains),
    version: 1,
    checkedOn: f.checkedOn || null,
    checkedBy: f.checkedBy || null,
    source: f.source ? { url: f.source, quote: f.quote } : null,
  }
}

export function conflictOf(
  holder: Fact,
  other: Fact,
  me: Person,
  domains: Domains,
  kept: KeptPair | undefined,
): Conflict {
  const asked = ASKED[holder.id] ?? { since: null, asked: 0 }
  return {
    key: `${holder.id}.${other.id}`,
    holder: sideOf(holder, domains),
    other: sideOf(other, domains),
    topic: topicOf(holder, other),
    where: holder.where.filter((w) => other.where.includes(w)),
    asked: asked.asked,
    since: asked.since,
    said: {
      now: SAID_NOW,
      onlyHolder: { state: 'grounded', text: holder.summary },
      onlyOther: { state: 'grounded', text: other.summary },
      withoutFlag: { state: 'grounded', text: `${holder.summary} ${other.summary}` },
    },
    rights: rightsOf(me, holder, other, domains),
    keptBoth: stillKept(kept, holder, other) ? kept!.decision : null,
  }
}

export function rowOf(holder: Fact, other: Fact, me: Person, domains: Domains): ConflictRow {
  const asked = ASKED[holder.id] ?? { since: null, asked: 0 }
  return {
    key: `${holder.id}.${other.id}`,
    holder: { id: holder.id, title: holder.title, domain: holder.domain },
    other: { id: other.id, title: other.title, domain: other.domain },
    topic: topicOf(holder, other),
    asked: asked.asked,
    since: asked.since,
    canSettle: Object.values(rightsOf(me, holder, other, domains)).some(Boolean),
    mine: me.owns.includes(holder.domain) || me.owns.includes(other.domain),
  }
}
