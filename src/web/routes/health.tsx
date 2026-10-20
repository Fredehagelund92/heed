import { createFileRoute } from '@tanstack/react-router'
import { AudienceGate } from '@/components/page/audience-gate'
import { WorkbenchPage } from '@/components/workbench/workbench-page'
import { validateWorkbenchSearch } from '@/lib/search-params'

export const Route = createFileRoute('/health')({
  validateSearch: validateWorkbenchSearch,
  component: HealthRoute,
})

/**
 * Health (Workbench plan, slices W4 to W8; navigation decision, 12 October 2026): one working
 * surface for owners, deputies and administrators, among the main places in the sidebar, on the
 * Workbench page template. It took over from Quality, from the Gaps page for them and from Areas,
 * whose old links land here; anyone else is told whose page it is, and nothing of the page is
 * read.
 */
function HealthRoute() {
  const search = Route.useSearch()
  return (
    <AudienceGate
      audience="quality"
      title="Health"
      refusal={{
        title: 'Health is for owners and admins',
        description:
          "It's where the owners of each domain see how well AI apps answer with its facts, and what to fix. Ask the owner of your domain or the data team.",
      }}
    >
      <WorkbenchPage search={search} />
    </AudienceGate>
  )
}
