import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ProposalRecord } from '@/api'
import { proposalListQuery } from '@/api/queries'
import { keptRows, useDiscarding } from '@/lib/discarding'
import { MINE, myDrafts } from '@/lib/my-drafts'

/**
 * The person's unsubmitted drafts, newest first, from the same cached page of their proposals
 * that Proposals > Mine lists, so Home, the sidebar and Mine show the same drafts and the same
 * count. A draft on its way out (discarded, waiting for Undo) is left out at once. Null until the
 * page has arrived, and while it cannot be read: nothing is said about drafts that were not
 * counted.
 */
export function useMyDrafts(): ProposalRecord[] | null {
  const mine = useQuery(proposalListQuery(MINE))
  const gone = useDiscarding()
  return useMemo(
    () => (mine.data ? keptRows(myDrafts(mine.data.rows), gone) : null),
    [mine.data, gone],
  )
}
