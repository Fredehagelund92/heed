import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'
import { conflictsSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/context/conflicts/')({
  validateSearch: conflictsSearch,
  pendingComponent: () => <Loading shape="page" />,
})
