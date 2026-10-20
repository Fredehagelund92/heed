import { createFileRoute, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { itemQuery, libraryQuery, proposalListQuery } from '@/api/queries'
import { kindNames } from '@/lib/library-core'
import { ItemPage } from '@/components/item/item-page'
import { PendingItem } from '@/components/item/pending-item'
import { openProposalStates } from '@/lib/proposals'
import { validateItemSearch } from '@/lib/search-params'

export const Route = createFileRoute('/library/$itemId')({
  validateSearch: validateItemSearch,
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery(libraryQuery())
    const item = await context.queryClient.ensureQueryData(itemQuery(params.itemId))
    if (!item) {
      // An item still in review has its id already: its address says so, if the person may read
      // the proposal.
      const pending = /^itm_[a-z0-9]{8,16}$/.test(params.itemId)
        ? await context.queryClient
            .ensureQueryData(proposalListQuery({ itemId: params.itemId, limit: 10 }))
            .then(
              (list) => list.rows.find((row) => openProposalStates.includes(row.state)) ?? null,
              () => null,
            )
        : null
      if (!pending) throw notFound()
      return { crumb: 'Waiting for review', pending: { id: pending.id, number: pending.number } }
    }
    // The title belongs to the paper; the breadcrumb names the kind and list position.
    return { crumb: kindNames[item.kind], itemCrumbId: item.id, pending: null }
  },
  component: ItemRoute,
})

function ItemRoute() {
  const { itemId } = Route.useParams()
  const search = Route.useSearch()
  const { pending } = Route.useLoaderData()
  const { data: item } = useSuspenseQuery(itemQuery(itemId))
  if (!item) return pending ? <PendingItem proposal={pending} /> : null
  return <ItemPage key={item.id} item={item} search={search} />
}
