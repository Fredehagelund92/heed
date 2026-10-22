import { domainsInText, matchDomain } from './domain-match.ts'
import type { Scope } from './item.ts'
import {
  memberTokens,
  namesOf,
  normalizeName,
  normalizeWithMap,
  phrasesIn,
  type Term,
} from './vocabulary.ts'

/**
 * The search behind `search_facts`: a pure, deterministic reading of a few words against the
 * items of an edition. A question's words rarely appear in a title as one phrase, so the query is
 * read the way a person means it: names of domains, metrics, metric groups, dimensions and their
 * values (with their other names) are recognised as whole, longest phrases and matched against
 * what an item is about as well as its text; the other words are matched one by one against the
 * title, summary and body, with light stemming. An item that matches every part comes first,
 * then the ones that match the most. Nothing is stored: the query lives only in this call.
 */

export type SearchArea = { id: string; name: string }
export type SearchItem = {
  id: string
  areaId: string
  title: string
  summary: string
  body?: string
  scope: Scope
}
/** One thing the query names. A phrase that names a domain and a term matches either. */
type Concept =
  | { kind: 'named'; phrase: string; areas: string[]; terms: string[] }
  | { kind: 'word'; stem: string }
export type ReadQuery = {
  concepts: Concept[]
  /** The query's words, stemmed, so an item titled with just those words comes first; never shown. */
  title: string
  /** What the query was read as, for the reply: keys and words, never the query itself. */
  used: {
    domains: string[]
    terms: string[]
    words: string[]
    ignored: string[]
    /**
     * Source member names (`traffic.sessions`) that no term's definition points at. They are not
     * searched as their words: that would answer for another metric without saying so.
     */
    unknown_members: string[]
  }
  /**
   * The domains the query names by another spelling than their stored name ("Stores and
   * Suppliers" for "Stores & Suplliers"), each with the words as the person wrote them.
   */
  spelled: { area: string; wrote: string; kind: 'loose' | 'close' }[]
}

// Words that carry no meaning in a search of short governed facts: function words, question
// words and the product's own nouns ("item", "domain"), so "what does the Sales domain
// cover" reads as Sales and "cover".
const stopWords = new Set(
  (
    'a about across after all also am an and any are as at be been before being between both but by ' +
    'can could did do does doing done during each for from had has have having how i if in into is it ' +
    'its me my no not of on or our over per please should so some than that the their them then there ' +
    'these they this those through to under until up us very was we were what when where which while ' +
    'who whom why will with within would you your ' +
    'area areas context domain domains item items tell show find list search look know'
  ).split(' '),
)

/** A word reduced to a plain form: "accounts" and "account" match, "orders" and "order". */
export function stem(word: string): string {
  let w = word.replace(/'s$/, '').replace(/'/g, '')
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y'
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us'))
    w = w.slice(0, -1)
  return w
}
const wordsOf = (text: string) => normalizeName(text).match(/[\p{L}\p{N}_']+/gu) ?? []
/** A title or a query as its stemmed words, so "exclude test account" reads as the title. */
const stemmedTitle = (text: string) => wordsOf(text).map(stem).join(' ')

/**
 * Reads a query: the domains and vocabulary terms it names, by their names, other names, keys or
 * ids, and the remaining words that mean something.
 */
export function readQuery(
  query: string,
  terms: readonly Term[],
  areas: readonly SearchArea[],
): ReadQuery {
  const text = normalizeName(query)
  const named = new Map<string, { areas: Set<string>; terms: Set<string> }>()
  const add = (name: string, kind: 'areas' | 'terms', id: string) => {
    const key = normalizeName(name)
    if (!key) return
    const entry = named.get(key) ?? { areas: new Set(), terms: new Set() }
    entry[kind].add(id)
    named.set(key, entry)
  }
  for (const area of areas)
    for (const name of [area.id, `area:${area.id}`, area.name]) add(name, 'areas', area.id)
  for (const term of terms) for (const name of namesOf(term)) add(name, 'terms', term.key)
  const used: ReadQuery['used'] = {
    domains: [],
    terms: [],
    words: [],
    ignored: [],
    unknown_members: [],
  }
  const unknown = new Set<number>()
  for (const member of memberTokens(text, terms)) {
    if (named.has(member.name)) continue
    for (let i = member.start; i < member.end; i++) unknown.add(i)
    used.unknown_members.push(member.name)
  }
  // A domain named by another spelling ("stores and suppliers" for "Stores & Suplliers") is read
  // as that domain, before its words are read as terms or words; a name as stored is found below.
  const spelt = domainsInText(
    text,
    areas.filter((area) => !phrasesIn(text, [normalizeName(area.name)]).found.length),
    unknown,
  )
  const asWritten = normalizeWithMap(query)
  const spelled: ReadQuery['spelled'] = []
  const taken = new Set(unknown)
  for (const hit of spelt) {
    for (let i = hit.start; i < hit.end; i++) taken.add(i)
    const from = asWritten.at[hit.start] ?? 0
    const to = (asWritten.at[hit.end - 1] ?? from) + 1
    spelled.push({ area: hit.area.id, wrote: query.slice(from, to), kind: hit.kind })
  }
  const exact = phrasesIn(text, [...named.keys()], taken)
  const occupied = exact.occupied
  const found: { name: string; start: number; end: number; area: string | null }[] = [
    ...exact.found.map((f) => ({ ...f, area: null })),
    ...spelt.map((hit) => ({
      name: text.slice(hit.start, hit.end),
      start: hit.start,
      end: hit.end,
      area: hit.area.id,
    })),
  ].sort((a, b) => a.start - b.start)
  const concepts: Concept[] = []
  for (const { name, area } of found) {
    const entry = area ? { areas: new Set([area]), terms: new Set<string>() } : named.get(name)!
    const concept = {
      kind: 'named' as const,
      phrase: name,
      areas: [...entry.areas].sort(),
      terms: [...entry.terms].sort(),
    }
    if (concepts.some((c) => c.kind === 'named' && c.phrase === name)) continue
    concepts.push(concept)
    used.domains.push(...concept.areas)
    used.terms.push(...concept.terms)
  }
  // The words outside the recognised phrases.
  const rest = [...text].map((char, i) => (occupied.has(i) ? ' ' : char)).join('')
  for (const word of wordsOf(rest)) {
    if (stopWords.has(word) || word.length < 2) {
      used.ignored.push(word)
      continue
    }
    const s = stem(word)
    if (concepts.some((c) => c.kind === 'word' && c.stem === s)) continue
    concepts.push({ kind: 'word', stem: s })
    used.words.push(word)
  }
  used.domains = [...new Set(used.domains)].sort()
  used.terms = [...new Set(used.terms)].sort()
  used.ignored = [...new Set(used.ignored)].sort()
  used.unknown_members = [...new Set(used.unknown_members)].sort()
  return { concepts, used, spelled, title: stemmedTitle(query) }
}

type Indexed = { text: string; stems: Set<string> }
const indexes = new WeakMap<SearchItem, Indexed>()
function indexed(item: SearchItem): Indexed {
  let entry = indexes.get(item)
  if (!entry) {
    const text = normalizeName([item.title, item.summary, item.body ?? ''].join(' \n '))
    entry = { text, stems: new Set(wordsOf(text).map(stem)) }
    indexes.set(item, entry)
  }
  return entry
}

/** How an item is about a vocabulary term: in its scope, through a metric's group, or by name. */
function about(item: SearchItem, key: string, parents: ReadonlyMap<string, string | null>) {
  return (
    item.scope.metrics.includes(key) ||
    item.scope.metrics.some((metric) => parents.get(metric) === key) ||
    item.scope.dimensions.includes(key) ||
    item.scope.dimensionValues.some((v) => v.value === key || v.dimension === key)
  )
}
function mentions(text: string, phrase: string) {
  let at = text.indexOf(phrase)
  while (at >= 0) {
    const before = text[at - 1]
    const after = text[at + phrase.length]
    if (
      (before === undefined || !/[\p{L}\p{N}_]/u.test(before)) &&
      (after === undefined || !/[\p{L}\p{N}_]/u.test(after))
    )
      return true
    at = text.indexOf(phrase, at + 1)
  }
  return false
}

export type Ranked<T> = { item: T; score: number; all: boolean }

/**
 * The items that match a read query, best first: every part matched before some, a named domain
 * or term before a plain word, then by id. An empty query keeps every item, in id order; a query
 * of only ignored words or unknown source members keeps none.
 */
export function rankItems<T extends SearchItem>(
  read: ReadQuery,
  items: readonly T[],
  terms: readonly Term[],
): Ranked<T>[] {
  const byId = (a: Ranked<T>, b: Ranked<T>) =>
    a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0
  if (!read.concepts.length) {
    if (read.used.ignored.length || read.used.unknown_members.length) return []
    return items.map((item) => ({ item, score: 0, all: true })).sort(byId)
  }
  const parents = new Map(terms.map((term) => [term.key, term.parentKey]))
  const ranked: Ranked<T>[] = []
  for (const item of items) {
    const { text, stems } = indexed(item)
    let score = 0
    let matched = 0
    for (const concept of read.concepts) {
      const hit =
        concept.kind === 'word'
          ? stems.has(concept.stem)
          : concept.areas.includes(item.areaId) ||
            concept.terms.some((key) => about(item, key, parents)) ||
            mentions(text, concept.phrase)
      if (!hit) continue
      matched++
      score += concept.kind === 'word' ? 1 : 3
    }
    if (matched) ranked.push({ item, score, all: matched === read.concepts.length })
  }
  // Among equals, the item titled with just the words asked comes first.
  const titled = (r: Ranked<T>) => Number(stemmedTitle(r.item.title) === read.title)
  return ranked.sort(
    (a, b) =>
      Number(b.all) - Number(a.all) || b.score - a.score || titled(b) - titled(a) || byId(a, b),
  )
}

/**
 * A domain by its id, `area:<id>` or its name ("Sales", "the Sales domain"), read
 * forgivingly (`matchDomain`): "and" for "&", punctuation, and a letter or two apart.
 */
export function findArea<T extends SearchArea>(input: string, areas: readonly T[]): T | null {
  return matchDomain(input, areas)?.area ?? null
}
