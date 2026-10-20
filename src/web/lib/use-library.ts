import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  areasQuery,
  currentUserQuery,
  libraryQuery,
  peopleQuery,
  vocabularyQuery,
} from '@/api/queries'
import { buildRows, type LibraryRow, type LibraryViewer } from '@/lib/library-core'
import { isAdmin } from '@/lib/permissions'

export type LibraryState = {
  /** Every readable item with names resolved, in index order. Empty while loading. */
  rows: LibraryRow[]
  /** True until the first index has arrived. */
  pending: boolean
  /** The index request failed and there is nothing cached to show. */
  failed: boolean
  /** Why the index request failed, when it did. */
  error: unknown
  /** A refresh failed while cached rows are shown (contract 9.5, "Stale"). */
  stale: boolean
  /** When the shown index was built, for the stale banner. */
  loadedAt: string | null
  today: string | null
  /** Who reads it, for the views that depend on the person. */
  viewer: LibraryViewer
  refetch: () => void
}

const empty: LibraryRow[] = []

/**
 * The library as rows, from the one cached index plus the reference data that names things.
 * Every screen that shows items reads this hook, so the sidebar counts, the list, the quick
 * switcher and an item page's previous and next agree.
 */
export function useLibrary(): LibraryState {
  const library = useQuery(libraryQuery())
  const areas = useQuery(areasQuery())
  const people = useQuery(peopleQuery())
  const vocabulary = useQuery(vocabularyQuery())
  const user = useQuery(currentUserQuery())

  const rows = useMemo(
    () =>
      library.data && areas.data && people.data && vocabulary.data
        ? buildRows(library.data, {
            areas: areas.data,
            people: people.data,
            vocabulary: vocabulary.data,
          })
        : empty,
    [library.data, areas.data, people.data, vocabulary.data],
  )
  const person = user.data
  const viewer = useMemo((): LibraryViewer => {
    const assignments = person?.permissions.assignments ?? []
    const areaIds = [
      ...new Set(
        assignments
          .filter((assignment) => assignment.role === 'owner')
          .map((assignment) => assignment.areaId),
      ),
    ]
    return {
      personId: person?.id,
      areaIds,
      maintains: areaIds.length > 0 || (person ? isAdmin(person.permissions) : false),
    }
  }, [person])
  const ready = rows !== empty || (library.data !== undefined && library.data.items.length === 0)

  return {
    rows,
    pending: !ready && !library.isError,
    failed: library.isError && library.data === undefined,
    error: library.error,
    stale: library.isError && library.data !== undefined,
    loadedAt: library.data?.loadedAt ?? null,
    today: library.data?.today ?? null,
    viewer,
    refetch: () => void library.refetch(),
  }
}
