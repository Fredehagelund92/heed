import MiniSearch from 'minisearch'
import type { LibraryIndex } from '@/api'
import type { Area, ItemKind, Scope, Vocabulary } from '@domain/item'
import { mentionTargetSchema } from '@domain/mentions'
import { kindNames } from '@/lib/library'
import type { MentionStatus, MentionTargetType } from '@/lib/mention-names'

/*
  What an @ mention and a scope chip can point at (the mentions design, section 2.3): a metric, a
  dimension, a dimension value, another context item or a domain, each by a stable key in the form
  the markup stores (`metric:orders`, `val:market/norway`, `item:itm_...`, `area:...`). The
  vocabulary endpoint returns ids without their prefixes and no metric groups or definition state
  (back end gap G8), so the keys are built here and every term starts as current.
*/

export type MentionOption = {
  /** The target as the markup stores it. */
  key: string
  type: MentionTargetType
  name: string
  /** Other names that find this one (FR-107). */
  aliases: string[]
  /** One quiet line beside the name: the metric group, the dimension, the kind and domain. */
  detail: string
  status: MentionStatus
  /** For an item: its kind, so the chip carries the kind glyph. */
  kind?: ItemKind
  /** For a domain: its hue, so the chip carries it. */
  label?: Area['label']
}

export type MentionMatch = {
  option: MentionOption
  /** The other name the query matched, when it matched one and not the main name. */
  alias?: string
}

/** The groups of the @ list, in order. Values come before dimensions: they are mentioned more. */
export const mentionGroups: { type: MentionTargetType; heading: string }[] = [
  { type: 'metric', heading: 'Metrics' },
  { type: 'val', heading: 'Values' },
  { type: 'dim', heading: 'Dimensions' },
  { type: 'item', heading: 'Facts' },
  { type: 'area', heading: 'Domains' },
]

/**
 * Every target a person may mention, from the three cached reads. A retired item cannot be
 * mentioned again (the mentions design, 2.4), so it is left out of the picker; it still resolves
 * through `targetsByKey` for text that already mentions it.
 */
export function buildMentionTargets({
  vocabulary,
  library,
  areas,
}: {
  vocabulary?: Vocabulary
  library?: LibraryIndex
  areas?: Area[]
}): MentionOption[] {
  const areaById = new Map((areas ?? []).map((area) => [area.id, area]))
  const options: MentionOption[] = [
    ...(vocabulary?.metrics ?? []).map((metric) => ({
      key: `metric:${metric.id}`,
      type: 'metric' as const,
      name: metric.name,
      aliases: [],
      detail: metric.group ? `Metric · ${metric.group}` : 'Metric',
      status: 'current' as const,
    })),
    ...(vocabulary?.dimensions ?? []).flatMap((dimension) => [
      ...dimension.values.map((value) => ({
        key: `val:${dimension.id}/${value.id}`,
        type: 'val' as const,
        name: value.name,
        aliases: value.aliases,
        detail: dimension.name,
        status: 'current' as const,
      })),
      {
        key: `dim:${dimension.id}`,
        type: 'dim' as const,
        name: dimension.name,
        aliases: [],
        detail: 'Dimension',
        status: 'current' as const,
      },
    ]),
    ...(library?.items ?? []).map((item) => ({
      key: `item:${item.id}`,
      type: 'item' as const,
      name: item.title,
      aliases: [],
      detail: [kindNames[item.kind], areaById.get(item.areaId)?.name].filter(Boolean).join(' · '),
      status: item.status === 'retired' ? ('retired' as const) : ('current' as const),
      kind: item.kind,
    })),
    ...(areas ?? []).map((area) => ({
      key: `area:${area.id}`,
      type: 'area' as const,
      name: area.name,
      aliases: [],
      detail: 'Domain',
      status: 'current' as const,
      label: area.label,
    })),
  ]
  // A key the markup could not store is never offered.
  return options.filter((option) => mentionTargetSchema.safeParse(option.key).success)
}

const lookups = new WeakMap<MentionOption[], Map<string, MentionOption>>()

/** The targets by key, for text that already holds mentions. Built once per list. */
export function targetsByKey(options: MentionOption[]): Map<string, MentionOption> {
  let lookup = lookups.get(options)
  if (!lookup) {
    lookup = new Map(options.map((option) => [option.key, option]))
    lookups.set(options, lookup)
  }
  return lookup
}

type SearchDocument = { id: string; name: string; aliases: string }
const indexes = new WeakMap<MentionOption[], MiniSearch<SearchDocument>>()

function searchIndex(options: MentionOption[]) {
  let index = indexes.get(options)
  if (index) return index
  index = new MiniSearch<SearchDocument>({
    fields: ['name', 'aliases'],
    searchOptions: {
      boost: { name: 2 },
      prefix: true,
      fuzzy: (term) => (term.length >= 5 ? 1 : false),
      combineWith: 'AND',
    },
  })
  index.addAll(
    options.map((option) => ({
      id: option.key,
      name: option.name,
      aliases: option.aliases.join(' '),
    })),
  )
  indexes.set(options, index)
  return index
}

const folded = (text: string) =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en')

/** Whether every word of the query starts a word of the text. */
function startsWords(text: string, query: string) {
  const words = folded(text).split(/[^\p{L}\p{N}]+/u)
  return folded(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .every((part) => words.some((word) => word.startsWith(part)))
}

/**
 * The targets that match what was typed after `@`, best first, at most `perGroup` of each type
 * and `limit` in all, grouped in `mentionGroups` order. An empty query lists the first of each group. A retired
 * item is never offered. When only another name matched, the match says which one, so the list
 * can say "also called Norge".
 */
export function searchMentionTargets(
  options: MentionOption[],
  query: string,
  {
    types = mentionGroups.map((group) => group.type),
    perGroup = 5,
    limit = Infinity,
    exclude = [],
  }: {
    types?: readonly MentionTargetType[]
    perGroup?: number
    limit?: number
    exclude?: readonly string[]
  } = {},
): MentionMatch[] {
  const allowed = new Set(types)
  const excluded = new Set(exclude)
  const offered = (option: MentionOption) =>
    allowed.has(option.type) && option.status !== 'retired' && !excluded.has(option.key)
  const trimmed = query.trim()
  const lookup = targetsByKey(options)
  // A name that starts with the words leads, then one where they start a word, then the rest
  // (another name, a near miss), each in the search's own order.
  const closeness = (option: MentionOption) =>
    folded(option.name).startsWith(folded(trimmed)) ? 0 : startsWords(option.name, trimmed) ? 1 : 2
  const ranked = trimmed
    ? searchIndex(options)
        .search(trimmed)
        .flatMap((result) => lookup.get(String(result.id)) ?? [])
        .map((option, order) => ({ option, order, rank: closeness(option) }))
        .sort((a, b) => a.rank - b.rank || a.order - b.order)
        .map(({ option }) => option)
    : options
  const matches: MentionMatch[] = []
  const counts = new Map<MentionTargetType, number>()
  for (const option of ranked) {
    if (matches.length >= limit) break
    if (!offered(option)) continue
    const count = counts.get(option.type) ?? 0
    if (count >= perGroup) continue
    counts.set(option.type, count + 1)
    const alias =
      trimmed && !startsWords(option.name, trimmed)
        ? option.aliases.find((name) => startsWords(name, trimmed))
        : undefined
    matches.push(alias ? { option, alias } : { option })
  }
  const order = new Map(mentionGroups.map((group, position) => [group.type, position]))
  return matches.sort((a, b) => order.get(a.option.type)! - order.get(b.option.type)!)
}

/**
 * The scope keys of a draft: its metrics, its dimensions with any value, then its dimension
 * values, each in the order added.
 */
export function scopeKeys(scope: Scope): string[] {
  return [...scope.metrics, ...scope.dimensions, ...scope.dimensionValues.map((row) => row.value)]
}

/**
 * Adds a metric, a dimension with any value or a dimension value to a draft's scope, in the shape
 * the write path checks: `metric:<id>`, `dim:<id>` and `{ dimension: 'dim:<id>', value:
 * 'val:<id>/<value>' }`. A dimension with any value and values of the same dimension never stand
 * together (FR-126): any value replaces the values, and a value narrows any value to itself. A key
 * already in the scope, or one of another type, leaves it unchanged.
 */
export function addToScope(scope: Scope, key: string): Scope {
  if (scopeKeys(scope).includes(key)) return scope
  if (key.startsWith('metric:')) return { ...scope, metrics: [...scope.metrics, key] }
  if (key.startsWith('dim:'))
    return {
      ...scope,
      dimensions: [...scope.dimensions, key],
      dimensionValues: scope.dimensionValues.filter((row) => row.dimension !== key),
    }
  if (key.startsWith('val:')) {
    const dimension = `dim:${key.slice(4).split('/')[0]}`
    return {
      ...scope,
      dimensions: scope.dimensions.filter((other) => other !== dimension),
      dimensionValues: [...scope.dimensionValues, { dimension, value: key }],
    }
  }
  return scope
}

export function removeFromScope(scope: Scope, key: string): Scope {
  return {
    ...scope,
    metrics: scope.metrics.filter((metric) => metric !== key),
    dimensions: scope.dimensions.filter((dimension) => dimension !== key),
    dimensionValues: scope.dimensionValues.filter((row) => row.value !== key),
  }
}
