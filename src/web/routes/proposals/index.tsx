import { createFileRoute } from '@tanstack/react-router'
import { ProposalsPage } from '@/components/proposals/proposals-page'
import { validateProposalsSearch } from '@/lib/search-params'

export const Route = createFileRoute('/proposals/')({
  validateSearch: validateProposalsSearch,
  component: ProposalsRoute,
})

function ProposalsRoute() {
  return <ProposalsPage search={Route.useSearch()} />
}
