import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  areasQuery,
  libraryQuery,
  peopleQuery,
  proposalListQuery,
  REVIEW_QUEUE_PAGE,
  reviewQueueQuery,
} from '@/api/queries'
import { useDeciding, waitingRows } from '@/lib/deciding'
import { reviewsAnything, toQueueRow } from '@/lib/review'
import { usePermissions } from '@/lib/use-session'

/**
 * The person's To review queue as rows: the queue in its own order (risk, then age), with the
 * names, the domains and each proposal's kind of context resolved. The queue carries no kind
 * (gap G2), so the open item proposals the person may read give it, and the library gives it for
 * a retirement. A proposal whose decision is on its way has left it (lib/deciding.ts). Off for
 * someone who reviews nothing.
 */
export function useReviewQueue() {
  const permissions = usePermissions()
  const enabled = permissions.ready && reviewsAnything(permissions.permissions)
  const queue = useQuery({ ...reviewQueueQuery(REVIEW_QUEUE_PAGE), enabled })
  const submitted = useQuery({
    ...proposalListQuery({ state: 'submitted', limit: 100 }),
    enabled,
  })
  const inReview = useQuery({
    ...proposalListQuery({ state: 'in_review', limit: 100 }),
    enabled,
  })
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const { data: library } = useQuery(libraryQuery())
  const deciding = useDeciding()
  const rows = useMemo(
    () =>
      waitingRows(queue.data ?? [], deciding).map((proposal) =>
        toQueueRow(proposal, {
          areas,
          people,
          proposals: [...(submitted.data?.rows ?? []), ...(inReview.data?.rows ?? [])],
          items: library?.items ?? [],
        }),
      ),
    [queue.data, deciding, submitted.data, inReview.data, areas, people, library],
  )
  return {
    enabled,
    queue,
    rows,
    /** How many wait for the person, once the queue is read. */
    count: queue.data ? rows.length : null,
    today: library?.today ?? null,
    viewerId: permissions.personId,
  }
}
