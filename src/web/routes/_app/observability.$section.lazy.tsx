import { createLazyFileRoute } from '@tanstack/react-router'
import { ObservabilityPage } from '@/pages/observability'

export const Route = createLazyFileRoute('/_app/observability/$section')({ component: Page })

function Page() {
  return <ObservabilityPage section={Route.useParams().section} />
}
