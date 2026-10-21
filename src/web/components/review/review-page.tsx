import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { ProposalRecord, Review } from '@/api'
import { reviewQuery } from '@/api/queries'
import { HeaderActions } from '@/components/app-shell/header-actions'
import { useReviewScope } from '@/components/app-shell/command-scope'
import { ChevronDownIcon, HistoryIcon, RefreshCwIcon, TriangleAlertIcon } from '@/components/icons'
import { Page, PageContent, PageDocument } from '@/components/page/page'
import { PageRail } from '@/components/page/page-rail'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { useMediaQuery } from '@/hooks/use-media-query'
import { proposalTitle } from '@/lib/proposals'
import type { DecisionOutcome } from '@/lib/review'
import type { ProposalSearch } from '@/lib/search-params'
import { useReviewQueue } from '@/lib/use-review-queue'
import { cn } from '@/lib/utils'
import { DecisionBar } from './decision-bar'
import { ReviewDialogs, useReviewModel } from './review-model'
import { ReviewTermBatch } from './term-batch'
import {
  activityCount,
  AgentCard,
  BeforeAndAfter,
  ClaimControl,
  ReviewActivity,
  ReviewApprovals,
  ReviewBadges,
  ReviewAttachedTests,
  ReviewChecks,
  ReviewDiff,
  ReviewDiscussion,
  ReviewMentions,
  ReviewNotes,
  ReviewOverlaps,
  ReviewPeople,
  ReviewSettings,
  SourceToolQuestion,
  WithdrawButton,
} from './review-sections'

/*
  A proposal in review mode (frame C2 of the front end plan, slice W5): what an owner, deputy or
  approver reads before deciding. The main column holds the header, the field diff with its
  Fields and Text switch (FR-209), the mentions with the narrower-audience warning, what an agent
  will see before and after (for a new item, its card first), the activity, and the source-tool
  question (FR-210) as one quiet line above the decision bar. The
  rail holds the checks with their details, the approvals still needed, the test questions
  affected, the overlaps and the review settings an owner may change. Below a 1,024 pixel
  container (1,280 wide with the sidebar) the rail stacks under the main column, so the checks
  are read before deciding. The decision bar is sticky at the bottom. The parts are the review
  panel's too (review-sections.tsx); this page is the full width for a long diff, the review
  settings and what an agent will see.
*/

export function ReviewPage({
  id,
  proposal,
  search,
}: {
  id: string
  /** The item proposal, for its draft; null for a retirement, a re-check or a term. */
  proposal: ProposalRecord | null
  search: ProposalSearch
}) {
  const review = useQuery(reviewQuery(id))
  if (review.isError && !review.data)
    return (
      <Page title={proposal ? proposalTitle(proposal) : 'Proposal'}>
        <PageContent>
          <Alert variant="danger" role="alert">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertContent>
              <AlertTitle>We couldn't load the review</AlertTitle>
              <AlertDescription>
                <Button variant="outline" onClick={() => void review.refetch()}>
                  <RefreshCwIcon />
                  Try again
                </Button>
              </AlertDescription>
            </AlertContent>
          </Alert>
        </PageContent>
      </Page>
    )
  if (!review.data)
    return (
      <Page title={proposal ? proposalTitle(proposal) : 'Proposal'} aria-busy="true">
        <PageContent>
          <span className="sr-only">Loading the review</span>
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </PageContent>
      </Page>
    )
  return <ReviewScreen review={review.data} proposal={proposal} search={search} />
}

function ReviewScreen({
  review,
  proposal,
  search,
}: {
  review: Review
  proposal: ProposalRecord | null
  search: ProposalSearch
}) {
  const navigate = useNavigate()
  const model = useReviewModel(review, proposal)
  const phone = useMediaQuery('(max-width: 47.99rem)')
  // The rail sits beside the main column from 1,280 wide, whether the sidebar is open or a
  // rail, and stacks under it below (frame C2), so the checks are read before deciding.
  const wide = useMediaQuery('(min-width: 80rem)')
  const { id, bar, change, title } = model
  const { rows: queueRows } = useReviewQueue()

  // ---- the queue around this proposal (j and k) ----
  // Stepping through the queue replaces the entry, so Back returns to where the queue was
  // opened from, not through every proposal read; the entry keeps what it came from.
  const position = queueRows.findIndex((row) => row.id === id)
  const neighbour = (delta: number) => {
    const row = position === -1 ? undefined : queueRows[position + delta]
    return row
      ? () =>
          void navigate({
            to: '/proposals/$proposalId',
            params: { proposalId: row.id },
            replace: true,
            state: true,
          })
      : null
  }
  const previousId = queueRows[position - 1]?.id
  const nextId = queueRows[position + 1]?.id
  const reviewScope = useMemo(
    () => ({
      canOpen: (outcome: DecisionOutcome) => bar.outcomes[outcome]?.allowed === true,
      open: (outcome: DecisionOutcome) => model.dialogs.openDecision(outcome),
      next: neighbour(1),
      previous: neighbour(-1),
    }),
    // The bar and the queue are read fresh on every render; the scope follows them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      bar.state,
      bar.outcomes.accept?.allowed,
      bar.outcomes.reject?.allowed,
      bar.outcomes.request_changes?.allowed,
      position,
      queueRows.length,
      previousId,
      nextId,
    ],
  )
  useReviewScope(reviewScope)

  const setCompare = (value: 'fields' | 'text') =>
    void navigate({
      to: '/proposals/$proposalId',
      params: { proposalId: id },
      search: { ...search, compare: value === 'fields' ? undefined : value },
      replace: true,
      state: true,
    })
  const compare = search.compare ?? 'fields'

  const checks = <ReviewChecks model={model} variant={phone ? 'folded' : 'card'} />
  const claimControl = <ClaimControl model={model} />
  const withdrawButton = <WithdrawButton model={model} />
  const headerActions = model.claimable || model.canWithdraw
  // A new item leads with the agent's card, open (heed-ux A9), unless it was resubmitted: then
  // what changed since the request leads (heed-ux B2). A change keeps the before and after
  // folded under what changed.
  const agentView =
    proposal && model.itemEdit ? (
      change === 'create' ? (
        <AgentCard proposal={proposal} />
      ) : (
        <BeforeAndAfter proposal={proposal} live={model.libraryItem?.summary ?? null} />
      )
    ) : null
  const leadWithAgent = change === 'create' && model.diff.view !== 'since'

  return (
    <Page title={title} heading="paper" data-template="document" data-mode="review">
      <HeaderActions>
        {claimControl}
        {withdrawButton}
      </HeaderActions>

      <PageDocument
        data-companion={wide ? 'beside' : 'below'}
        className={cn(
          'grow pt-6',
          wide ? 'flex-row items-start' : '@6xl:flex-col @6xl:items-stretch',
        )}
      >
        <article
          data-slot="paper"
          aria-label="Proposal under review"
          className="flex w-full min-w-0 flex-1 flex-col gap-8"
        >
          <header className="flex flex-col gap-3">
            <ReviewBadges model={model} />
            <h1 className="text-display font-bold tracking-display break-words">{title}</h1>
            <ReviewPeople model={model} />
            <ReviewNotes model={model} />
            {phone && headerActions ? (
              <div className="flex flex-wrap items-center gap-2">
                {claimControl}
                {withdrawButton}
              </div>
            ) : null}
          </header>

          {/* A new item leads with what an agent will see (heed-ux A9). */}
          {leadWithAgent ? agentView : null}

          {/* On a phone the checks are one folded row, read before the diff (frame C2, phone). */}
          {phone ? checks : null}

          <ReviewDiff model={model} compare={compare} onCompare={setCompare} />

          <ReviewTermBatch model={model} />

          <ReviewMentions model={model} />

          {leadWithAgent ? null : agentView}

          <ReviewDiscussion model={model} />

          <Collapsible className="flex flex-col gap-3 rounded-lg border bg-card">
            <CollapsibleTrigger className="group/activity flex min-h-control-touch items-center gap-3 rounded-lg px-4 text-left">
              <HistoryIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-body font-bold">History</span>
              <span className="text-caption text-muted-foreground tabular-nums">
                {activityCount(model)}
              </span>
              <ChevronDownIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/activity:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-6 px-4 pb-4">
              <ReviewActivity model={model} />
            </CollapsibleContent>
          </Collapsible>

          {change !== 'retire' ? <SourceToolQuestion model={model} /> : null}
        </article>

        <PageRail
          aria-label="Checks, approvals and overlaps"
          data-slot="review-companion"
          placement={wide ? 'beside' : 'below'}
        >
          {phone ? null : checks}
          <ReviewAttachedTests model={model} />
          <ReviewApprovals model={model} />
          <ReviewOverlaps model={model} />
          <ReviewSettings model={model} />
        </PageRail>
      </PageDocument>

      <DecisionBar bar={bar} onOpen={(outcome) => model.dialogs.openDecision(outcome)} />
      <ReviewDialogs model={model} />
    </Page>
  )
}
