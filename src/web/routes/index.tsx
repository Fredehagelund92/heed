import { createFileRoute } from '@tanstack/react-router'
import { catalogueQuery, libraryQuery, proposalListQuery } from '@/api/queries'
import { HomePage } from '@/components/home/home-page'
import { MINE } from '@/lib/my-drafts'
import { validateHomeSearch } from '@/lib/search-params'

/**
 * How long Home waits for the person's drafts before it shows: the time a loading indicator
 * waits (contract 10, rule 7). Your drafts sits above the rest of Home, so a list that arrives in
 * that time is there from the first frame and never pushes the page down; a slower one appears
 * when it comes, rather than holding Home.
 */
const DRAFTS_WAIT_MS = 150

export const Route = createFileRoute('/')({
  validateSearch: validateHomeSearch,
  loader: async ({ context }) => {
    // Start loading without holding the page: each tab shows its own loading state.
    void context.queryClient.prefetchQuery(libraryQuery())
    void context.queryClient.prefetchQuery(catalogueQuery())
    await Promise.race([
      context.queryClient.prefetchQuery(proposalListQuery(MINE)),
      new Promise((resolve) => setTimeout(resolve, DRAFTS_WAIT_MS)),
    ])
  },
  component: HomeRoute,
})

function HomeRoute() {
  return <HomePage search={Route.useSearch()} />
}
