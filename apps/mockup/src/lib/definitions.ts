import * as React from "react"
import { dimensions, metrics, servedToAgents, type DomainId, type Fact } from "@/data/world"
import { DEFINITIONS_TOOL } from "@/data/integrations"

// Definitions: the data glossary. Metrics and dimensions are synced from the connector (Cube
// today) and are never changed here: their name, meaning, other names and domain are Cube's.
// Two plain concepts are written here. A term is a word with its own meaning ("Peak season"). A
// synonym is another name for an existing definition ("GMV" for Gross sales): stored as a term
// that points at it, so adding one from the definition's tag box or from the term editor's
// "Another name for" writes the same entry, once. Kept in memory until the page reloads.

export type DefinitionType = "metric" | "dimension" | "term"

export type Definition = {
  name: string
  type: DefinitionType
  /** Its meaning. Empty for a synonym, whose meaning is its target's. */
  definition: string
  /** A synonym: the definition it is another name for. */
  sameAs?: string
  /** Synced from Cube: read-only here. */
  synced: boolean
  /** Other names that came with the synced item from Cube; read-only. */
  sourceNames: string[]
  domain?: DomainId
  /** Cube's group, for metrics and dimensions. */
  group?: string
  /** A dimension's values, as Cube lists them. */
  values?: string
  /** Cube changed it at the last sync. */
  changed?: string
  /** Who wrote a term. */
  by?: string
  updated: string
}

export const typeLabel: Record<DefinitionType, string> = { metric: "Metric", dimension: "Dimension", term: "Term" }
/** A type as people read it; a term that points at something else is a synonym. */
export const kindName = (d: Pick<Definition, "type" | "sameAs">) => (d.sameAs ? "Synonym" : typeLabel[d.type])
export const SYNCED_AT = "today at 06:00"
export const sourceUrl = (d: Definition) => `https://git.example/data/cube-model/blob/main/model/${(d.group ?? "segments").toLowerCase()}.yml`
export const cubeRef = (d: Definition) => `cube:${(d.group ?? "segments").toLowerCase()}.${d.name.toLowerCase().replace(/[^a-z]+/g, "_")}`

const term = (name: string, fields: Partial<Definition> & { by: string; updated: string }): Definition => ({
  name,
  type: "term",
  definition: "",
  synced: false,
  sourceNames: [],
  ...fields,
})

const TERMS: Definition[] = [
  term("Webshop", {
    domain: "sales",
    definition: "Orders placed on larchwood.example or in the iOS and Android apps. Marketplace orders are not the webshop.",
    by: "Jon Abara",
    updated: "2 Oct 2026",
  }),
  term("Store credit", {
    domain: "sales",
    definition: "Money a customer holds with us from a gift card or a refund, spent like cash at checkout. Orders count it; Net revenue does not.",
    by: "Sofia Brandt",
    updated: "5 Sep 2026",
  }),
  term("Peak season", {
    domain: "marketing",
    definition: "15 November to 31 December, and 1 to 31 March for the spring sale. Compare a peak week with the same week last year, not with the week before.",
    by: "Tomas Eriksen",
    updated: "18 Sep 2026",
  }),
  term("Price promotion", {
    domain: "marketing",
    definition: "A lower price shown to everyone for a set time, as opposed to a discount code a customer types in.",
    by: "Tomas Eriksen",
    updated: "11 Sep 2026",
  }),
  term("Test account", {
    domain: "customer_value",
    definition: "An account made by our team to try the shop. Its orders are real orders in the payment data but are left out of customer counts.",
    by: "Noor Haddad",
    updated: "2 Jul 2026",
  }),
  // Synonyms: Heed's own words that mean a synced item, or another term.
  term("GMV", { sameAs: "Gross sales", domain: "sales", by: "Jon Abara", updated: "14 Oct 2026" }),
  term("Turnover", { sameAs: "Net revenue", domain: "sales", by: "Sofia Brandt", updated: "9 Oct 2026" }),
  term("Purchases", { sameAs: "Orders", domain: "sales", by: "Sofia Brandt", updated: "12 Oct 2026" }),
  term("Basket size", { sameAs: "Average order value", domain: "sales", by: "Jon Abara", updated: "30 Sep 2026" }),
  term("Country", { sameAs: "Market", by: "Ravi Kapoor", updated: "1 Oct 2026" }),
  term("Online store", { sameAs: "Webshop", domain: "sales", by: "Jon Abara", updated: "2 Oct 2026" }),
  // Two conflicts an owner has to settle: a word used for two things, and a synonym of a synonym.
  term("Sales", { sameAs: "Net revenue", domain: "sales", by: "Ines Duarte", updated: "21 Oct 2026" }),
  term("Takings", { sameAs: "Turnover", domain: "sales", by: "Lars Dahl", updated: "22 Oct 2026" }),
]

let all: Definition[] = [
  ...metrics.map<Definition>((m) => ({
    name: m.name,
    type: "metric",
    definition: m.definition,
    synced: true,
    sourceNames: m.otherNames ?? [],
    domain: m.domain,
    group: m.group,
    changed: m.note === "changed" ? "7 Oct" : undefined,
    updated: m.note === "changed" ? "7 Oct 2026" : "22 Oct 2026",
  })),
  ...dimensions.map<Definition>((d) => ({
    name: d.name,
    type: "dimension",
    definition: d.definition,
    synced: true,
    sourceNames: [],
    group: "Segments",
    values: d.values,
    updated: "22 Oct 2026",
  })),
  ...TERMS,
]

const listeners = new Set<() => void>()
const set = (next: Definition[]) => {
  all = next
  listeners.forEach((l) => l())
}

/** The definitions as they stand, outside React (the link resolver and tests). */
export const allDefinitions = () => all

export function useDefinitions() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => all
  )
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
export const findDefinition = (name: string | undefined) => (name ? all.find((d) => same(d.name, name)) : undefined)

/** The terms that mean the same as this definition: its "Also called in Heed". */
export const synonymsOf = (name: string) => all.filter((d) => d.sameAs && same(d.sameAs, name))

/** What a word finally means: a synonym's target, followed to the end. */
export function meaningOf(d: Definition): Definition {
  const seen = new Set<string>()
  let at = d
  while (at.sameAs && !seen.has(at.name)) {
    seen.add(at.name)
    const next = findDefinition(at.sameAs)
    if (!next) break
    at = next
  }
  return at
}

/** Every word that means this definition: its name, Cube's other names, and Heed's synonyms. */
export const namesOf = (d: Definition) => [d.name, ...d.sourceNames, ...synonymsOf(d.name).map((s) => s.name)]

/** `short` is the one line a quick view shows; `other` is what the word already means. */
export type Conflict = { kind: "two-things" | "chain" | "missing"; message: string; short: string; other?: string }

/**
 * Why a term can mislead an agent: its word already means something else (another definition's
 * name, or a name Cube gives another item), or it is a synonym of a synonym.
 */
export function conflictOf(d: Definition): Conflict | undefined {
  if (d.type !== "term") return undefined
  const target = d.sameAs ? findDefinition(d.sameAs) : undefined
  if (d.sameAs && !target)
    return {
      kind: "missing",
      message: `${d.sameAs} isn't in Definitions any more. Point ${d.name} at something else.`,
      short: `${d.sameAs} isn't in Definitions any more.`,
    }
  // A term never conflicts with itself (a draft of it is a different object with the same name).
  const other = all.find((x) => !(x.type === "term" && same(x.name, d.name)) && x !== target && (same(x.name, d.name) || x.sourceNames.some((n) => same(n, d.name))))
  if (other)
    return {
      kind: "two-things",
      message: `“${d.name}” already means ${other.name}${other.synced ? ` in ${DEFINITIONS_TOOL}` : " here"}${target ? `, and this term says it means ${target.name}` : ""}. An agent can't tell which one a person means. Rename this term or point it at ${other.name}.`,
      short: `“${d.name}” already means ${other.name}.`,
      other: other.name,
    }
  if (target?.sameAs) {
    const to = meaningOf(target)
    return {
      kind: "chain",
      message: `${target.name} is itself a synonym of ${to.name}. Point ${d.name} at ${to.name} directly.`,
      short: `${target.name} is itself a synonym of ${to.name}.`,
    }
  }
  return undefined
}

/**
 * The live context about a definition: for a metric or a term, the items that use any of its
 * names (a metric through where it applies, a term in its text). Dimensions are about every item.
 */
export function contextAbout(d: Definition, facts: Fact[]) {
  const target = meaningOf(d)
  if (target.type === "dimension") return []
  const names = namesOf(target).map((n) => n.toLowerCase())
  const word = (n: string) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i")
  return facts.filter(
    (f) =>
      servedToAgents(f) &&
      (target.type === "metric" ? f.where.some((w) => names.includes(w.toLowerCase())) : names.some((n) => word(n).test(`${f.title} ${f.summary} ${f.body ?? ""}`)))
  )
}

/** The word in a question that is a Heed synonym, and the synced item it means: "turnover" is Net revenue. */
export function synonymIn(question: string): { asked: string; is: Definition } | undefined {
  const lower = question.toLowerCase()
  const hit = all
    .filter((d) => d.sameAs && !conflictOf(d))
    .sort((a, b) => b.name.length - a.name.length)
    .find((d) => new RegExp(`\\b${d.name.toLowerCase()}\\b`).test(lower))
  if (!hit) return undefined
  const is = meaningOf(hit)
  return is.synced ? { asked: hit.name, is } : undefined
}

/** Saves a term; a renamed one replaces the old entry where it stood. Synced items are never saved here. */
export function saveTerm(previous: string | undefined, next: Definition) {
  if (next.synced) return
  const index = previous ? all.findIndex((d) => d.name === previous) : -1
  if (index === -1) set([...all, next])
  else set(all.map((d, i) => (i === index ? next : d)))
}

/**
 * Adds a synonym to a definition. An existing term with that word is pointed at it (no second
 * entry for the same word); otherwise a new term is written. It never edits the target.
 */
export function addSynonym(target: Definition, word: string, by: string): { ok: true; created: boolean } | Exclude<SynonymCheck, { ok: true }> {
  const check = checkSynonym(target, word)
  if (!check.ok) return check
  const point = target.sameAs ? meaningOf(target) : target
  set([...all, term(word.trim().replace(/\s+/g, " "), { sameAs: point.name, domain: point.domain, by, updated: "23 Oct 2026" })])
  return { ok: true, created: true }
}

/** The synonym rows the list folds into their definition: those whose definition is still there. */
export const foldsInto = (d: Definition) => (d.sameAs ? findDefinition(d.sameAs) : undefined)

/** Every synonym that ends at this definition, a synonym of a synonym included: the list's "Also called". */
export const alsoCalled = (d: Definition) => all.filter((x) => x.sameAs && x !== d && meaningOf(x) === d)

/**
 * Words typed or pasted into the synonym box: split on commas and new lines, trimmed, each word
 * once whatever its case, the person's own casing kept. "GMV, turnover, sales value" is three.
 */
export function parseTags(input: string): string[] {
  const out: string[] = []
  for (const raw of input.split(/[,\n]/)) {
    const w = raw.trim().replace(/\s+/g, " ")
    if (w && !out.some((x) => same(x, w))) out.push(w)
  }
  return out
}

/** Why a word can't become a synonym of this definition, and who already has it. */
export type SynonymCheck = { ok: true } | { ok: false; why: "empty" | "here" | "source" | "taken" | "term"; reason: string; holder?: string; by?: string }

/** Checks a word before it becomes a synonym: never a second entry for a word, never a word that means something else. */
export function checkSynonym(target: Definition, word: string): SynonymCheck {
  const name = word.trim()
  if (!name) return { ok: false, why: "empty", reason: "Type a word." }
  const point = target.sameAs ? meaningOf(target) : target
  if (namesOf(point).some((n) => same(n, name))) return { ok: false, why: "here", reason: `${point.name} is already called “${name}”.`, holder: point.name }
  const taken = all.find((d) => d.synced && (same(d.name, name) || d.sourceNames.some((n) => same(n, name))))
  if (taken) return { ok: false, why: "source", reason: `“${name}” is ${DEFINITIONS_TOOL}'s name for ${taken.name}.`, holder: taken.name, by: DEFINITIONS_TOOL }
  const existing = all.find((d) => d.type === "term" && same(d.name, name))
  if (existing?.sameAs)
    return {
      ok: false,
      why: "taken",
      reason: `“${existing.name}” is already another name for ${existing.sameAs}, added by ${existing.by}.`,
      holder: existing.sameAs,
      by: existing.by,
    }
  if (existing)
    return { ok: false, why: "term", reason: `“${existing.name}” is a term with its own meaning, written by ${existing.by}.`, holder: existing.name, by: existing.by }
  return { ok: true }
}

/** Removes a synonym: the term only existed to point here, so it goes. */
export function removeTerm(name: string) {
  set(all.filter((d) => !(d.type === "term" && same(d.name, name))))
}

/** The other names that go with a term when it is deleted: the synonyms that point at it. */
export const goesWith = (names: string[]) => all.filter((d) => d.sameAs && names.some((n) => same(d.sameAs!, n)) && !names.some((n) => same(d.name, n)))

/** Deletes terms, and the synonyms that only existed to point at them. Gives back what was there, for Undo. */
export function deleteTerms(names: string[]) {
  const before = all
  const gone = new Set([...names, ...goesWith(names).map((d) => d.name)].map((n) => n.toLowerCase()))
  set(all.filter((d) => d.synced || !gone.has(d.name.toLowerCase())))
  return before
}

/** Moves terms to another domain. Gives back what was there, for Undo. */
export function moveTerms(names: string[], domain: DomainId) {
  const before = all
  set(all.map((d) => (!d.synced && names.some((n) => same(d.name, n)) ? { ...d, domain } : d)))
  return before
}

/** Undo: the definitions as they were. */
export const restoreDefinitions = (snapshot: Definition[]) => set(snapshot)
