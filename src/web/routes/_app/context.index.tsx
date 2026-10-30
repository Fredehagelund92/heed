import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'
import { contextSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/context/')({
  validateSearch: contextSearch,
  pendingComponent: () => <Loading shape="page" />,
})
