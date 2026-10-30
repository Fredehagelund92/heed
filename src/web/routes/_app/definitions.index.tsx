import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'
import { definitionsSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/definitions/')({
  validateSearch: definitionsSearch,
  pendingComponent: () => <Loading shape="page" />,
})
