import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'

// The review is a place to work, inside the shell with the sidebar as its icon rail. Esc goes back to the Inbox.
export const Route = createFileRoute('/_app/inbox/$id/review')({
  pendingComponent: () => <Loading shape="review" />,
})
