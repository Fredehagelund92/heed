import { createFileRoute } from '@tanstack/react-router'
import { itemQuery } from '@/api/queries'
import { ContextPage } from '@/components/context/context-page'
import { kindNames } from '@/lib/library-core'
import { validateContextSearch } from '@/lib/search-params'

export const Route = createFileRoute('/library/$itemId_/suggest')({
  validateSearch: validateContextSearch,
  // The trail goes up through the item being changed, named by its kind as its own page is.
  loader: async ({ context, params }) => {
    const item = await context.queryClient.ensureQueryData(itemQuery(params.itemId))
    return { parentCrumb: item ? kindNames[item.kind] : undefined }
  },
  component: SuggestContext,
})

function SuggestContext() {
  const { itemId } = Route.useParams()
  const { draft } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <ContextPage
      itemId={itemId}
      draftId={draft}
      onCreated={(proposal) => {
        void navigate({ search: { draft: proposal.id }, replace: true })
      }}
    />
  )
}
