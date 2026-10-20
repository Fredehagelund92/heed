import type { CatalogueTerm } from '@/api'
import { shelfTotals } from '@/lib/catalogue'
import { daysFrom, isEndedIssueRow, type LibraryRow, type LibraryViewer } from '@/lib/library'
import { visibleRows } from '@/lib/library-search'

/**
 * Home's row model (Home P, the product-style Home): one page for every person, built from the
 * library index and the catalogue the app already reads. "Facts" is Home's word for a library
 * item; the rest of the app keeps "context item". Pure, so the page, the tests and the stories
 * share one answer.
 */

/** The tabs of Home's one table. The first is the default and leaves the address clean. */
export const homeTabs = [
  { id: 'recent', title: 'Recently changed' },
  { id: 'issues', title: 'Known issues' },
  { id: 'topics', title: 'Topics' },
] as const
export type HomeTabId = (typeof homeTabs)[number]['id']

/** How many facts Recently changed lists, and how far back it looks. */
export const RECENT_LIMIT = 8
export const RECENT_DAYS = 30

/** How many facts the search field suggests before "Show all". */
export const SUGGESTION_LIMIT = 3

/** Whether a fact is in service: not retired, and not an issue whose last day has passed. */
function inService(row: LibraryRow): boolean {
  return row.displayStatus !== 'retired' && !isEndedIssueRow(row)
}

/**
 * The facts that changed in the last 30 days, newest first, at most eight. Ties fall back to the
 * title so the order never changes between renders.
 */
export function recentFacts(rows: readonly LibraryRow[], today: string): LibraryRow[] {
  return rows
    .filter((row) => inService(row) && daysFrom(today, row.updatedAt) >= -RECENT_DAYS)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title))
    .slice(0, RECENT_LIMIT)
}

/**
 * The known data issues: issues that apply today (the Active issue status), the one ending
 * soonest first and the ongoing ones last, then by title.
 */
export function knownIssues(rows: readonly LibraryRow[]): LibraryRow[] {
  return rows
    .filter((row) => row.displayStatus === 'active_issue')
    .sort(
      (a, b) =>
        (a.until ?? '9999').localeCompare(b.until ?? '9999') || a.title.localeCompare(b.title),
    )
}

export type HomeTopic = {
  key: string
  name: string
  /** The topic's metrics, by name. */
  metrics: { id: string; name: string }[]
  /** Facts about any of its metrics, each counted once. */
  facts: number
  /** Issues about any of its metrics that apply today. */
  issues: number
}

/**
 * The topics: the catalogue's metric groups, with the facts and the known issues about their
 * metrics. The most written-about topic comes first.
 */
export function homeTopics(
  terms: readonly CatalogueTerm[],
  rows: readonly LibraryRow[],
  today: string,
): HomeTopic[] {
  const groups = new Map<string, { name: string; terms: CatalogueTerm[] }>()
  for (const term of terms) {
    if (term.kind !== 'metric' || term.group === null) continue
    const group = groups.get(term.group.key) ?? { name: term.group.name, terms: [] }
    group.terms.push(term)
    groups.set(term.group.key, group)
  }
  return [...groups]
    .map(([key, group]) => {
      const shelf = shelfTotals(rows, group.terms, today)
      return {
        key,
        name: group.name,
        metrics: group.terms
          .map((term) => ({ id: term.id, name: term.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        facts: shelf.items,
        issues: shelf.activeIssues,
      }
    })
    .sort((a, b) => b.facts - a.facts || a.name.localeCompare(b.name))
}

export type FactSuggestions = {
  /** The best matches, at most three. */
  rows: LibraryRow[]
  /** Every match, the number the library shows for the same words. */
  total: number
}

/** Words a question has and a fact rarely does; the library's search needs every word to match. */
const questionWords = new Set(
  'why how what when where which who whose did does do is are was were has have had about in on at of for to the a an by'.split(
    ' ',
  ),
)

/**
 * The words of what a person typed that the library's search looks for: a question's own words
 * ("why did orders drop in Norway") are left out, so the facts it names can still match.
 * Words that are all question words stay as they are.
 */
export function factQuery(query: string): string {
  const words = query.trim().split(/\s+/).filter(Boolean)
  const kept = words.filter(
    (word) => !questionWords.has(word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')),
  )
  return (kept.length ? kept : words).join(' ')
}

/**
 * The facts the search field suggests for what a person typed: the library's own search over the
 * same rows (the client index), so "Show all 9 in the library" opens a list of exactly nine when
 * it opens with the same words (`factQuery`).
 */
export function factSuggestions(
  rows: LibraryRow[],
  query: string,
  viewer: LibraryViewer,
): FactSuggestions {
  const trimmed = factQuery(query)
  if (!trimmed) return { rows: [], total: 0 }
  const matches = visibleRows(rows, { q: trimmed }, viewer)
  return { rows: matches.slice(0, SUGGESTION_LIMIT), total: matches.length }
}
