import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { areasQuery } from '@/api/queries'
import { RolesPending } from '@/components/page/audience-gate'
import { usePermissions } from '@/lib/use-session'

export const Route = createFileRoute('/areas')({
  component: AreasRoute,
})

/**
 * The retired Areas page (navigation decision, 12 October 2026): a domain is in its record in
 * Health, so an old link opens the record of the first domain the person reads, as the page
 * opened on it. Health tells anyone it is not for whose page it is. The roles and the domains are
 * reads, so the page waits for them rather than guess.
 */
function AreasRoute() {
  const { ready, isAdmin, canReview } = usePermissions()
  const areas = useQuery(areasQuery())
  if (!ready || areas.isPending) return <RolesPending title="Health" />
  const area = areas.data?.find((candidate) => isAdmin || canReview(candidate.id))
  return <Navigate to="/health" search={area ? { open: `domain:${area.id}` } : {}} replace />
}
