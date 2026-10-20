import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, within } from 'storybook/test'
import { demoProposalIds } from '@/api/mock-demo-proposals'
import { StoryApp } from './story-app'

/*
  The Proposals page and a proposal's status page on the mock (slice W4): Maria's demo week has
  one proposal in every state. Use the viewport menu for 1440, 1024 and 390 and the theme menu
  for light and dark.
*/

const meta = { title: 'Pages/Proposals', parameters: { layout: 'fullscreen' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const proposal = (state: keyof typeof demoProposalIds, tab?: 'fields' | 'preview') => (
  <StoryApp path={`/proposals/${demoProposalIds[state]}${tab ? `?tab=${tab}` : ''}`} />
)

export const Mine: Story = { render: () => <StoryApp path="/proposals" /> }
export const MineSearched: Story = { render: () => <StoryApp path="/proposals?q=norway" /> }
export const MineNoResults: Story = {
  render: () => <StoryApp path="/proposals?q=nothing+like+this" />,
}
export const MineEmpty: Story = { render: () => <StoryApp path="/proposals" scenario="empty" /> }
export const MineLoading: Story = { render: () => <StoryApp path="/proposals" scenario="slow" /> }
/**
 * Mine on the drafts with Maria's draft selected: the selection bar offers Discard with its key,
 * and the draft row keeps its menu in the row button's column.
 */
export const MineDraftsSelected: Story = {
  render: () => <StoryApp path="/proposals?view=mine&state=draft" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('checkbox', { name: 'Select every draft' }, { timeout: 10_000 }),
    )
    const bar = canvas.getByRole('region', { name: 'Selected drafts' })
    await expect(within(bar).getByRole('button', { name: /^Discard/ })).toBeVisible()
  },
}
/** The confirmation of a discard from Mine's selection bar. */
export const MineDiscardDialog: Story = {
  render: MineDraftsSelected.render,
  play: async (context) => {
    await MineDraftsSelected.play?.(context)
    const bar = within(context.canvasElement).getByRole('region', { name: 'Selected drafts' })
    await userEvent.click(within(bar).getByRole('button', { name: /^Discard/ }))
    await expect(
      await screen.findByRole('alertdialog', { name: 'Discard this draft?' }),
    ).toBeVisible()
  },
}
/** Mine on the drafts with none left: every draft was submitted or discarded. */
export const MineNoDrafts: Story = {
  render: () => <StoryApp path="/proposals?view=mine&state=draft" person="per_ravi" />,
}
export const Draft: Story = { render: () => proposal('draft') }
export const WaitingForReview: Story = { render: () => proposal('submitted') }
export const InReview: Story = { render: () => proposal('in_review') }
export const ChangesRequested: Story = { render: () => proposal('changes_requested') }
export const Accepted: Story = { render: () => proposal('accepted') }
export const Rejected: Story = { render: () => proposal('rejected') }
export const Withdrawn: Story = { render: () => proposal('withdrawn') }
export const ChangeFields: Story = { render: () => proposal('in_review', 'fields') }
export const AgentAnswer: Story = { render: () => proposal('changes_requested', 'preview') }
export const AsTheOwner: Story = {
  render: () => (
    <StoryApp path={`/proposals/${demoProposalIds.changes_requested}`} person="per_jon" />
  ),
}
