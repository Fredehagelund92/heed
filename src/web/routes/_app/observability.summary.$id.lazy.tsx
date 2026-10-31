import { createLazyFileRoute } from '@tanstack/react-router'
import { ObservabilityPage } from '@/pages/observability'

export const Route = createLazyFileRoute('/_app/observability/summary/$id')({ component: Page })

// One of Summary's monthly snapshots, as a digest to print or save as a PDF.
function Page() {
  return <ObservabilityPage section="summary" snapshot={Route.useParams().id} />
}
