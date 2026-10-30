import { createFileRoute } from '@tanstack/react-router'
import { ObservabilityPage } from '@/pages/observability'
import { observabilitySearch } from '@/lib/search'

export const Route = createFileRoute('/_app/observability/')({
  validateSearch: observabilitySearch,
  component: () => <ObservabilityPage />,
})
