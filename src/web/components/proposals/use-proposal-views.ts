import { useQuery } from '@tanstack/react-query'
import { proposalListQuery } from '@/api/queries'
import { keptRows, useDiscarding } from '@/lib/discarding'
import { MINE, mineProposals } from '@/lib/my-drafts'
import { proposalViewsFor } from '@/lib/proposals'
import { reviewsAnything } from '@/lib/review'
import { useReviewQueue } from '@/lib/use-review-queue'
import { usePermissions } from '@/lib/use-session'
import type { ViewChip } from './view-chips'

/**
 * The view chips with their counts: To review counts what waits for the person (amber while
 * anything does), Mine the person's own proposals (amber while one needs them), less the drafts
 * on their way out.
 */
export function useProposalViews(): ViewChip[] {
  const permissions = usePermissions()
  const reviews = reviewsAnything(permissions.permissions)
  const mine = useQuery(proposalListQuery(MINE))
  const gone = useDiscarding()
  const own = mine.data ? keptRows(mineProposals(mine.data.rows), gone) : null
  const { count: waiting } = useReviewQueue()
  return proposalViewsFor(reviews).map((candidate) =>
    candidate.id === 'review'
      ? {
          id: candidate.id,
          title: candidate.title,
          count: waiting,
          attention: (waiting ?? 0) > 0,
        }
      : {
          id: candidate.id,
          title: candidate.title,
          // Mine lists item creates and changes, and terms (lib/my-drafts.ts, mineProposals).
          count: own ? own.length : null,
          attention: (own ?? []).some((proposal) => proposal.state === 'changes_requested'),
        },
  )
}
