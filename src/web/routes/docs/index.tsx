import { createFileRoute } from '@tanstack/react-router'
import { DocsHome } from '@/components/docs/docs-home'
import { validateDocsSearch } from '@/lib/search-params'

export const Route = createFileRoute('/docs/')({
  validateSearch: validateDocsSearch,
  // The pages are part of the build, a chunk away: read them before the page shows. The query
  // itself is in that chunk too, so none of the docs is in the first load.
  loader: async ({ context }) => {
    const { docsQuery } = await import('@/lib/docs-sections')
    await context.queryClient.ensureQueryData(docsQuery())
  },
  component: DocsRoute,
})

function DocsRoute() {
  return <DocsHome section={Route.useSearch().section} />
}
