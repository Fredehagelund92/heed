import * as z from 'zod/mini'

export const termSchema = z
  .object({
    key: z.string(),
    kind: z.enum(['metric', 'metric_group', 'dimension', 'dimension_value']),
    name: z.string().check(z.refine((value) => normalizeName(value).length > 0)),
    aliases: z.array(z.string().check(z.refine((value) => normalizeName(value).length > 0))),
    parentKey: z.nullable(z.string()),
    areaId: z.nullable(z.string()),
    /**
     * The members of the definition source the term names (CON-201, CON-208): a metric names one
     * at most, a dimension one per view of the source (`cube:orders.market`, `cube:segments.market`).
     */
    definitionRefs: z.array(z.string()),
  })
  .check(
    z.refine((term) => {
      const patterns = {
        metric: /^metric:[a-z0-9_]+$/,
        metric_group: /^group:[a-z0-9_]+$/,
        dimension: /^dim:[a-z0-9_]+$/,
        dimension_value: /^val:[a-z0-9_]+\/[a-z0-9_]+$/,
      }
      if (!patterns[term.kind].test(term.key)) return false
      if (term.kind === 'dimension_value')
        return term.parentKey === `dim:${term.key.slice(4).split('/')[0]}`
      if (term.kind === 'metric')
        return term.parentKey === null || /^group:[a-z0-9_]+$/.test(term.parentKey)
      return term.parentKey === null
    }, 'Invalid vocabulary key or parent'),
  )
export type Term = z.infer<typeof termSchema>
export const governedVocabularySchema = z.array(termSchema).check(
  z.refine(
    (terms) => new Set(terms.map((term) => term.key)).size === terms.length,
    'Duplicate vocabulary key',
  ),
  z.refine(
    (terms) =>
      terms.every(
        (term) => term.parentKey === null || terms.some((parent) => parent.key === term.parentKey),
      ),
    'Missing vocabulary parent',
  ),
)
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim()
}
/**
 * A text normalised as `normalizeName` does, with where each character came from: `at[i]` is the
 * place in `text` of the character that gave `normalized[i]`, so a name or a date found in the
 * normalised text is found in the words as written.
 */
export function normalizeWithMap(text: string): { text: string; at: number[] } {
  let bare = ''
  const from: number[] = []
  let index = 0
  for (const char of text) {
    const folded = char.normalize('NFKD').replace(/\p{M}/gu, '')
    bare += folded
    for (let k = 0; k < folded.length; k++) from.push(index)
    index += char.length
  }
  // Lower case as a whole, as normalizeName does (a final sigma depends on the next letter).
  const lower = bare.toLowerCase()
  const cased =
    lower.length === bare.length ? lower : [...bare].map((c) => c.toLowerCase()).join('')
  let out = ''
  const at: number[] = []
  for (let i = 0; i < cased.length && i < from.length; i++) {
    const c = cased[i]!
    const folded = c === 'æ' ? 'ae' : c === 'ø' ? 'o' : c === 'ß' ? 'ss' : c
    if (/\s/.test(folded)) {
      if (out.length && !out.endsWith(' ')) {
        out += ' '
        at.push(from[i]!)
      }
      continue
    }
    out += folded
    for (let k = 0; k < folded.length; k++) at.push(from[i]!)
  }
  if (out.endsWith(' ')) {
    out = out.slice(0, -1)
    at.pop()
  }
  return { text: out, at }
}
/**
 * The member a definition ref names, as the definition source's own tools name it:
 * `cube:orders.returns` is `orders.returns`.
 */
export function memberOf(ref: string): string {
  return ref.slice(ref.indexOf(':') + 1)
}
/**
 * A source member name as an agent passes it after a query to the data tool: `view.member`
 * (`orders.returns`), or the definition ref itself (`cube:orders.returns`). Each part
 * starts with a letter or `_` and has two characters at least, so "e.g." or "1.5" is none.
 */
const memberPattern = /(?:[a-z][a-z0-9_-]*:)?[a-z_][a-z0-9_]+(?:\.[a-z_][a-z0-9_]+)+/g
export function isMemberName(input: string): boolean {
  const name = normalizeName(input)
  return name.match(memberPattern)?.[0] === name
}
/** The names of a term that a source member name can be: each definition ref and its member. */
export function memberNames(term: Term): string[] {
  return term.definitionRefs.flatMap((ref) => [normalizeName(ref), normalizeName(memberOf(ref))])
}
/**
 * The view a definition ref is in, as the definition source names it: `orders` of
 * `cube:orders.market`. Null for a member without a view.
 */
export function refView(ref: string): string | null {
  const member = memberOf(ref)
  const dot = member.lastIndexOf('.')
  return dot > 0 ? member.slice(0, dot) : null
}
/**
 * The members of a term that matter to an item about `metricRefs` (CON-209, CON-210): a
 * dimension in several views flags an item only through its member in the views of the item's
 * metrics. With no metric, or none in a view the term has, every member matters.
 */
export function relevantRefs(
  refs: readonly string[],
  metricRefs: readonly string[],
): readonly string[] {
  if (refs.length < 2) return refs
  const views = new Set(metricRefs.map(refView).filter((view) => view !== null))
  const relevant = refs.filter((ref) => views.has(refView(ref) ?? ''))
  return relevant.length ? relevant : refs
}
/**
 * What a term version's digest covers. A term that names one definition at most keeps the shape it
 * was always digested in (`definitionRef`), so the digests of earlier editions still verify.
 */
export function termDigestContent(
  term: Pick<Term, 'key' | 'kind' | 'parentKey' | 'name' | 'aliases' | 'areaId' | 'definitionRefs'>,
) {
  const { definitionRefs, ...rest } = term
  const content = {
    key: rest.key,
    kind: rest.kind,
    parentKey: rest.parentKey,
    name: rest.name,
    aliases: rest.aliases,
    areaId: rest.areaId,
  }
  return definitionRefs.length > 1
    ? { ...content, definitionRefs: [...definitionRefs].sort(byCodePoint) }
    : { ...content, definitionRef: definitionRefs[0] ?? null }
}
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
/**
 * Every name a term goes by, normalised: its key, its name, its other names (FR-107) and the
 * source member its definition points at (CON-517). Words and structured fields are read by
 * these same names.
 */
export function namesOf(term: Term): string[] {
  return [
    ...new Set([term.key, term.name, ...term.aliases, ...memberNames(term)].map(normalizeName)),
  ].filter(Boolean)
}

/**
 * The whole phrases of `names` in a normalised text, longest first, each place used once: the one
 * way Heed finds names in words. A place in `occupied` is already taken and is never read again.
 */
export function phrasesIn(text: string, names: Iterable<string>, occupied = new Set<number>()) {
  const found: { name: string; start: number; end: number }[] = []
  const boundary = (char: string | undefined) => char === undefined || !/[\p{L}\p{N}_]/u.test(char)
  for (const name of [...new Set(names)].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))) {
    if (!name) continue
    let start = text.indexOf(name)
    while (start >= 0) {
      const end = start + name.length
      if (
        boundary(text[start - 1]) &&
        boundary(text[end]) &&
        !Array.from({ length: name.length }, (_, i) => start + i).some((i) => occupied.has(i))
      ) {
        for (let i = start; i < end; i++) occupied.add(i)
        found.push({ name, start, end })
      }
      start = text.indexOf(name, start + Math.max(name.length, 1))
    }
  }
  return { found: found.sort((a, b) => a.start - b.start), occupied }
}
/**
 * The source member names in a text (already normalised), with where each starts and ends. A
 * member inside a link or an email address (next to `/`, `@` or another dot-joined word) is none;
 * a full stop that ends the sentence is not part of it. Only a name in a view some term's
 * definition points at is a member, unless the whole text is the member name: "returns.also" or
 * "shop24.com" in a sentence stay words.
 */
export function memberTokens(
  text: string,
  terms: readonly Term[],
): { name: string; start: number; end: number }[] {
  const views = new Set(
    terms.flatMap((term) =>
      term.definitionRefs.map((ref) => normalizeName(memberOf(ref)).split('.')[0]!),
    ),
  )
  const whole = isMemberName(text.replace(/\.$/, ''))
  return [...text.matchAll(memberPattern)].flatMap((match) => {
    if (!whole && !views.has(memberOf(match[0]).split('.')[0]!)) return []
    const start = match.index
    const end = start + match[0].length
    const joined = (char: string | undefined) =>
      char !== undefined && /[\p{L}\p{N}_/@:.-]/u.test(char)
    const after = text[end] === '.' && !/\S/u.test(text[end + 1] ?? '') ? undefined : text[end]
    return joined(text[start - 1]) || joined(after) ? [] : [{ name: match[0], start, end }]
  })
}

export type TermResolution =
  { status: 'resolved'; key: string } | { status: 'need_more_detail'; options: string[] }
/**
 * A term by its key, its name or another name, or the source member its definition points at
 * (`orders.returns` or `cube:orders.returns`), so an agent that just queried the data tool
 * can name what it queried (CON-517).
 */
export function resolveTerm(
  input: string,
  terms: readonly Term[],
  kinds: readonly Term['kind'][],
  parentKey?: string,
): TermResolution {
  const candidates = terms.filter(
    (term) =>
      kinds.includes(term.kind) && (parentKey === undefined || term.parentKey === parentKey),
  )
  const key = candidates.find((term) => term.key === input)
  if (key) return { status: 'resolved', key: key.key }
  // The names words are read by (namesOf); a source member counts only when no name matches.
  const name = normalizeName(input)
  const named = candidates.filter((term) => namesOf(term).includes(name))
  const exact = named.filter((term) => !memberNames(term).includes(name))
  const found = exact.length ? exact : named
  if (found.length === 1) return { status: 'resolved', key: found[0]!.key }
  const options = found.length ? found : candidates
  return { status: 'need_more_detail', options: options.map((term) => term.key).sort() }
}

const trigrams = (value: string) => {
  const text = `  ${normalizeName(value)} `
  return new Set(Array.from({ length: text.length - 2 }, (_, i) => text.slice(i, i + 3)))
}

/**
 * How alike two names read, from 0 to 1: the share of three-letter pieces they have in common,
 * so a typo ("sles") is close to the name it misses ("Sales").
 */
export function nameSimilarity(a: string, b: string): number {
  const x = trigrams(a)
  const y = trigrams(b)
  return (2 * [...y].filter((gram) => x.has(gram)).length) / (x.size + y.size)
}

/** A member's own name in words, without its view: `orders.refund_total` is "refund total". */
const memberWords = (member: string) =>
  memberOf(normalizeName(member)).split('.').at(-1)!.replaceAll('_', ' ')

/**
 * Typo matches are suggestions, never silently selected scope. A source member name Heed does
 * not know (`traffic.sessions`) is compared by its own name ("sessions") with the names and with
 * the members' own names the terms point at, never by its view, which many members share. It
 * needs a closer match than a typo: a member's name is a whole other name, and letters it shares
 * by chance ("sessions" and "Operations") suggest the wrong metric.
 */
export function suggestTerms(input: string, terms: readonly Term[]): string[] {
  const member = isMemberName(input)
  const wanted = member ? memberWords(input) : input
  return terms
    .map((term) => ({
      key: term.key,
      score: Math.max(
        ...[
          term.name,
          ...term.aliases,
          ...(member ? term.definitionRefs.map(memberWords) : []),
        ].map((alias) => nameSimilarity(wanted, alias)),
      ),
    }))
    .filter((term) => term.score >= (member ? 0.45 : 0.3))
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1))
    .map((term) => term.key)
}
