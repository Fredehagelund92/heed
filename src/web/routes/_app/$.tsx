import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'

// An address the app does not know: a page that says so (pages/not-found.tsx), never another page
// under the wrong address.
export const Route = createFileRoute('/_app/$')({
  pendingComponent: () => <Loading shape="page" />,
})
