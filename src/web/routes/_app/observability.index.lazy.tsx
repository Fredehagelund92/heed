import { createLazyFileRoute } from '@tanstack/react-router'
import { ObservabilityPage } from '@/pages/observability'

export const Route = createLazyFileRoute('/_app/observability/')({
  component: () => <ObservabilityPage />,
})
