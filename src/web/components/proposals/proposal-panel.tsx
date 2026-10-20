import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { proposalQuery, reviewQuery } from '@/api/queries'
import { RefreshCwIcon } from '@/components/icons'
import { ListEmpty } from '@/components/library/list-state'
import { DockPanel } from '@/components/page/dock-panel'
import { StatusPanel } from '@/components/proposal/status-panel'
import { ReviewPanel } from '@/components/review/review-panel'
import { Button } from '@/components/ui/button'
import { opensInReview } from '@/lib/review'
import type { ProposalPanelTab } from '@/lib/search-params'
import { usePermissions } from '@/lib/use-session'

/*
  The proposal open in the Proposals page's docked panel (design round 3, direction A), in the
  mode its page would open in (routes/proposals/$proposalId.tsx): review mode for an owner,
  deputy or approver of its domain while it waits for a decision, status mode for everyone else
  and once it is decided. A proposal the list does not read (a term) opens through its review.
  Expand opens the proposal's page.
*/

export type ProposalPanelProps = {
  id: string
  tab: ProposalPanelTab | undefined
  onTabChange: (tab: ProposalPanelTab) => void
  /** Where the proposal is in the list, when it is in it. */
  position: { index: number; total: number } | null
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
  /** After a decision in the panel: the queue moves on to the next proposal. */
  onDecided?: () => void
}

function Meta({
  number,
  position,
}: {
  number: number | null
  position: ProposalPanelProps['position']
}) {
  return (
    <>
      <span className="truncate">{number === null ? 'Proposal' : `Proposal #${number}`}</span>
      {position ? (
        <span className="shrink-0">
          · {(position.index + 1).toLocaleString('en')} of {position.total.toLocaleString('en')}
        </span>
      ) : null}
    </>
  )
}

export function ProposalPanel(props: ProposalPanelProps) {
  const { id, tab, onTabChange, position, onPrevious, onNext, onClose, onDecided } = props
  const permissions = usePermissions()
  const proposal = useQuery(proposalQuery(id))
  // A term has no item draft: it reads through its review, whoever opens it.
  const reviewMode =
    proposal.data === null ||
    proposal.data?.subject === 'vocabulary' ||
    (proposal.data !== undefined && opensInReview(proposal.data, permissions.permissions))
  const review = useQuery({ ...reviewQuery(id), enabled: permissions.ready && reviewMode })
  // The page goes up to this list, the entry behind it, so its Escape comes back here.
  const expand = (
    <Link to="/proposals/$proposalId" params={{ proposalId: id }} state={{ fromParent: true }} />
  )
  const shared = { onPrevious, onNext, onClose }

  if (permissions.ready && proposal.data && !reviewMode)
    return (
      <StatusPanel
        key={id}
        proposal={proposal.data}
        tab={tab}
        onTabChange={onTabChange}
        meta={<Meta number={proposal.data.number} position={position} />}
        expand={expand}
        {...shared}
      />
    )
  if (permissions.ready && reviewMode && review.data)
    return (
      <ReviewPanel
        key={id}
        review={review.data}
        proposal={proposal.data?.subject === 'item' ? proposal.data : null}
        tab={tab}
        onTabChange={onTabChange}
        meta={<Meta number={review.data.proposal.number} position={position} />}
        expand={expand}
        onDecided={onDecided}
        {...shared}
      />
    )

  const missing = (proposal.data === null || reviewMode) && review.data === null
  const failed = proposal.isError || (reviewMode && review.isError && !review.data)
  return (
    <DockPanel
      title={missing ? 'Proposal not found' : failed ? "We couldn't load the proposal" : null}
      meta={<Meta number={null} position={position} />}
      {...shared}
    >
      {missing ? (
        <ListEmpty
          title="This proposal is no longer available"
          action={
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          }
        >
          It may have been discarded, or the link is mistyped. The list is still where it was.
        </ListEmpty>
      ) : failed ? (
        <ListEmpty
          title="Nothing was lost"
          action={
            <Button
              variant="outline"
              onClick={() => void (proposal.isError ? proposal.refetch() : review.refetch())}
            >
              <RefreshCwIcon />
              Try again
            </Button>
          }
        >
          Check your connection, then try again.
        </ListEmpty>
      ) : null}
    </DockPanel>
  )
}
