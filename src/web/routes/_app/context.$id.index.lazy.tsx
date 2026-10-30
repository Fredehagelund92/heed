import { createLazyFileRoute } from '@tanstack/react-router'
import { FactPage } from '@/pages/fact'

export const Route = createLazyFileRoute('/_app/context/$id/')({ component: Page })

function Page() {
  return <FactPage id={Route.useParams().id} />
}
