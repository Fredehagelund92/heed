import { createFileRoute } from '@tanstack/react-router'
import { ObservabilityPage } from '@/pages/observability'
import { observabilitySearch } from '@/lib/search'

export const Route = createFileRoute('/_app/observability/$section')({
  validateSearch: observabilitySearch,
  component: Page,
})

function Page() {
  return <ObservabilityPage section={Route.useParams().section} />
}
