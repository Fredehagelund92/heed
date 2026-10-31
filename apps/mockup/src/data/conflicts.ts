import { domains, ownersOf, servedToAgents, type Fact, type Person } from "./world"

// A conflict is declared by a person, never computed: an owner chose "These disagree" at the review,
// or set a disagrees-with link in the editor. The item that holds the link comes first. Nothing here
// compares meanings: the summary is built from the two items' structure (where they apply and when).

export type ConflictPair = {
  /** `holder.other`, the address of the pair. */
  key: string
  /** The item that holds the disagrees-with link. */
  holder: Fact
  other: Fact
  /** "Orders in Norway": the metric and the market both apply to, from their Applies to. */
  topic: string
  /** What both apply to, as stored. */
  where: string[]
}

/** When a pair started and how often agents met it this week. Counts only, as everywhere. */
const ASKED: Record<string, { since: string; asked: number }> = {
  itm_gift_store_credit: { since: "24 Sep", asked: 31 },
  itm_spain_vat_in: { since: "12 Oct", asked: 18 },
  itm_france_switch_12: { since: "23 Oct", asked: 4 },
}
export const askedOf = (p: ConflictPair) => ASKED[p.holder.id] ?? { since: "Today", asked: 0 }

export const pairKey = (a: string, b: string) => `${a}.${b}`

/** The topic: "Orders in Norway" when both apply to a metric and a market, else what they share. */
export function topicOf(a: Fact, b: Fact): { topic: string; where: string[] } {
  const where = a.where.filter((w) => b.where.includes(w))
  const [first, ...rest] = where.length ? where : a.where
  return { topic: rest.length ? `${first} in ${rest.join(", ")}` : (first ?? a.title), where }
}

/** Every pair agents get both sides of: both published and not archived. */
export function conflictPairs(facts: Fact[]): ConflictPair[] {
  const byId = new Map(facts.map((f) => [f.id, f]))
  const out: ConflictPair[] = []
  const seen = new Set<string>()
  for (const holder of facts) {
    const other = holder.disagreesWith ? byId.get(holder.disagreesWith) : undefined
    if (!other || !servedToAgents(holder) || !servedToAgents(other)) continue
    const id = [holder.id, other.id].sort().join("|")
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ key: pairKey(holder.id, other.id), holder, other, ...topicOf(holder, other) })
  }
  return out.sort((x, y) => askedOf(y).asked - askedOf(x).asked)
}

/** The pair at an address, in either order; the holder always comes first. */
export function pairAt(facts: Fact[], key: string | undefined): ConflictPair | undefined {
  if (!key) return undefined
  const [a, b] = key.split(".")
  return conflictPairs(facts).find((p) => (p.holder.id === a && p.other.id === b) || (p.holder.id === b && p.other.id === a))
}

/** Pairs an item is in, as the first or the second. */
export const pairsOf = (facts: Fact[], id: string) => conflictPairs(facts).filter((p) => p.holder.id === id || p.other.id === id)

/** The one-line summary, from structure: the Conflict state's sentence and the topic. */
export const titleOf = (p: ConflictPair) => `Two items say different things about ${p.topic}.`

export function sublineOf(p: ConflictPair) {
  const from = [p.holder.valid.from, p.other.valid.from].filter(Boolean).sort().at(-1)
  const when = from ? `, from ${new Date(from).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""
  return `Both apply to ${p.where.join(", ")}${when}. Agents get both and say that context disagrees. Nothing is archived until an owner chooses.`
}

/* ---------- what agents say ---------- */

export type Said = { state: "grounded" | "conflict"; text: string }

/** What agents say about the topic today: Conflict, both given. */
export const saidNow: Said = { state: "conflict", text: "Two items say different things. Both are given until an owner chooses." }
/** What agents would say if they got only this one: the deterministic answer, as Try it gives it. */
export const saidWithOnly = (f: Fact): Said => ({ state: "grounded", text: f.summary })
/** What agents would say with the flag removed: both, and nothing about a difference. */
export const saidWithoutFlag = (p: ConflictPair): Said => ({ state: "grounded", text: `${p.holder.summary} ${p.other.summary}` })

/* ---------- who may do what ---------- */

const owns = (me: Person, f: Fact) => me.admin || ownersOf(f).includes(me.name) || me.owns.includes(f.domain)

export type Rights = {
  /** Keep this one: archives the other, so it needs the other item's owner. */
  keep: (keep: Fact, other: Fact) => boolean
  edit: (f: Fact) => boolean
  both: boolean
  /** Not a conflict removes the link, so it needs the holder's owner. */
  notConflict: boolean
  /** Anything at all. */
  any: boolean
}

export function rightsOf(me: Person, p: ConflictPair): Rights {
  const both = owns(me, p.holder) || owns(me, p.other)
  return {
    keep: (_keep, other) => owns(me, other),
    edit: (f) => owns(me, f),
    both,
    notConflict: owns(me, p.holder),
    any: both,
  }
}

/** The owners of an item, in words: "Priya Nair", "Jon Abara and Sofia Brandt". */
export const ownerNames = (f: Fact) => {
  const o = ownersOf(f)
  return o.length > 1 ? `${o.slice(0, -1).join(", ")} and ${o.at(-1)}` : (o[0] ?? domains[f.domain].name)
}

/* ---------- decisions ---------- */

export type SettleHow = "keep" | "both" | "unrelated"

/** One decision, kept on both items' history with who, when, the reason and the line. */
export type Settled = {
  how: SettleHow
  /** The item kept, for keep. */
  kept?: string
  /** The item archived, for keep. */
  archived?: string
  reason: string
  quote?: string
  by: string
  at: string
  /** For keep both: the two items as they were. The pair is back on the lists once either changes. */
  seen?: Record<string, string>
}

/** A stamp of what an item says now, so keep both lasts only until either item changes. */
export const stampOf = (f: Fact) => JSON.stringify([f.title, f.summary, f.where, f.valid, f.status, f.disagreesWith])

/** Whether a kept-both pair is still as it was: then it is off the conflict lists. */
export const keptBoth = (p: ConflictPair, s: Settled | undefined) =>
  !!s && s.how === "both" && s.seen?.[p.holder.id] === stampOf(p.holder) && s.seen?.[p.other.id] === stampOf(p.other)

/* ---------- many conflicts (?state=many) ---------- */

/**
 * More pairs, to show a long list: grouped by topic, most asked first, the first six shown. Invented
 * like the rest of the demo, and only in this state.
 */
export const MANY: { topic: string; a: string; b: string; domains: string; asked: number; since: string; mine: boolean }[] = [
  { topic: "Units sold", a: "Units sold counts a bundle as one unit", b: "Units sold counts each item in a bundle", domains: "Sales", asked: 12, since: "9 Oct", mine: true },
  { topic: "Returns in Spain", a: "Store returns in Spain count on the day they are booked", b: "Store returns in Spain count on the day the parcel arrives", domains: "Sales", asked: 6, since: "20 Oct", mine: true },
  { topic: "Gross margin", a: "Gross margin includes freight", b: "Gross margin leaves out freight", domains: "Sales and Paid media", asked: 5, since: "2 Oct", mine: false },
  { topic: "Orders in Poland", a: "Orders in Poland count from payment", b: "Orders in Poland count from dispatch", domains: "Sales", asked: 4, since: "18 Oct", mine: true },
  { topic: "Active customers", a: "Active customers bought in the last 90 days", b: "Active customers bought in the last 12 months", domains: "Customer value", asked: 3, since: "14 Oct", mine: false },
  { topic: "Discount cost", a: "Discount cost includes free shipping", b: "Discount cost leaves out free shipping", domains: "Marketing", asked: 3, since: "11 Oct", mine: false },
  { topic: "Conversion rate", a: "Conversion rate counts app installs", b: "Conversion rate counts paid orders only", domains: "Marketing", asked: 2, since: "7 Oct", mine: false },
  { topic: "Orders in Sweden", a: "Orders in Sweden include bank transfers", b: "Orders in Sweden leave out bank transfers", domains: "Sales", asked: 2, since: "1 Oct", mine: true },
  { topic: "Churn", a: "Churn counts a customer after 180 days", b: "Churn counts a customer after 365 days", domains: "Customer value", asked: 1, since: "28 Sep", mine: false },
  { topic: "Online share", a: "Online share counts click and collect", b: "Online share leaves out click and collect", domains: "Sales", asked: 1, since: "26 Sep", mine: false },
  { topic: "Return on ad spend", a: "Return on ad spend uses 7-day attribution", b: "Return on ad spend uses 30-day attribution", domains: "Paid media", asked: 1, since: "22 Sep", mine: false },
]
