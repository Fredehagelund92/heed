import { normalizeName } from './vocabulary.ts'

/*
  A domain by the words people use for it. People write "Stores and Suppliers" for a domain stored
  as "Stores & Suppliers", or type its name with a letter swapped, and the name itself may hold a
  typo ("Stores & Suplliers", as an administrator typed it). Heed reads such words as the domain
  they mean, and says once how it read them, so the person never has to guess the stored
  spelling and never hears that they were misunderstood.

  Pure: the outcome tools, the search and the assistant's turn context match the same way.
*/

export type NamedArea = { id: string; name: string }

/**
 * How words matched a domain: `exact` is its id or its name as stored, apart from case and
 * spaces; `loose` its name with "and" for "&" and without punctuation; `close` its name spelt a
 * letter or two apart.
 */
export type DomainMatchKind = 'exact' | 'loose' | 'close'

/** A name as its loose words: lower case, "&" read as "and", every other sign a space. */
export function looseWords(text: string): string[] {
  return (
    normalizeName(text)
      .replace(/&/g, ' and ')
      .replace(/[_\-./]+/g, ' ')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
}
const looseName = (text: string) => looseWords(text).join(' ')

/**
 * The edits between two words, a swap of two neighbouring letters counted as one (optimal string
 * alignment distance), so "Parnters" is one edit from "Partners".
 */
export function editDistance(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  const rows = Array.from({ length: x.length + 1 }, (_, i) =>
    Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1])
        best = Math.min(best, rows[i - 2]![j - 2]! + 1)
      rows[i]![j] = best
    }
  return rows[x.length]![y.length]!
}

/** How many edits a name of this length may be from the words and still be meant: none when short. */
const allowance = (length: number) => (length < 5 ? 0 : length <= 10 ? 1 : length <= 20 ? 2 : 3)

/**
 * The domain the words name, forgivingly: by id (`stores_suppliers`, `area:stores_suppliers`),
 * by name apart from case, "and" or "&" and punctuation, then by the one name spelt a letter or
 * two apart. A close spelling that fits two domains as well names neither. "The", "domain" and
 * "area" around the name are left out.
 */
export function matchDomain<T extends NamedArea>(
  input: string,
  areas: readonly T[],
): { area: T; kind: DomainMatchKind } | null {
  const wanted = normalizeName(input)
    .replace(/^area:/, '')
    .replace(/^the /, '')
    .replace(/ (domain|area)$/, '')
  const exact = areas.find((area) => area.id === wanted || normalizeName(area.name) === wanted)
  if (exact) return { area: exact, kind: 'exact' }
  const loose = looseName(wanted)
  if (!loose) return null
  const same = areas.filter(
    (area) => looseName(area.name) === loose || looseName(area.id) === loose,
  )
  if (same.length === 1) return { area: same[0]!, kind: 'loose' }
  if (same.length > 1) return null
  const scored = areas
    .map((area) => ({
      area,
      distance: Math.min(
        editDistance(loose, looseName(area.name)),
        editDistance(loose, looseName(area.id)),
      ),
    }))
    .sort((a, b) => a.distance - b.distance)
  const [best, next] = scored
  if (!best || best.distance > allowance([...loose].length)) return null
  if (next && next.distance === best.distance) return null
  return { area: best.area, kind: 'close' }
}

/**
 * The domains a text names by a loose or close spelling of their name (the search's exact names
 * are found before this): each with where it starts and ends in the text, which is normalised as
 * `normalizeName` gives it. In running text only a name of two or more words may be spelt apart,
 * so a single word ("payment") stays a word and never becomes a domain ("Payments").
 */
export function domainsInText<T extends NamedArea>(
  text: string,
  areas: readonly T[],
  occupied: ReadonlySet<number> = new Set(),
): { area: T; kind: 'loose' | 'close'; start: number; end: number }[] {
  // The words of the text with where each is, "&" being a word of its own ("and").
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+|&/gu)].map((m) => ({
    word: m[0] === '&' ? 'and' : m[0],
    start: m.index,
    end: m.index + m[0].length,
  }))
  const hits: { area: T; kind: 'loose' | 'close'; start: number; end: number }[] = []
  const taken = new Set<number>()
  // Longer names first, so "Stores and Suppliers" wins over a domain called "Suppliers".
  const byLength = [...areas].sort(
    (a, b) => looseWords(b.name).length - looseWords(a.name).length || (a.id < b.id ? -1 : 1),
  )
  for (const area of byLength) {
    const words = looseWords(area.name)
    if (!words.length) continue
    const name = words.join(' ')
    for (let i = 0; i + words.length <= tokens.length; i++) {
      const window = tokens.slice(i, i + words.length)
      if (window.some((_, k) => taken.has(i + k))) continue
      const start = window[0]!.start
      const end = window.at(-1)!.end
      if (Array.from({ length: end - start }, (_, k) => start + k).some((k) => occupied.has(k)))
        continue
      const wrote = window.map((t) => t.word).join(' ')
      const kind =
        wrote === name
          ? 'loose'
          : words.length > 1 &&
              editDistance(wrote, name) <= allowance([...name].length) &&
              // Each word on its own is that word or a letter or two from it.
              window.every(
                (t, k) => editDistance(t.word, words[k]!) <= Math.max(1, allowance(t.word.length)),
              )
            ? 'close'
            : null
      if (!kind) continue
      for (let k = 0; k < words.length; k++) taken.add(i + k)
      hits.push({ area, kind, start, end })
    }
  }
  return hits.sort((a, b) => a.start - b.start)
}

/**
 * The words of a stored name that look misspelt beside what the person wrote: each a letter or
 * two from the person's word, where the person's word is one Heed knows from elsewhere (the
 * domain's id, the vocabulary, the other domains) and the stored one is not. Without such a
 * word, neither spelling is assumed wrong.
 */
export function misspeltWords(
  stored: string,
  wrote: string,
  known: ReadonlySet<string>,
): { stored: string; wrote: string }[] {
  const a = looseWords(stored)
  const b = looseWords(wrote)
  if (a.length !== b.length) return []
  return a.flatMap((word, i) => {
    const other = b[i]!
    return word !== other &&
      editDistance(word, other) <= Math.max(1, allowance(word.length)) &&
      known.has(other) &&
      !known.has(word)
      ? [{ stored: word, wrote: other }]
      : []
  })
}

/**
 * The words of a domain's stored name that look misspelt beside its id, which was written when
 * the domain was made and never changes ("Stores & Suplliers" with the id `stores_suppliers`): a
 * name's word a letter or two from a word of the id that the name lacks.
 */
export function misspeltAgainstId(name: string, id: string): { stored: string; wrote: string }[] {
  const nameWords = looseWords(name)
  const idWords = looseWords(id)
  return nameWords.flatMap((word) => {
    if (idWords.includes(word)) return []
    const near = idWords.find(
      (other) =>
        !nameWords.includes(other) &&
        editDistance(word, other) <= Math.max(1, allowance(word.length)),
    )
    return near ? [{ stored: word, wrote: near }] : []
  })
}

/**
 * A stored word as the name shows it, and the word meant, cased like it: "Suplliers" for
 * "Suppliers".
 */
function typoWords(name: string, typos: readonly { stored: string; wrote: string }[]) {
  const storedWords = name.match(/[\p{L}\p{N}]+/gu) ?? []
  const shown = (word: string) => storedWords.find((w) => normalizeName(w) === word) ?? word
  const cased = (word: string, like: string) =>
    like[0] && like[0] === like[0].toUpperCase()
      ? `${word.charAt(0).toUpperCase()}${word.slice(1)}`
      : word
  return typos
    .map((t) => `"${shown(t.stored)}" for "${cased(t.wrote, shown(t.stored))}"`)
    .join(' and ')
}
const renameWords =
  'Administrators rename domains in Administration › Domains (/admin?section=domains); the id stays the same.'

/**
 * A note on a domain whose stored name looks misspelt beside its id, said as an observation,
 * blaming nobody; null when it does not.
 */
export function storedNameNote(
  area: NamedArea,
  /** Whether to say where it is renamed: a tool's reply does, the turn context only observes. */
  where = true,
): string | null {
  const typos = misspeltAgainstId(area.name, area.id)
  return typos.length
    ? `The domain's stored name looks misspelt: ${typoWords(area.name, typos)}, as its id ${area.id} reads.${where ? ` ${renameWords}` : ''}`
    : null
}

/** The words Heed knows from its own names, for `misspeltWords`. */
export function knownWords(names: Iterable<string>): Set<string> {
  const words = new Set<string>()
  for (const name of names) for (const word of looseWords(name)) words.add(word)
  return words
}

/**
 * How Heed read a person's words for a domain, said once, or null when they are its name. It
 * states which domain was meant and, when the stored name looks misspelt, says so as an
 * observation and where it is changed, blaming nobody.
 */
export function domainReadAs(
  area: NamedArea,
  wrote: string,
  kind: DomainMatchKind,
  /** Words Heed knows from elsewhere: the domain's id, the vocabulary and the other domains. */
  known: ReadonlySet<string>,
): {
  wrote: string
  domain: string
  kind: 'loose' | 'close'
  misspelt?: true
  note: string
} | null {
  if (kind === 'exact') return null
  const typos = kind === 'close' ? misspeltWords(area.name, wrote, known) : []
  return {
    wrote,
    domain: area.name,
    kind,
    ...(typos.length ? { misspelt: true as const } : {}),
    note: `"${wrote}" was read as the domain ${area.name} (${area.id})${kind === 'close' ? ', the domain whose name is closest' : ''}.${
      typos.length
        ? ` The domain's stored name looks misspelt: ${typoWords(area.name, typos)}. ${renameWords}`
        : ''
    }`,
  }
}

/** What the model is told to do with a `domainReadAs` note: once, briefly, without blame. */
export const domainReadAsInstruction =
  "When the person's words for a domain differ from its stored name, say once, in a few words, which domain you read. When a note says the stored name looks misspelt, mention it once in a few words as an observation, not as a next step, blaming nobody. Do not repeat either in later answers, and never argue with how the person wrote it."
