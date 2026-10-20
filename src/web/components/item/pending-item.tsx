import { Link } from '@tanstack/react-router'
import type { ProposalRecord } from '@/api/client'
import { ClockIcon } from '@/components/icons'
import { Page, PageContent } from '@/components/page/page'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

/*
  An item's address before the item is accepted: an import, an agent's draft or a form names the
  item's id as soon as its proposal is sent. The library holds only accepted items, so the address
  says the item is waiting for review and leads to its proposal, instead of "Page not found".
*/

export function PendingItem({ proposal }: { proposal: Pick<ProposalRecord, 'id' | 'number'> }) {
  return (
    <Page title="Waiting for review">
      <PageContent>
        <Empty data-slot="pending-item" className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClockIcon />
            </EmptyMedia>
            <EmptyTitle>This fact is waiting for review</EmptyTitle>
            <EmptyDescription>
              It is in proposal #{proposal.number}. It shows in the library, and AI apps get it,
              once an owner of its domain accepts it.
            </EmptyDescription>
          </EmptyHeader>
          <Button
            render={<Link to="/proposals/$proposalId" params={{ proposalId: proposal.id }} />}
          >
            Open proposal #{proposal.number}
          </Button>
        </Empty>
      </PageContent>
    </Page>
  )
}
