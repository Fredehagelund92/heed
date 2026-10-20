import type { CatalogueStatus, CatalogueTermKind } from '@domain/catalogue'
import { catalogueStatuses, scopeNames, shelfOf } from '@domain/catalogue'
import type { Area } from '@domain/item'
import type { Catalogue, CatalogueSource, CatalogueTerm } from '@/api'
import { parseList, queryTerms, type LibraryRow } from '@/lib/library'
import type { CatalogueSearch } from '@/lib/search-params'

/**
 * The catalogue home's row model (design contract 5, "The catalogue"; FR-136): the view, the
 * search and the filters over `catalogue.list`, and the grouping by domain. Pure, so the page,
 * the tests and the stories share one answer.
 */

/** The view chips. The view lives in the address (`?kind=`); All is the default. */
export const catalogueViews = [
  { id: 'all', title: 'All' },
  { id: 'metric', title: 'Metrics' },
  { id: 'dimension', title: 'Dimensions' },
] as const
export type CatalogueViewId = (typeof catalogueViews)[number]['id']

/** The words for the tool when no one source names it: several tools, or none read yet. */
export const ANY_SOURCE_TOOL = 'the source'

/**
 * The sources the catalogue's definitions come from: those its terms' definitions name, or every
 * source while no term names one. A connector the server no longer reads keeps its row, and is
 * left out once nothing comes from it.
 */
export function catalogueSources(
  catalogue: Pick<Catalogue, 'sources' | 'terms'> | undefined,
): CatalogueSource[] {
  if (!catalogue) return []
  const named = new Set(catalogue.terms.flatMap((term) => term.definition?.sourceId ?? []))
  return named.size === 0
    ? catalogue.sources
    : catalogue.sources.filter((source) => named.has(source.id))
}

/**
 * The tool the catalogue's definitions come from, as people say it, for the words on screen
 * ("Changed in Cube"): the one tool its sources read, or "the source" (CON-101: no vendor is
 * named in the code).
 */
export function catalogueTool(catalogue: Pick<Catalogue, 'sources' | 'terms'> | undefined): string {
  const tools = new Set(catalogueSources(catalogue).map((source) => source.tool))
  return tools.size === 1 ? [...tools][0]! : ANY_SOURCE_TOOL
}

/**
 * The status words of a row (contract 5): one badge, most urgent first. `tool` is the tool the
 * term's definition comes from.
 */
export function catalogueStatusName(
  status: CatalogueStatus,
  { activeIssues = 0, tool = ANY_SOURCE_TOOL }: { activeIssues?: number; tool?: string } = {},
): string {
  switch (status) {
    case 'gone':
      return `Gone from ${tool}`
    case 'changed':
      return `Changed in ${tool}`
    case 'active_issues':
      return activeIssues === 1
        ? '1 active issue'
        : `${activeIssues.toLocaleString('en')} active issues`
    case 'no_context':
      return 'No context yet'
    case 'not_linked':
      return 'Not linked'
    case 'in_sync':
      return 'In sync'
  }
}

/** The name the Filter menu shows, where a count does not fit the word. */
export function catalogueStatusFilterName(status: CatalogueStatus, tool: string): string {
  return status === 'active_issues' ? 'Active issues' : catalogueStatusName(status, { tool })
}

/** Whether a status asks for a look, and so is tinted (tint means look at this). */
export function catalogueStatusAsks(status: CatalogueStatus): boolean {
  return status === 'gone' || status === 'changed' || status === 'active_issues'
}

/** The group a term with no domain falls in: dimensions apply everywhere, metrics lack one. */
export const NO_DOMAIN = 'none'

export type CatalogueFilters = {
  statuses: CatalogueStatus[]
  /** An area id, or `none` for the metrics with no domain. */
  area: string | undefined
}

export function catalogueFiltersOf(search: CatalogueSearch): CatalogueFilters {
  return { statuses: parseList(search.status, catalogueStatuses), area: search.area }
}

export function catalogueFilterCount(search: CatalogueSearch): number {
  const filters = catalogueFiltersOf(search)
  return (filters.statuses.length > 0 ? 1 : 0) + (filters.area ? 1 : 0)
}

/** The words a term is found by: its name, other names, its name in the source and the description copy. */
function haystack(term: CatalogueTerm): string {
  return [
    term.name,
    ...term.aliases,
    term.id,
    term.definition?.name ?? '',
    term.definition?.title ?? '',
    term.definition?.descriptionCopy ?? '',
  ]
    .join(' ')
    .toLowerCase()
}

/** Every word of the query must appear somewhere in the term (contract 8.2). */
export function matchesQuery(term: CatalogueTerm, query: string | undefined): boolean {
  const words = queryTerms(query).map((word) => word.toLowerCase())
  if (words.length === 0) return true
  const text = haystack(term)
  return words.every((word) => text.includes(word))
}

/** How well a term's own names (name, other names) fit the query: 0 is best, 3 is "somewhere". */
function nameRank(term: CatalogueTerm, query: string): number {
  const names = [term.name, ...term.aliases].map((name) => name.toLowerCase())
  if (names.some((name) => name === query)) return 0
  if (names.some((name) => name.startsWith(query))) return 1
  if (names.some((name) => ` ${name}`.includes(` ${query}`))) return 2
  return 3
}

export type RankedTerm = { term: CatalogueTerm; rank: number }

/**
 * The palette's catalogue results (contract 9.1): the terms every word of the query finds, the
 * whole name or another name first, then a name that starts with it, then a word of a name, then
 * a match in the Cube name or description; A to Z within each. The rank lets the palette put the
 * terms before the library items when a term is named outright.
 */
export function rankTerms(
  terms: readonly CatalogueTerm[],
  query: string,
  limit: number,
): RankedTerm[] {
  const wanted = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!wanted) return []
  return terms
    .filter((term) => matchesQuery(term, wanted))
    .map((term) => ({ term, rank: nameRank(term, wanted) }))
    .sort((a, b) => a.rank - b.rank || byName(a.term, b.term))
    .slice(0, limit)
}

function matchesFilters(term: CatalogueTerm, filters: CatalogueFilters): boolean {
  if (filters.statuses.length > 0 && !filters.statuses.includes(term.status)) return false
  // No domain is the group of that name: metrics the source gave no domain. A dimension with no area
  // applies to every domain, so it is not "without" one.
  if (filters.area === NO_DOMAIN) return term.kind === 'metric' && term.domain.areaId === null
  if (filters.area !== undefined && term.domain.areaId !== filters.area) return false
  return true
}

/**
 * The domains the Filter menu offers: those that have a term, the chosen one, and No domain while
 * a metric has none.
 */
export function filterDomains(
  terms: readonly CatalogueTerm[],
  areas: readonly Area[],
  chosen: string | undefined,
): { areas: Area[]; noDomain: boolean } {
  const used = new Set(terms.map((term) => term.domain.areaId))
  return {
    areas: areas.filter((area) => used.has(area.id) || area.id === chosen),
    noDomain:
      chosen === NO_DOMAIN ||
      terms.some((term) => term.kind === 'metric' && term.domain.areaId === null),
  }
}

/** The terms the search and filters leave, before the view chip: the chips count these. */
export function searchedTerms(terms: readonly CatalogueTerm[], search: CatalogueSearch) {
  const filters = catalogueFiltersOf(search)
  return terms.filter((term) => matchesQuery(term, search.q) && matchesFilters(term, filters))
}

export function inCatalogueView(term: CatalogueTerm, view: CatalogueViewId): boolean {
  return view === 'all' || term.kind === view
}

/** How many terms each view chip would show with the current search and filters. */
export function viewCounts(terms: readonly CatalogueTerm[]): Record<CatalogueViewId, number> {
  const metrics = terms.filter((term) => term.kind === 'metric').length
  return { all: terms.length, metric: metrics, dimension: terms.length - metrics }
}

const byName = (a: CatalogueTerm, b: CatalogueTerm) =>
  a.name.localeCompare(b.name, 'en') || a.key.localeCompare(b.key)

/** The terms of one view, A to Z. */
export function visibleTerms(
  terms: readonly CatalogueTerm[],
  search: CatalogueSearch,
): CatalogueTerm[] {
  const view = search.kind ?? 'all'
  return searchedTerms(terms, search)
    .filter((term) => inCatalogueView(term, view))
    .sort(byName)
}

export type DomainInfo = {
  /** The area id, or a key for All domains and No domain: what a group is keyed by. */
  key: string
  name: string
  /** The domain's hue, or null for All domains, No domain and an unknown domain. */
  label: Area['label'] | null
  /** Set when the term has no area: All domains for a dimension, No domain for a metric. */
  none: CatalogueTermKind | null
}

/** The domain a term shows: its area, a dimension that applies everywhere, or no domain. */
export function termDomainInfo(
  term: Pick<CatalogueTerm, 'kind' | 'domain'>,
  areas: readonly Area[],
): DomainInfo {
  const { areaId } = term.domain
  if (areaId === null) {
    return term.kind === 'dimension'
      ? { key: `${NO_DOMAIN}:dimension`, name: 'All domains', label: null, none: 'dimension' }
      : { key: `${NO_DOMAIN}:metric`, name: 'No domain', label: null, none: 'metric' }
  }
  const area = areas.find((candidate) => candidate.id === areaId)
  // A domain the source names that is not one of ours yet: say so rather than show an id.
  return {
    key: areaId,
    name: area?.name ?? 'Unknown domain',
    label: area?.label ?? null,
    none: null,
  }
}

export type CatalogueGroupHeader = DomainInfo & {
  type: 'group'
  metrics: number
  dimensions: number
}
export type CatalogueEntry = CatalogueGroupHeader | { type: 'term'; term: CatalogueTerm }

/** "11 metrics", "4 dimensions", "2 metrics, 1 dimension". */
export function groupCountText({ metrics, dimensions }: { metrics: number; dimensions: number }) {
  const part = (count: number, noun: string) =>
    `${count.toLocaleString('en')} ${count === 1 ? noun : `${noun}s`}`
  if (metrics > 0 && dimensions > 0)
    return `${part(metrics, 'metric')}, ${part(dimensions, 'dimension')}`
  return dimensions > 0 ? part(dimensions, 'dimension') : part(metrics, 'metric')
}

/**
 * Groups terms by domain (the catalogue's default, decision 4 of the catalogue research): the
 * domains by name, then the metrics with no domain, then All domains, where dimensions sit. In a
 * group, metrics come before dimensions, each A to Z. A collapsed group keeps its header row.
 * Without grouping, the terms stay A to Z.
 */
export function catalogueEntries(
  terms: readonly CatalogueTerm[],
  areas: readonly Area[],
  { grouped, collapsed = new Set() }: { grouped: boolean; collapsed?: ReadonlySet<string> },
): CatalogueEntry[] {
  if (!grouped) return [...terms].sort(byName).map((term) => ({ type: 'term', term }))
  const groups = new Map<string, { header: CatalogueGroupHeader; terms: CatalogueTerm[] }>()
  for (const term of terms) {
    const domain = termDomainInfo(term, areas)
    let group = groups.get(domain.key)
    if (!group) {
      group = {
        header: { type: 'group', ...domain, metrics: 0, dimensions: 0 },
        terms: [],
      }
      groups.set(domain.key, group)
    }
    group.terms.push(term)
    if (term.kind === 'metric') group.header.metrics += 1
    else group.header.dimensions += 1
  }
  const rank = (header: CatalogueGroupHeader) =>
    header.none === 'dimension' ? 2 : header.none === 'metric' ? 1 : 0
  const kindRank = (kind: CatalogueTermKind) => (kind === 'metric' ? 0 : 1)
  return [...groups.values()]
    .sort((a, b) => rank(a.header) - rank(b.header) || a.header.name.localeCompare(b.header.name))
    .flatMap(({ header, terms: members }): CatalogueEntry[] => [
      header,
      ...(collapsed.has(header.key)
        ? []
        : [...members]
            .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || byName(a, b))
            .map((term): CatalogueEntry => ({ type: 'term', term }))),
    ])
}

/** The totals under the grid: they follow the view, the search and the filters. */
export function catalogueTotals(terms: readonly CatalogueTerm[]) {
  const counts = viewCounts(terms)
  return {
    terms: counts.all,
    metrics: counts.metric,
    dimensions: counts.dimension,
    domains: new Set(terms.flatMap((term) => (term.domain.areaId ? [term.domain.areaId] : [])))
      .size,
  }
}

/**
 * What the library holds about the shown terms together: accepted items and the issues that
 * still apply, each counted once. The terms' own counts cannot be added up, because one item
 * can be about Orders and Norway at once. Counted from the library index, as the term
 * counts are (src/domain/catalogue.ts).
 */
export function shelfTotals(
  rows: readonly LibraryRow[],
  terms: readonly CatalogueTerm[],
  today: string,
): { items: number; activeIssues: number } {
  const names = terms.map((term) => scopeNames(term.key))
  const shelf = shelfOf(rows, (row) => names.some((named) => named(row)), today)
  return { items: shelf.items, activeIssues: shelf.activeIssues }
}

/** "26 terms: 22 metrics, 4 dimensions". */
export function termsText({
  terms,
  metrics,
  dimensions,
}: Pick<ReturnType<typeof catalogueTotals>, 'terms' | 'metrics' | 'dimensions'>) {
  const head = `${terms.toLocaleString('en')} ${terms === 1 ? 'term' : 'terms'}`
  if (metrics === 0 || dimensions === 0) return head
  return `${head}: ${groupCountText({ metrics, dimensions })}`
}
