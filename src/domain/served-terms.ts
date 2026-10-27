import { dayWords } from './dates.ts'
import { acceptedByRole } from './served-review.ts'
import { parseTermRef } from './terms.ts'
import { namesOf, normalizeName, normalizeWithMap, phrasesIn, type Term } from './vocabulary.ts'

/*
  What agents get of the terms and synonyms people write in Definitions (docs/product.md,
  sections 3 and 10; FR-138). A synonym of a metric or a dimension is read as that definition: it
  joins its other names, so a question in that word is read as a question about the metric or the
  dimension. A term with its own meaning, and a synonym of one, is background for reading the
  words: a reply names the word used and gives the meaning as a person wrote it, who wrote it (a
  role, never the person) and when. A term is never a checked source: it changes neither the items
  that apply nor the answer state, and a synonym only names what another name already names. Only
  a word that means one thing is served: a word the vocabulary has already, or that a sync gave a
  second meaning, is left out, as are the words of a stopped domain and every deleted term.
*/

/** A term or a synonym as the serving bundle holds it: the words people wrote, never who. */
export type WrittenTerm = {
  id: string
  name: string
  /** Its own meaning, in markdown; null for a synonym. */
  meaning: string | null
  /** What a synonym means (`metric:<id>`, `dim:<id>` or `term:<id>`); null for a term with its own meaning. */
  sameAs: string | null
  /** Its domain: a term's own, a synonym's is what it means. */
  areaId: string | null
  /** The UTC day it was last written. */
  writtenOn: string
  /** The role it was written in: an owner of its domain, or an administrator. */
  writtenAs: 'owner' | 'administrator'
  /** A sync gave its word a second meaning, or what it means is gone: agents can't tell which one a person means. */
  conflict: boolean
}

/** One word of a text that a person defined, and what it means. */
export type TermUse = {
  /** The words as the text has them. */
  word: string
  /** The term or the synonym the words are. */
  term: WrittenTerm
  /** What they mean: a term with its own meaning, or a metric or a dimension of the vocabulary. */
  means: WrittenTerm | Term
}

/** The most terms a reply names. */
export const TERMS_SHOWN = 5

const isWritten = (means: WrittenTerm | Term): means is WrittenTerm => 'meaning' in means

/**
 * The words people wrote that agents get, and the vocabulary with each served synonym of a metric
 * or a dimension among its other names. A word is served only when it means one thing: not in
 * conflict, not in a stopped domain, no name the vocabulary has already (after case, spaces and
 * accents are set aside), and no word another served term has. A synonym is served only while
 * what it means is: a metric or a dimension of the vocabulary, or a served term with its own
 * meaning. The words come back in a fixed order, by word.
 */
export function servedWords<T extends Term>(
  vocabulary: readonly T[],
  written: readonly WrittenTerm[],
  stopped: { all: boolean; areas: readonly string[] },
): { vocabulary: T[]; written: WrittenTerm[] } {
  if (stopped.all || !written.length) return { vocabulary: [...vocabulary], written: [] }
  const taken = new Set(vocabulary.flatMap(namesOf))
  const word = (term: WrittenTerm) => normalizeName(term.name)
  const open = written.filter(
    (term) =>
      !term.conflict &&
      word(term) !== '' &&
      !taken.has(word(term)) &&
      !(term.areaId !== null && stopped.areas.includes(term.areaId)),
  )
  const held = new Map<string, number>()
  for (const term of open) held.set(word(term), (held.get(word(term)) ?? 0) + 1)
  const once = open.filter((term) => held.get(word(term)) === 1)
  const own = new Set(once.filter((term) => term.meaning !== null).map((term) => term.id))
  const keys = new Map(vocabulary.map((term) => [term.key, term]))
  const served = once
    .filter((term) => {
      if (term.meaning !== null) return true
      if (term.sameAs === null) return false
      const ref = parseTermRef(term.sameAs)
      if (ref.term !== undefined) return own.has(ref.term)
      const kind = keys.get(ref.key)?.kind
      return kind === 'metric' || kind === 'dimension'
    })
    .sort((a, b) => (word(a) < word(b) ? -1 : word(a) > word(b) ? 1 : 0))
  const added = new Map<string, string[]>()
  for (const term of served)
    if (term.sameAs !== null && !term.sameAs.startsWith('term:'))
      added.set(term.sameAs, [...(added.get(term.sameAs) ?? []), term.name])
  return {
    vocabulary: vocabulary.map((term) =>
      added.has(term.key) ? { ...term, aliases: [...term.aliases, ...added.get(term.key)!] } : term,
    ),
    written: served,
  }
}

/**
 * The words of a text that a person defined (`written`, as `servedWords` gives them), in the
 * order the text has them, each meaning once (by the first words that name it) and `max` at
 * most. A word is read as a whole phrase, longest first, case, spaces and accents aside, and with
 * a plural "s" too, as Definitions counts the items about a term. A name of the vocabulary that holds the same place wins: "active
 * customers" is a metric's name even when "Active" is a term.
 */
export function termsIn(
  text: string,
  vocabulary: readonly Term[],
  written: readonly WrittenTerm[],
  max = TERMS_SHOWN,
): TermUse[] {
  if (!written.length || max < 1) return []
  const byName = new Map<string, WrittenTerm>()
  for (const term of written) byName.set(normalizeName(term.name), term)
  const names = new Set(vocabulary.flatMap(namesOf).filter((name) => !byName.has(name)))
  for (const term of written) {
    const plural = `${normalizeName(term.name)}s`
    if (!byName.has(plural) && !names.has(plural)) byName.set(plural, term)
  }
  const ids = new Map(written.map((term) => [term.id, term]))
  const keys = new Map(vocabulary.map((term) => [term.key, term]))
  const meansOf = (term: WrittenTerm): WrittenTerm | Term | undefined => {
    if (term.sameAs === null) return term
    const ref = parseTermRef(term.sameAs)
    return ref.term !== undefined ? ids.get(ref.term) : keys.get(ref.key)
  }
  const { text: folded, at } = normalizeWithMap(text)
  const uses: TermUse[] = []
  for (const { name, start, end } of phrasesIn(folded, [...byName.keys(), ...names]).found) {
    const term = byName.get(name)
    const means = term && meansOf(term)
    if (!term || !means || uses.some((use) => use.means === means)) continue
    const last = at[end - 1]!
    const word = text.slice(at[start], last + (text.codePointAt(last)! > 0xffff ? 2 : 1))
    uses.push({ word, term, means })
    if (uses.length === max) break
  }
  return uses
}

/**
 * A word a person defined, as an agent gets it: the words used, what they name and its kind, and
 * whether they are another name for it; for a term, its meaning as written; its domain; who wrote
 * it as a role, never the person, and on which day; and the page where a person reads it. For a
 * term, that is the term's own (a synonym's words point at it); for a synonym of a metric or a
 * dimension, the synonym's, as the definition is the source's.
 */
export function termEntry(
  use: TermUse,
  names: { domain: (areaId: string) => string; url: (name: string) => string },
) {
  const { word, term, means } = use
  const own = isWritten(means)
  const author = own ? means : term
  const domain = author.areaId === null ? null : names.domain(author.areaId)
  const role =
    author.writtenAs === 'administrator' || domain === null
      ? acceptedByRole('administrator', '')
      : acceptedByRole('owner', domain)
  return {
    word,
    name: means.name,
    kind: own ? 'term' : means.kind === 'metric' ? 'metric' : 'dimension',
    ...(means !== term ? { synonym: true } : {}),
    ...(own ? { meaning: means.meaning! } : {}),
    ...(domain === null ? {} : { domain }),
    written: { role, date: author.writtenOn },
    url: names.url(means.name),
  }
}
export type TermEntry = ReturnType<typeof termEntry>

/** Who wrote a term, in one sentence: "Written 20 Oct 2026 by the owner of Sales, in Definitions." */
export const writtenWords = (on: string, by: string) =>
  `Written ${dayWords(on)} by ${by}, in Definitions.`

/** Said to an agent when a reply names terms: whose words they are, and what they never are. */
export const termsNext =
  'terms says what some words mean here, as a person wrote them in Definitions: read the words by them and say whose words they are, but never give a term as a checked source.'
