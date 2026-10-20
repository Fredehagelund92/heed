import { normalizeName, type Term } from './vocabulary.ts'

/*
  The search behind "Where it applies" (FR-107): a dimension can have thousands of values, so the
  picker never lists them all. It asks for a page: metrics, and per dimension a few values and how
  many match, with recent and often-used terms first. Inside one dimension it pages through the
  values. A pasted list is matched name by name, and what is not found is named. Pure: the caller
  passes the live vocabulary, the person's recent terms and how many live items use each term.
*/

export type ScopeTermKind = 'metric' | 'dimension' | 'dimension_value'

/** One term the picker offers or shows as a chip. */
export type ScopeHit = {
  /** The key the draft stores: `metric:orders`, `dim:market` or `val:market/norway`. */
  key: string
  kind: ScopeTermKind
  name: string
  /** The dimension of a value. */
  dimension: { key: string; name: string } | null
  /** The other name the words matched ("Norge" for Norway), when not the name itself. */
  alias: string | null
  /** In the person's own recent drafts. */
  recent: boolean
  /** Live items whose scope names it. */
  uses: number
}

/** One dimension in the results: the dimension itself ("any value") and a few of its values. */
export type ScopeGroup = {
  dimension: ScopeHit
  /** The words named the dimension itself, so `count` is all of its values. */
  named: boolean
  /** Values that match the words, or all of its values when the words named the dimension. */
  count: number
  values: ScopeHit[]
}

export type ScopeSearch = {
  metrics: ScopeHit[]
  groups: ScopeGroup[]
  /** Inside one dimension, where the next page of values starts. */
  nextCursor: string | null
}

export type ScopeMatch = {
  found: ScopeHit[]
  /** Words that name more than one term, with the terms they name. */
  ambiguous: { entry: string; options: ScopeHit[] }[]
  /** Words that name nothing. */
  missing: string[]
}

export type ScopeSearchInput = {
  query: string
  /** Search the values of one dimension only, a page at a time. */
  dimension?: string
  cursor?: string
  limit?: number
}

export type ScopeUsage = {
  /** Keys in the person's recent drafts, newest first. */
  recent: readonly string[]
  /** Live items per key. */
  uses: Readonly<Record<string, number>>
}

export const SCOPE_PAGE = 20
const MAX_METRICS = 5
const MAX_GROUPS = 4
const MAX_GROUP_VALUES = 5

const words = (text: string) =>
  normalizeName(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
const idOf = (key: string) =>
  key
    .slice(key.indexOf(':') + 1)
    .split('/')
    .pop() ?? key

/** How well a name meets the words: 0 equal, 1 starts with them, 2 each word starts a word, else null. */
function fit(name: string, tokens: readonly string[], phrase: string): number | null {
  const normalized = normalizeName(name)
  if (normalized === phrase) return 0
  if (normalized.startsWith(phrase)) return 1
  const own = words(name)
  return tokens.every((token) => own.some((word) => word.startsWith(token))) ? 2 : null
}

type Ranked = { hit: ScopeHit; fit: number }

function scopeKind(term: Term): ScopeTermKind | null {
  return term.kind === 'metric' || term.kind === 'dimension' || term.kind === 'dimension_value'
    ? term.kind
    : null
}

/** A ranked hit for a term, or null when the words miss it. Empty words meet every term. */
function rank(
  term: Term,
  names: ReadonlyMap<string, Term>,
  usage: ScopeUsage,
  tokens: readonly string[],
  phrase: string,
): Ranked | null {
  const kind = scopeKind(term)
  if (!kind) return null
  let best: { fit: number; alias: string | null } | null = tokens.length
    ? null
    : { fit: 1, alias: null }
  for (const [candidate, alias] of [
    [term.name, null],
    [idOf(term.key).replace(/_/g, ' '), null],
    ...term.aliases.map((name) => [name, name] as const),
  ] as const) {
    if (!tokens.length) break
    const value = fit(candidate, tokens, phrase)
    // An alias ranks after the name it stands for when both fit as well.
    if (value !== null && (!best || value + (alias ? 0.5 : 0) < best.fit))
      best = { fit: value + (alias ? 0.5 : 0), alias }
  }
  if (!best) return null
  const parent = term.parentKey ? names.get(term.parentKey) : undefined
  return {
    fit: best.fit,
    hit: {
      key: term.key,
      kind,
      name: term.name,
      dimension:
        kind === 'dimension_value' && parent ? { key: parent.key, name: parent.name } : null,
      alias: best.alias,
      recent: usage.recent.includes(term.key),
      uses: usage.uses[term.key] ?? 0,
    },
  }
}

/** An exact name first, then recent, then often used, then the closer fit, then by name. */
function order(a: Ranked, b: Ranked): number {
  return (
    Number(a.fit >= 1) - Number(b.fit >= 1) ||
    Number(b.hit.recent) - Number(a.hit.recent) ||
    b.hit.uses - a.hit.uses ||
    a.fit - b.fit ||
    a.hit.name.localeCompare(b.hit.name, 'en') ||
    (a.hit.key < b.hit.key ? -1 : 1)
  )
}

/** The page of terms for the words, as `ScopeSearch` describes. */
export function searchScope(
  terms: readonly Term[],
  usage: ScopeUsage,
  input: ScopeSearchInput,
): ScopeSearch {
  const limit = Math.min(Math.max(input.limit ?? SCOPE_PAGE, 1), 50)
  const tokens = words(input.query)
  const phrase = normalizeName(input.query)
  const names = new Map(terms.map((term) => [term.key, term]))
  const valuesOf = new Map<string, Term[]>()
  for (const term of terms)
    if (term.kind === 'dimension_value' && term.parentKey)
      valuesOf.set(term.parentKey, [...(valuesOf.get(term.parentKey) ?? []), term])
  const ranked = (list: readonly Term[], query = tokens, whole = phrase) =>
    list
      .map((term) => rank(term, names, usage, query, whole))
      .filter((entry): entry is Ranked => entry !== null)
      .sort(order)

  if (input.dimension !== undefined) {
    const dimension = names.get(input.dimension)
    if (!dimension || dimension.kind !== 'dimension')
      return { metrics: [], groups: [], nextCursor: null }
    const values = ranked(valuesOf.get(dimension.key) ?? [])
    const start = Math.max(0, Number.parseInt(input.cursor ?? '0', 10) || 0)
    const page = values.slice(start, start + limit)
    return {
      metrics: [],
      groups: [
        {
          dimension: rank(dimension, names, usage, [], '')!.hit,
          named: tokens.length === 0,
          count: values.length,
          values: page.map((entry) => entry.hit),
        },
      ],
      nextCursor: start + limit < values.length ? String(start + limit) : null,
    }
  }

  if (!tokens.length) return { metrics: [], groups: [], nextCursor: null }
  const metrics = ranked(terms.filter((term) => term.kind === 'metric')).slice(0, MAX_METRICS)
  const dimensions = terms.filter((term) => term.kind === 'dimension')
  const groups = dimensions
    .map((dimension) => {
      const named = rank(dimension, names, usage, tokens, phrase)
      // Words that name the dimension show it with its first values; otherwise its matching values.
      const values = named
        ? ranked(valuesOf.get(dimension.key) ?? [], [], '')
        : ranked(valuesOf.get(dimension.key) ?? [])
      if (!named && !values.length) return null
      return {
        named: named !== null,
        best: named ?? values[0]!,
        group: {
          dimension: named?.hit ?? rank(dimension, names, usage, [], '')!.hit,
          named: named !== null,
          count: values.length,
          values: values.map((entry) => entry.hit),
        },
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => Number(b.named) - Number(a.named) || order(a.best, b.best))
    .slice(0, MAX_GROUPS)
  // About one page in all: the metrics, then a row per dimension and a few of its values.
  const room = Math.max(groups.length, limit - metrics.length - groups.length)
  const perGroup = Math.min(MAX_GROUP_VALUES, Math.max(1, Math.floor(room / (groups.length || 1))))
  return {
    metrics: metrics.map((entry) => entry.hit),
    groups: groups.map(({ group }) => ({ ...group, values: group.values.slice(0, perGroup) })),
    nextCursor: null,
  }
}

/** Splits a pasted list into entries: one per line, comma, semicolon or tab, each once. */
export function scopeEntries(text: string): string[] {
  const seen = new Set<string>()
  return text
    .split(/[\n\r,;\t]+/)
    .map((entry) => entry.trim())
    .filter((entry) => {
      const key = normalizeName(entry)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/**
 * Matches a pasted list name by name: by the name, another name or the id, with no guessing.
 * Inside one dimension only its values count; otherwise metrics and values of any dimension.
 */
export function matchScope(
  terms: readonly Term[],
  usage: ScopeUsage,
  entries: readonly string[],
  dimension?: string,
): ScopeMatch {
  const names = new Map(terms.map((term) => [term.key, term]))
  const byName = new Map<string, Term[]>()
  for (const term of terms) {
    if (dimension !== undefined) {
      if (term.kind !== 'dimension_value' || term.parentKey !== dimension) continue
    } else if (term.kind !== 'metric' && term.kind !== 'dimension_value') continue
    for (const name of new Set(
      [term.name, idOf(term.key), idOf(term.key).replace(/_/g, ' '), ...term.aliases].map(
        normalizeName,
      ),
    ))
      byName.set(name, [...(byName.get(name) ?? []), term])
  }
  const result: ScopeMatch = { found: [], ambiguous: [], missing: [] }
  const found = new Set<string>()
  for (const entry of entries) {
    const matches = byName.get(normalizeName(entry)) ?? []
    const hits = matches.map((term) => {
      const hit = rank(term, names, usage, [], '')!.hit
      const alias = term.aliases.find((name) => normalizeName(name) === normalizeName(entry))
      return { ...hit, alias: alias ?? null }
    })
    if (hits.length === 1) {
      if (!found.has(hits[0]!.key)) result.found.push(hits[0]!)
      found.add(hits[0]!.key)
    } else if (hits.length > 1) result.ambiguous.push({ entry, options: hits })
    else result.missing.push(entry)
  }
  return result
}

/** The chips of a scope: each key the vocabulary still holds, in the order given. */
export function describeScope(
  terms: readonly Term[],
  usage: ScopeUsage,
  keys: readonly string[],
): ScopeHit[] {
  const names = new Map(terms.map((term) => [term.key, term]))
  return keys.flatMap((key) => {
    const term = names.get(key)
    const entry = term ? rank(term, names, usage, [], '') : null
    return entry ? [entry.hit] : []
  })
}
