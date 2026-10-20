import { useMemo } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { groupRows } from '@/lib/library'
import { visibleRows } from '@/lib/library-search'
import { listSearch } from '@/lib/list-memory'
import type { LibrarySearch } from '@/lib/search-params'
import { useLibrary } from '@/lib/use-library'

/** The order of the list the person came from, the same order the list shows (groups included). */
export function useItemListOrder(search: LibrarySearch, itemId: string) {
  const library = useLibrary()
  return useMemo(() => {
    const ordered = (list: LibrarySearch) =>
      groupRows(visibleRows(library.rows, list, library.viewer), list.group).flatMap((entry) =>
        entry.type === 'item' ? [entry.row] : [],
      )
    let rows = ordered(search)
    let effective = search
    // Opened from the palette or a link with a list it is not in: fall back to all items.
    if (!rows.some((row) => row.id === itemId) && Object.keys(listSearch(search)).length > 0) {
      effective = {}
      rows = ordered(effective)
    }
    return { rows, search: effective, ready: !library.pending }
  }, [library.rows, library.viewer, library.pending, search, itemId])
}

/**
 * Whether an item page carries the list it was opened from: opened from the library's list (the
 * entry says so, so its default list counts), or with a list in its address, as a shared link
 * may be. Opened from anywhere else, it has no list position.
 */
export function useListContext(search: LibrarySearch) {
  const fromList = useRouterState({ select: (state) => state.location.state.fromList === true })
  return fromList || Object.keys(listSearch(search)).length > 0
}
