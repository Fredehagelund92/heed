import { createFileRoute } from '@tanstack/react-router'
import { catalogueTermIdPattern } from '../../../domain/catalogue-term-id.ts'
import { catalogueTermQuery, libraryQuery } from '@/api/queries'
import { TermLoading } from '@/components/catalogue/term-loading'
import { TermPage } from '@/components/catalogue/term-page'
import { validateTermSearch } from '@/lib/search-params'

export const Route = createFileRoute('/catalogue/dimension/$id')({
  validateSearch: validateTermSearch,
  loader: async ({ context, params }) => {
    // The shelf, the Context tab and the issues come from the library index.
    void context.queryClient.prefetchQuery(libraryQuery())
    if (!catalogueTermIdPattern.test(params.id)) return { crumb: 'Dimension not found' }
    try {
      const term = await context.queryClient.ensureQueryData(
        catalogueTermQuery('dimension', params.id),
      )
      // The trail ends with the kind; the page has the name (contract 8.6).
      return term ? {} : { crumb: 'Dimension not found' }
    } catch {
      // The page says what failed and offers Try again, which runs this loader again.
      return {}
    }
  },
  pendingComponent: TermLoading,
  component: DimensionRoute,
})

function DimensionRoute() {
  const { id } = Route.useParams()
  return <TermPage key={id} kind="dimension" id={id} search={Route.useSearch()} />
}
