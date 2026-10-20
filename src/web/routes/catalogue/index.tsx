import { createFileRoute } from '@tanstack/react-router'
import { catalogueQuery, libraryQuery } from '@/api/queries'
import { CataloguePage } from '@/components/catalogue/catalogue-page'
import { validateCatalogueSearch } from '@/lib/search-params'

export const Route = createFileRoute('/catalogue/')({
  validateSearch: validateCatalogueSearch,
  loader: ({ context }) => {
    // Start loading without holding the page: the list shows its own loading state. The library
    // index gives the totals under the grid.
    void context.queryClient.prefetchQuery(catalogueQuery())
    void context.queryClient.prefetchQuery(libraryQuery())
  },
  component: CatalogueRoute,
})

function CatalogueRoute() {
  return <CataloguePage search={Route.useSearch()} />
}
