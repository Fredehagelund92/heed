import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'
import { helpSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/help')({
  validateSearch: helpSearch,
  pendingComponent: () => <Loading shape="page" />,
})
