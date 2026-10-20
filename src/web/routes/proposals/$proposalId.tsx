import { createFileRoute, notFound } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { proposalQuery, reviewQuery } from '@/api/queries'
import { Page, PageContent } from '@/components/page/page'
import { ProposalPage } from '@/components/proposal/proposal-page'
import { ReviewPage } from '@/components/review/review-page'
import { opensInReview } from '@/lib/review'
import { validateProposalSearch } from '@/lib/search-params'
import { usePermissions } from '@/lib/use-session'

export const Route = createFileRoute('/proposals/$proposalId')({
  validateSearch: validateProposalSearch,
  loader: async ({ context, params }) => {
    const proposal = await context.queryClient.ensureQueryData(proposalQuery(params.proposalId))
    if (proposal) return { crumb: `#${proposal.number}` }
    // A proposal the list does not read (a term) still opens through its review data.
    const review = await context.queryClient.ensureQueryData(reviewQuery(params.proposalId))
    if (!review) throw notFound()
    // The paper shows the title; the breadcrumb ends with the proposal's number (contract 8.6).
    return { crumb: `#${review.proposal.number}` }
  },
  component: ProposalRoute,
})

/**
 * A single proposal in one of two modes, by what the person may do (front end plan, call 1):
 * review mode for an owner, deputy or approver of its domain while it waits for a decision,
 * status mode for everyone else and once it is decided.
 */
function ProposalRoute() {
  const { proposalId } = Route.useParams()
  const search = Route.useSearch()
  const permissions = usePermissions()
  const { data: proposal } = useSuspenseQuery(proposalQuery(proposalId))
  const review = useQuery({ ...reviewQuery(proposalId), enabled: !proposal })
  if (!permissions.ready) return <Page title="Proposal" aria-busy="true" />
  if (!proposal) {
    if (review.data)
      return <ReviewPage key={proposalId} id={proposalId} proposal={null} search={search} />
    // A draft discarded on this page reads as gone until the page moves on.
    return (
      <Page title="Proposal">
        <PageContent>
          <p className="text-body text-muted-foreground">
            {review.isPending ? '' : 'This proposal is no longer available.'}
          </p>
        </PageContent>
      </Page>
    )
  }
  // A term has no item draft: it reads through its review, whoever opens it.
  if (proposal.subject === 'vocabulary')
    return <ReviewPage key={proposal.id} id={proposal.id} proposal={null} search={search} />
  return opensInReview(proposal, permissions.permissions) ? (
    <ReviewPage key={proposal.id} id={proposal.id} proposal={proposal} search={search} />
  ) : (
    <ProposalPage key={proposal.id} proposal={proposal} search={search} />
  )
}
