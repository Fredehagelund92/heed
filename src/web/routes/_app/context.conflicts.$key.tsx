import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'

export const Route = createFileRoute('/_app/context/conflicts/$key')({
  pendingComponent: () => <Loading shape="page" />,
})
