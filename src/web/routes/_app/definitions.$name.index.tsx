import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'

export const Route = createFileRoute('/_app/definitions/$name/')({
  pendingComponent: () => <Loading shape="page" />,
})
