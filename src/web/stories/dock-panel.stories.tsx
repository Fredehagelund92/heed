import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'
import { demoGapIds, demoProposalIds, demoReviewIds } from '@/api/mock-demo-proposals'
import { EllipsisIcon, PencilIcon } from '@/components/icons'
import { DomainBadge, KindIcon } from '@/components/item/item-marks'
import { DockPanel } from '@/components/page/dock-panel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TabsContent } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StoryApp } from './story-app'

/**
 * The docked panel (design round 3, direction A): one record opened from a grid, beside it.
 * From 1,224 wide it docks on the right and the shell folds the sidebar to its rail; below that
 * it lies over the grid; on a phone it is a modal full-screen sheet with a back arrow and contained focus. Use the viewport menu
 * for 1440, 1024 and 390 and the theme menu for dark. The stories below show it in the real
 * shell: a library item, a proposal of the review queue with its decision bar, one of Maria's
 * own proposals in status mode, a metric and a dimension of the catalogue, and a gap.
 */
const meta = {
  title: 'Parts/Dock panel',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const tabs = [
  { value: 'read', label: 'Read' },
  { value: 'source', label: 'Source' },
  { value: 'history', label: 'History' },
] as const

function Sample({
  title = 'New tax rate applied in Poland from 8 June 2026',
  ends = false,
}: {
  title?: string | null
  ends?: boolean
}) {
  const [tab, setTab] = useState<(typeof tabs)[number]['value']>('read')
  return (
    <DockPanel
      title={title}
      meta={
        <>
          <KindIcon kind="event" decorative />
          <span className="truncate">Event</span>
          <span className="shrink-0">· 2 of 1,404</span>
        </>
      }
      badges={<DomainBadge name="Sales" label="teal" />}
      tabs={tabs}
      tab={tab}
      onTabChange={setTab}
      tabsLabel="Record sections"
      onPrevious={ends ? undefined : () => undefined}
      onNext={ends ? undefined : () => undefined}
      expand={<a href="#page" />}
      onClose={() => undefined}
      footer={
        <>
          <Button variant="outline">
            <PencilIcon />
            Suggest a change
          </Button>
          <Button variant="outline" size="icon" aria-label="More actions">
            <EllipsisIcon />
          </Button>
        </>
      }
    >
      <TabsContent value="read" className="flex flex-col gap-3 text-body">
        <p>
          New tax rate applied in Poland from 8 June 2026. Check the source tool before you quote
          the number.
        </p>
      </TabsContent>
      <TabsContent value="source" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </TabsContent>
      <TabsContent value="history" className="text-body">
        One version.
      </TabsContent>
    </DockPanel>
  )
}

/** The title first, then the badges; the bar names the kind; the footer's actions are ghost. */
export const Default: Story = {
  render: () => <Sample />,
  play: async ({ canvasElement }) => {
    const panel = within(canvasElement).getByRole('region')
    await expect(within(panel).getByText('Event')).toBeInTheDocument()
    await expect(within(panel).getByRole('button', { name: 'Suggest a change' })).not.toHaveClass(
      'border-border',
    )
  },
}

/** At the first or last row of the list: Previous and Next are off. */
export const AtTheEnds: Story = {
  render: () => <Sample ends />,
  play: async ({ canvasElement }) => {
    const panel = within(canvasElement).getByRole('region')
    await expect(within(panel).getByRole('button', { name: 'Previous' })).toBeDisabled()
    await expect(within(panel).getByRole('button', { name: 'Next' })).toBeDisabled()
  },
}

/** The record is still loading: a placeholder for the title. */
export const Loading: Story = { render: () => <Sample title={null} /> }

export const LongTitle: Story = {
  render: () => (
    <Sample title="Comparing Average order value between France and other markets after the payment provider switched in the United Kingdom on 12 June 2026" />
  ),
}

/** The tabs from the keyboard: arrows move between them, the panel keeps them to itself. */
export const TabsFromTheKeyboard: Story = {
  render: () => <Sample />,
  play: async ({ canvasElement }) => {
    const panel = within(canvasElement).getByRole('region')
    await userEvent.click(within(panel).getByRole('tab', { name: 'Read' }))
    await userEvent.keyboard('{ArrowRight}')
    await expect(within(panel).getByRole('tab', { name: 'Source' })).toHaveFocus()
  },
}

export const Phone: Story = {
  render: () => <Sample />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

/** The library with an item open in the panel, in the real shell. */
export const LibraryItem: Story = {
  name: 'Library: an item open',
  render: () => <StoryApp path="/library?panel=itm_zgk6ael1" />,
}

/** An item that asks for a look, as its owner: the note line and Mark as checked. */
export const LibraryItemThatAsks: Story = {
  name: 'Library: an item that asks for a look',
  render: () => <StoryApp path="/library?panel=itm_gjdvl50x" person="per_jon" />,
}

export const LibrarySourceTab: Story = {
  name: 'Library: the Source tab',
  render: () => <StoryApp path="/library?panel=itm_gjdvl50x&tab=source" />,
}

export const LibraryLinksTab: Story = {
  name: 'Library: the Links tab',
  render: () => <StoryApp path="/library?panel=itm_jyfuvl07&tab=links" />,
}

export const LibraryNotFound: Story = {
  name: 'Library: an item that is not there',
  render: () => <StoryApp path="/library?panel=itm_nothere1" />,
}

/** j steps the panel to the next row; Escape closes it. */
export const LibraryKeyboard: Story = {
  name: 'Library: j and Escape',
  render: () => <StoryApp path="/library?panel=itm_zgk6ael1" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const panel = await canvas.findByRole('region', { name: /New tax rate applied in Poland/ })
    await waitFor(() => expect(panel).toHaveTextContent('2 of'), { timeout: 10_000 })
    await userEvent.keyboard('j')
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-slot="dock-meta"]')).toHaveTextContent('3 of'),
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(canvasElement.querySelector('[data-slot="dock-panel"]')).toBeNull())
  },
}

export const LibraryTablet: Story = {
  name: 'Library: over the grid at 1024',
  render: () => <StoryApp path="/library?panel=itm_zgk6ael1" />,
  globals: { viewport: { value: 'laptop', isRotated: false } },
}

export const PhoneLibraryItem: Story = {
  name: 'Phone library item',
  render: () => <StoryApp path="/library?panel=itm_zgk6ael1" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

// ---- the Proposals page and the catalogue (design round 3, slice 4) ----

/** Jon's queue with a proposal open: the tabs and the decision bar in the footer. */
export const ReviewQueueProposal: Story = {
  name: 'Review: a proposal open from the queue',
  render: () => <StoryApp path={`/proposals?panel=${demoReviewIds.ready}`} person="per_jon" />,
}

export const ReviewChecksTab: Story = {
  name: 'Review: the Checks tab',
  render: () => (
    <StoryApp path={`/proposals?panel=${demoReviewIds.checks}&tab=checks`} person="per_jon" />
  ),
}

/** Claimed by someone else: every decision stays visible, locked, with its reason. */
export const ReviewBlocked: Story = {
  name: 'Review: blocked decisions',
  render: () => <StoryApp path={`/proposals?panel=${demoReviewIds.claimed}`} person="per_jon" />,
}

export const ReviewNotClaimed: Story = {
  name: 'Review: not claimed yet',
  render: () => <StoryApp path={`/proposals?panel=${demoReviewIds.overdue}`} person="per_jon" />,
}

/** j steps the panel to the next proposal in the queue; Escape closes it. */
export const ReviewKeyboard: Story = {
  name: 'Review: j and Escape',
  render: () => (
    <StoryApp path={`/proposals?panel=${demoReviewIds.approverNext}`} person="per_jon" />
  ),
  play: async ({ canvasElement }) => {
    const meta = () => canvasElement.querySelector('[data-slot="dock-meta"]')
    await waitFor(() => expect(meta()).toHaveTextContent('1 of 10'), { timeout: 10_000 })
    await userEvent.keyboard('j')
    await waitFor(() => expect(meta()).toHaveTextContent('2 of 10'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(canvasElement.querySelector('[data-slot="dock-panel"]')).toBeNull())
  },
}

export const ReviewTablet: Story = {
  name: 'Review: over the queue at 1024',
  render: () => <StoryApp path={`/proposals?panel=${demoReviewIds.ready}`} person="per_jon" />,
  globals: { viewport: { value: 'laptop', isRotated: false } },
}

export const PhoneReview: Story = {
  name: 'Phone review',
  render: () => <StoryApp path={`/proposals?panel=${demoReviewIds.ready}`} person="per_jon" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

/** One of Maria's own proposals, in status mode: the reviewer's word, the reply and the actions. */
export const MyProposal: Story = {
  name: 'Proposals: one of mine, changes requested',
  render: () => (
    <StoryApp path={`/proposals?view=mine&panel=${demoProposalIds.changes_requested}`} />
  ),
}

export const MyDraft: Story = {
  name: 'Proposals: my draft, the Checks tab',
  render: () => (
    <StoryApp path={`/proposals?view=mine&panel=${demoProposalIds.draft}&tab=checks`} />
  ),
}

export const MyAcceptedProposal: Story = {
  name: 'Proposals: one of mine, accepted',
  render: () => <StoryApp path={`/proposals?view=mine&panel=${demoProposalIds.accepted}`} />,
}

/** A metric open from the catalogue: On the shelf, what the library holds, the actions. */
export const CatalogueMetric: Story = {
  name: 'Catalogue: a metric open',
  render: () => <StoryApp path="/catalogue?panel=metric:net_revenue" />,
}

export const CatalogueMetricWithAnIssue: Story = {
  name: 'Catalogue: a metric with an active issue, the Context tab',
  render: () => <StoryApp path="/catalogue?panel=metric:orders&tab=context" />,
}

export const CatalogueSource: Story = {
  name: 'Catalogue: the Source tab',
  render: () => <StoryApp path="/catalogue?panel=metric:orders&tab=source" />,
}

export const CatalogueDimension: Story = {
  name: 'Catalogue: a dimension open',
  render: () => <StoryApp path="/catalogue?panel=dim:market" />,
}

export const CatalogueNotFound: Story = {
  name: 'Catalogue: a term that is not there',
  render: () => <StoryApp path="/catalogue?panel=metric:no_such_metric" />,
}

export const PhoneCatalogue: Story = {
  name: 'Phone catalogue term',
  render: () => <StoryApp path="/catalogue?panel=metric:net_revenue" />,
  globals: { viewport: { value: 'phone', isRotated: false } },
}

/** A gap open beside the list, as a contributor reads it (an owner's opens in the Workbench). */
export const Gap: Story = {
  name: 'Gaps: a gap open',
  render: () => <StoryApp path={`/gaps?gap=${demoGapIds.open}`} />,
}
