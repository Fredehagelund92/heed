import { useQuery } from '@tanstack/react-query'
import type { ProposalRecord } from '@/api'
import { areasQuery, catalogueQuery, itemQuery, proposalQuery, sessionQuery } from '@/api/queries'
import { Page, PageContent } from '@/components/page/page'
import { Button } from '@/components/ui/button'
import { ContextForm } from './context-form'

export function ContextPage({
  draftId,
  asked,
  itemId,
  metric,
  about,
  from,
  evidence,
  onCreated,
}: {
  draftId?: string
  /** The month people asked about, YYYY-MM, for a draft started from a gap. */
  asked?: string
  itemId?: string
  /** A new draft about this metric, from its term page. */
  metric?: string
  /** A new draft about the scope Try it asked about, and its first day. */
  about?: readonly string[]
  from?: string
  /** A new draft from a capture link: the page and the sentence selected on it. */
  evidence?: { url?: string; quote?: string }
  onCreated: (proposal: ProposalRecord) => void
}) {
  const session = useQuery(sessionQuery())
  const areas = useQuery(areasQuery())
  const catalogue = useQuery(catalogueQuery())
  const item = useQuery({ ...itemQuery(itemId ?? ''), enabled: Boolean(itemId) })
  const proposal = useQuery({ ...proposalQuery(draftId ?? ''), enabled: Boolean(draftId) })
  // A new draft about a metric or a scope takes its domain from the metric's (FR-123), which the
  // catalogue says: the form waits for it, so Submit never meets a domain still being worked out.
  const infers = !draftId && !itemId && Boolean(metric || about?.length)
  const pending =
    session.isPending ||
    areas.isPending ||
    (infers && catalogue.isPending) ||
    (itemId && item.isPending) ||
    (draftId && proposal.isPending)
  const failed =
    session.isError || areas.isError || (itemId && item.isError) || (draftId && proposal.isError)
  if (failed)
    return (
      <Page title="Add a fact">
        <PageContent>
          <p role="alert">We couldn't load the form. Your saved draft is safe.</p>
          <Button
            variant="outline"
            onClick={() => {
              void session.refetch()
              void areas.refetch()
              if (itemId) void item.refetch()
              if (draftId) void proposal.refetch()
            }}
          >
            Try again
          </Button>
        </PageContent>
      </Page>
    )
  if (pending || !session.data || !areas.data)
    return (
      <Page title="Add a fact">
        <PageContent>
          <p role="status">Loading the form...</p>
        </PageContent>
      </Page>
    )
  if ((draftId && !proposal.data) || (itemId && (!item.data || item.data.status === 'retired')))
    return (
      <Page title="Fact unavailable">
        <PageContent>
          <p>This draft or fact isn't available. It may have been archived or sent.</p>
        </PageContent>
      </Page>
    )
  if (
    proposal.data &&
    (proposal.data.proposerId !== session.data.person.id ||
      !['draft', 'changes_requested'].includes(proposal.data.state))
  )
    return (
      <Page title="Draft unavailable">
        <PageContent>
          <p>You can't edit this proposal here.</p>
        </PageContent>
      </Page>
    )
  return (
    <ContextForm
      areas={areas.data}
      catalogue={catalogue.data}
      source={proposal.data ?? item.data ?? undefined}
      personId={session.data.person.id}
      asked={asked}
      metric={metric}
      about={about}
      from={from}
      evidence={evidence}
      onCreated={onCreated}
    />
  )
}
