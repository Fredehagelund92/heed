import type { ItemKind } from '@domain/item'
import type { ItemDisplayStatus } from '@domain/status'
import MiniSearch from 'minisearch'
import {
  applyViewAndFilters,
  filtersOf,
  formatList,
  isEndedIssueRow,
  sortRows,
  sortStateOf,
  toggleIn,
  type LibraryRow,
  type LibraryViewer,
} from '@/lib/library'
import type { LibrarySearch } from '@/lib/search-params'

/*
  Search over the library rows. Kept apart from lib/library.ts so the shell (sidebar counts)
  does not load the search index code; the list, the item page and the palette do.
*/

type SearchDocument = {
  id: string
  title: string
  about: string
  owner: string
  domain: string
  summary: string
}

const indexes = new WeakMap<LibraryRow[], MiniSearch<SearchDocument>>()

/**
 * A client search index over title, where it applies, owner, domain, summary and id (contract
 * 9.1). Built once per set of rows and cached. Prefix and light typo matching, all words must match.
 */
export function searchIndex(rows: LibraryRow[]): MiniSearch<SearchDocument> {
  const cached = indexes.get(rows)
  if (cached) return cached
  const index = new MiniSearch<SearchDocument>({
    fields: ['title', 'about', 'owner', 'domain', 'summary', 'id'],
    searchOptions: {
      boost: { title: 3, about: 2, id: 2 },
      prefix: true,
      // One typo in words of five letters or more: "northlnd" finds Norway, "norway" does not find Spain.
      fuzzy: (term) => (term.length >= 5 ? 1 : false),
      combineWith: 'AND',
    },
  })
  index.addAll(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      about: row.about.join(' '),
      owner: row.ownerName,
      domain: row.areaName,
      summary: row.summary,
    })),
  )
  indexes.set(rows, index)
  return index
}

/** The ids that match a query, best match first. */
export function searchIds(rows: LibraryRow[], query: string): string[] {
  return searchIndex(rows)
    .search(query)
    .map((result) => String(result.id))
}

/** The rows of a list, in order: view, filters, search, sort. */
export function visibleRows(
  rows: LibraryRow[],
  search: LibrarySearch,
  viewer: LibraryViewer,
): LibraryRow[] {
  const filtered = applyViewAndFilters(rows, search.view ?? 'all', filtersOf(search), viewer)
  const query = search.q?.trim()
  let matched = filtered
  if (query) {
    const allowed = new Map(filtered.map((row) => [row.id, row]))
    matched = searchIds(rows, query).flatMap((id) => allowed.get(id) ?? [])
  }
  return sortRows(matched, sortStateOf(search))
}

/**
 * How many ended issues the list leaves out right now (requirements 4.4): the ones that would show, with
 * the same view, filters and search, if the Ended issues filter were on. Zero once it is on.
 */
export function hiddenEndedIssues(
  rows: LibraryRow[],
  search: LibrarySearch,
  viewer: LibraryViewer,
): number {
  if (search.ended === 'show' || search.status?.split(',').includes('expired')) return 0
  return visibleRows(rows, { ...search, ended: 'show' }, viewer).filter(isEndedIssueRow).length
}

/** What ticking or unticking one option of the Filter menu does to the URL. */
export type FilterChoice =
  | { facet: 'kind'; value: ItemKind }
  | { facet: 'status'; value: ItemDisplayStatus }
  | { facet: 'area'; value: string }
  | { facet: 'about'; value: string }
  | { facet: 'ended' }

export function filterChoicePatch(
  search: LibrarySearch,
  option: FilterChoice,
): Partial<LibrarySearch> {
  const filters = filtersOf(search)
  switch (option.facet) {
    case 'kind':
      return { kind: formatList(toggleIn(filters.kinds, option.value)) }
    case 'status':
      return { status: formatList(toggleIn(filters.statuses, option.value)) }
    case 'area':
      return { area: filters.area === option.value ? undefined : option.value }
    case 'about':
      return { about: filters.about === option.value ? undefined : option.value }
    case 'ended':
      return { ended: filters.endedIssues ? undefined : 'show' }
  }
}

/**
 * Counts for the Filter menu: how many rows the list shows after clicking one option, the view, the
 * search and every other filter kept. The search runs once; each count is one filter pass.
 */
export function filterCounter(
  rows: LibraryRow[],
  search: LibrarySearch,
  viewer: LibraryViewer,
): (option: FilterChoice) => number {
  const query = search.q?.trim()
  const matches = query ? new Set(searchIds(rows, query)) : null
  return (option) => {
    const next = { ...search, ...filterChoicePatch(search, option) }
    const filtered = applyViewAndFilters(rows, next.view ?? 'all', filtersOf(next), viewer)
    return matches ? filtered.filter((row) => matches.has(row.id)).length : filtered.length
  }
}
