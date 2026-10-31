import { createLazyFileRoute } from '@tanstack/react-router'
import { ConflictPage } from '@/pages/conflicts'

export const Route = createLazyFileRoute('/_app/context/conflicts/$key')({ component: Page })

function Page() {
  const { key } = Route.useParams()
  return <ConflictPage key={key} pairKey={key} />
}
