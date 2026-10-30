import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'

export const Route = createFileRoute('/_app/observability/summary/$id')({
  pendingComponent: () => <Loading shape="page" />,
})
