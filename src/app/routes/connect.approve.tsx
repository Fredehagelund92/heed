import { createFileRoute } from '@tanstack/react-router'
import { ConnectApprovePage } from '@/pages/connect-approve'
import { connectApproveSearch } from '@/lib/search'

// Where the login server sends a person whose agent asked to connect: outside the app's shell, as
// sign-in is, signed in or not.
export const Route = createFileRoute('/connect/approve')({
  validateSearch: connectApproveSearch,
  component: ConnectApprovePage,
})
