import { normalizeName } from './vocabulary.ts'
import { shownStates, type Shown, type ShownCounts, type ShownState } from './observability.ts'

/*
  Observability's filters by dimension (FR-620): a dimension first, then its values, with how many
  times agents asked about each in the range. Every dimension is the same kind of thing: none is
  special. A filter is a dimension with value keys or "any value" (`*`), or a fixed field (metric,
  domain, month, answer, gap, reported), and "is not" leaves its values out.

  The counts come after the topics' disclosure (topicView in observability.ts): a count here is
  only ever what the shown counts of whole domains, whole subjects and topics add up to, never a
  number of its own. So a count with a filter on and the same count with it off differ by shown
  counts only, and no hidden count can be worked out by subtracting one from the other (FR-614).
  Pure: the service passes the view's disclosed topics and the vocabulary.
*/

/** The fixed fields a filter can be on besides a dimension (`dim:channel`). */
export const obsFilterFields = ['metric', 'domain', 'month', 'answer', 'gap', 'reported'] as const
export type ObsFilterField = (typeof obsFilterFields)[number]

/** One filter: "Channel is any of Webshop, Stores", "Campaign has any value", "Domain is not finance". */
export type ObsFilter = { key: string; not?: boolean; values: readonly string[] }

/** Every value of a dimension: a topic that names the dimension at all, with a value or "by" it. */
export const ANY_VALUE = '*'

const DIMENSION = /^dim:[a-z0-9_]+$/
const VALUE = /^val:[a-z0-9_]+\/[a-z0-9_]+$/
const METRIC = /^(metric|group):[a-z0-9_]+$/
const AREA = /^[a-z][a-z0-9_]{1,39}$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const GAPS = ['draft', 'suggestion', 'none'] as const
const REPORTED = ['yes', 'no'] as const

export const isDimensionKey = (key: string) => DIMENSION.test(key)

/** The dimension a value belongs to: `val:market/norway` is of `dim:market`. */
export function dimensionOf(valueKey: string): string | null {
  const slash = valueKey.indexOf('/')
  return valueKey.startsWith('val:') && slash > 4 ? `dim:${valueKey.slice(4, slash)}` : null
}

/** Whether a filter's values are the kind its key takes: the keys of the dimension's own values. */
export function filterFits(filter: ObsFilter): boolean {
  if (!filter.values.length) return false
  const every = (ok: (v: string) => boolean) => filter.values.every(ok)
  if (isDimensionKey(filter.key))
    return every((v) => v === ANY_VALUE || (VALUE.test(v) && dimensionOf(v) === filter.key))
  switch (filter.key as ObsFilterField) {
    case 'metric':
      return every((v) => METRIC.test(v))
    case 'domain':
      return every((v) => AREA.test(v))
    case 'month':
      return every((v) => MONTH.test(v))
    case 'answer':
      return every((v) => (shownStates as readonly string[]).includes(v))
    case 'gap':
      return every((v) => (GAPS as readonly string[]).includes(v))
    case 'reported':
      return every((v) => (REPORTED as readonly string[]).includes(v))
    default:
      return false
  }
}

/** A topic as the filters read it: its keys, and what a reader may see of how it was answered. */
export type FilterTopic = {
  id: string
  domain: string | null
  /** Its scope without the month: the months of one subject. */
  subject: string
  month: string
  metrics: readonly string[]
  /** The values asked about, by key: `val:market/norway`. */
  values: readonly string[]
  /** The dimensions named with no value ("Orders by channel"): `dim:channel`. */
  dimensions: readonly string[]
  /** The answer states its shown counts say it had (FR-614), as Questions' views read them. */
  answers: readonly ShownState[]
  notFound: boolean
  reported: boolean
  /** What waits for its gap in the Inbox, as In the Inbox reads it. */
  gap: 'draft' | 'suggestion' | 'none' | null
  total: Shown
  atLeast: number
  counts: ShownCounts
}

const named = new WeakMap<FilterTopic, ReadonlySet<string>>()
/** The dimensions a topic names: its values', and those it names with no value. */
export function dimensionsOf(t: FilterTopic): ReadonlySet<string> {
  let set = named.get(t)
  if (!set) {
    set = new Set([...t.dimensions, ...t.values.flatMap((v) => dimensionOf(v) ?? [])])
    named.set(t, set)
  }
  return set
}

/** Whether a topic names a dimension at all: one of its values, or the dimension with no value. */
export const names = (t: FilterTopic, dimension: string) => dimensionsOf(t).has(dimension)

/** The topics that name each dimension. */
function byDimension(topics: readonly FilterTopic[]) {
  const out = new Map<string, FilterTopic[]>()
  for (const t of topics)
    for (const d of dimensionsOf(t)) {
      const list = out.get(d)
      if (list) list.push(t)
      else out.set(d, [t])
    }
  return out
}

/** Puts one more in a list kept by key. */
function file<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function hit(t: FilterTopic, f: ObsFilter): boolean {
  const some = (has: (v: string) => boolean) => f.values.some(has)
  if (isDimensionKey(f.key))
    return some((v) => (v === ANY_VALUE ? names(t, f.key) : t.values.includes(v)))
  switch (f.key as ObsFilterField) {
    case 'metric':
      return some((v) => t.metrics.includes(v))
    case 'domain':
      return some((v) => t.domain === v)
    case 'month':
      return some((v) => t.month === v)
    case 'answer':
      return some((v) => t.answers.includes(v as ShownState) || (v === 'missing' && t.notFound))
    case 'gap':
      return some((v) => t.gap === v)
    case 'reported':
      return some((v) => (v === 'yes') === t.reported)
    default:
      return false
  }
}

/** Whether a topic passes every filter but the one on `skip`, as a count without its own filter. */
export const passes = (t: FilterTopic, filters: readonly ObsFilter[], skip?: string) =>
  filters.every((f) => f.key === skip || hit(t, f) !== !!f.not)

/** A count as a reader may have it: the total, or null when hidden, and what its shown parts add up to. */
export type ShownSum = { total: Shown; atLeast: number }
/** A count of topics and of what was asked about them. */
export type TopicSum = ShownSum & { topics: number }

/** What a view disclosed besides its topics: each subject over its months, and each domain. */
export type Disclosed = {
  topics: readonly FilterTopic[]
  subjects: readonly {
    key: string
    topics: readonly string[]
    total: Shown
    atLeast: number
    counts: ShownCounts
  }[]
  domains: readonly { domain: string | null; total: Shown; atLeast: number }[]
}

type Piece = { total: Shown; atLeast: number }
const add = (pieces: readonly Piece[]): ShownSum => ({
  total: pieces.every((p) => p.total !== null) ? pieces.reduce((n, p) => n + p.total!, 0) : null,
  atLeast: pieces.reduce((n, p) => n + (p.total ?? p.atLeast), 0),
})

/**
 * What a set of the view's topics adds up to, from shown counts only: a whole domain's own total,
 * else a whole subject's, else each topic's. A hidden part makes the total null ("83+" from
 * `atLeast`), never a number worked out from the others. Each answer state comes from whole
 * subjects' counts and single topics', as Questions' rows show them.
 */
export function counter(view: Disclosed) {
  const subjects = new Map(view.subjects.map((s) => [s.key, s]))
  const byDomain = new Map<string | null, string[]>()
  for (const t of view.topics) file(byDomain, t.domain, t.id)
  const domains = new Map(view.domains.map((d) => [d.domain, d]))

  /** The parts of the set: whole subjects, then the topics left over. */
  function parts(list: readonly FilterTopic[]) {
    const bySubject = new Map<string, FilterTopic[]>()
    for (const t of list) file(bySubject, t.subject, t)
    const whole: NonNullable<ReturnType<typeof subjects.get>>[] = []
    const loose: FilterTopic[] = []
    for (const [key, mine] of bySubject) {
      const s = subjects.get(key)
      if (s && s.topics.length === mine.length) whole.push(s)
      else loose.push(...mine)
    }
    return { whole, loose }
  }

  function asked(list: readonly FilterTopic[]): TopicSum {
    const ids = new Set(list.map((t) => t.id))
    const pieces: Piece[] = []
    const rest: FilterTopic[] = []
    const mine = new Map<string | null, FilterTopic[]>()
    for (const t of list) file(mine, t.domain, t)
    for (const [domain, own] of mine) {
      const d = domains.get(domain)
      if (d && d.total !== null && byDomain.get(domain)!.every((id) => ids.has(id))) pieces.push(d)
      else rest.push(...own)
    }
    const { whole, loose } = parts(rest)
    pieces.push(...whole, ...loose)
    return { topics: list.length, ...add(pieces) }
  }

  function states(list: readonly FilterTopic[]): Record<ShownState, ShownSum> {
    const { whole, loose } = parts(list)
    const out = {} as Record<ShownState, ShownSum>
    for (const s of shownStates) {
      const cells = [...whole, ...loose].map((p) => p.counts[s])
      out[s] = add(cells.map((c) => ({ total: c, atLeast: c ?? 0 })))
    }
    return out
  }

  return { asked, states }
}

/** How much a count weighs, for its order: what it shows. */
export const sizeOf = (c: ShownSum) => c.total ?? c.atLeast

/* ---------- dimensions and their values ---------- */

/** A term as the picker lists it: a dimension, or a value of one. */
export type ObsTerm = { key: string; name: string; aliases: readonly string[] }

export type DimensionRow = {
  key: string
  name: string
  values: number
  /** How many of its values were asked about: as many as its values' first step lists. */
  valuesAsked: number
  asked: TopicSum
}

const collator = new Intl.Collator('en', { sensitivity: 'base' })
/** A to Z by name, whatever its case and accents; the key keeps two of one name apart. */
export const byName = (a: { name: string; key: string }, b: { name: string; key: string }) =>
  collator.compare(a.name, b.name) || (a.key < b.key ? -1 : 1)
const bySize = <T extends { name: string; key: string; asked: ShownSum }>(a: T, b: T) =>
  sizeOf(b.asked) - sizeOf(a.asked) || byName(a, b)

/**
 * Every dimension, each counted over the topics that name it and pass every filter but its own,
 * so its other values stay in sight: the most asked first, then A to Z. `values` is how many
 * values the vocabulary has for it; none means it is filtered by "any value" alone.
 */
export function dimensionRows(
  view: Disclosed,
  filters: readonly ObsFilter[],
  dimensions: readonly ObsTerm[],
  valuesOf: ReadonlyMap<string, readonly ObsTerm[]>,
): DimensionRow[] {
  const count = counter(view)
  const naming = byDimension(view.topics)
  return dimensions
    .map((d) => {
      const mine = (naming.get(d.key) ?? []).filter((t) => passes(t, filters, d.key))
      const own = new Set((valuesOf.get(d.key) ?? []).map((v) => v.key))
      return {
        key: d.key,
        name: d.name,
        values: valuesOf.get(d.key)?.length ?? 0,
        valuesAsked: new Set(mine.flatMap((t) => t.values).filter((v) => own.has(v))).size,
        asked: count.asked(mine),
      }
    })
    .sort(bySize)
}

export type ValueSort = 'asked' | 'name'
export type ValueRow = { key: string; name: string; asked: TopicSum }
export type ValueGroup = {
  dimension: { key: string; name: string }
  /** Every topic that names the dimension and passes the other filters: "any value". */
  asked: TopicSum
  /** One page of the values asked about in the range that match the words. */
  values: ValueRow[]
  /** How many values asked about in the range match, on every page. */
  matched: number
  /** Values of the vocabulary that match but were not asked about in the range. */
  notAsked: number
  nextCursor: string | null
}

/** How many values a page lists, and a group in a search over every dimension. */
export const VALUE_PAGE = 50
export const GROUP_VALUES = 3

const words = (text: string) =>
  normalizeName(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** Whether a search has at least two letters or digits to look for. */
export const searchable = (text: string) => words(text).join('').length >= 2

const idWords = (key: string) => (key.split('/').pop() ?? key).replace(/_/g, ' ')

/** Whether the words meet a term: its name, its key's own words or another name starts with them. */
export function meets(query: string): (term: ObsTerm) => boolean {
  const tokens = words(query)
  if (!tokens.length) return query.trim() ? () => false : () => true
  const phrase = normalizeName(query.trim())
  return (term) =>
    [term.name, idWords(term.key), ...term.aliases].some((name) => {
      if (normalizeName(name).startsWith(phrase)) return true
      const own = words(name)
      return tokens.every((token) => own.some((word) => word.startsWith(token)))
    })
}

const cursorOf = (cursor: string | undefined) =>
  Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0)

/** One dimension's values: the ones asked about, counted without the dimension's own filter. */
function groupOf(
  naming: ReadonlyMap<string, readonly FilterTopic[]>,
  count: ReturnType<typeof counter>,
  filters: readonly ObsFilter[],
  dimension: ObsTerm,
  values: readonly ObsTerm[],
  input: { q: string; sort: ValueSort },
) {
  const named = naming.get(dimension.key) ?? []
  const mine = named.filter((t) => passes(t, filters, dimension.key))
  const askedKeys = new Set(named.flatMap((t) => t.values))
  const byValue = new Map<string, FilterTopic[]>()
  for (const t of mine)
    for (const v of t.values) if (dimensionOf(v) === dimension.key) file(byValue, v, t)
  const matching = values.filter(meets(input.q))
  const rows = matching
    .filter((v) => byValue.has(v.key))
    .map((v) => ({ key: v.key, name: v.name, asked: count.asked(byValue.get(v.key)!) }))
    .sort(input.sort === 'name' ? byName : bySize)
  return {
    dimension: { key: dimension.key, name: dimension.name },
    asked: count.asked(mine),
    rows,
    notAsked: matching.filter((v) => !askedKeys.has(v.key)).length,
  }
}

/**
 * The values of one dimension, a page at a time: the values asked about in the range that match
 * the words, the most asked first (or A to Z), each counted over the topics that pass every filter
 * but the dimension's own. A dimension without values in the vocabulary has "any value" alone.
 */
export function valuePage(
  view: Disclosed,
  filters: readonly ObsFilter[],
  dimension: ObsTerm,
  values: readonly ObsTerm[],
  input: { q: string; sort: ValueSort; cursor?: string },
): ValueGroup {
  const g = groupOf(byDimension(view.topics), counter(view), filters, dimension, values, input)
  const start = cursorOf(input.cursor)
  return {
    dimension: g.dimension,
    asked: g.asked,
    values: g.rows.slice(start, start + VALUE_PAGE),
    matched: g.rows.length,
    notAsked: g.notAsked,
    nextCursor: start + VALUE_PAGE < g.rows.length ? String(start + VALUE_PAGE) : null,
  }
}

/**
 * The words searched in every dimension: each dimension with a value asked about that matches,
 * its first few values, the dimension whose top value was asked most first (or A to Z by the
 * dimension's name), a page of dimensions at a time; and how many matching values were not asked
 * about in the range, in every dimension.
 */
export function valueSearch(
  view: Disclosed,
  filters: readonly ObsFilter[],
  dimensions: readonly ObsTerm[],
  valuesOf: ReadonlyMap<string, readonly ObsTerm[]>,
  input: { q: string; sort: ValueSort; cursor?: string },
): { groups: ValueGroup[]; notAsked: number; nextCursor: string | null } {
  const count = counter(view)
  const naming = byDimension(view.topics)
  const all = dimensions.map((d) =>
    groupOf(naming, count, filters, d, valuesOf.get(d.key) ?? [], input),
  )
  const found = all
    .filter((g) => g.rows.length)
    .sort((a, b) =>
      input.sort === 'name'
        ? byName(a.dimension, b.dimension)
        : sizeOf(b.rows[0]!.asked) - sizeOf(a.rows[0]!.asked) || byName(a.dimension, b.dimension),
    )
  const start = cursorOf(input.cursor)
  return {
    groups: found.slice(start, start + VALUE_PAGE).map((g) => ({
      dimension: g.dimension,
      asked: g.asked,
      values: g.rows.slice(0, GROUP_VALUES),
      matched: g.rows.length,
      notAsked: g.notAsked,
      nextCursor: g.rows.length > GROUP_VALUES ? String(GROUP_VALUES) : null,
    })),
    notAsked: all.reduce((n, g) => n + g.notAsked, 0),
    nextCursor: start + VALUE_PAGE < found.length ? String(start + VALUE_PAGE) : null,
  }
}
