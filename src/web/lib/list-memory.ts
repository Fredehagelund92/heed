import type { LibrarySearch } from '@/lib/search-params'

/**
 * Remembers, per list, the item the person was on: the cursor row when they left the list, or
 * the last item they moved to with previous and next on an item page. Going back to the list
 * puts the cursor there, so j and k continue where the person was (Linear does the same). The
 * scroll position itself is restored by the router, because the page is the scrolling element.
 */
const cursors = new Map<string, string>()

/** The params that define a list. Two URLs with the same key show the same rows in the same order. */
export function listKey(search: LibrarySearch): string {
  const { view, q, area, kind, status, about, sort, dir, group, ended, domains } = search
  return JSON.stringify([
    view,
    q?.trim() || undefined,
    area,
    kind,
    status,
    about,
    sort,
    dir,
    group,
    ended,
    domains,
  ])
}

export function rememberCursor(search: LibrarySearch, itemId: string) {
  cursors.set(listKey(search), itemId)
}

export function rememberedCursor(search: LibrarySearch): string | undefined {
  return cursors.get(listKey(search))
}

/** The library params of a URL, without anything else, to carry from the list to an item and back. */
export function listSearch(search: LibrarySearch): LibrarySearch {
  const { view, q, area, kind, status, about, sort, dir, group, ended, domains } = search
  return Object.fromEntries(
    Object.entries({ view, q, area, kind, status, about, sort, dir, group, ended, domains }).filter(
      ([, value]) => value !== undefined && value !== '',
    ),
  )
}
