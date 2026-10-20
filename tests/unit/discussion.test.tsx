import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProposalEvent } from '@/api'
import { createQueryClient } from '@/api/query-client'
import { Discussion } from '@/components/proposal/discussion'
import { RouterFrame } from '@/stories/router-frame'

const names: Record<string, string> = { per_maria: 'Maria Lindqvist', per_jon: 'Jon Abara' }
const events: ProposalEvent[] = [
  {
    id: 'e1',
    at: '2026-10-06T09:12:00.000Z',
    actorId: 'per_jon',
    kind: 'commented',
    data: { text: 'Name **the regulator**.\n\n# Not a heading\n\n- one\n- two', decisionId: 'd1' },
  },
  { id: 'e2', at: '2026-10-06T09:00:00.000Z', actorId: 'per_jon', kind: 'claimed', data: {} },
  {
    id: 'e3',
    at: '2026-10-06T09:30:00.000Z',
    actorId: 'per_maria',
    kind: 'commented',
    data: { text: 'Will do.' },
  },
]

function renderDiscussion(composer: Parameters<typeof Discussion>[0]['composer']) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterFrame>
        <Discussion
          events={events}
          pending={false}
          proposerId="per_maria"
          area={{ ownerIds: ['per_jon'] }}
          nameOf={(id) => names[id] ?? null}
          viewerId="per_maria"
          audience="Only you, the reviewers of Commercial and administrators read this."
          composer={composer}
        />
      </RouterFrame>
    </QueryClientProvider>,
  )
}

describe('the discussion', () => {
  it('reads as a conversation in the small Markdown of a comment', async () => {
    renderDiscussion(null)
    const region = await screen.findByRole('region', { name: /Discussion/ })
    const comments = within(region)
      .getAllByRole('listitem')
      .filter((li) => li.dataset.slot)
    expect(comments).toHaveLength(2)
    const [first, second] = comments
    expect(within(first!).getByText('Jon Abara')).toBeInTheDocument()
    expect(within(first!).getByText('Owner')).toBeInTheDocument()
    expect(within(first!).getByText('With the request for changes')).toBeInTheDocument()
    expect(within(first!).getByText('the regulator').tagName).toBe('STRONG')
    // A heading in a comment is a bold line, never part of the page's outline.
    expect(within(region).queryByRole('heading', { name: 'Not a heading' })).toBeNull()
    expect(within(second!).getByText('You')).toBeInTheDocument()
    expect(within(second!).getByText('Proposer')).toBeInTheDocument()
    expect(within(region).queryByRole('textbox')).toBeNull()
  })

  it('offers the composer to the people who discuss it', async () => {
    renderDiscussion({
      proposal: { id: 'p1', revision: 3 },
      title: 'Reply to Jon',
      notice: 'Jon is notified in the app.',
      action: 'Send reply',
    })
    expect(await screen.findByRole('textbox', { name: 'Reply to Jon' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument()
    expect(screen.getByText(/Markdown works/)).toBeInTheDocument()
  })
})
