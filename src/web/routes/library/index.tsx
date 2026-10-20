import { createFileRoute } from '@tanstack/react-router'
import { libraryQuery } from '@/api/queries'
import { LibraryPage } from '@/components/library/library-page'
import { validateLibrarySearch } from '@/lib/search-params'

export const Route = createFileRoute('/library/')({
  validateSearch: validateLibrarySearch,
  loader: ({ context }) => {
    // Start loading the index without holding the page: the list shows its own loading state.
    void context.queryClient.prefetchQuery(libraryQuery())
  },
  component: LibraryRoute,
})

function LibraryRoute() {
  return <LibraryPage search={Route.useSearch()} />
}
