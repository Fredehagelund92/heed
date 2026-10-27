/**
 * Terms and synonyms (FR-138): the words people write in Definitions. A term is a word with its
 * own meaning ("Peak season"); a synonym is another name for a metric, a dimension or a term
 * ("GMV" for Gross sales). One word has one meaning across the workspace, so a word that already
 * means something is refused, and the refusal names who has it. These are the rules the service
 * applies before it writes; the database keeps the same ones (db/migrations/0009_terms.sql).
 */

/** The longest word a term can be. */
export const TERM_NAME_MAX = 100
/** The longest meaning a term can have, in characters of markdown. */
export const TERM_MEANING_MAX = 4000
/** The most terms one change takes. */
export const TERM_BULK_MAX = 200

/** A word as it is compared: trimmed, its spaces folded to one, in lower case. */
export const termWord = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

/** A name as it is kept: trimmed, its spaces folded to one, its casing the writer's. */
export const termName = (name: string) => name.trim().replace(/\s+/g, ' ')

/** A word can't hold a comma or a line break: the synonym box splits on them. */
export const termNamePattern = /^[^,\r\n\t]+$/

/**
 * What a synonym means, as the API names it: a metric or a dimension of the vocabulary by its key
 * (`metric:gross_sales`, `dim:market`), or a term by its id (`term:<uuid>`).
 */
export const termRefPattern =
  /^(?:metric:[a-z0-9_]+|dim:[a-z0-9_]+|term:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

export type TermRef = { key: string; term?: never } | { term: string; key?: never }

export function parseTermRef(ref: string): TermRef {
  return ref.startsWith('term:') ? { term: ref.slice('term:'.length) } : { key: ref }
}

export const termRefOf = (row: { sameAsKey: string | null; sameAsTerm: string | null }) =>
  row.sameAsKey ?? (row.sameAsTerm ? `term:${row.sameAsTerm}` : null)

/** Why a word can't be written: what it already means. */
export const termRefusalCodes = ['here', 'source', 'taken', 'term'] as const
export type TermRefusalCode = (typeof termRefusalCodes)[number]

/**
 * Something that already has the word. A metric or a dimension has it by its name or other names
 * in the vocabulary, or by what the definitions source calls it (`tool`: "Cube"). A term has it
 * as its own word: a synonym (`sameAs`) or a term with its own meaning.
 */
export type WordHolder =
  | { origin: 'vocabulary' | 'source'; ref: string; name: string; tool?: string | null }
  | {
      origin: 'term'
      id: string
      name: string
      /** What the synonym means, by ref and name; null for a term with its own meaning. */
      sameAs: { ref: string; name: string } | null
      /** Who wrote it. */
      by: string
    }

export type TermRefusal = {
  code: TermRefusalCode
  /** One sentence for the person, naming who has the word. */
  message: string
  /** What the word means now. */
  holder: string
  /** Who gave it that meaning: the person who wrote the term, or the tool that names it. */
  by: string | null
}

/**
 * Why `word` can't be written, given what already has it, or null when nothing does. `point` is
 * what the new word would mean, when it is a synonym: a word that already means that same thing
 * is refused as said already (`here`), never saved twice.
 */
export function wordRefusal(
  word: string,
  holders: readonly WordHolder[],
  point: { ref: string; name: string } | null,
): TermRefusal | null {
  const said = termName(word)
  const same = (h: WordHolder) =>
    point !== null && (h.origin === 'term' ? h.sameAs?.ref === point.ref : h.ref === point.ref)
  const here = holders.find(same)
  if (here && point)
    return {
      code: 'here',
      message: `${point.name} is already called “${said}”.`,
      holder: point.name,
      by: here.origin === 'term' ? here.by : (here.tool ?? null),
    }
  const synced = holders.find((h) => h.origin !== 'term')
  if (synced)
    return {
      code: 'source',
      message: synced.tool
        ? `“${said}” is ${synced.tool}'s name for ${synced.name}.`
        : `“${said}” is already a name for ${synced.name}.`,
      holder: synced.name,
      by: synced.tool ?? null,
    }
  const term = holders.find((h) => h.origin === 'term')
  if (!term) return null
  if (term.sameAs)
    return {
      code: 'taken',
      message: `“${term.name}” is already another name for ${term.sameAs.name}, added by ${term.by}.`,
      holder: term.sameAs.name,
      by: term.by,
    }
  return {
    code: 'term',
    message: `“${term.name}” is a term with its own meaning, written by ${term.by}.`,
    holder: term.name,
    by: term.by,
  }
}

/** Why a term would mislead an agent now: a sync gave its word a second meaning, or what it means is gone. */
export const termConflictCodes = ['source', 'missing'] as const
export type TermConflictCode = (typeof termConflictCodes)[number]

/** A plain sentence for "these terms": "Deleted “Peak season” and 2 more." */
export function termsSummary(verb: string, names: readonly string[]) {
  const [first, ...rest] = names
  return rest.length
    ? `${verb} “${first}” and ${rest.length} more.`
    : `${verb} “${first ?? 'a term'}”.`
}
