import { createFileRoute } from '@tanstack/react-router'
import { ApprovePage } from '@/components/connect/approve-page'
import { validateConnectApproveSearch } from '@/lib/search-params'

/**
 * Where the login server sends a person whose AI app asked to connect: sign in, then allow or
 * deny. Not nested under /connect, so the Connect page can be its own route.
 */
export const Route = createFileRoute('/connect_/approve')({
  validateSearch: validateConnectApproveSearch,
  component: ApproveRoute,
})

function ApproveRoute() {
  return <ApprovePage requestId={Route.useSearch().request} />
}
