import { createFileRoute, Navigate } from '@tanstack/react-router'
import { GapsPage } from '@/components/gaps/gaps-page'
import { RolesPending } from '@/components/page/audience-gate'
import { validateGapsSearch } from '@/lib/search-params'
import { usePermissions } from '@/lib/use-session'
import { workbenchFromGaps } from '@/lib/workbench-address'

export const Route = createFileRoute('/gaps')({
  validateSearch: validateGapsSearch,
  component: GapsRoute,
})

/**
 * The Gaps page, for everyone Health is not for (Workbench plan, slice W8). An owner, deputy or
 * administrator works on gaps in Health, so their link lands on its Gaps view with the same
 * search, filters and open gap; the topic counts stay here for them too. The roles are a read,
 * not the router's context, so the page waits for them rather than flash the list.
 */
function GapsRoute() {
  const search = Route.useSearch()
  const { ready, isFor } = usePermissions()
  if (!ready) return <RolesPending title="Gaps" />
  const workbench = isFor('quality') ? workbenchFromGaps(search) : null
  if (workbench) return <Navigate to="/health" search={workbench} replace />
  return <GapsPage search={search} />
}
