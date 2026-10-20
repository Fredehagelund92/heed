import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { binItemQuery, itemQuery } from '@/api/queries'
import { BinItemPage } from '@/components/library/bin-item-page'
import { AudienceGate } from '@/components/page/audience-gate'
import { Page } from '@/components/page/page'
import { kindNames } from '@/lib/library-core'

export const Route = createFileRoute('/library/bin_/$itemId')({
  loader: async ({ context, params }) => {
    // Anyone else is refused: the gate below says whose page it is.
    const binned = await context.queryClient
      .ensureQueryData(binItemQuery(params.itemId))
      .catch(() => undefined)
    if (binned) return { crumb: kindNames[binned.item.kind] }
    if (binned === undefined) return { crumb: undefined }
    // Restored since the address was copied: the item is back in the library.
    if (await context.queryClient.ensureQueryData(itemQuery(params.itemId)))
      throw redirect({ to: '/library/$itemId', params, replace: true })
    throw notFound()
  },
  component: BinItemRoute,
})

/**
 * An item in the Bin, to read before restoring it. Only administrators open the Bin; anyone else
 * who opens the address is told whose page it is, and nothing of the item is read. The service
 * checks every call again.
 */
function BinItemRoute() {
  return (
    <AudienceGate
      audience="administrators"
      title="Bin"
      refusal={{
        title: 'The Bin is for admins',
        description:
          'It holds the facts an admin moved out of the library. Ask the data team if a fact you need is missing.',
      }}
    >
      <BinItem />
    </AudienceGate>
  )
}

function BinItem() {
  const { itemId } = Route.useParams()
  const { data } = useQuery(binItemQuery(itemId))
  if (!data) return <Page title="Bin" aria-busy="true" />
  return <BinItemPage key={data.item.id} entry={data.entry} item={data.item} />
}
