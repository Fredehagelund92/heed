/**
 * The catalogue of metrics and dimensions (FR-136): every term of the live vocabulary with what
 * the definition source last read about it and what the library holds about it. The catalogue is
 * a window, not a store: the definition stays in the source tool (CON-207). Pure: the service and
 * the mock binding compute the same answer from the same rules.
 */
import { itemKinds, type ContextItem, type ItemKind } from './item.ts'
import { itemDisplayStatus, needsALook } from './status.ts'

export const catalogueTermKinds = ['metric', 'dimension'] as const
export type CatalogueTermKind = (typeof catalogueTermKinds)[number]

/** Where a term's domain comes from, in this order of precedence. */
export const termDomainSources = ['vocabulary', 'source', 'none'] as const
export type TermDomainSource = (typeof termDomainSources)[number]

/**
 * The domain of a term: the vocabulary's area map first (CON-206), the definition source's hint
 * second (for Cube the `meta.domain` of the view, CON-516), and no domain third.
 */
export function termDomain(
  vocabularyAreaId: string | null,
  sourceHint: string | null,
): { areaId: string | null; source: TermDomainSource } {
  if (vocabularyAreaId !== null) return { areaId: vocabularyAreaId, source: 'vocabulary' }
  if (sourceHint !== null) return { areaId: sourceHint, source: 'source' }
  return { areaId: null, source: 'none' }
}

/**
 * What the source says about a definition now. `missing`: the newest complete read no longer
 * lists it (CON-210). `changed`: the source changed it after Heed first read it, and accepted
 * items still carry an older change mark, so they wait for a re-check (CON-209). `current`
 * otherwise.
 */
export const definitionStates = ['current', 'changed', 'missing'] as const
export type DefinitionState = (typeof definitionStates)[number]

export function definitionState(definition: {
  missing: boolean
  changedSinceFirstRead: boolean
  itemsWithOlderMark: number
}): DefinitionState {
  if (definition.missing) return 'missing'
  if (definition.changedSinceFirstRead && definition.itemsWithOlderMark > 0) return 'changed'
  return 'current'
}

/**
 * The domain the definition source gives a term from its definitions' domains: the one they all
 * agree on. A dimension whose views lie in several domains, or in a view without one, is shared
 * and gets none, so an administrator looks after it (CON-206). The SQL twin is
 * `cl_source_domains_now` (db/migrations/0001_baseline.sql).
 */
export function agreedDomain(hints: readonly (string | null)[]): string | null {
  const distinct = new Set(hints)
  return distinct.size === 1 ? (hints[0] ?? null) : null
}

/**
 * The definition that speaks for a term in several views: the first one gone from the source,
 * else the first that changed there, else the first. Null for a term with none.
 */
export function speakingDefinition<T extends { state: DefinitionState }>(
  definitions: readonly T[],
): T | null {
  return (
    definitions.find((definition) => definition.state === 'missing') ??
    definitions.find((definition) => definition.state === 'changed') ??
    definitions[0] ??
    null
  )
}

/**
 * Where a definition's model file is in the Git host's web view: the configured address of the
 * model folder and the file's path in it, each segment encoded. Null unless both are known. Only
 * an address is built; nothing is fetched.
 */
export function modelFileAddress(
  folderUrl: string | null,
  path: string | null,
): { path: string; url: string | null } | null {
  if (path === null) return null
  if (folderUrl === null) return { path, url: null }
  const segments = path.split('/').map((segment) => encodeURIComponent(segment))
  return { path, url: `${folderUrl.replace(/\/+$/, '')}/${segments.join('/')}` }
}

/**
 * The one status a catalogue row shows, most urgent first: the definition is gone from the
 * source, it changed there, issues about the term still apply, nothing on the shelf names it, it
 * is not linked to a definition, or all is well.
 */
export const catalogueStatuses = [
  'gone',
  'changed',
  'active_issues',
  'no_context',
  'not_linked',
  'in_sync',
] as const
export type CatalogueStatus = (typeof catalogueStatuses)[number]

export function catalogueStatus(
  definition: { state: DefinitionState } | null,
  shelf: { items: number; activeIssues: number },
): CatalogueStatus {
  if (definition?.state === 'missing') return 'gone'
  if (definition?.state === 'changed') return 'changed'
  if (shelf.activeIssues > 0) return 'active_issues'
  if (shelf.items === 0) return 'no_context'
  if (definition === null) return 'not_linked'
  return 'in_sync'
}

type ShelfItem = Pick<
  ContextItem,
  'kind' | 'status' | 'validity' | 'reviewDate' | 'checkFlag' | 'scope' | 'updatedAt'
>

/**
 * Whether an item's scope names a term or a dimension value, by its vocabulary key. A dimension
 * is named by any of its values and by "any value"; a value only by itself.
 */
export function scopeNames(key: string): (item: Pick<ContextItem, 'scope'>) => boolean {
  const [prefix = '', rest = ''] = key.split(/:(.*)/s)
  if (prefix === 'metric') return (item) => item.scope.metrics.includes(rest)
  if (prefix === 'dim')
    return (item) =>
      item.scope.dimensions.includes(rest) ||
      item.scope.dimensionValues.some((v) => v.dimension === rest)
  if (prefix === 'val') {
    const [dimension, value] = rest.split('/')
    return (item) =>
      item.scope.dimensionValues.some((v) => v.dimension === dimension && v.value === value)
  }
  return () => false
}

export type Shelf = {
  /** Accepted items whose scope names the term. Retired items are history, not on the shelf. */
  items: number
  byKind: Record<ItemKind, number>
  /** Re-check due, source changed or source missing (`needsALook`). */
  needsALook: number
  /** Issues about the term that still apply. */
  activeIssues: number
  /** Items whose last day has passed. They stay in service for questions about their period. */
  ended: number
  /** The newest change to one of these items (ISO 8601), or null when there are none. */
  lastUpdated: string | null
}

/** What the library holds about a term, from its index rows, as the library counts them. */
export function shelfOf(
  items: readonly ShelfItem[],
  names: (item: ShelfItem) => boolean,
  today: string,
): Shelf {
  const shelf: Shelf = {
    items: 0,
    byKind: Object.fromEntries(itemKinds.map((kind) => [kind, 0])) as Record<ItemKind, number>,
    needsALook: 0,
    activeIssues: 0,
    ended: 0,
    lastUpdated: null,
  }
  for (const item of items) {
    if (item.status !== 'accepted' || !names(item)) continue
    const status = itemDisplayStatus(item, today)
    shelf.items += 1
    shelf.byKind[item.kind] += 1
    if (needsALook(status)) shelf.needsALook += 1
    if (status === 'active_issue') shelf.activeIssues += 1
    if (status === 'expired') shelf.ended += 1
    if (shelf.lastUpdated === null || item.updatedAt > shelf.lastUpdated)
      shelf.lastUpdated = item.updatedAt
  }
  return shelf
}
