import { dayWords } from './dates.ts'
import { acceptedByRole } from './served-review.ts'
import { parseTermRef } from './terms.ts'
import {
  namesOf,
  normalizeName,
  normalizeWithMap,
  phrasesIn,
  type ContestedWord,
  type Term,
  type WordMeaning,
} from './vocabulary.ts'

/*
  What agents get of the terms and synonyms people write in Definitions (docs/product.md,
  sections 3 and 10; FR-138). A synonym of a metric or a dimension is read as that definition: it
  joins its other names, so a question in that word is read as a question about the metric or the
  dimension. A term with its own meaning, and a synonym of one, is background for reading the
  words: a reply names the word used and gives the meaning as a person wrote it, who wrote it (a
  role, never the person) and when. A term is never a checked source: it changes neither the items
  that apply nor the answer state, and a synonym only names what another name already names. Only
  a word that means one thing is served, and the words of a stopped domain and every deleted term
  are left out. A word with two meanings is never settled here: it stays on each of them as
  `contested`, so a question in that word reads nothing and asks which one the person means.
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
  /** The metrics and dimensions the word means as well, by key, as the vocabulary or the source has them. */
  alsoMeans?: readonly string[]
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

/** Written terms by their word, each list in the order given. */
function byName(written: readonly WrittenTerm[]) {
  const words = new Map<string, WrittenTerm[]>()
  for (const term of written) {
    const word = normalizeName(term.name)
    words.set(word, [...(words.get(word) ?? []), term])
  }
  return words
}

/** What a written word means, by key: a metric, a dimension or a term of its own. */
const meaningRef = (term: WrittenTerm) => term.sameAs ?? `term:${term.id}`

/**
 * The words with more than one meaning: what people wrote, then what the vocabulary and the
 * definitions source call it. A word that names what it already means is no second meaning, and
 * neither is a synonym of something gone: that has one meaning left at most. A term that means a
 * term of its own counts as that term. A term of its own that shares a word only with another
 * term has no metric to stop on, so it stays out, and Definitions shows the conflict.
 */
function contestedWords<T extends Term>(vocabulary: readonly T[], open: readonly WrittenTerm[]) {
  const keys = new Map(vocabulary.map((term) => [term.key, term]))
  const held = new Map<string, T[]>()
  for (const term of vocabulary)
    for (const name of namesOf(term)) held.set(name, [...(held.get(name) ?? []), term])
  const byWord = byName(open)
  const byId = new Map(open.map((term) => [term.id, term]))
  const contested: ContestedWord[] = []
  for (const [word, claims] of byWord) {
    const meanings = new Map<string, WordMeaning>()
    const add = (key: string, name: string) => void meanings.set(key, { key, name })
    for (const term of claims) {
      const ref = parseTermRef(meaningRef(term))
      const target = ref.term !== undefined ? byId.get(ref.term) : keys.get(ref.key)
      if (target) add('meaning' in target ? `term:${target.id}` : target.key, target.name)
    }
    const others = [...(held.get(word) ?? [])].sort((a, b) => (a.key < b.key ? -1 : 1))
    for (const term of others) add(term.key, term.name)
    for (const key of claims.flatMap((term) => term.alsoMeans ?? [])) {
      const term = keys.get(key)
      if (term) add(key, term.name)
    }
    const all = [...meanings.values()]
    if (all.length > 1 && all.some((m) => !m.key.startsWith('term:')))
      contested.push({ word, said: claims[0]!.name, meanings: all })
  }
  return contested
}

/**
 * The words people wrote that agents get, the vocabulary with each served synonym of a metric or
 * a dimension among its other names, and the words with more than one meaning. A word is served
 * only when it means one thing: no name the vocabulary has already (after case, spaces and accents
 * are set aside), no word another served term has, and not in conflict or in a stopped domain. A
 * contested word goes on every meaning the vocabulary has, as an other name and in `contested`, so
 * reading it never picks one. A synonym is served only while what it means is: a metric or a
 * dimension of the vocabulary, or a served term with its own meaning. The words come back in a
 * fixed order, by word.
 */
export function servedWords<T extends Term>(
  vocabulary: readonly T[],
  written: readonly WrittenTerm[],
  stopped: { all: boolean; areas: readonly string[] },
): { vocabulary: T[]; written: WrittenTerm[] } {
  if (stopped.all || !written.length) return { vocabulary: [...vocabulary], written: [] }
  const taken = new Set(vocabulary.flatMap(namesOf))
  const word = (term: WrittenTerm) => normalizeName(term.name)
  const running = written.filter(
    (term) => word(term) !== '' && !(term.areaId !== null && stopped.areas.includes(term.areaId)),
  )
  const open = running.filter((term) => !term.conflict && !taken.has(word(term)))
  // Terms that only now read as one word and mean one thing are that one word, once.
  const once = [...byName(open).values()].flatMap((terms) =>
    new Set(terms.map(meaningRef)).size === 1 ? [terms[0]!] : [],
  )
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
  const contested = new Map<string, ContestedWord[]>()
  for (const claim of contestedWords(vocabulary, running))
    for (const { key } of claim.meanings) {
      const term = keys.get(key)
      if (!term) continue
      contested.set(key, [...(contested.get(key) ?? []), claim])
      if (!namesOf(term).includes(claim.word))
        added.set(key, [...(added.get(key) ?? []), claim.said])
    }
  return {
    vocabulary: vocabulary.map((term) => {
      const claims = contested.get(term.key)
      return added.has(term.key) || claims
        ? {
            ...term,
            aliases: [...term.aliases, ...(added.get(term.key) ?? [])],
            ...(claims ? { contested: claims } : {}),
          }
        : term
    }),
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
