import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'
import { observabilitySearch } from '@/lib/search'

export const Route = createFileRoute('/_app/observability/$section')({
  validateSearch: observabilitySearch,
  pendingComponent: () => <Loading shape="page" />,
})
