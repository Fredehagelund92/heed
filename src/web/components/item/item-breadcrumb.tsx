import { useRouterState } from '@tanstack/react-router'
import { useItemListOrder, useListContext } from '@/lib/use-item-list-order'
import { validateLibrarySearch } from '@/lib/search-params'

export default function ItemCrumb({ kind, itemId }: { kind: string; itemId: string }) {
  const search = useRouterState({ select: (state) => state.location.search })
  const list = validateLibrarySearch(search)
  const order = useItemListOrder(list, itemId)
  // The position only when the page carries the list it was opened from.
  const index = useListContext(list) ? order.rows.findIndex((row) => row.id === itemId) : -1
  return (
    <>
      {kind}
      {index >= 0
        ? ` · ${(index + 1).toLocaleString('en')} of ${order.rows.length.toLocaleString('en')}`
        : ''}
    </>
  )
}
