import { createFileRoute } from '@tanstack/react-router'
import { catalogueTermIdPattern } from '../../../domain/catalogue-term-id.ts'
import { catalogueTermQuery, libraryQuery } from '@/api/queries'
import { TermPage } from '@/components/catalogue/term-page'
import { TermLoading } from '@/components/catalogue/term-loading'
import { validateTermSearch } from '@/lib/search-params'

export const Route = createFileRoute('/catalogue/metric/$id')({
  validateSearch: validateTermSearch,
  loader: async ({ context, params }) => {
    // The shelf, the Context tab and the issues come from the library index.
    void context.queryClient.prefetchQuery(libraryQuery())
    if (!catalogueTermIdPattern.test(params.id)) return { crumb: 'Metric not found' }
    try {
      const term = await context.queryClient.ensureQueryData(
        catalogueTermQuery('metric', params.id),
      )
      // The trail ends with the kind; the page has the name (contract 8.6).
      return term ? {} : { crumb: 'Metric not found' }
    } catch {
      // The page says what failed and offers Try again, which runs this loader again.
      return {}
    }
  },
  pendingComponent: TermLoading,
  component: MetricRoute,
})

function MetricRoute() {
  const { id } = Route.useParams()
  return <TermPage key={id} kind="metric" id={id} search={Route.useSearch()} />
}
