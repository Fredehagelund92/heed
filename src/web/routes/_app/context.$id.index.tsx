import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'

export const Route = createFileRoute('/_app/context/$id/')({
  pendingComponent: () => <Loading shape="page" />,
})
